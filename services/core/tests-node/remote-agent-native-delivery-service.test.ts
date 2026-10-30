import { DatabaseSync } from "node:sqlite";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { MAX_TEXT_LENGTH, type SignalEnvelope } from "@openmeld/protocol";
import {
  buildAgentTaskKey,
  buildRemoteAgentRuntimeConversationId,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_FAILURE_PURPOSE,
  REMOTE_AGENT_IMAGE_TRANSFORM_QUOTA_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS,
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS,
  remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
  resolveListSignalsReadQuerySemantics,
  signalSystemNoticeDataSchema,
  spaceMemberDirectorySchema,
  spaceWorkHandoffV2Schema,
} from "@openmeld/schemas";
import type {
  CenterAgentModelRoute,
  MessageChannelConversationLocator,
  OpenMeldDaemonDispatchQueueMessage,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerSubmitTurnRequest,
  ResolveNativeReplyPlacementInput,
} from "@openmeld/schemas/types";
import { describe, expect, it, type Mock, onTestFinished, vi } from "vitest";
import { readAiBilling } from "../src/usage/ai-billing-service";

// This suite owns delivery orchestration. Native funding isolation, encryption,
// balances, and concurrent grants are covered in ai-billing.test.ts.
vi.mock("../src/usage/ai-billing-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/usage/ai-billing-service")>()),
  readAiBilling: vi.fn(async () => ({ status: "available", source: "free" })),
}));

import { rpcCenterAgentListAgentActivitySessions } from "../src/agent-activity/activity-center-agent-rpc";
import {
  claimReadyAgentTaskCompletionSubscription,
  readAgentTaskCompletionSubscription,
  readAgentTaskTerminalOutcome,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { requireCenterAgentContinuationParent } from "../src/center-agent/application/center-agent-delegation-service";
// biome-ignore lint/performance/noNamespaceImport: Spy on the verified result reader at its owner boundary.
import * as summaryRecoveryService from "../src/center-agent/application/task-summary-recovery-service";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
  CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS,
  type CenterAgentMemoryAdapter,
  type CenterAgentMemoryRepository,
} from "../src/center-agent-memory/contract";
import {
  type CenterAgentMemoryService,
  createCenterAgentMemoryService,
} from "../src/center-agent-memory/memory-service";
import { listRecentDispatchLedgerEntriesForSpace } from "../src/dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeCoordinatorClient from "../src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import {
  executeHostedExecutionRecovery,
  inspectHostedExecutionRecovery,
} from "../src/execution-recovery/application/hosted-execution-recovery-coordinator";
import type { CoreBindings } from "../src/lib/bindings";
import { setOrganizationWorkingLanguagePreference } from "../src/organizations/organization-working-language-repository";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import {
  REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS,
  REMOTE_AGENT_TASK_CONTINUATION_ADMISSION_MAX_ATTEMPTS,
} from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  requestRemoteAgentNativeDeliveryStop,
  stopRemoteAgentNativeDelivery,
} from "../src/remote-agent/application/native-delivery-cancellation-service";
import { projectTaskContinuationAdmissionExhaustedInboxItem } from "../src/remote-agent/application/native-delivery-inbox-producer";
import { reconcileTaskContinuationInbox } from "../src/remote-agent/application/native-delivery-inbox-reconciliation";
import {
  completeRemoteAgentNativeDelivery,
  processRemoteAgentNativeDeliveryDeadlineProbe,
  publishRemoteAgentFailureNotice,
  reconcileRemoteAgentRetainedResultPublication,
  retryMissingRemoteAgentAcceptedDeliveryProbes,
  submitRemoteAgentExecutionRecoveryTurn,
  submitRemoteAgentNativeDelivery,
  submitRemoteAgentSlackNativeDelivery,
  submitRemoteAgentTaskContinuationDelivery,
} from "../src/remote-agent/application/native-delivery-service";
import { requirePersonalRemoteAgentBinding } from "../src/remote-agent/application/personal-remote-agent-binding";
import { runPersonalRemoteAgentSpaceTool } from "../src/remote-agent/application/personal-remote-agent-space-tools";
import { attachCenterAgentMemoryToTurnEnvelope } from "../src/remote-agent/application/remote-agent-memory-context";
import { submitRemoteAgentWorkerAdmission } from "../src/remote-agent/application/remote-agent-worker-admission";
import { resolveNativeDeliveryReplyThreadContext } from "../src/remote-agent/application/reply-placement";
import {
  claimRemoteAgentFinalPublication,
  claimRemoteAgentNativeDeliveryTerminalFailure,
  listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace,
  markRemoteAgentCallbackPublishFailure,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  markRemoteAgentNativeDeliveryDeadlineProbeEnqueued,
  markRemoteAgentNativeDeliveryFailure,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
  rearmRemoteAgentNativeDeliveryForWorkLoop,
  recordRemoteAgentNativeDeliveryExecutionProgress,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  rpcExecuteExecutionRecovery,
  rpcInspectExecutionRecovery,
  rpcPostCenterAgentWakePublicationSignal,
} from "../src/rpc/methods";
import { createSpaceBootstrapTimingCollector } from "../src/space/application/space-bootstrap-timing";
import { truncateSpaceTextToProtocolLimit } from "../src/space/application/space-text";
import {
  authorizeSpaceNativeWakeAdmission,
  readNativeSpaceWakeStopIntent,
} from "../src/space/application/space-wake-stop-intent";
import {
  createDispatchOutboxRecord,
  deleteDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  markDispatchOutboxHandedOff,
  readDispatchOutboxRecordByDispatchId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import { resolveHandedOffOutboxCandidatePolicyDecision } from "../src/space/rules/policy/dispatch-outbox-redrive-policy";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./helpers/center-agent-model-route.test-support";
import {
  createPostgresHarness,
  installPostgresWriteFailure,
  observeNativePostgresQueries,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const UUID_V5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const THREAD_CONTEXT: NonNullable<
  OpenMeldDaemonDispatchQueueMessage["threadContext"]
> = {
  threadId: "thr_11111111-1111-4111-8111-111111111111",
  rootSignalId: "signal_thread_root",
};

import { requireCurrentDesignatedCenterAgentCaller } from "../src/center-agent/current-designated-center-agent";
import {
  rpcReadOrganizationSkillRuntimeCatalog,
  rpcReadOrganizationSkillRuntimeResource,
  rpcReadOrganizationSkillRuntimeSnapshot,
} from "../src/organization-skills/organization-skill-rpc";
import { requirePersonalRemoteAgentExecution } from "../src/remote-agent/application/personal-remote-agent-space-tools";
import { prepareRemoteAgentMemberRequest } from "../src/remote-agent/application/remote-agent-member-request";
import { requireRemoteAgentToolCaller } from "../src/remote-agent/application/remote-agent-tool-caller";

const UNSUPPORTED_INTERRUPTION_DETAIL = /502|overloaded|Please try again/u;
const INTERRUPTION_REPLAY_CAUTION =
  /actions may have taken effect.*Check.*before repeating/s;
describe("Remote Agent native delivery callback service", () => {
  it.each([
    "repository",
    "brief",
    "files",
  ])("admits supported handoff materials before starting a hosted provider (%s)", async (materials) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 2100,
        status: "pending" as const,
        submissionId: "handoff-submission",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const message = createDispatchMessage();
    message.sourceSignalSnapshot = {
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      text: "Implement the published plan",
      workHandoff: spaceWorkHandoffV2Schema.parse({
        schemaVersion: 2,
        sourceSignalId: "planning-result",
        sourceRevision: 1,
        ...(materials === "repository"
          ? {
              code: {
                projectId: "project",
                repositoryFingerprint: `sha256:${"a".repeat(64)}`,
                commit: "b".repeat(40),
              },
              execution: { workspace: "isolated" },
            }
          : {
              execution: { workspace: "isolated", access: "space_context" },
            }),
        files:
          materials === "files"
            ? [{ fileId: "report", revision: 3, relativePath: "report.md" }]
            : [],
        skills: [],
        requirements: [],
        work: {
          goal: "Implement",
          completed: "Plan",
          nextSteps: "Fix",
          evidence: [],
          attemptedApproaches: [],
          decisions: [],
          constraints: [],
          openQuestions: [],
          completionCriteria: ["Checks pass"],
        },
      }),
    };
    try {
      if (materials !== "repository") {
        await submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message,
          nowMs: 2100,
        });
        expect(workerSubmit).toHaveBeenCalledOnce();
        expect(workerSubmit.mock.calls[0]?.[0].workHandoff).toEqual(
          message.sourceSignalSnapshot.workHandoff
        );
        expect(
          env.__spaceStub.rpcPostSystemNoticeSignal
        ).not.toHaveBeenCalled();
        return;
      }
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message,
          nowMs: 2100,
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "terminal_failure",
            reasonCode: "space.handoff.code_receiver_unsupported",
            text: expect.stringContaining("Choose a supported Agent"),
          }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: message.idempotencyKey,
        })
      ).resolves.toMatchObject({
        status: "failed",
        failureCode: "space.handoff.code_receiver_unsupported",
      });
    } finally {
      await harness.close();
    }
  });

  it("finishes an accepted legacy Remote turn across a Core upgrade without redispatch or duplicate publication", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn();
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      // A pre-upgrade accepted delivery is already owned by the old Remote.
      // The new Core must consume its original callback without another turn.
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "legacy-inflight",
        submissionId: "legacy-submission",
        dispatchId: "legacy-dispatch",
        spaceId: SPACE_ID,
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
      });
      const callback = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: "legacy-dispatch",
        idempotencyKey: "legacy-inflight",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: "legacy-submission",
        triggerMessageId: "signal_1",
        text: "The completed investigation.",
      };
      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).resolves.toMatchObject({ status: "accepted" });
      await completeRemoteAgentNativeDelivery(env, callback);
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it.each([
    false,
    true,
  ])("freezes task attribution for receiver support=%s across an upgrade", async (supported) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: "UPDATE openmeld.space_index_spaces SET space_purpose = NULL, direct_message_pair_key = NULL WHERE space_id = $1",
      values: [SPACE_ID],
    });
    const readSubmitTurnCapabilities = vi.fn(() => {
      if (!supported) {
        throw new Error(
          'The RPC receiver does not implement the method "readSubmitTurnCapabilities".'
        );
      }
      return Promise.resolve({ v: 1 as const, taskId: true as const });
    });
    const requests: RemoteAgentWorkerSubmitTurnRequest[] = [];
    const workerSubmit = vi.fn(
      (request: RemoteAgentWorkerSubmitTurnRequest) => {
        requests.push(structuredClone(request));
        if (!supported) {
          // Published e4454cf1's strict request has no top-level taskId key.
          expect(request).not.toHaveProperty("taskId");
        }
        if (requests.length === 1) {
          throw new Error("ACK transport lost");
        }
        return Promise.resolve({
          accepted: false,
          createdAt: 1200,
          status: "pending" as const,
          submissionId: "submission-rolling",
        });
      }
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        readSubmitTurnCapabilities,
      },
    });
    const input = {
      binding: createBinding(),
      db: harness.db,
      env,
      executionAttemptId: "attempt-rolling",
      memoryService: null,
      message: createDispatchMessage({ taskId: "task-rolling" }),
      nowMs: 1000,
    };
    try {
      await submitRemoteAgentNativeDelivery(input);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.conversationId).toBe(
        `center-space:${SPACE_ID}:root:${input.message.threadContext?.rootSignalId ?? input.message.sourceEventId}`
      );
      if (!supported) {
        expect(requests[0]).not.toHaveProperty("taskId");
      }
      if (supported) {
        expect(requests[0]?.taskId).toBe("task-rolling");
      }
      readSubmitTurnCapabilities.mockResolvedValue({ v: 1, taskId: true });
      await submitRemoteAgentNativeDelivery({ ...input, nowMs: 2000 });
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "completed",
    "failed",
    "continuation_required",
  ] as const)("handles %s after real Hosted conveyor retirement", async (outcome) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const privateSpaceDatabase = new DatabaseSync(":memory:");
    onTestFinished(() => privateSpaceDatabase.close());
    const sql = {
      exec(statement: string, ...params: (string | number | null)[]) {
        const prepared = privateSpaceDatabase.prepare(statement);
        const rows = prepared.columns().length ? prepared.all(...params) : [];
        const written = prepared.columns().length
          ? 0
          : Number(prepared.run(...params).changes);
        return {
          toArray: () => rows,
          rowsWritten: written,
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    } as unknown as SqlStorage;
    ensureSpaceSqlSchema(sql);
    const record = createDispatchOutboxRecord({
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      bindingState: "bound",
      bindingEnabled: true,
      dispatchPolicy: "mention_only",
      ruleId: "retirement",
      ruleSource: "system",
      ruleReason: "test",
      sourceSignalSnapshot: {
        text: "Continue the investigation.",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      senderProfileId: HUMAN_PROFILE_ID,
      spaceId: SPACE_ID,
      sourceEventId: "signal_1",
      targetProfileId: AGENT_PROFILE_ID,
      nowMs: 1000,
    });
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 32_000,
        status: "pending" as const,
        submissionId: request.dispatchId,
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    env.__spaceStub.rpcReadWakeStopIntent.mockImplementation((query) =>
      readNativeSpaceWakeStopIntent({ db: harness.db, sql, query })
    );
    env.__spaceStub.rpcAuthorizeNativeWakeAdmission.mockImplementation(
      (query) => {
        const result = authorizeSpaceNativeWakeAdmission(sql, query, 32_000);
        return result.status === "not_found"
          ? readNativeSpaceWakeStopIntent({ db: harness.db, sql, query })
          : result;
      }
    );
    try {
      insertDispatchOutboxRecord(sql, record);
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: record.idempotencyKey,
        submissionId: record.dispatchId,
        dispatchId: record.dispatchId,
        spaceId: SPACE_ID,
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
      });
      markDispatchOutboxHandedOff(sql, {
        dispatchId: record.dispatchId,
        handedOffAtMs: 1100,
      });
      expect(
        resolveHandedOffOutboxCandidatePolicyDecision({
          outboxStatus: "handed_off",
          hostedNativeDeliveryHandoffState: "durably_owned",
          nowMs: 32_000,
          recentInflightSkipWithinMs: 15_000,
          staleReclaimMs: 30_000,
          ledgerRow: {
            status: "dispatching",
            lastAttemptAtMs: 1000,
            latestAttemptStatus: "waiting_result",
            latestAttemptErrorCode: null,
            daemonSessionId: null,
            connectionGeneration: null,
            leaseEpoch: null,
          },
        })
      ).toEqual({ kind: "delete" });
      deleteDispatchOutboxRecord(sql, { dispatchId: record.dispatchId });
      expect(
        readDispatchOutboxRecordByDispatchId(sql, record.dispatchId)
      ).toBeNull();
      const identity = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: record.dispatchId,
        idempotencyKey: record.idempotencyKey,
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: record.dispatchId,
        triggerMessageId: "signal_1",
      };
      const callback = {
        continuation_required: {
          ...identity,
          status: "continuation_required" as const,
          checkpoint: {
            reason: "tool_call_budget_exhausted" as const,
            toolCallLimit: 64,
            v: 1 as const,
          },
        },
        failed: {
          ...identity,
          status: "failed" as const,
          failureCode: "remote_agent.turn_not_completed",
          failureMessage: "Could not finish.",
        },
        completed: { ...identity, text: "The completed investigation." },
      }[outcome];
      expect(
        await completeRemoteAgentNativeDelivery(env, callback)
      ).toMatchObject({ status: "accepted" });
      expect(workerSubmit).toHaveBeenCalledTimes(
        outcome === "continuation_required" ? 1 : 0
      );
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledTimes(
        outcome === "completed" ? 1 : 0
      );
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(outcome === "failed" ? 1 : 0);
    } finally {
      await harness.close();
    }
  });
  it.each([
    ["before_checkpoint", false],
    ["after_rearm", false],
    ["before_checkpoint", true],
    ["after_rearm", true],
  ] as const)("honors Stop at work-loop %s with notice retry %s", async (stopAt, failNotice) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn();
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        deliveryId: "delivery-stop-gap",
        dispatchId: "dispatch-stop-gap",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        idempotencyKey: "stop-gap-1",
        spaceId: SPACE_ID,
        submissionId: "stop-gap-submission-1",
        triggerMessageId: "signal-stop-gap",
      });
      env.__spaceStub.rpcReadWakeStopIntent.mockImplementation(async () => {
        const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: "delivery-stop-gap",
        });
        return {
          status:
            stopAt === "before_checkpoint" ||
            delivery?.idempotencyKey !== "stop-gap-1"
              ? "requested"
              : "not_requested",
        };
      });
      const checkpoint = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: "dispatch-stop-gap",
        idempotencyKey: "stop-gap-1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: "stop-gap-submission-1",
        triggerMessageId: "signal-stop-gap",
        status: "continuation_required" as const,
        checkpoint: {
          reason: "tool_call_budget_exhausted" as const,
          toolCallLimit: 64,
          v: 1 as const,
        },
      };
      if (failNotice) {
        env.__spaceStub.rpcPostSystemNoticeSignal.mockRejectedValueOnce(
          new Error("Stop notice publication temporarily unavailable")
        );
        await expect(
          completeRemoteAgentNativeDelivery(env, checkpoint)
        ).rejects.toThrow("Stop notice publication temporarily unavailable");
      }
      await expect(
        completeRemoteAgentNativeDelivery(env, checkpoint)
      ).resolves.toMatchObject({ status: "accepted" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(
        await readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: "delivery-stop-gap",
        })
      ).toMatchObject({
        status: "failed",
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
      });
      await completeRemoteAgentNativeDelivery(env, checkpoint);
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledTimes(
        failNotice ? 2 : 1
      );
      expect(
        await readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: "delivery-stop-gap",
        })
      ).toMatchObject({
        status: "failed",
        publishedSignalId: "signal_reply_1",
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    true,
    false,
  ])("admits a personal Agent without Center designation or memory with fresh acknowledgement %s", async (accepted) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET is_default = 1 WHERE profile_id = $1',
      values: [HUMAN_PROFILE_ID],
    });
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = NULL, owner_user_id = \'user_1\' WHERE profile_id = $1',
      values: [AGENT_PROFILE_ID],
    });
    await harness.query({
      text: 'DELETE FROM "openmeld"."center_agent_designations"',
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'disabled_historical', disabled_at_ms = 1000 WHERE binding_id = 'binding_1'",
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'enabled_primary', disabled_at_ms = NULL, owner_kind = 'owner_account', owner_id = 'user_1', runtime_kind = 'hosted_remote_agent', agent_controller_ref = 'hosted:remote-agent', openmeld_service_runtime_id = 'hosted:remote-agent', hosted_runtime_identity_json = $1 WHERE binding_id = 'binding_1'",
      values: [JSON.stringify(HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY)],
    });
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted,
        createdAt: 2100,
        requestId: "personal-request",
        status: "pending" as const,
        submissionId: "personal-submission",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      sourceSignal: createSignalEnvelope("signal_1", "Please help."),
    });
    const directory = spaceMemberDirectorySchema.parse({
      spaceId: SPACE_ID,
      generatedAt: new Date().toISOString(),
      members: [AGENT_PROFILE_ID, HUMAN_PROFILE_ID].map((profileId) => ({
        profileId,
        profileKind: profileId === AGENT_PROFILE_ID ? "agent" : "human",
        displayName: profileId,
        primaryMentionLabel: profileId,
        mentionLabels: [profileId],
        mentionAlias: null,
        labelSource: "profile_id",
        lookupTokens: [profileId],
        preferredLookupToken: profileId,
        profileIdShort: profileId.slice(0, 8),
        allowedRelations: {
          wake: profileId === AGENT_PROFILE_ID,
          reference: false,
          mention: profileId === HUMAN_PROFILE_ID,
        },
        ownerUserId: "user_1",
        ownerName: "Ari",
        agentCard: null,
        spaceRole: null,
      })),
    });
    const readDirectory = vi.fn(async () => directory);
    Object.assign(env.__spaceStub, { rpcGetMemberDirectory: readDirectory });
    workerSubmit.mockImplementationOnce(async (request) => {
      // Worker preparation can run before Core has persisted its acknowledgement.
      await expect(
        requirePersonalRemoteAgentExecution(env, "personal-submission")
      ).rejects.toThrow("execution_not_active");
      const prepared = await requirePersonalRemoteAgentExecution(
        env,
        "personal-submission",
        request.idempotencyKey
      );
      expect(prepared.request).toMatchObject({
        agentProfileId: AGENT_PROFILE_ID,
      });
      expect(prepared.delivery.status).toBe("submitted");
      await expect(
        rpcReadOrganizationSkillRuntimeSnapshot(env, {
          context: prepared.context,
          preparationIdempotencyKey: request.idempotencyKey,
          releases: [
            {
              skillId: "skill_other",
              releaseId: "release_other",
              name: "other-skill",
              digest: "a".repeat(64),
            },
          ],
        })
      ).rejects.toThrow("prepared_release_mismatch");
      await expect(
        rpcReadOrganizationSkillRuntimeCatalog(env, {
          context: prepared.context,
          preparationIdempotencyKey: request.idempotencyKey,
          releases: [
            {
              skillId: "skill_other",
              releaseId: "release_other",
              name: "other-skill",
              digest: "a".repeat(64),
            },
          ],
        })
      ).rejects.toThrow("prepared_release_mismatch");
      await expect(
        rpcReadOrganizationSkillRuntimeResource(env, {
          context: prepared.context,
          path: "references/checklist.md",
          preparationIdempotencyKey: request.idempotencyKey,
          release: {
            skillId: "skill_other",
            releaseId: "release_other",
            name: "other-skill",
            digest: "a".repeat(64),
          },
        })
      ).rejects.toThrow("prepared_release_mismatch");
      return {
        accepted,
        createdAt: 2100,
        requestId: "personal-request",
        status: "pending" as const,
        submissionId: "personal-submission",
      };
    });
    try {
      const result = await submitRemoteAgentNativeDelivery({
        binding: { ...createBinding(), personalAgent: true },
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
      expect(result.status).toBe("submitted");
      const request = workerSubmit.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        v: 4,
        conversationIdentity: {
          kind: "personal_agent",
          agentProfileId: AGENT_PROFILE_ID,
        },
        organizationSkillReleases: [],
      });
      expect(request?.conversationId).not.toBe(SPACE_ID);
      expect(request?.turnEnvelope.memory).toBeUndefined();
      const execution = await requirePersonalRemoteAgentExecution(
        env,
        "personal-submission"
      );
      expect(execution.delivery.status).toBe(
        accepted ? "accepted" : "retry_observed"
      );
      await expect(
        resolveNativeDeliveryReplyThreadContext({
          env,
          delivery: execution.delivery,
        })
      ).resolves.toEqual(THREAD_CONTEXT);
      expect(
        env.__spaceStub.rpcResolveNativeReplyPlacement
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch_1",
          defaultToThread: true,
          lock: true,
        })
      );
      const sender = execution.request.turnEnvelope.sender;
      if (sender.kind !== "member" || !sender.verified || !sender.ownerUserId) {
        throw new Error("Expected the admitted human requester");
      }
      await expect(
        prepareRemoteAgentMemberRequest(env, execution.context, {
          memberId: sender.id,
          userId: sender.ownerUserId,
        })
      ).resolves.toMatchObject({ member: { userId: sender.ownerUserId } });
      await expect(
        prepareRemoteAgentMemberRequest(env, execution.context, {
          memberId: "another-member",
          userId: sender.ownerUserId,
        })
      ).rejects.toThrow("verified requester");
      await expect(
        rpcCenterAgentListAgentActivitySessions(env, {
          context: execution.context,
          limit: 20,
          speakerMember: {
            memberId: sender.id,
            userId: sender.ownerUserId,
          },
        })
      ).resolves.toMatchObject({ sessions: [] });
      await expect(
        rpcCenterAgentListAgentActivitySessions(env, {
          context: execution.context,
          limit: 20,
          speakerMember: {
            memberId: "another-member",
            userId: sender.ownerUserId,
          },
        })
      ).rejects.toThrow("verified requester");
      await expect(
        requireCurrentDesignatedCenterAgentCaller({
          env,
          context: execution.context,
        })
      ).rejects.toThrow();
      await expect(
        requireRemoteAgentToolCaller({ env, context: execution.context })
      ).resolves.toMatchObject({
        activeOrganization: { organizationId: request?.organizationId },
      });
      await expect(
        requireRemoteAgentToolCaller({
          env,
          context: {
            ...execution.context,
            actorContext: {
              ...execution.context.actorContext,
              openMeldProfileId: "another-agent",
            },
          },
        })
      ).rejects.toThrow("does not match");
      const messageRead = {
        submissionId: "personal-submission",
        operation: { kind: "messages" },
      };
      const history = await runPersonalRemoteAgentSpaceTool(env, messageRead);
      expect(history).toMatchObject({
        kind: "messages",
        messages: [{ content: { text: "Please help." } }],
      });
      expect(env.__spaceStub.rpcListSignalsResult).toHaveBeenLastCalledWith(
        expect.objectContaining({ spaceId: SPACE_ID, limit: 31, recent: true })
      );
      if (history.kind !== "messages" || !history.messages[0]) {
        throw new Error("Expected an exact message reference");
      }
      const sourceRef = history.messages[0].sourceRef;
      const evidenceRead = {
        submissionId: "personal-submission",
        operation: {
          kind: "evidence",
          sourceSignalId: sourceRef.id,
          version: sourceRef.version,
        },
      };
      await expect(
        runPersonalRemoteAgentSpaceTool(env, evidenceRead)
      ).resolves.toMatchObject({
        kind: "evidence",
        message: { sourceRef, content: { text: "Please help." } },
        nextOffset: null,
      });
      await expect(
        runPersonalRemoteAgentSpaceTool(env, {
          ...evidenceRead,
          operation: {
            ...evidenceRead.operation,
            version: `sha256:${"0".repeat(64)}`,
          },
        })
      ).rejects.toThrow("evidence_version_unavailable");
      await expect(
        runPersonalRemoteAgentSpaceTool(env, {
          ...evidenceRead,
          operation: {
            ...evidenceRead.operation,
            sourceSignalId: "missing-source",
          },
        })
      ).rejects.toThrow("evidence_unavailable");
      readDirectory.mockResolvedValueOnce({ ...directory, members: [] });
      await expect(
        runPersonalRemoteAgentSpaceTool(env, evidenceRead)
      ).rejects.toThrow("space_membership_revoked");
      const rootSignal = createSignalEnvelope(
        THREAD_CONTEXT.rootSignalId,
        "Root"
      );
      const replies = [
        createSignalEnvelope("thread-first", "First"),
        createSignalEnvelope("thread-last", "Last"),
      ];
      const readThread = vi.fn(async () => ({
        ok: true,
        value: {
          rootSignal,
          thread: {
            ...THREAD_CONTEXT,
            spaceId: SPACE_ID,
            createdByProfileId: HUMAN_PROFILE_ID,
            createdAt: new Date(1000).toISOString(),
            updatedAt: new Date(1000).toISOString(),
          },
        },
      }));
      const readReplies = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { signals: replies, placements: [] },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { signals: replies, placements: [] },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { signals: replies.slice(1), placements: [] },
        });
      Object.assign(env.__spaceStub, {
        rpcGetThreadResult: readThread,
        rpcListThreadSignalsResult: readReplies,
      });
      let afterSignalId: string | undefined;
      for (const [id, next] of [
        [rootSignal.id, rootSignal.id],
        ["thread-first", "thread-first"],
        ["thread-last", null],
      ] as const) {
        const page = await runPersonalRemoteAgentSpaceTool(env, {
          submissionId: "personal-submission",
          operation: {
            kind: "thread",
            threadId: THREAD_CONTEXT.threadId,
            limit: 1,
            ...(afterSignalId ? { afterSignalId } : {}),
          },
        });
        expect(page).toMatchObject({
          kind: "thread",
          messages: [{ sourceRef: { id } }],
          nextAfterSignalId: next,
        });
        if (page.kind !== "thread") {
          throw new Error("Expected a thread page");
        }
        expect(page.messages).toHaveLength(1);
        afterSignalId = next ?? undefined;
      }
      expect(
        readReplies.mock.calls.map(([query]) => query.afterSignalId)
      ).toEqual([rootSignal.id, rootSignal.id, "thread-first"]);
      const readUpdates = vi.fn(async () => ({ signals: [] }));
      Object.assign(env.__spaceStub, { rpcGetUpdates: readUpdates });
      const updates = await runPersonalRemoteAgentSpaceTool(env, {
        submissionId: "personal-submission",
        operation: { kind: "updates" },
      });
      expect(updates).toEqual({ kind: "updates", signals: [] });
      expect(readUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: SPACE_ID,
          afterSignalId: request?.triggerMessageId,
          limit: 20,
        })
      );
      const targetDmSpaceId = "d".repeat(64);
      const otherOrganizationSpaceId = "e".repeat(64);
      const inaccessibleSpaceId = "f".repeat(64);
      for (const [spaceId, organizationId] of [
        [targetDmSpaceId, "org_1"],
        [otherOrganizationSpaceId, "another-org"],
        [inaccessibleSpaceId, "org_1"],
      ] as const) {
        await harness.query({
          text: `INSERT INTO "openmeld"."space_index_spaces" (
            space_id, organization_id, organization_visibility, status,
            space_name, source_updated_at_ms, projected_at_ms, projection_event_id
          ) VALUES ($1, $2, 'private', 'active', 'DM', 100, 100, $3)`,
          values: [spaceId, organizationId, `projection-${spaceId}`],
        });
      }
      const stopResponse = {
        ok: true,
        runtimeCoordinatorExecutionId: null,
        status: "cancelled",
        stopMode: "openmeld_owned_pre_agent",
        targetProfileId: AGENT_PROFILE_ID,
        cancellationState: {
          observedAtMs: 100,
          reasonCode: "space.wake_stopped_before_send",
          status: "cancelled",
        },
      };
      const checkSpaceAccess = (input: { spaceId: string }) => {
        if (input.spaceId === inaccessibleSpaceId) {
          throw new Error("HTTP 403: Space access denied");
        }
      };
      const readProgress = vi.fn(
        (input: { spaceId: string; clientMessageId: string }) => {
          checkSpaceAccess(input);
          return Promise.resolve({
            query: {
              spaceId: input.spaceId,
              clientMessageId: input.clientMessageId,
              targetProfileId: null,
            },
            items: [],
          });
        }
      );
      const stopWake = vi.fn((input: { spaceId: string }) => {
        checkSpaceAccess(input);
        return Promise.resolve(stopResponse);
      });
      Object.assign(env.__spaceStub, {
        rpcGetWakeProgress: readProgress,
        rpcPostWakeStop: stopWake,
      });
      for (const kind of ["wake_progress", "wake_stop"] as const) {
        const operation =
          kind === "wake_progress"
            ? { kind, query: { clientMessageId: "dm-message" } }
            : {
                kind,
                body: {
                  target: {
                    by: "client_message",
                    clientMessageId: "dm-message",
                    targetProfileId: AGENT_PROFILE_ID,
                  },
                },
              };
        for (const spaceId of [undefined, targetDmSpaceId]) {
          await expect(
            runPersonalRemoteAgentSpaceTool(env, {
              submissionId: "personal-submission",
              operation: { ...operation, ...(spaceId ? { spaceId } : {}) },
            })
          ).resolves.toMatchObject({ kind });
          expect(
            kind === "wake_progress" ? readProgress : stopWake
          ).toHaveBeenLastCalledWith(
            expect.objectContaining({
              spaceId: spaceId ?? SPACE_ID,
              context: expect.objectContaining({
                actorContext: expect.objectContaining({
                  openMeldProfileId: AGENT_PROFILE_ID,
                  ownerUserId: "user_1",
                }),
              }),
            })
          );
        }
        for (const [spaceId, error] of [
          [otherOrganizationSpaceId, "HTTP 404"],
          ["9".repeat(64), "HTTP 404"],
          [inaccessibleSpaceId, "HTTP 403"],
        ]) {
          await expect(
            runPersonalRemoteAgentSpaceTool(env, {
              submissionId: "personal-submission",
              operation: { ...operation, spaceId },
            })
          ).rejects.toThrow(error);
        }
        expect(
          kind === "wake_progress" ? readProgress : stopWake
        ).toHaveBeenCalledTimes(3);
      }
      const siblingProfileId = "agt_22222222-2222-4222-8222-222222222222";
      const sibling = directory.members[0];
      if (!sibling) {
        throw new Error("Expected the active Agent member");
      }
      readDirectory.mockResolvedValueOnce({
        ...directory,
        members: [
          ...directory.members,
          { ...sibling, profileId: siblingProfileId },
        ],
      });
      await runPersonalRemoteAgentSpaceTool(env, {
        submissionId: "personal-submission",
        operation: {
          kind: "wake",
          agentProfileId: siblingProfileId,
          text: "Review this work.",
        },
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({ threadContext: THREAD_CONTEXT })
      );
      const replyPlacement = await runPersonalRemoteAgentSpaceTool(env, {
        submissionId: "personal-submission",
        operation: { kind: "reply_placement", placement: "conversation" },
      });
      expect(replyPlacement).toMatchObject({
        kind: "reply_placement",
        placement: { dispatchId: "dispatch_1", locked: false },
      });
      expect(
        env.__spaceStub.rpcResolveNativeReplyPlacement
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch_1",
          sourceSignalId: "signal_1",
          profileId: AGENT_PROFILE_ID,
          placement: "conversation",
          lock: false,
        })
      );
      for (const kind of ["board", "updates", "authorize"] as const) {
        readDirectory.mockResolvedValueOnce({ ...directory, members: [] });
        await expect(
          runPersonalRemoteAgentSpaceTool(env, {
            submissionId: "personal-submission",
            operation: { kind },
          })
        ).rejects.toThrow("space_membership_revoked");
      }
      readDirectory.mockResolvedValueOnce({ ...directory, members: [] });
      await expect(
        runPersonalRemoteAgentSpaceTool(env, {
          submissionId: "personal-submission",
          operation: { kind: "reply_placement", placement: "thread" },
        })
      ).rejects.toThrow("space_membership_revoked");
      expect(readUpdates).toHaveBeenCalledTimes(1);
      await expect(
        runPersonalRemoteAgentSpaceTool(env, {
          ...messageRead,
          operation: { kind: "messages", spaceId: "another-space" },
        })
      ).rejects.toThrow();
      const readsBeforeRevocation =
        env.__spaceStub.rpcListSignalsResult.mock.calls.length;
      readDirectory.mockResolvedValueOnce({ ...directory, members: [] });
      await expect(
        runPersonalRemoteAgentSpaceTool(env, messageRead)
      ).rejects.toThrow("space_membership_revoked");
      expect(env.__spaceStub.rpcListSignalsResult).toHaveBeenCalledTimes(
        readsBeforeRevocation
      );
      if (!request?.agentProfileOwnerUserId) {
        throw new Error("expected personal Agent owner");
      }
      const identity = {
        db: harness.db,
        agentProfileId: request.agentProfileId,
        organizationId: request.organizationId,
        ownerUserId: request.agentProfileOwnerUserId,
      };
      await expect(
        requirePersonalRemoteAgentBinding({
          ...identity,
          bindingId: "replaced-binding",
        })
      ).rejects.toThrow("personal_binding_changed");
      await expect(
        requirePersonalRemoteAgentBinding({
          ...identity,
          organizationId: "another-organization",
        })
      ).rejects.toThrow("personal_profile_unavailable");
      await harness.query({
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [identity.organizationId, identity.ownerUserId],
      });
      await expect(requirePersonalRemoteAgentBinding(identity)).rejects.toThrow(
        "personal_profile_unavailable"
      );
    } finally {
      await harness.close();
    }
  });
  it("admits a personal Agent Wake authored by the designated Center Agent", async () => {
    const centerAgentProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = NULL, owner_user_id = \'user_1\' WHERE profile_id = $1',
      values: [AGENT_PROFILE_ID],
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, managed_role, status, source) VALUES ($1, 'Center Agent', 'org-center-agent', 'agent', 'org_1', NULL, 'center_agent', 'active', 'migration')",
      values: [centerAgentProfileId],
    });
    await harness.query({
      text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1 WHERE organization_id = \'org_1\'',
      values: [centerAgentProfileId],
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'disabled_historical', disabled_at_ms = 1000 WHERE binding_id = 'binding_1'",
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'enabled_primary', disabled_at_ms = NULL, owner_kind = 'owner_account', owner_id = 'user_1', runtime_kind = 'hosted_remote_agent', agent_controller_ref = 'hosted:remote-agent', openmeld_service_runtime_id = 'hosted:remote-agent', hosted_runtime_identity_json = $1 WHERE binding_id = 'binding_1'",
      values: [JSON.stringify(HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY)],
    });
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 2100,
        requestId: "personal-request",
        status: "pending" as const,
        submissionId: "personal-submission",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const directory = spaceMemberDirectorySchema.parse({
      spaceId: SPACE_ID,
      generatedAt: new Date().toISOString(),
      members: [AGENT_PROFILE_ID, centerAgentProfileId, HUMAN_PROFILE_ID].map(
        (profileId) => ({
          profileId,
          profileKind: profileId === HUMAN_PROFILE_ID ? "human" : "agent",
          displayName: profileId,
          primaryMentionLabel: profileId,
          mentionLabels: [profileId],
          mentionAlias: null,
          labelSource: "profile_id",
          lookupTokens: [profileId],
          preferredLookupToken: profileId,
          profileIdShort: profileId.slice(0, 8),
          allowedRelations: {
            wake: profileId === AGENT_PROFILE_ID,
            reference: false,
            mention: profileId === HUMAN_PROFILE_ID,
          },
          ownerUserId: profileId === centerAgentProfileId ? null : "user_1",
          ownerName: profileId === centerAgentProfileId ? null : "Ari",
          agentCard: null,
          spaceRole: null,
        })
      ),
    });
    Object.assign(env.__spaceStub, {
      rpcGetMemberDirectory: vi.fn(async () => directory),
    });
    try {
      const result = await submitRemoteAgentNativeDelivery({
        binding: { ...createBinding(), personalAgent: true },
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage({
          sourceProfileNameSnapshot: "Center Agent",
          sourceSignalSnapshot: {
            profileId: centerAgentProfileId,
            profileKind: "agent",
            text: "Please review this pull request.",
          },
        }),
        nowMs: 1000,
      });
      expect(result.status).toBe("submitted");
      await expect(
        requirePersonalRemoteAgentExecution(env, "personal-submission")
      ).resolves.toMatchObject({
        request: { author: { profileId: centerAgentProfileId } },
      });
      // Only the Organization's current designated Center Agent is an
      // ownerless requester; a replaced designation no longer authorizes it.
      await harness.query({
        text: 'UPDATE "openmeld"."center_agent_designations" SET agent_profile_id = $1 WHERE organization_id = \'org_1\'',
        values: [AGENT_PROFILE_ID],
      });
      await expect(
        requirePersonalRemoteAgentExecution(env, "personal-submission")
      ).rejects.toThrow("requester_membership_revoked");
    } finally {
      await harness.close();
    }
  });
  it("continues the same delivery after a tool-budget checkpoint and publishes only the later final result", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 2100,
        requestId: "request-work-loop-2",
        status: "pending" as const,
        submissionId: "submission-work-loop-2",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        deliveryId: "delivery-work-loop",
        dispatchId: "dispatch-work-loop",
        idempotencyKey: "idempotency-work-loop-1",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "submission-work-loop-1",
        triggerMessageId: "signal-work-loop",
      });
      const checkpoint = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        callbackAttempt: 1,
        checkpoint: {
          reason: "tool_call_budget_exhausted" as const,
          toolCallLimit: 64,
          v: 1 as const,
        },
        dispatchId: "dispatch-work-loop",
        idempotencyKey: "idempotency-work-loop-1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        status: "continuation_required" as const,
        submissionId: "submission-work-loop-1",
        triggerMessageId: "signal-work-loop",
      };
      await expect(
        completeRemoteAgentNativeDelivery(env, checkpoint)
      ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
      await expect(
        completeRemoteAgentNativeDelivery(env, checkpoint)
      ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      const continuedRequest = workerSubmit.mock.calls[0]?.[0];
      expect(continuedRequest).toMatchObject({
        dispatchId: "dispatch-work-loop",
        messages: [
          {
            role: "user",
            content: expect.stringContaining(
              "Continue the same request after the tool-call checkpoint"
            ),
          },
        ],
        turnEnvelope: {
          workLoopContinuation: {
            attempt: 1,
            reason: "tool_call_budget_exhausted",
            v: 1,
          },
        },
      });
      expect(continuedRequest?.idempotencyKey).not.toBe(
        checkpoint.idempotencyKey
      );
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      const active = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: harness.db,
        deliveryId: "delivery-work-loop",
      });
      expect(active).toMatchObject({
        deliveryId: "delivery-work-loop",
        idempotencyKey: continuedRequest?.idempotencyKey,
        status: "accepted",
        submissionId: "submission-work-loop-2",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch-work-loop",
          idempotencyKey: continuedRequest?.idempotencyKey ?? "missing",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          status: "completed",
          submissionId: "submission-work-loop-2",
          text: "Tests are updated and passing.",
          triggerMessageId: "signal-work-loop",
        })
      ).resolves.toEqual({
        publishedSignalId: "signal_reply_1",
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("publishes an explicit failure instead of looping after the safe continuation limit", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(
      (request: RemoteAgentWorkerSubmitTurnRequest) => {
        const attempt = request.turnEnvelope.workLoopContinuation?.attempt;
        if (!attempt) {
          throw new Error("Expected a work-loop continuation attempt.");
        }
        return Promise.resolve({
          accepted: true,
          createdAt: 2100 + attempt,
          requestId: `request-work-loop-limit-${attempt}`,
          status: "pending" as const,
          submissionId: `submission-work-loop-limit-${attempt + 1}`,
        });
      }
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        deliveryId: "delivery-work-loop-limit",
        dispatchId: "dispatch-work-loop-limit",
        idempotencyKey: "idempotency-work-loop-limit-1",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "submission-work-loop-limit-1",
        triggerMessageId: "signal-work-loop-limit",
      });
      let idempotencyKey = "idempotency-work-loop-limit-1";
      let submissionId = "submission-work-loop-limit-1";
      const buildCheckpoint = () => ({
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        checkpoint: {
          reason: "tool_call_budget_exhausted" as const,
          toolCallLimit: 64,
          v: 1 as const,
        },
        dispatchId: "dispatch-work-loop-limit",
        idempotencyKey,
        organizationId: "org_1",
        spaceId: SPACE_ID,
        status: "continuation_required" as const,
        submissionId,
        triggerMessageId: "signal-work-loop-limit",
      });
      for (
        let attempt = 1;
        attempt <= REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS;
        attempt += 1
      ) {
        await expect(
          completeRemoteAgentNativeDelivery(env, buildCheckpoint())
        ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
        idempotencyKey = `delivery-work-loop-limit:work-loop:${attempt}`;
        submissionId = `submission-work-loop-limit-${attempt + 1}`;
      }
      expect(workerSubmit).toHaveBeenCalledTimes(
        REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS
      );
      await expect(
        completeRemoteAgentNativeDelivery(env, buildCheckpoint())
      ).resolves.toEqual({
        publishedSignalId: "signal_reply_1",
        status: "accepted",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(
        REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS
      );
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(1);
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Codex kept working but could not finish this request within the safe execution limit. Review the results and open Diagnostics in OpenMeld before starting more work.",
        })
      );
      const terminal = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: harness.db,
        deliveryId: "delivery-work-loop-limit",
      });
      expect(terminal).toMatchObject({
        failureCode: REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE,
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps a Routine parent private while its Center Agent continuation is pending", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const runId = "routine-run-continuation-1";
    const parentDeliveryId = "delivery-routine-parent";
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-routine-parent",
        db: harness.db,
        deliveryId: parentDeliveryId,
        dispatchId: runId,
        idempotencyKey: runId,
        nowMs: 900,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        routineNameSnapshot: "Daily learning",
        routineRunId: runId,
        spaceId: SPACE_ID,
        status: "submitted",
        triggerMessageId: runId,
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: runId,
        nowMs: 950,
        submissionId: "submission-routine-parent",
        workerRequestId: "request-routine-parent",
      });
      await harness.query({
        values: [runId, parentDeliveryId],
        text: `
          INSERT INTO "openmeld"."routine_runs" (
            id,
            routine_id,
            organization_id,
            scheduled_for,
            status,
            routine_name_snapshot,
            target_space_id_snapshot,
            destination_kind_snapshot,
            execution_engine,
            native_delivery_id,
            started_at_ms
          ) VALUES ($1, 'routine-1', 'org_1', 900, 'submitted',
            'Daily learning', '${SPACE_ID}', 'space', 'workflow', $2, 900)
        `,
      });
      await harness.query({
        values: [runId],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET worker_submit_request_json = '{"sentinel":"retained"}'
          WHERE idempotency_key = $1
        `,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          delegationId: "delegation-routine-1",
          instruction: "Synthesize the delegated findings.",
          kind: "resume_agent",
          sourceSignalId: runId,
          spaceId: SPACE_ID,
          threadContext: null,
        },
        db: harness.db,
        idempotencyKey: "subscription-key:routine-parent",
        nowMs: 980,
        observerTask: {
          deliveryId: parentDeliveryId,
          kind: "native_delivery",
          v: 1,
        },
        organizationId: "org_1",
        subscriptionId: "subscription-routine-parent",
        watchedTask: {
          kind: "space_wake",
          sourceClientMessageId: "client-routine-child",
          spaceId: SPACE_ID,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          v: 1,
        },
      });
      const env = buildEnv(harness.db, {
        dispatchQueueSend: vi.fn(async () => undefined),
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding-routine-parent",
            dispatchId: runId,
            idempotencyKey: runId,
            organizationId: "org_1",
            spaceId: SPACE_ID,
            submissionId: "submission-routine-parent",
            text: "Private working notes that must not be published.",
            triggerMessageId: runId,
          },
          { bypassRoutineWorkflowRouting: true }
        )
      ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-routine-parent",
        })
      ).resolves.toMatchObject({
        publishedSignalId: null,
        status: "completed",
      });
      expect(
        await harness.queryFirst<{
          worker_submit_request_json: string | null;
        }>({
          values: [runId],
          text: `
            SELECT worker_submit_request_json
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE idempotency_key = $1
          `,
        })
      ).toEqual({ worker_submit_request_json: '{"sentinel":"retained"}' });
      expect(
        await harness.queryFirst<{
          native_delivery_id: string;
          status: string;
        }>({
          values: [runId],
          text: `
            SELECT native_delivery_id, status
            FROM "openmeld"."routine_runs"
            WHERE id = $1
          `,
        })
      ).toEqual({ native_delivery_id: parentDeliveryId, status: "submitted" });
    } finally {
      await harness.close();
    }
  });
  it.each(
    ["persist", "replay", "watchdog", "admission"].flatMap((route) =>
      ["signal-child-result", null].map((publishedSignalId) => ({
        route,
        publishedSignalId,
      }))
    )
  )("rejects a frozen unmarked summary at $route with locator $publishedSignalId", async ({
    route,
    publishedSignalId,
  }) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi
      .fn()
      .mockRejectedValue(new Error("old admission response lost"));
    const readAdmission = vi.fn();
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        readAdmission,
      },
    });
    const subscriptionId = "legacy-summary";
    const idempotencyKey = `agent-task-continuation:${subscriptionId}`;
    try {
      const staged = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
        subscriptionId,
      });
      const saved = staged.workerSubmitRequest;
      if (!saved) {
        throw new Error("Missing frozen request");
      }
      const watchedTask = {
        kind: "native_delivery" as const,
        deliveryId: `child:${idempotencyKey}`,
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-task-result",
        occurredAtMs: 1050,
        publishedSignalId,
        status: "succeeded" as const,
      };
      const legacy = remoteAgentWorkerSubmitTurnRequestSchema.parse({
        ...saved,
        turnEnvelope: {
          ...saved.turnEnvelope,
          trigger: {
            source: "task_continuation",
            delegationId: "delegation-summary",
            subscriptionId,
            watchedTask,
            outcome,
          },
        },
      });
      // Reproduce an old producer's frozen request, without overwriting it in production.
      await harness.query({
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1, execution_recovery_submit_request_json = $2 WHERE idempotency_key = $3',
        values: [
          JSON.stringify(legacy),
          JSON.stringify(legacy),
          idempotencyKey,
        ],
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: `parent-submission:${idempotencyKey}`,
        });
      if (!observerDelivery) {
        throw new Error("Missing observer");
      }
      await registerAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId,
        organizationId: "org_1",
        idempotencyKey: `register:${subscriptionId}`,
        nowMs: 1100,
        completionCondition: "terminal",
        observerTask: {
          kind: "native_delivery",
          deliveryId: observerDelivery.deliveryId,
          v: 1,
        },
        watchedTask,
        continuation: {
          kind: "resume_agent",
          delegationId: "delegation-summary",
          instruction: "Summarize existing results.",
          summaryRecovery: {
            operatorUserId: "user_1",
            sourceSubscriptionId: "original-summary",
          },
        },
      });
      workerSubmit.mockClear();
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey,
      });
      if (!delivery) {
        throw new Error("Missing delivery");
      }
      let action: Promise<unknown>;
      if (route === "persist") {
        action = persistRemoteAgentWorkerSubmitRequest({
          db: harness.db,
          idempotencyKey,
          nowMs: 1200,
          workerSubmitRequest: {
            ...legacy,
            turnEnvelope: {
              ...legacy.turnEnvelope,
              trigger: {
                source: "task_continuation",
                delegationId: "delegation-summary",
                subscriptionId,
                watchedTask,
                outcome,
                summaryOnly: true,
              },
            },
          },
        });
      } else if (route === "replay") {
        action = submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          env,
          idempotencyKey,
          subscriptionId,
          delegationId: "delegation-summary",
          delegation: {
            barrier: "all_terminal",
            delegationId: "delegation-summary",
            generation: 1,
            children: [
              {
                agentProfileId: AGENT_PROFILE_ID,
                role: "primary",
                state: "terminal",
                task: watchedTask,
                terminalOutcome: outcome,
              },
            ],
          },
          instruction: "Summarize existing results.",
          summaryOnly: true,
          observerDelivery,
          watchedTask,
          outcome,
          nowMs: 1200,
          isAuthorized: async () => true,
        });
      } else if (route === "admission") {
        action = submitRemoteAgentWorkerAdmission({
          db: harness.db,
          env,
          nowMs: 1200,
          organizationId: "org_1",
          admissionDelivery: delivery,
          request: legacy,
          worker: { submitConversationTurn: workerSubmit, readAdmission },
        });
      } else {
        const probe = requireAdmissionProbe(probes, "watchdog", 1);
        action = processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        });
      }
      await expect(action).rejects.toThrow(
        "remote_agent.task_continuation.summary_policy_mismatch"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(readAdmission).not.toHaveBeenCalled();
      const retained = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey,
      });
      expect(retained?.workerSubmitRequest).toEqual(legacy);
      expect(retained?.executionRecoverySubmitRequest).toEqual(legacy);
      expect(retained?.idempotencyKey).toBe(idempotencyKey);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "signal-child-result",
    null,
  ])("submits one idempotent continuation with the child's exact result locator %s", async (childSignalId) => {
    const requestTimeContext = {
      submittedAtMs: 800,
      userTime: {
        timeZone: "America/Los_Angeles",
        source: "web" as const,
        observedAtMs: 700,
      },
    };
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const stageLogs = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    let finishAuthorization!: (allowed: boolean) => void;
    const authorization = new Promise<boolean>((resolve) => {
      finishAuthorization = resolve;
    });
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1200,
        requestId: "request-continuation",
        status: "pending" as const,
        submissionId: "submission-continuation",
      })
    );
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-parent",
        db: harness.db,
        dispatchId: "dispatch-parent",
        idempotencyKey: "idempotency-parent",
        nowMs: 900,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        spaceId: SPACE_ID,
        status: "submitted",
        threadContext: THREAD_CONTEXT,
        triggerMessageId: "signal_1",
      });
      await persistTestCenterAgentWorkerSubmitRequest({
        bindingId: "binding-parent",
        db: harness.db,
        dispatchId: "dispatch-parent",
        idempotencyKey: "idempotency-parent",
        requestTimeContext,
        spaceId: SPACE_ID,
        triggerMessageId: "signal_1",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency-parent",
        nowMs: 950,
        submissionId: "submission-parent",
        workerRequestId: "request-parent",
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected parent delivery fixture");
      }
      const delegatedWake = {
        activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
        attribution: {
          actorProfileId: AGENT_PROFILE_ID,
          onBehalfOf: {
            profileId: HUMAN_PROFILE_ID,
            userId: "user_1",
            displayName: "Ari",
          },
        },
        clientMessageId: "client-child-1",
        completionMode: "resume_parent_when_all_terminal" as const,
        context: {
          activeOrganizationId: "org_1",
          actorContext: {
            openMeldProfileId: AGENT_PROFILE_ID,
            profileKind: "agent" as const,
            requestId: "delegated-wake",
          },
        },
        delegationId: "delegation-1",
        fallbackAgentProfileId: null,
        mentionTargets: [],
        organizationId: "org_1",
        parentSubmissionId: "submission-parent",
        profile: { kind: "agent" as const, profileId: AGENT_PROFILE_ID },
        referenceTargets: [],
        spaceId: SPACE_ID,
        subscriptionIds: ["subscription-1"],
        text: "Continue the original request in ten minutes.",
        v: 1 as const,
      };
      // Publication recovery re-reads the retained parent, not a fresh clock.
      await rpcPostCenterAgentWakePublicationSignal(env, delegatedWake);
      await rpcPostCenterAgentWakePublicationSignal(env, delegatedWake);
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestTimeContext })
      );
      await expect(
        rpcPostCenterAgentWakePublicationSignal(env, {
          ...delegatedWake,
          organizationId: "another-organization",
        })
      ).rejects.toMatchObject({
        cause: { code: "center_agent.delegation_parent_unavailable" },
      });
      const recalledContinuationMemory = {
        items: [
          {
            source: "ca_dm" as const,
            subject: "member" as const,
            text: "Ari wants delegated results summarized with the decision first.",
          },
        ],
        truncated: false,
      };
      const continuationMemoryService = createTestMemoryService({
        recallForTurn: vi.fn(async () => recalledContinuationMemory),
      });
      const continuationInput = {
        db: harness.db,
        delegation: {
          barrier: "all_terminal" as const,
          children: [
            {
              agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
              role: "primary" as const,
              state: "terminal" as const,
              task: {
                kind: "space_wake" as const,
                sourceClientMessageId: "client-child-1",
                spaceId: SPACE_ID,
                targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                v: 1 as const,
              },
              terminalOutcome: {
                errorCode: null,
                eventId: "terminal-child-1",
                occurredAtMs: 1050,
                publishedSignalId: childSignalId,
                status: "succeeded" as const,
              },
            },
          ],
          delegationId: "delegation-1",
          generation: 1,
        },
        delegationId: "delegation-1",
        env,
        idempotencyKey: "agent-task-continuation:subscription-1",
        instruction: "Synthesize the delegated result.",
        isAuthorized: async () => await authorization,
        memoryService: continuationMemoryService,
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-child-1",
          occurredAtMs: 1050,
          publishedSignalId: childSignalId,
          status: "succeeded" as const,
        },
        sourceSignalId: "signal_1",
        spaceId: SPACE_ID,
        subscriptionId: "subscription-1",
        threadContext: THREAD_CONTEXT,
        watchedTask: {
          kind: "space_wake" as const,
          sourceClientMessageId: "client-child-1",
          spaceId: SPACE_ID,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          v: 1 as const,
        },
      };
      await registerAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: continuationInput.subscriptionId,
        organizationId: "org_1",
        idempotencyKey: "register:summary-1",
        nowMs: 1050,
        completionCondition: "terminal",
        observerTask: {
          kind: "native_delivery",
          deliveryId: observerDelivery.deliveryId,
          v: 1,
        },
        watchedTask: continuationInput.watchedTask,
        continuation: {
          kind: "resume_agent",
          delegationId: "delegation-1",
          instruction: continuationInput.instruction,
          summaryRecovery: {
            operatorUserId: "user_1",
            sourceSubscriptionId: "original-summary",
          },
        },
      });
      const firstSubmission = submitRemoteAgentTaskContinuationDelivery({
        ...continuationInput,
        summaryOnly: true,
      });
      expect(stageLogs).toHaveBeenCalledWith(
        "[core.remote_agent.task_continuation.stage]",
        expect.objectContaining({
          idempotencyKey: continuationInput.idempotencyKey,
          subscriptionId: continuationInput.subscriptionId,
          stage: "preparation",
          event: "started",
        })
      );
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(continuationMemoryService.recallForTurn).not.toHaveBeenCalled();
      finishAuthorization(true);
      const first = await firstSubmission;
      const preparationEvidence = stageLogs.mock.calls
        .filter(
          ([event]) => event === "[core.remote_agent.task_continuation.stage]"
        )
        .map(([, evidence]) => evidence);
      for (const stage of [
        "turn_context",
        "memory",
        "skill_selection",
        "watchdog_enqueue",
        "source_dispatch",
      ]) {
        expect(preparationEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ stage, event: "started" }),
            expect.objectContaining({ stage, event: "finished" }),
          ])
        );
      }
      const serializedEvidence = JSON.stringify(preparationEvidence);
      expect(serializedEvidence).not.toContain(continuationInput.instruction);
      expect(serializedEvidence).not.toContain(
        recalledContinuationMemory.items[0]?.text
      );
      expect(stageLogs).toHaveBeenCalledWith(
        "[core.remote_agent.task_continuation.stage]",
        expect.objectContaining({
          idempotencyKey: continuationInput.idempotencyKey,
          stage: "preparation",
          event: "finished",
          elapsedMs: expect.any(Number),
        })
      );
      const replay = await submitRemoteAgentTaskContinuationDelivery({
        ...continuationInput,
        nowMs: 1300,
      });
      expect(replay).toEqual(first);
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...continuationInput,
          isAuthorized: async () => false,
        })
      ).resolves.toEqual({ status: "cancelled", task: null });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: "agent-task-continuation:subscription-1",
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(
                `"publishedSignalId":${JSON.stringify(childSignalId)}`
              ),
            }),
          ],
          turnEnvelope: expect.objectContaining({
            requestTimeContext,
            interactionEnvironment: "requester_private",
            memory: recalledContinuationMemory,
            sender: expect.objectContaining({
              ownerUserId: "user_1",
              profileId: HUMAN_PROFILE_ID,
              verified: true,
            }),
            trigger: {
              delegation: continuationInput.delegation,
              delegationId: "delegation-1",
              outcome: expect.objectContaining({
                eventId: "terminal-child-1",
                status: "succeeded",
              }),
              source: "task_continuation",
              summaryOnly: true,
              subscriptionId: "subscription-1",
              watchedTask: continuationInput.watchedTask,
            },
          }),
        })
      );
      const instructions =
        workerSubmit.mock.calls[0]?.[0]?.messages[0]?.content;
      expect(instructions).toContain("summarize the other available results");
      expect(instructions).toContain("Do not guess another result locator");
      if (childSignalId === null) {
        expect(instructions).toContain(
          "Result unavailable in this completion evidence"
        );
        expect(instructions).toContain("do not repeat the child task");
      } else {
        expect(instructions).not.toContain(
          "Result unavailable in this completion evidence"
        );
      }
      expect(continuationMemoryService.recallForTurn).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "agent-task-continuation:subscription-1",
        })
      ).resolves.toMatchObject({
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        status: "accepted",
        submissionId: "submission-continuation",
      });
    } finally {
      stageLogs.mockRestore();
      await harness.close();
    }
  });
  it("continues from a persisted v4 observer and rolls its runtime generation automatically", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi
      .fn()
      .mockResolvedValueOnce({
        idempotencyKey: "agent-task-continuation:subscription-v4",
        message: "Worker diagnostic detail only.",
        outcome: "rejected" as const,
        reasonCode: "remote_agent.conversation_history_limit_exceeded" as const,
        v: 1 as const,
      })
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: 1200,
        requestId: "request-continuation-v4",
        status: "pending" as const,
        submissionId: "submission-continuation-v4",
      });
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      sourceSignals: [
        createSignalEnvelope(
          "signal_previous_v4",
          "The delegated investigation is ready to summarize."
        ),
        createSignalEnvelope("signal_v4_parent", "Coordinate this task."),
      ],
    });
    env.__spaceStub.rpcListDispatchConversationContinuitySignalsResult.mockImplementation(
      async (query) =>
        query.spaceAccess?.actor.kind === "dispatch_continuation" &&
        query.spaceAccess.actor.dispatchId === "dispatch-v4-parent"
          ? {
              ok: true,
              value: {
                signals: [
                  createSignalEnvelope(
                    "signal_previous_v4",
                    "The delegated investigation is ready to summarize."
                  ),
                  createSignalEnvelope(
                    "signal_v4_parent",
                    "Coordinate this task."
                  ),
                ],
              },
            }
          : {
              code: "space.continuity.dispatch_not_found",
              message: "The exact Space dispatch is unavailable.",
              ok: false,
              status: 404,
            }
    );
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-v4-parent",
        db: harness.db,
        dispatchId: "dispatch-v4-parent",
        idempotencyKey: "idempotency-v4-parent",
        nowMs: 900,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        sourceClientMessageId: "client-v4-parent",
        spaceId: SPACE_ID,
        status: "submitted",
        threadContext: THREAD_CONTEXT,
        triggerMessageId: "signal_v4_parent",
      });
      await persistTestCenterAgentWorkerSubmitRequest({
        bindingId: "binding-v4-parent",
        db: harness.db,
        dispatchId: "dispatch-v4-parent",
        idempotencyKey: "idempotency-v4-parent",
        requestVersion: 4,
        spaceId: SPACE_ID,
        triggerMessageId: "signal_v4_parent",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency-v4-parent",
        nowMs: 950,
        submissionId: "submission-v4-parent",
        workerRequestId: "request-v4-parent",
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-v4-parent",
        db: harness.db,
        dispatchId: "agent-task-continuation:nested-parent",
        idempotencyKey: "idempotency-v4-nested-parent",
        nowMs: 980,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        spaceId: SPACE_ID,
        status: "submitted",
        threadContext: THREAD_CONTEXT,
        triggerMessageId: "signal_v4_parent",
      });
      await persistTestCenterAgentWorkerSubmitRequest({
        bindingId: "binding-v4-parent",
        db: harness.db,
        dispatchId: "agent-task-continuation:nested-parent",
        idempotencyKey: "idempotency-v4-nested-parent",
        requestVersion: 4,
        spaceId: SPACE_ID,
        triggerMessageId: "signal_v4_parent",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency-v4-nested-parent",
        nowMs: 990,
        submissionId: "submission-v4-nested-parent",
        workerRequestId: "request-v4-nested-parent",
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-v4-nested-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected v4 parent delivery fixture");
      }
      expect(observerDelivery.executionRecoverySubmitRequest).toMatchObject({
        conversationId: SPACE_ID,
        runtimeConversation: { generation: 0 },
        v: 4,
      });
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          env,
          idempotencyKey: "agent-task-continuation:subscription-v4",
          instruction: "Synthesize the delegated result.",
          isAuthorized: async () => true,
          nowMs: 1100,
          observerDelivery,
          outcome: {
            errorCode: "runtime_coordinator.delivery_expired",
            eventId: "terminal-v4-child",
            occurredAtMs: 1050,
            publishedSignalId: "signal-v4-child-expired",
            status: "failed",
          },
          subscriptionId: "subscription-v4",
          watchedTask: {
            kind: "space_wake",
            sourceClientMessageId: "client-v4-child",
            spaceId: SPACE_ID,
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
            v: 1,
          },
          watchId: "watch-v4",
        })
      ).resolves.toMatchObject({
        status: "submitted",
        task: { kind: "native_delivery" },
      });
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
        conversationId: SPACE_ID,
        messages: [
          {
            content: expect.stringContaining(
              "The child Wake expired before it reached the local Agent. No child task result is available"
            ),
          },
        ],
        runtimeConversation: { generation: 0 },
        v: 4,
      });
      expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
        continuityContext: {
          fromGeneration: 0,
          logicalConversationId: SPACE_ID,
          toGeneration: 1,
        },
        conversationId: SPACE_ID,
        runtimeConversation: { generation: 1 },
        v: 4,
      });
      expect(
        env.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
      ).toHaveBeenCalledOnce();
      expect(
        env.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceAccess: expect.objectContaining({
            actor: expect.objectContaining({
              dispatchId: "dispatch-v4-parent",
              sourceSignalId: "signal_v4_parent",
            }),
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("resumes an ordinary Slack parent in its frozen Slack thread", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1200,
      requestId: "request-slack-continuation",
      status: "pending" as const,
      submissionId: "submission-slack-continuation",
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    const originalEnvelope = createSlackTurnEnvelope();
    try {
      const observerDelivery = await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "idempotency-slack-parent",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-slack-parent",
        triggerMessageId: "slack-message-parent",
        turnEnvelope: originalEnvelope,
      });
      expect(observerDelivery.workerSubmitRequest).toBeNull();
      expect(observerDelivery.executionRecoverySubmitRequest).toMatchObject({
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        v: 2,
      });
      const watchedTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-slack-child",
        spaceId: SPACE_ID,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-slack-child",
        occurredAtMs: 1050,
        publishedSignalId: "signal-slack-child-result",
        status: "succeeded" as const,
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          delegation: {
            barrier: "all_terminal",
            children: [
              {
                agentProfileId: watchedTask.targetProfileId,
                role: "primary",
                state: "terminal",
                task: watchedTask,
                terminalOutcome: outcome,
              },
            ],
            delegationId: "delegation-slack",
            generation: 1,
          },
          delegationId: "delegation-slack",
          env,
          idempotencyKey: "agent-task-continuation:subscription-slack",
          instruction: "Synthesize the Slack child result.",
          isAuthorized: async () => true,
          nowMs: 1100,
          observerDelivery,
          outcome,
          subscriptionId: "subscription-slack",
          watchedTask,
        })
      ).resolves.toMatchObject({
        status: "submitted",
        task: { kind: "native_delivery" },
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
          spaceId: originalEnvelope.space.id,
          triggerMessageId: "slack-message-parent",
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "externally_shared",
            space: originalEnvelope.space,
            trigger: expect.objectContaining({
              source: "task_continuation",
              subscriptionId: "subscription-slack",
            }),
          }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "agent-task-continuation:subscription-slack",
        })
      ).resolves.toMatchObject({
        conversationKind: "slack",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: originalEnvelope.space.id,
        triggerMessageId: "slack-message-parent",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects a Slack continuation when its frozen locator disagrees with its conversation id", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1200,
      requestId: "request-slack-continuation",
      status: "pending" as const,
      submissionId: "submission-slack-continuation",
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    const mismatchedEnvelope = {
      ...createSlackTurnEnvelope(),
      space: {
        ...createSlackTurnEnvelope().space,
        id: "slack:T123:C123:1700000000.999999",
      },
    };
    try {
      const observerDelivery = await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "idempotency-slack-parent-mismatch",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-slack-parent-mismatch",
        triggerMessageId: "slack-message-parent",
        turnEnvelope: mismatchedEnvelope,
      });
      const watchedTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-slack-child",
        spaceId: SPACE_ID,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-slack-child",
        occurredAtMs: 1050,
        publishedSignalId: "signal-slack-child-result",
        status: "succeeded" as const,
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          delegation: {
            barrier: "all_terminal",
            children: [
              {
                agentProfileId: watchedTask.targetProfileId,
                role: "primary",
                state: "terminal",
                task: watchedTask,
                terminalOutcome: outcome,
              },
            ],
            delegationId: "delegation-slack-mismatch",
            generation: 1,
          },
          delegationId: "delegation-slack-mismatch",
          env,
          idempotencyKey: "agent-task-continuation:subscription-slack-mismatch",
          instruction: "Synthesize the Slack child result.",
          isAuthorized: async () => true,
          nowMs: 1100,
          observerDelivery,
          outcome,
          subscriptionId: "subscription-slack-mismatch",
          watchedTask,
        })
      ).rejects.toThrow(
        "Remote Agent task continuation has no valid original Slack destination"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("fails a continuation when privacy clearing removed its original model route", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn();
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "idempotency-cleared-model-parent",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-cleared-model-parent",
        triggerMessageId: "slack-message-parent",
        turnEnvelope: createSlackTurnEnvelope(),
      });
      await harness.query({
        values: ["idempotency-cleared-model-parent"],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            worker_submit_request_json = NULL,
            execution_recovery_submit_request_json = NULL
          WHERE idempotency_key = $1
        `,
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-cleared-model-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected privacy-cleared continuation observer");
      }
      const watchedTask = {
        deliveryId: "delivery-cleared-model-child",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          env,
          idempotencyKey: "agent-task-continuation:subscription-cleared-model",
          instruction: "Continue after the child result.",
          isAuthorized: async () => true,
          nowMs: 1100,
          observerDelivery,
          outcome: {
            errorCode: null,
            eventId: "terminal-cleared-model-child",
            occurredAtMs: 1050,
            publishedSignalId: "signal-cleared-model-child",
            status: "succeeded",
          },
          subscriptionId: "subscription-cleared-model",
          watchedTask,
          watchId: "watch-cleared-model",
        })
      ).rejects.toThrow(
        "remote_agent.task_continuation.original_model_route_unavailable"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("publishes a deterministic Slack continuation rejection to its original thread", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const fetchMock = vi.fn(
      (
        input: Request | string | URL,
        _init?: RequestInit
      ): Promise<Response> => {
        if (String(input).includes("/chat.getPermalink")) {
          return Promise.resolve(
            Response.json({
              ok: true,
              permalink:
                "https://openmeld.slack.com/archives/C123/p1700000000000999",
            })
          );
        }
        return Promise.resolve(
          Response.json({ ok: true, ts: "1700000000.000999" })
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const workerSubmit = vi.fn(async () => ({
      idempotencyKey: "agent-task-continuation:subscription-slack-rejected",
      message: "The Slack continuation identity is invalid.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.turn_envelope_identity_mismatch" as const,
      v: 1 as const,
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
      slackBotToken: "xoxb-test",
    });
    const originalEnvelope = createSlackTurnEnvelope();
    try {
      const observerDelivery = await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "idempotency-slack-rejected-parent",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-slack-rejected-parent",
        triggerMessageId: "slack-message-parent",
        turnEnvelope: originalEnvelope,
      });
      const watchedTask = {
        deliveryId: "delivery-slack-child",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      const continuationInput = {
        db: harness.db,
        env,
        idempotencyKey: "agent-task-continuation:subscription-slack-rejected",
        instruction: "Continue after the Slack child.",
        isAuthorized: async () => true,
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-slack-child",
          occurredAtMs: 1050,
          publishedSignalId: "signal-slack-child",
          status: "succeeded" as const,
        },
        subscriptionId: "subscription-slack-rejected",
        watchedTask,
        watchId: "watch-slack-rejected",
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery(continuationInput)
      ).resolves.toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      const slackPostCalls = fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/chat.postMessage")
      );
      const slackStatusCalls = fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/assistant.threads.setStatus")
      );
      const slackPermalinkCalls = fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/chat.getPermalink")
      );
      expect(slackPostCalls).toHaveLength(1);
      expect(slackPermalinkCalls).toHaveLength(1);
      expect(
        JSON.parse(String(slackPostCalls[0]?.[1]?.body ?? "{}"))
      ).toMatchObject({
        channel: "C123",
        text: "Center Agent could not start this request. Please try again.",
        thread_ts: "1700000000.000001",
      });
      expect(slackStatusCalls).toHaveLength(1);
      expect(
        JSON.parse(String(slackStatusCalls[0]?.[1]?.body ?? "{}"))
      ).toMatchObject({
        channel_id: "C123",
        status: "",
        thread_ts: "1700000000.000001",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "agent-task-continuation:subscription-slack-rejected",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        finalPublicationState: "published",
        publishedSignalId: "1700000000.000999",
        status: "failed",
      });
      await harness.query({
        values: [continuationInput.idempotencyKey],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            final_publication_state = 'claimed',
            final_publication_claim_id = 'claim-slack-crashed',
            final_publication_claimed_at_ms = 1150,
            final_publication_claim_expires_at_ms = 1200,
            published_signal_id = NULL,
            completed_at_ms = NULL,
            updated_at_ms = 1200
          WHERE idempotency_key = $1
        `,
      });
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...continuationInput,
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/chat.postMessage")
        )
      ).toHaveLength(1);
      const replayStatusCalls = fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/assistant.threads.setStatus")
      );
      expect(replayStatusCalls).toHaveLength(2);
      expect(
        replayStatusCalls.every(
          ([, init]) =>
            (
              JSON.parse(String(init?.body ?? "{}")) as {
                status?: unknown;
              }
            ).status === ""
        )
      ).toBe(true);
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/chat.getPermalink")
        )
      ).toHaveLength(2);
      expect(workerSubmit).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationInput.idempotencyKey,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "failed",
      });
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("resumes a Lark task watch through its frozen Message Channel locator", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1200,
      requestId: "request-lark-continuation",
      status: "pending" as const,
      submissionId: "submission-lark-continuation",
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    const locator = {
      appId: "app_1",
      chatId: "chat_1",
      connectionId: "connection_1",
      provider: "lark" as const,
      rootMessageId: "message_1",
      tenantKey: "tenant_1",
      threadId: "thread_1",
    };
    const originalEnvelope = createMessageChannelTurnEnvelope();
    try {
      const observerDelivery = await createAcceptedContinuationObserver({
        conversationKind: "message_channel",
        db: harness.db,
        idempotencyKey: "idempotency-lark-parent",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey:
          "11111111-1111-5111-8111-111111111111",
        submissionId: "submission-lark-parent",
        triggerMessageId: "message_current_1",
        turnEnvelope: originalEnvelope,
      });
      expect(observerDelivery.workerSubmitRequest).toBeNull();
      const watchedTask = {
        deliveryId: "delivery-parallel-lark",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-parallel-lark",
        occurredAtMs: 1050,
        publishedSignalId: "signal-parallel-lark-result",
        status: "succeeded" as const,
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          env,
          idempotencyKey: "agent-task-continuation:subscription-lark",
          instruction: "Continue after the Lark task completes.",
          isAuthorized: async () => true,
          nowMs: 1100,
          observerDelivery,
          outcome,
          subscriptionId: "subscription-lark",
          watchedTask,
          watchId: "watch-lark",
        })
      ).resolves.toMatchObject({
        status: "submitted",
        task: { kind: "native_delivery" },
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: originalEnvelope.space.id,
          triggerMessageId: "message_current_1",
          turnEnvelope: expect.objectContaining({
            space: originalEnvelope.space,
            trigger: expect.objectContaining({
              source: "task_watch_continuation",
              subscriptionId: "subscription-lark",
            }),
          }),
        })
      );
      const continuationDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "agent-task-continuation:subscription-lark",
        });
      expect(continuationDelivery).toMatchObject({
        conversationKind: "message_channel",
        messageChannelLocator: locator,
        spaceId: originalEnvelope.space.id,
        triggerMessageId: "message_current_1",
      });
      expect(continuationDelivery?.providerPublicationIdempotencyKey).toMatch(
        UUID_V5_PATTERN
      );
      expect(continuationDelivery?.providerPublicationIdempotencyKey).not.toBe(
        observerDelivery.providerPublicationIdempotencyKey
      );
    } finally {
      await harness.close();
    }
  });
  it("retries a deterministic Lark continuation failure without resubmitting the worker", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" (
          connection_id,
          organization_id,
          provider,
          app_id,
          tenant_key,
          bot_open_id,
          bot_name,
          transport,
          status,
          installed_by_user_id,
          permission_bundle_version,
          granted_capability_groups_json,
          connection_generation,
          last_verified_at_ms,
          failure_reason_code,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'connection_1',
          'org_1',
          'lark',
          'app_1',
          'tenant_1',
          'bot_open_id_1',
          'Center Agent',
          'webhook',
          'connected',
          'user_1',
          'channel-preset-v1',
          '["messaging"]',
          1,
          1000,
          NULL,
          1000,
          1000
        )
      `,
    });
    const publishFailure = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.failure_publication_rate_limited",
        status: "failed" as const,
      })
      .mockResolvedValue({
        resultId: "message-lark-continuation-failure",
        status: "published" as const,
      });
    const adapter: MessageChannelProviderAdapter = {
      createWorkingCard: vi.fn(),
      publishFile: vi.fn(),
      downloadResource: vi.fn(),
      finalizeWorkingCard: vi.fn(),
      provider: "lark",
      publishFailure,
      publishIdentityLinkGuidance: vi.fn(),
      publishPrivateNavigationGuidance: vi.fn(),
      publishReply: vi.fn(),
      publishWorkingCard: vi.fn(),
      readChannelContext: vi.fn(),
      updateWorkingCard: vi.fn(),
    };
    const workerSubmit = vi.fn(async () => ({
      idempotencyKey: "agent-task-continuation:subscription-lark-rejected",
      message: "The Lark continuation identity is invalid.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.turn_envelope_identity_mismatch" as const,
      v: 1 as const,
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    const locator = {
      appId: "app_1",
      chatId: "chat_1",
      connectionId: "connection_1",
      provider: "lark" as const,
      rootMessageId: "message_1",
      tenantKey: "tenant_1",
      threadId: "thread_1",
    };
    try {
      const observerDelivery = await createAcceptedContinuationObserver({
        conversationKind: "message_channel",
        db: harness.db,
        idempotencyKey: "idempotency-lark-rejected-parent",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey:
          "11111111-1111-5111-8111-111111111111",
        submissionId: "submission-lark-rejected-parent",
        triggerMessageId: "message_current_1",
        turnEnvelope: createMessageChannelTurnEnvelope(),
      });
      const watchedTask = {
        deliveryId: "delivery-lark-child",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      const continuationInput = {
        db: harness.db,
        env,
        idempotencyKey: "agent-task-continuation:subscription-lark-rejected",
        instruction: "Continue after the Lark child.",
        isAuthorized: async () => true,
        messageChannelProviderRegistry: createMessageChannelProviderRegistry([
          adapter,
        ]),
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-lark-child",
          occurredAtMs: 1050,
          publishedSignalId: "signal-lark-child",
          status: "succeeded" as const,
        },
        subscriptionId: "subscription-lark-rejected",
        watchedTask,
        watchId: "watch-lark-rejected",
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery(continuationInput)
      ).rejects.toThrow("lark.failure_publication_rate_limited");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationInput.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        failureDetail: "The Lark continuation identity is invalid.",
        finalPublicationState: null,
        status: "failed",
      });
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...continuationInput,
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(publishFailure).toHaveBeenCalledTimes(2);
      expect(publishFailure).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          failureCode: "remote_agent.turn_envelope_identity_mismatch",
          locator,
          text: "Center Agent could not start this request. Please try again.",
        })
      );
      expect(publishFailure).toHaveBeenLastCalledWith(
        expect.objectContaining({
          failureCode: "remote_agent.turn_envelope_identity_mismatch",
          locator,
          text: "Center Agent could not start this request. Please try again.",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "agent-task-continuation:subscription-lark-rejected",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        failureDetail: "The Lark continuation identity is invalid.",
        finalPublicationState: "published",
        providerPublicationResultId: "message-lark-continuation-failure",
        status: "failed",
      });
      await harness.query({
        values: [continuationInput.idempotencyKey],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            final_publication_state = 'claimed',
            final_publication_claim_id = 'claim-lark-crashed',
            final_publication_claimed_at_ms = 1250,
            final_publication_claim_expires_at_ms = 1300,
            provider_publication_result_id = NULL,
            completed_at_ms = NULL,
            updated_at_ms = 1300
          WHERE idempotency_key = $1
        `,
      });
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...continuationInput,
          nowMs: 1400,
        })
      ).resolves.toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(publishFailure).toHaveBeenCalledTimes(3);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationInput.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureDetail: "The Lark continuation identity is invalid.",
        finalPublicationState: "published",
        providerPublicationResultId: "message-lark-continuation-failure",
        status: "failed",
      });
      workerSubmit.mockRejectedValueOnce(
        new Error(
          "The RPC receiver does not implement the method submitConversationTurn"
        )
      );
      const unavailableInput = {
        ...continuationInput,
        idempotencyKey:
          "agent-task-continuation:subscription-lark-worker-unavailable",
        nowMs: 1500,
        outcome: {
          ...continuationInput.outcome,
          eventId: "terminal-lark-child-worker-unavailable",
        },
        subscriptionId: "subscription-lark-worker-unavailable",
        watchedTask: {
          deliveryId: "delivery-lark-child-worker-unavailable",
          kind: "native_delivery" as const,
          v: 1 as const,
        },
        watchId: "watch-lark-worker-unavailable",
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery(unavailableInput)
      ).resolves.toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: unavailableInput.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.worker_submit_failed",
        finalPublicationState: "published",
        status: "worker_unavailable",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(publishFailure).toHaveBeenCalledTimes(4);
    } finally {
      await harness.close();
    }
  });
  it("keeps a deterministically rejected continuation terminal across replay", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      idempotencyKey: "agent-task-continuation:subscription-rejected",
      message: "The continuation identity is invalid.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.turn_envelope_identity_mismatch" as const,
      v: 1 as const,
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idempotency-rejected-parent",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "submission-rejected-parent",
        threadContext: THREAD_CONTEXT,
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-rejected-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected rejected continuation parent fixture");
      }
      const watchedTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-rejected-child",
        spaceId: SPACE_ID,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-rejected-child",
        occurredAtMs: 1050,
        publishedSignalId: "signal-rejected-child",
        status: "succeeded" as const,
      };
      const input = {
        db: harness.db,
        env,
        idempotencyKey: "agent-task-continuation:subscription-rejected",
        instruction: "Continue after the exact task.",
        isAuthorized: async () => true,
        nowMs: 1100,
        observerDelivery,
        outcome,
        sourceSignalId: "signal_1",
        spaceId: SPACE_ID,
        subscriptionId: "subscription-rejected",
        threadContext: THREAD_CONTEXT,
        watchedTask,
        watchId: "watch-rejected",
      };
      const first = await submitRemoteAgentTaskContinuationDelivery(input);
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledOnce();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Center Agent could not start this request. Please try again.",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: input.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        finalPublicationState: "published",
        publishedSignalId: "signal_reply_1",
        status: "failed",
      });
      const replay = await submitRemoteAgentTaskContinuationDelivery({
        ...input,
        nowMs: 1200,
      });
      expect(first).toMatchObject({
        status: "terminal",
        task: { kind: "native_delivery" },
      });
      expect(replay).toEqual(first);
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: input.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("projects a deterministic continuation rejection for a watcher registered during admission", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    let resolveWorkerSubmit!: (value: {
      idempotencyKey: string;
      message: string;
      outcome: "rejected";
      reasonCode: "remote_agent.turn_envelope_identity_mismatch";
      v: 1;
    }) => void;
    const workerSubmit = vi.fn(
      () =>
        new Promise<{
          idempotencyKey: string;
          message: string;
          outcome: "rejected";
          reasonCode: "remote_agent.turn_envelope_identity_mismatch";
          v: 1;
        }>((resolve) => {
          resolveWorkerSubmit = resolve;
        })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idempotency-observed-rejection-parent",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "submission-observed-rejection-parent",
        threadContext: THREAD_CONTEXT,
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-observed-rejection-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected observed rejection parent fixture");
      }
      const idempotencyKey =
        "agent-task-continuation:subscription-observed-rejection";
      const watchedTask = {
        deliveryId: "delivery-observed-child",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      const submission = submitRemoteAgentTaskContinuationDelivery({
        db: harness.db,
        env,
        idempotencyKey,
        instruction: "Continue after the exact task.",
        isAuthorized: async () => true,
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-observed-child",
          occurredAtMs: 1050,
          publishedSignalId: "signal-observed-child",
          status: "succeeded",
        },
        settlementNowMs: () => 1200,
        subscriptionId: "subscription-observed-rejection",
        watchedTask,
        watchId: "watch-observed-rejection",
      });
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      const continuationDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        });
      if (!continuationDelivery) {
        throw new Error("expected continuation delivery during admission");
      }
      const continuationTask = {
        deliveryId: continuationDelivery.deliveryId,
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "subscription-key:observed-rejection",
        nowMs: 1150,
        observerTask: {
          agentControllerRef: "builtin:codex",
          hostId: "host-1",
          kind: "controller_task",
          taskId: "observer-task-rejection",
          v: 1,
        },
        organizationId: observerDelivery.organizationId,
        subscriptionId: "subscription-watching-rejected-continuation",
        watchedTask: continuationTask,
      });
      resolveWorkerSubmit({
        idempotencyKey,
        message: "The continuation identity is invalid.",
        outcome: "rejected",
        reasonCode: "remote_agent.turn_envelope_identity_mismatch",
        v: 1,
      });
      await expect(submission).resolves.toMatchObject({
        status: "terminal",
        task: continuationTask,
      });
      await expect(
        readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(continuationTask),
        })
      ).resolves.toMatchObject({
        outcome: {
          errorCode: "remote_agent.turn_envelope_identity_mismatch",
          publishedSignalId: "signal_reply_1",
          status: "failed",
        },
        task: continuationTask,
      });
    } finally {
      await harness.close();
    }
  });
  it("projects a continuation admission timeout to its watcher and replays it idempotently", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) =>
        Promise.resolve(message)
    );
    const workerSubmit = vi.fn(() => new Promise<never>(() => undefined));
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: dispatchQueueSend,
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idempotency-observed-timeout-parent",
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "submission-observed-timeout-parent",
        threadContext: THREAD_CONTEXT,
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-observed-timeout-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected observed timeout parent fixture");
      }
      const idempotencyKey =
        "agent-task-continuation:subscription-observed-timeout";
      const watchedTask = {
        deliveryId: "delivery-observed-timeout-child",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      const pendingAdmission = submitRemoteAgentTaskContinuationDelivery({
        db: harness.db,
        env,
        idempotencyKey,
        instruction: "Continue after the exact task.",
        isAuthorized: async () => true,
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-observed-timeout-child",
          occurredAtMs: 1050,
          publishedSignalId: "signal-observed-timeout-child",
          status: "succeeded",
        },
        settlementNowMs: () => 1200,
        subscriptionId: "subscription-observed-timeout",
        watchedTask,
        watchId: "watch-observed-timeout",
      });
      expect(pendingAdmission).toBeInstanceOf(Promise);
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      const continuationDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        });
      if (!continuationDelivery) {
        throw new Error("expected continuation delivery during admission");
      }
      const continuationTask = {
        deliveryId: continuationDelivery.deliveryId,
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "subscription-key:observed-timeout",
        nowMs: 1150,
        observerTask: {
          agentControllerRef: "builtin:codex",
          hostId: "host-1",
          kind: "controller_task",
          taskId: "observer-task-timeout",
          v: 1,
        },
        organizationId: observerDelivery.organizationId,
        subscriptionId: "subscription-watching-timeout-continuation",
        watchedTask: continuationTask,
      });
      const probe = dispatchQueueSend.mock.calls.find(
        ([message]) =>
          message.kind === "remote_agent_native_delivery_deadline_probe"
      )?.[0];
      if (!probe) {
        throw new Error("expected continuation admission watchdog probe");
      }
      await harness.query({
        values: [idempotencyKey],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            status = 'failed',
            failure_code = 'remote_agent.admission_timeout',
            failure_detail = 'A retryable publisher still owns this admission.',
            completed_at_ms = 1160,
            updated_at_ms = 1160
          WHERE idempotency_key = $1
        `,
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.admission_watchdog_terminal_delivery",
        status: "skipped",
      });
      await expect(
        readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(continuationTask),
        })
      ).resolves.toMatchObject({
        outcome: {
          errorCode: "remote_agent.admission_timeout",
          status: "failed",
        },
        task: continuationTask,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-watching-timeout-continuation",
        })
      ).resolves.toMatchObject({
        outcome: {
          errorCode: "remote_agent.admission_timeout",
          status: "failed",
        },
        state: "settled",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.admission_watchdog_terminal_delivery",
        status: "skipped",
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    ...[0, 1, 3].flatMap((round) =>
      ["watchdog", "accepted"].flatMap((phase) =>
        [false, true].map((stopped) => ({
          round,
          phase,
          stopped,
          mismatch: null,
        }))
      )
    ),
    ...["organization", "subscription"].map((mismatch) => ({
      round: 3,
      phase: "accepted",
      stopped: true,
      mismatch,
    })),
  ])("checks the trusted continuation chain at round $round/$phase with parent stopped=$stopped mismatch=$mismatch", async ({
    round,
    phase,
    stopped,
    mismatch,
  }) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const subscriptionId = "subscription-loop-stop";
    const originalKey = `agent-task-continuation:${subscriptionId}`;
    const cancelExecution = vi.fn<
      NonNullable<
        NonNullable<
          CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
        >["cancelExecution"]
      >
    >((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        status: "already_cancelled",
        execution: {
          ...identity,
          acceptedAtMs: 2000,
          cancellationReason: reason ?? null,
          completedAtMs: 400_000,
          lastProgressAtMs: 400_000,
          lastProgressKind: "aborted",
          status: "aborted",
        },
      });
    });
    const reconcileExecution = vi
      .fn()
      .mockRejectedValue(new Error("probe transport unavailable"));
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: vi
          .fn()
          .mockRejectedValue(new Error("ACK lost")),
        cancelExecution,
        reconcileExecution,
        readAdmissionStop: async (request) => ({
          v: 1,
          status: "found",
          stopIntent: {
            v: 1,
            organizationId: request.organizationId,
            spaceId: request.spaceId,
            idempotencyKey: request.idempotencyKey,
            requestedAtMs: 400_000,
            reason: "Parent stopped",
          },
        }),
      },
    });
    try {
      let delivery = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey: originalKey,
        subscriptionId,
        replyLanguageTag: "en",
      });
      for (let attempt = 1; attempt <= round; attempt += 1) {
        delivery = await markRemoteAgentNativeDeliveryAck({
          db: harness.db,
          nowMs: 1200 + attempt,
          idempotencyKey: delivery.idempotencyKey,
          submissionId: `submission:${attempt - 1}`,
          accepted: true,
          workerRequestId: null,
        });
        const previousRequest = delivery.executionRecoverySubmitRequest;
        if (!previousRequest) {
          throw new Error("Expected the persisted request");
        }
        const nextKey = `${delivery.deliveryId}:work-loop:${attempt}`;
        delivery = await rearmRemoteAgentNativeDeliveryForWorkLoop({
          db: harness.db,
          delivery,
          attempt,
          nowMs: 1300 + attempt,
          checkpoint: {
            v: 1,
            reason: "tool_call_budget_exhausted",
            toolCallLimit: 64,
          },
          nextIdempotencyKey: nextKey,
          nextWorkerSubmitRequest:
            remoteAgentWorkerSubmitTurnRequestSchema.parse({
              ...previousRequest,
              idempotencyKey: nextKey,
              turnEnvelope: {
                ...previousRequest.turnEnvelope,
                workLoopContinuation: {
                  v: 1,
                  attempt,
                  reason: "tool_call_budget_exhausted",
                  previousSubmissionId: delivery.submissionId,
                },
              },
            }),
        });
      }
      if (phase === "accepted") {
        delivery = await markRemoteAgentNativeDeliveryAck({
          db: harness.db,
          nowMs: 2000,
          idempotencyKey: delivery.idempotencyKey,
          submissionId: `submission:${round}`,
          accepted: true,
          workerRequestId: null,
        });
      }
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId,
      });
      if (!subscription) {
        throw new Error("Expected the subscription");
      }
      if (stopped) {
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 3000,
          task: subscription.observerTask,
          outcome: {
            status: "stopped",
            errorCode: "execution_cancelled",
            eventId: "parent-stopped",
            occurredAtMs: 3000,
            publishedSignalId: null,
          },
        });
      }
      const probe = {
        ...createDeadlineProbe({
          idempotencyKey: delivery.idempotencyKey,
          submissionId:
            phase === "watchdog"
              ? `admission_watchdog:${delivery.idempotencyKey}`
              : `submission:${round}`,
        }),
        dispatchId: delivery.dispatchId,
        deadlineAtMs: 400_000,
      };
      if (mismatch) {
        if (mismatch === "organization") {
          await harness.query({
            text: 'UPDATE "openmeld"."agent_task_completion_subscriptions" SET organization_id = \'org_other\' WHERE subscription_id = $1',
            values: [subscriptionId],
          });
        } else {
          const otherSubscriptionId = "other-subscription";
          await registerAgentTaskCompletionSubscription({
            db: harness.db,
            organizationId: subscription.organizationId,
            observerTask: subscription.observerTask,
            watchedTask: subscription.watchedTask,
            continuation: subscription.continuation,
            completionCondition: subscription.completionCondition,
            subscriptionId: otherSubscriptionId,
            idempotencyKey: "register-other-subscription",
            nowMs: 3001,
          });
          await claimReadyAgentTaskCompletionSubscription({
            db: harness.db,
            subscriptionId: otherSubscriptionId,
            claimId: "other-claim",
            claimLeaseMs: 30_000,
            nowMs: 3002,
          });
          const currentRequest = delivery.executionRecoverySubmitRequest;
          if (!currentRequest) {
            throw new Error("Expected the current request");
          }
          const foreignRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse(
            {
              ...currentRequest,
              turnEnvelope: {
                ...currentRequest.turnEnvelope,
                trigger: {
                  ...currentRequest.turnEnvelope.trigger,
                  subscriptionId: otherSubscriptionId,
                },
              },
            }
          );
          await harness.query({
            text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET execution_recovery_submit_request_json = $1 WHERE delivery_id = $2',
            values: [JSON.stringify(foreignRequest), delivery.deliveryId],
          });
        }
        await expect(
          processRemoteAgentNativeDeliveryDeadlineProbe({
            db: harness.db,
            env,
            nowMs: probe.deadlineAtMs,
            probe,
          })
        ).rejects.toThrow("stop_identity_mismatch");
        expect(cancelExecution).not.toHaveBeenCalled();
        return;
      }
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toMatchObject({ status: "skipped" });
      if (stopped) {
        expect(cancelExecution).toHaveBeenCalledWith(
          expect.objectContaining({ idempotencyKey: delivery.idempotencyKey })
        );
        expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ noticeType: "wake_stopped" }),
          })
        );
      } else {
        expect(cancelExecution).not.toHaveBeenCalled();
      }
    } finally {
      await harness.close();
    }
  });
  it.each([
    "watchdog",
    "backoff",
  ] as const)("keeps a stopped parent ahead of its continuation %s, including a failed Stop transport", async (phase) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi
      .fn()
      .mockRejectedValue(new Error("ACK response lost"));
    const cancelExecution = vi
      .fn()
      .mockRejectedValueOnce(new Error("Stop transport unavailable"))
      .mockResolvedValue({ status: "not_found" });
    const readAdmissionStop = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        v: 1 as const,
        status: "found" as const,
        stopIntent: {
          v: 1 as const,
          organizationId: request.organizationId,
          spaceId: request.spaceId,
          idempotencyKey: request.idempotencyKey,
          requestedAtMs: 1300,
          reason: "Parent task was stopped.",
        },
      })
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        cancelExecution,
        readAdmissionStop,
        submitConversationTurn: workerSubmit,
      },
    });
    const subscriptionId = `subscription-parent-stop-${phase}`;
    const idempotencyKey = `agent-task-continuation:${subscriptionId}`;
    try {
      const staged = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
        subscriptionId,
        replyLanguageTag: "en",
      });
      let probe = requireAdmissionProbe(probes, "watchdog", 1);
      if (phase === "backoff") {
        await processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        });
        probe = requireAdmissionProbe(probes, "retry", 2);
      }
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId,
      });
      if (!subscription) {
        throw new Error("Expected the task owner's continuation");
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: probe.deadlineAtMs - 1,
        task: subscription.observerTask,
        outcome: {
          status: "stopped",
          errorCode: "execution_cancelled",
          eventId: `parent-stop-${phase}`,
          occurredAtMs: probe.deadlineAtMs - 1,
          publishedSignalId: null,
        },
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toMatchObject({
        status: "skipped",
        reasonCode: "remote_agent.cancellation_execution_unconfirmed",
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
      const repair = probes.at(-1);
      if (!repair) {
        throw new Error("Expected a durable Stop repair probe");
      }
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: repair.deadlineAtMs,
          probe: repair,
        })
      ).resolves.toMatchObject({
        status: "skipped",
        reasonCode: "remote_agent.execution_cancelled",
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(cancelExecution).toHaveBeenCalledTimes(2);
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "wake_stopped",
            reasonCode: "remote_agent.execution_cancelled",
          }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        status: "failed",
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        submissionId: null,
        acceptedAtMs: null,
        publishedSignalId: "signal_reply_1",
      });
      const task = {
        kind: "native_delivery" as const,
        deliveryId: staged.deliveryId,
        v: 1 as const,
      };
      // Observe the stopped task through the existing owner, not a synthetic ACK.
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: `observe-${phase}`,
        nowMs: repair.deadlineAtMs,
        observerTask: {
          kind: "native_delivery",
          deliveryId: `observer-${phase}`,
          v: 1,
        },
        organizationId: "org_1",
        subscriptionId: `observe-${phase}`,
        watchedTask: task,
      });
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: repair.deadlineAtMs + 1,
        probe: repair,
      });
      await expect(
        readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(task),
        })
      ).resolves.toMatchObject({ outcome: { status: "stopped" } });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).not.toHaveBeenCalled();
      expect(
        await harness.queryAll({
          text: 'SELECT * FROM "openmeld"."inbox_items" WHERE attention = \'needs_action\'',
          values: [],
        })
      ).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "confirmed",
    "repair_admission",
    "repair_accepted",
  ] as const)("forwards a parent Stop that races with the retry ACK without publishing a failure (%s)", async (phase) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const subscriptionId = "subscription-retry-stop-race";
    const idempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("ACK response lost"))
      .mockImplementationOnce(
        async (request: RemoteAgentWorkerSubmitTurnRequest) => {
          const subscription = await readAgentTaskCompletionSubscription({
            db: harness.db,
            subscriptionId,
          });
          if (!subscription) {
            throw new Error("Expected the original task owner");
          }
          await recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 300_000,
            task: subscription.observerTask,
            outcome: {
              status: "stopped",
              errorCode: "execution_cancelled",
              eventId: "parent-stopped-during-submit",
              occurredAtMs: 300_000,
              publishedSignalId: null,
            },
          });
          return {
            accepted: true,
            createdAt: 300_000,
            status: "pending",
            submissionId: request.dispatchId,
          };
        }
      );
    const cancelExecution = vi.fn<
      NonNullable<
        NonNullable<
          CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
        >["cancelExecution"]
      >
    >((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        status: "already_cancelled",
        execution: {
          ...identity,
          acceptedAtMs: 300_000,
          cancellationReason: reason ?? null,
          completedAtMs: 300_001,
          lastProgressAtMs: 300_001,
          lastProgressKind: "aborted",
          status: "aborted",
        },
      });
    });
    if (phase !== "confirmed") {
      cancelExecution.mockRejectedValueOnce(
        new Error("Stop transport unavailable after ACK")
      );
    }
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
        subscriptionId,
        replyLanguageTag: "en",
      });
      const watchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: watchdog.deadlineAtMs,
        probe: watchdog,
      });
      const retry = requireAdmissionProbe(probes, "retry", 2);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        })
      ).resolves.toMatchObject({
        status: "skipped",
        reasonCode:
          phase === "confirmed"
            ? "remote_agent.execution_cancelled"
            : "remote_agent.cancellation_execution_unconfirmed",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(cancelExecution).toHaveBeenCalledOnce();
      if (phase !== "confirmed") {
        expect(
          env.__spaceStub.rpcPostSystemNoticeSignal
        ).not.toHaveBeenCalled();
        const repair =
          phase === "repair_admission"
            ? probes.at(-1)
            : probes.find(
                (candidate) => candidate.submissionId === idempotencyKey
              );
        if (!repair) {
          throw new Error("Expected the durable post-ACK Stop repair probe");
        }
        await expect(
          processRemoteAgentNativeDeliveryDeadlineProbe({
            db: harness.db,
            env,
            nowMs: Math.max(repair.deadlineAtMs, retry.deadlineAtMs) + 1,
            probe: repair,
          })
        ).resolves.toMatchObject({
          status: "skipped",
          reasonCode: "remote_agent.execution_cancelled",
        });
      }
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ noticeType: "wake_stopped" }),
        })
      );
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: retry.deadlineAtMs + 1,
        probe: retry,
      });
      expect(cancelExecution).toHaveBeenCalledTimes(
        phase === "confirmed" ? 1 : 2
      );
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledOnce();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("retries a timed-out task continuation and records the later admission", async () => {
    const admissionLogs = vi.spyOn(console, "info").mockImplementation(() => {
      // The lost response and the later ACK must remain separate evidence.
    });
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("admission response was lost"))
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: 1200,
        requestId: "request-retried-continuation",
        status: "pending" as const,
        submissionId: "submission-retried-continuation",
      });
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const idempotencyKey = "agent-task-continuation:retry-success";
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const initialWatchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: initialWatchdog.deadlineAtMs,
          probe: initialWatchdog,
        })
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.task_continuation.admission_retry_scheduled",
        status: "skipped",
      });
      const retry = requireAdmissionProbe(probes, "retry", 2);
      expect(retry.submissionId).toBe(initialWatchdog.submissionId);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        })
      ).resolves.toMatchObject({
        reasonCode:
          "remote_agent.task_continuation.admission_retry_acknowledged",
        status: "skipped",
      });
      expect(requireAdmissionProbe(probes, "watchdog", 2).submissionId).toBe(
        initialWatchdog.submissionId
      );
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
        dispatchId: idempotencyKey,
        idempotencyKey,
      });
      expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
        dispatchId: idempotencyKey,
        idempotencyKey,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        acceptedAtMs: retry.deadlineAtMs,
        admissionAttemptCount: 2,
        admissionRetryDueAtMs: null,
        status: "accepted",
        submissionId: "submission-retried-continuation",
      });
      const evidence = admissionLogs.mock.calls
        .filter(([label]) => label === "[core.remote_agent.admission_attempt]")
        .map(([, event]) => event);
      expect(
        evidence.filter(
          (event) =>
            event.phase === "admission_finished" &&
            event.outcome === "outcome_unknown"
        )
      ).toEqual([expect.objectContaining({ attempt: 1, idempotencyKey })]);
      expect(
        evidence.filter((event) => event.phase === "acknowledged")
      ).toEqual([
        expect.objectContaining({
          accepted: true,
          attempt: 2,
          currentAttemptSubmittedAtMs: retry.deadlineAtMs,
          idempotencyKey,
          submissionId: "submission-retried-continuation",
        }),
      ]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      admissionLogs.mockRestore();
      await harness.close();
    }
  });
  it.each([
    "found",
    "not_found",
    "transport_error",
    "old_receiver",
    "malformed_response",
  ] as const)("recovers a lost ACK and keeps the real submission when reconciliation is %s", async (reconciliationStatus) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const submissionId = "original-native-submission";
    const idempotencyKey = "agent-task-continuation:read-original-ack";
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("ACK response lost"))
    );
    const readAdmission = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        v: 1 as const,
        status: "found" as const,
        ack: {
          accepted: false as const,
          createdAt: 1100,
          idempotencyKey: request.idempotencyKey,
          status: "pending" as const,
          submissionId,
        },
      })
    );
    const reconcileExecution = vi.fn(() => {
      if (
        reconciliationStatus === "transport_error" ||
        reconciliationStatus === "old_receiver"
      ) {
        return Promise.reject(
          new Error(
            reconciliationStatus === "old_receiver"
              ? "RPC receiver does not implement method reconcileExecution"
              : "execution reconciliation transport unavailable"
          )
        );
      }
      if (reconciliationStatus === "malformed_response") {
        // Deliberately violate the receiver contract to exercise validation.
        return Promise.resolve({ status: "found", execution: null } as never);
      }
      return Promise.resolve(
        reconciliationStatus === "not_found"
          ? { status: "not_found" as const }
          : {
              status: "found" as const,
              execution: {
                v: 1 as const,
                acceptedAtMs: 1100,
                cancellationReason: null,
                completedAtMs: null,
                idempotencyKey,
                lastProgressAtMs: 260_000,
                lastProgressKind: "tool_started" as const,
                organizationId: "org_1",
                spaceId: SPACE_ID,
                status: "running" as const,
                submissionId,
              },
            }
      );
    });
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        readAdmission,
        reconcileExecution,
      },
    });
    try {
      const delivery = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const watchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs,
          probe: watchdog,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.admission_ack_recovered",
        status: "skipped",
      });
      expect(readAdmission).toHaveBeenCalledWith(delivery.workerSubmitRequest);
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      const acceptedProbe = probes.find(
        (probe) => probe.submissionId === submissionId
      );
      if (!acceptedProbe) {
        throw new Error("Expected the existing accepted-execution probe");
      }
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: acceptedProbe.deadlineAtMs,
        probe: acceptedProbe,
      });
      expect(reconcileExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey,
          submissionId,
        })
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        submissionId,
        admissionAttemptCount: 1,
        status: "retry_observed",
        failureCode: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("retains a recovered ACK when scheduling reconciliation fails and repairs its existing probe without replaying startup", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const idempotencyKey = "agent-task-continuation:recovered-probe-failure";
    const submissionId = "original-submission-with-probe-failure";
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("ACK response lost"))
    );
    let rejectAcceptedProbe = true;
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        if (probe.submissionId === submissionId && rejectAcceptedProbe) {
          rejectAcceptedProbe = false;
          return Promise.reject(
            new Error("Accepted probe transport unavailable")
          );
        }
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        readAdmission: vi.fn(
          async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
            v: 1 as const,
            status: "found" as const,
            ack: {
              accepted: false as const,
              createdAt: 1100,
              idempotencyKey: request.idempotencyKey,
              status: "pending" as const,
              submissionId,
            },
          })
        ),
      },
    });
    const evidence = vi.spyOn(console, "info");
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const watchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs,
          probe: watchdog,
        })
      ).rejects.toThrow();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        status: "retry_observed",
        submissionId,
        admissionAttemptCount: 1,
        admissionRetryDueAtMs: null,
        acceptedProbeNextDueAtMs: null,
      });
      expect(
        evidence.mock.calls.filter(
          ([label, event]) =>
            label === "[core.remote_agent.admission_attempt]" &&
            event.idempotencyKey === idempotencyKey &&
            (event.phase === "timed_out" || event.phase === "retry_scheduled")
        )
      ).toEqual([]);
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs + 1,
        })
      ).resolves.toMatchObject({ errors: 0 });
      expect(
        probes.filter((probe) => probe.submissionId === submissionId)
      ).toHaveLength(1);
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      evidence.mockRestore();
      await harness.close();
    }
  });
  it.each([
    "not_found",
    "unconfirmed",
    "old_receiver",
    "transport_error",
  ] as const)("does not adopt a synthetic execution from a %s admission receipt", async (status) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("ACK response lost"))
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        readAdmission: vi.fn(() => {
          if (status === "old_receiver" || status === "transport_error") {
            return Promise.reject(
              new Error(
                status === "old_receiver"
                  ? "RPC receiver does not implement method readAdmission"
                  : "transport unavailable"
              )
            );
          }
          return Promise.resolve({ v: 1 as const, status });
        }),
      },
    });
    const idempotencyKey = `agent-task-continuation:receipt-${status}`;
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const watchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: watchdog.deadlineAtMs,
        probe: watchdog,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        submissionId: null,
        status: "submitted",
        admissionAttemptCount: 1,
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        probes.every((probe) =>
          probe.submissionId.startsWith("admission_watchdog:")
        )
      ).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("delivers the watched terminal outcome even when its Inbox projection fails", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: {
        submitConversationTurn: vi.fn(() =>
          Promise.reject(new Error("admission response was lost"))
        ),
      },
    });
    try {
      const delivery = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey: "agent-task-continuation:inbox-failure",
      });
      const watchedTask = {
        kind: "native_delivery" as const,
        v: 1 as const,
        deliveryId: delivery.deliveryId,
      };
      await registerAgentTaskCompletionSubscription({
        db: harness.db,
        organizationId: "org_1",
        completionCondition: "terminal",
        continuation: null,
        nowMs: 1300,
        subscriptionId: "watch-inbox-failure",
        idempotencyKey: "watch-inbox-failure",
        observerTask: {
          kind: "controller_task",
          v: 1,
          agentControllerRef: "builtin:codex",
          hostId: "host-1",
          taskId: "observer",
        },
        watchedTask,
      });
      for (let attempt = 1; attempt < 3; attempt += 1) {
        const watchdog = requireAdmissionProbe(probes, "watchdog", attempt);
        await processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs,
          probe: watchdog,
        });
        const retry = requireAdmissionProbe(probes, "retry", attempt + 1);
        await processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        });
      }
      const removeFailure = await installPostgresWriteFailure({
        harness,
        table: "inbox_items",
        operation: "INSERT",
        message: "inbox unavailable",
      });
      const watchdog = requireAdmissionProbe(probes, "watchdog", 3);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs,
          probe: watchdog,
        })
      ).rejects.toThrow();
      await expect(
        readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(watchedTask),
        })
      ).resolves.toMatchObject({ outcome: { status: "failed" } });
      expect(
        await harness.queryAll({
          text: `SELECT id FROM "openmeld"."inbox_items"`,
        })
      ).toEqual([]);
      await removeFailure();
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: watchdog.deadlineAtMs + 1,
        probe: watchdog,
      });
      expect(
        await harness.queryAll({
          text: `SELECT attention FROM "openmeld"."inbox_items"`,
        })
      ).toEqual([{ attention: "update" }]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    ["pending", "en", undefined],
    ["sent", "en", undefined],
    ["pending", "zh-Hans", undefined],
    ["pending", "zh-Hans", "en"],
    ["pending", "en", "zh-Hans"],
  ] as const)("alerts the requester after task continuation admission retries are exhausted and preserves %s email evidence in %s (Organization %s)", async (emailState, languageTag, organizationLanguage) => {
    const admissionLogs = vi.spyOn(console, "info").mockImplementation(() => {
      // Capture bounded evidence without flooding the test output.
    });
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("admission response was lost"))
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const subscriptionId = "subscription-language-exhausted";
    const idempotencyKey = `agent-task-continuation:${subscriptionId}`;
    try {
      await setOrganizationWorkingLanguagePreference({
        db: harness.db,
        organizationId: "org_1",
        languageTag: organizationLanguage ?? languageTag,
        mode: "selected",
        nowMs: 1,
        updatedByUserId: "user_1",
      });
      const delivery = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
        ...(organizationLanguage
          ? { replyLanguageTag: languageTag, subscriptionId }
          : {}),
      });
      for (
        let attempt = 1;
        attempt <= REMOTE_AGENT_TASK_CONTINUATION_ADMISSION_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const watchdog = requireAdmissionProbe(probes, "watchdog", attempt);
        const outcome = await processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: watchdog.deadlineAtMs,
          probe: watchdog,
        });
        if (attempt === REMOTE_AGENT_TASK_CONTINUATION_ADMISSION_MAX_ATTEMPTS) {
          expect(outcome).toEqual({ status: "expired" });
          break;
        }
        expect(outcome).toMatchObject({
          reasonCode:
            "remote_agent.task_continuation.admission_retry_scheduled",
          status: "skipped",
        });
        const retry = requireAdmissionProbe(probes, "retry", attempt + 1);
        await expect(
          processRemoteAgentNativeDeliveryDeadlineProbe({
            db: harness.db,
            env,
            nowMs: retry.deadlineAtMs,
            probe: retry,
          })
        ).resolves.toMatchObject({
          reasonCode:
            "remote_agent.task_continuation.admission_retry_outcome_unknown",
          status: "skipped",
        });
      }
      expect(workerSubmit).toHaveBeenCalledTimes(
        REMOTE_AGENT_TASK_CONTINUATION_ADMISSION_MAX_ATTEMPTS
      );
      const evidence = admissionLogs.mock.calls
        .filter(([label]) => label === "[core.remote_agent.admission_attempt]")
        .map(([, event]) => event);
      const sends = evidence.filter((event) => event.phase === "sending");
      expect(
        sends.map((event) => ({
          attempt: event.attempt,
          currentAttemptSubmittedAtMs: event.currentAttemptSubmittedAtMs,
        }))
      ).toEqual([
        { attempt: 1, currentAttemptSubmittedAtMs: delivery.submittedAtMs },
        {
          attempt: 2,
          currentAttemptSubmittedAtMs: requireAdmissionProbe(probes, "retry", 2)
            .deadlineAtMs,
        },
        {
          attempt: 3,
          currentAttemptSubmittedAtMs: requireAdmissionProbe(probes, "retry", 3)
            .deadlineAtMs,
        },
      ]);
      expect(
        evidence
          .filter((event) => event.phase === "timed_out")
          .map((event) => event.attempt)
      ).toEqual([1, 2, 3]);
      expect(
        evidence.filter(
          (event) =>
            event.phase === "admission_finished" &&
            event.outcome === "outcome_unknown"
        )
      ).toHaveLength(3);
      for (const event of evidence) {
        expect(event).toMatchObject({
          deliveryId: delivery.deliveryId,
          dispatchId: delivery.dispatchId,
          idempotencyKey,
          deliveryCreatedAtMs: delivery.createdAtMs,
        });
        expect(event).not.toHaveProperty("error");
        expect(event).not.toHaveProperty("workerSubmitRequest");
      }
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey,
        })
      ).resolves.toMatchObject({
        admissionAttemptCount:
          REMOTE_AGENT_TASK_CONTINUATION_ADMISSION_MAX_ATTEMPTS,
        failureCode: "remote_agent.admission_timeout",
        status: "failed",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            languageTag === "en" ? "after 3 attempts" : "共 3 次"
          ),
        })
      );
      const failureText =
        env.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls.at(
          -1
        )?.[0]?.text;
      expect(failureText).toContain(
        languageTag === "en"
          ? "There will be no automatic recovery"
          : "不会再自动恢复"
      );
      expect(failureText).toContain(
        languageTag === "en" ? "may repeat earlier actions" : "可能重复执行"
      );
      expect(failureText).toContain(
        languageTag === "en"
          ? "summarize the existing results"
          : "基于已有结果重新汇总"
      );
      const failurePreview = await (
        await harness.queryAll<{
          preview: string;
        }>({
          text: 'SELECT preview FROM "openmeld"."inbox_items"',
        })
      )[0]?.preview;
      expect(failurePreview).toBe(failureText);
      expect(
        await harness.queryAll<{
          attention: string;
          importance: string;
          preview: string;
          recipient_user_id: string;
          source_key: string;
          source_target_json: string;
        }>({
          text: `
            SELECT
              attention,
              importance,
              preview,
              recipient_user_id,
              source_key,
              source_target_json
            FROM "openmeld"."inbox_items"
          `,
        })
      ).toEqual([
        expect.objectContaining({
          attention: "update",
          importance: "normal",
          preview: expect.stringContaining(
            languageTag === "en" ? "3 attempts" : "共 3 次"
          ),
          recipient_user_id: "user_1",
          source_key: `${delivery.deliveryId}:admission_retry_exhausted`,
          source_target_json: JSON.stringify({
            kind: "space",
            signalId: "signal_reply_1",
            spaceId: SPACE_ID,
            threadRootSignalId: THREAD_CONTEXT.rootSignalId,
          }),
        }),
      ]);
      const oldItem = await (
        await harness.queryAll<{
          id: string;
        }>({
          text: 'SELECT id FROM "openmeld"."inbox_items"',
        })
      )[0];
      if (!oldItem) {
        throw new Error("Expected a continuation notice");
      }
      // A previously shipped projection linked the child result into this
      // parent's Space and demanded action. Preserve the recipient's choices.
      await harness.db.query({
        ...{
          text: `UPDATE "openmeld"."inbox_items" SET
        attention = 'action_required', importance = 'urgent',
        resolution_status = 'open',
        source_target_json = $1, source_facts_json = $2,
        read_at_ms = 900001, cleared_at_ms = 900002 WHERE id = $3`,
          values: [],
        },
        values: [
          JSON.stringify({
            kind: "space",
            signalId: "signal-task-result",
            spaceId: SPACE_ID,
            threadRootSignalId: THREAD_CONTEXT.rootSignalId,
          }),
          JSON.stringify({
            version: 1,
            recipientReasons: ["requester"],
            requestCategory: "action",
          }),
          oldItem.id,
        ],
      });
      const terminal = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey,
      });
      if (!terminal) {
        throw new Error("Expected the failed continuation");
      }
      const occurrence = await (
        await harness.queryAll<{
          occurred_at_ms: number;
        }>({
          text: 'SELECT occurred_at_ms FROM "openmeld"."inbox_items"',
        })
      )[0];
      if (!occurrence) {
        throw new Error("Expected the retained occurrence");
      }
      await harness.query({
        text: `INSERT INTO "openmeld"."inbox_email_deliveries"
        (id, inbox_item_id, state, attempt_count, next_attempt_at_ms, message_id, sent_at_ms, created_at_ms, updated_at_ms)
        VALUES ($1, $2, $3, $4, 2000, $5, $6, 2000, 2700)`,
        values: [
          "legacy-continuation-email",
          oldItem.id,
          emailState,
          emailState === "sent" ? 1 : 0,
          emailState === "sent" ? "provider-receipt" : null,
          emailState === "sent" ? 2700 : null,
        ],
      });
      // A different source occurrence is not a known legacy projection.
      await harness.query({
        text: 'UPDATE "openmeld"."inbox_items" SET occurred_at_ms = $1 WHERE id = $2',
        values: [occurrence.occurred_at_ms + 1, oldItem.id],
      });
      await expect(
        projectTaskContinuationAdmissionExhaustedInboxItem({
          attempts: 3,
          db: harness.db,
          delivery: terminal,
          occurredAtMs: occurrence.occurred_at_ms,
          languageTag,
        })
      ).rejects.toThrow(
        "Inbox source identity conflicts with an existing item"
      );
      expect(
        await harness.queryFirst({
          text: 'SELECT state FROM "openmeld"."inbox_email_deliveries" WHERE id = \'legacy-continuation-email\'',
        })
      ).toEqual({ state: emailState });
      await harness.query({
        text: 'UPDATE "openmeld"."inbox_items" SET occurred_at_ms = $1 WHERE id = $2',
        values: [occurrence.occurred_at_ms, oldItem.id],
      });
      const reconcileInput = {
        inboxDb: harness.db,
        sourceDb: harness.db,
        identityDb: harness.db,
        coordinationDb: harness.db,
        organizationId: "org_1",
        recipientUserId: "user_1",
      };
      // A changed source is not the retired producer. Read-time repair must
      // preserve it without making unrelated Inbox reads fail.
      await harness.query({
        text: `UPDATE "openmeld"."inbox_items" SET source_facts_json = $1 WHERE id = $2`,
        values: [
          JSON.stringify({
            version: 1,
            recipientReasons: ["requester"],
            requestCategory: "review",
          }),
          oldItem.id,
        ],
      });
      await expect(
        reconcileTaskContinuationInbox(reconcileInput)
      ).resolves.toBeUndefined();
      expect(
        await harness.queryFirst({
          text: `SELECT attention FROM "openmeld"."inbox_items" WHERE id = $1`,
          values: [oldItem.id],
        })
      ).toEqual({ attention: "action_required" });
      await harness.query({
        text: `UPDATE "openmeld"."inbox_items" SET source_facts_json = $1 WHERE id = $2`,
        values: [
          JSON.stringify({
            version: 1,
            recipientReasons: ["requester"],
            requestCategory: "action",
          }),
          oldItem.id,
        ],
      });
      for (let replay = 0; replay < 2; replay += 1) {
        await reconcileTaskContinuationInbox(reconcileInput);
      }
      expect(
        await harness.queryAll({
          text: `SELECT id, attention, importance,
        source_target_json, read_at_ms, cleared_at_ms, resolution_status FROM "openmeld"."inbox_items"`,
        })
      ).toEqual([
        {
          id: oldItem.id,
          attention: "update",
          importance: "normal",
          source_target_json: JSON.stringify({
            kind: "space",
            signalId: "signal_reply_1",
            spaceId: SPACE_ID,
            threadRootSignalId: THREAD_CONTEXT.rootSignalId,
          }),
          read_at_ms: 900_001,
          cleared_at_ms: 900_002,
          resolution_status: "not_applicable",
        },
      ]);
      expect(
        await harness.queryFirst({
          text: 'SELECT state, suppressed_reason, message_id, sent_at_ms, attempt_count FROM "openmeld"."inbox_email_deliveries" WHERE id = \'legacy-continuation-email\'',
        })
      ).toMatchObject(
        emailState === "sent"
          ? {
              state: "sent",
              message_id: "provider-receipt",
              sent_at_ms: 2700,
              attempt_count: 1,
            }
          : {
              state: "suppressed",
              suppressed_reason: "item_not_urgent",
              message_id: null,
              sent_at_ms: null,
              attempt_count: 0,
            }
      );
    } finally {
      admissionLogs.mockRestore();
      await harness.close();
    }
  });
  it("does not retry a task continuation accepted before the retry wake", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("admission response was lost"));
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const idempotencyKey = "agent-task-continuation:accepted-before-retry";
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const initialWatchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: initialWatchdog.deadlineAtMs,
        probe: initialWatchdog,
      });
      const retry = requireAdmissionProbe(probes, "retry", 2);
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey,
        nowMs: retry.deadlineAtMs - 1,
        submissionId: "submission-late-original-ack",
        workerRequestId: "request-late-original-ack",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        })
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.admission_watchdog_already_acknowledged",
        status: "skipped",
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("claims a duplicate task continuation retry only once", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("admission response was lost"))
      .mockResolvedValue({
        accepted: true,
        createdAt: 1300,
        requestId: "request-single-retry",
        status: "pending" as const,
        submissionId: "submission-single-retry",
      });
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve(probe);
      }),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const idempotencyKey = "agent-task-continuation:duplicate-retry";
    try {
      await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey,
      });
      const initialWatchdog = requireAdmissionProbe(probes, "watchdog", 1);
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: initialWatchdog.deadlineAtMs,
        probe: initialWatchdog,
      });
      const retry = requireAdmissionProbe(probes, "retry", 2);
      const outcomes = await Promise.all([
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        }),
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: retry.deadlineAtMs,
          probe: retry,
        }),
      ]);
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode:
              "remote_agent.task_continuation.admission_retry_acknowledged",
          }),
          expect.objectContaining({
            reasonCode:
              "remote_agent.task_continuation.admission_retry_lost_race",
          }),
        ])
      );
    } finally {
      await harness.close();
    }
  });
  it("retries an ambiguous Center Agent watch admission without settling it", async () => {
    const requestTimeContext = {
      submittedAtMs: 800,
      userTime: {
        timeZone: "Asia/Taipei",
        source: "web" as const,
        observedAtMs: 700,
      },
    };
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("old worker rejected the continuation envelope");
      })
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: 1300,
        requestId: "request-task-watch",
        status: "pending" as const,
        submissionId: "submission-task-watch",
      });
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-watch-parent",
        db: harness.db,
        dispatchId: "dispatch-watch-parent",
        idempotencyKey: "idempotency-watch-parent",
        nowMs: 900,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        spaceId: SPACE_ID,
        status: "submitted",
        threadContext: THREAD_CONTEXT,
        triggerMessageId: "signal_1",
      });
      await persistTestCenterAgentWorkerSubmitRequest({
        bindingId: "binding-watch-parent",
        db: harness.db,
        dispatchId: "dispatch-watch-parent",
        idempotencyKey: "idempotency-watch-parent",
        requestTimeContext,
        spaceId: SPACE_ID,
        triggerMessageId: "signal_1",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency-watch-parent",
        nowMs: 950,
        submissionId: "submission-watch-parent",
        workerRequestId: "request-watch-parent",
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-watch-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected task watch parent delivery fixture");
      }
      const watchedTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-parallel-task",
        spaceId: SPACE_ID,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-parallel-task",
        occurredAtMs: 1050,
        publishedSignalId: "signal-parallel-result",
        status: "succeeded" as const,
      };
      const input = {
        db: harness.db,
        env,
        idempotencyKey: "agent-task-continuation:subscription-watch-1",
        instruction: "Continue after the parallel task completes.",
        isAuthorized: async () => true,
        nowMs: 1100,
        observerDelivery,
        outcome,
        sourceSignalId: "signal_1",
        spaceId: SPACE_ID,
        subscriptionId: "subscription-watch-1",
        threadContext: THREAD_CONTEXT,
        watchedTask,
        watchId: "watch-1",
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery(input)
      ).rejects.toThrow(
        "remote_agent.task_continuation.submit_outcome_unknown"
      );
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...input,
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "submitted",
        task: {
          kind: "native_delivery",
        },
      });
      expect(workerSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          idempotencyKey: "agent-task-continuation:subscription-watch-1",
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(
                '"publishedSignalId":"signal-parallel-result"'
              ),
            }),
          ],
          turnEnvelope: expect.objectContaining({
            requestTimeContext,
            sender: expect.objectContaining({
              ownerUserId: "user_1",
              profileId: HUMAN_PROFILE_ID,
              verified: true,
            }),
            trigger: {
              outcome,
              source: "task_watch_continuation",
              subscriptionId: "subscription-watch-1",
              watchedTask,
              watchId: "watch-1",
            },
          }),
        })
      );
      expect(workerSubmit).toHaveBeenCalledTimes(2);
    } finally {
      await harness.close();
    }
  });
  it("cancels a continuation stopped after worker admission but before ACK persistence", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => {
      await markRemoteAgentNativeDeliveryFailure({
        db: harness.db,
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        idempotencyKey:
          "agent-task-continuation:subscription-authorization-race",
        nowMs: 1199,
        status: "failed",
      });
      return {
        accepted: true,
        createdAt: 1200,
        requestId: "request-continuation-race",
        status: "pending" as const,
        submissionId: "submission-continuation-race",
      };
    });
    const cancelExecution = vi.fn((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 1200,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 1201,
          lastProgressKind: "cancellation_requested" as const,
          status: "cancellation_requested" as const,
        },
        status: "cancellation_requested" as const,
      });
    });
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
      },
    });
    const isAuthorized = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding-parent",
        db: harness.db,
        dispatchId: "dispatch-parent",
        idempotencyKey: "idempotency-parent",
        nowMs: 900,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        spaceId: SPACE_ID,
        status: "submitted",
        threadContext: THREAD_CONTEXT,
        triggerMessageId: "signal_1",
      });
      await persistTestCenterAgentWorkerSubmitRequest({
        bindingId: "binding-parent",
        db: harness.db,
        dispatchId: "dispatch-parent",
        idempotencyKey: "idempotency-parent",
        spaceId: SPACE_ID,
        triggerMessageId: "signal_1",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency-parent",
        nowMs: 950,
        submissionId: "submission-parent",
        workerRequestId: "request-parent",
      });
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-parent",
        });
      if (!observerDelivery) {
        throw new Error("expected parent delivery fixture");
      }
      const watchedTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-child-race",
        spaceId: SPACE_ID,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        v: 1 as const,
      };
      const outcome = {
        errorCode: null,
        eventId: "terminal-child-race",
        occurredAtMs: 1050,
        publishedSignalId: "signal-child-race",
        status: "succeeded" as const,
      };
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          db: harness.db,
          delegation: {
            barrier: "all_terminal",
            children: [
              {
                agentProfileId: watchedTask.targetProfileId,
                role: "primary",
                state: "terminal",
                task: watchedTask,
                terminalOutcome: outcome,
              },
            ],
            delegationId: "delegation-race",
            generation: 1,
          },
          delegationId: "delegation-race",
          env,
          idempotencyKey:
            "agent-task-continuation:subscription-authorization-race",
          instruction: "Synthesize the delegated result.",
          isAuthorized,
          nowMs: 1100,
          observerDelivery,
          outcome,
          subscriptionId: "subscription-authorization-race",
          watchedTask,
        })
      ).resolves.toEqual({ status: "cancelled", task: null });
      expect(cancelExecution).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey:
            "agent-task-continuation:subscription-authorization-race",
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("projects a Remote Agent callback onto its exact observed Space Wake task", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "observed-space-wake",
        sourceClientMessageId: "client-observed-space-wake",
        spaceId: SPACE_ID,
        submissionId: "submission-observed-space-wake",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "subscription-key:observed-space-wake",
        nowMs: 1150,
        observerTask: {
          agentControllerRef: "builtin:codex",
          hostId: "host-1",
          kind: "controller_task",
          taskId: "observer-task-1",
          v: 1,
        },
        organizationId: "org_1",
        subscriptionId: "subscription-observed-space-wake",
        watchedTask: {
          kind: "space_wake",
          sourceClientMessageId: "client-observed-space-wake",
          spaceId: SPACE_ID,
          targetProfileId: AGENT_PROFILE_ID,
          v: 1,
        },
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal-observed-space-wake-result",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch_1",
          idempotencyKey: "observed-space-wake",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          submissionId: "submission-observed-space-wake",
          text: "Completed.",
          triggerMessageId: "signal_1",
        })
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-observed-space-wake",
        })
      ).resolves.toMatchObject({
        outcome: {
          publishedSignalId: "signal-observed-space-wake-result",
          status: "succeeded",
        },
        state: "settled",
      });
    } finally {
      await harness.close();
    }
  });
  it("cancels a worker admitted while the Space Wake was being stopped", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_stopped_during_submit",
      status: "pending" as const,
      submissionId: "sub_stopped_during_submit",
    }));
    const cancelExecution = vi.fn((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 1001,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 1002,
          lastProgressKind: "cancellation_requested" as const,
          status: "cancellation_requested" as const,
        },
        status: "cancellation_requested" as const,
      });
    });
    const resolveProfileById = vi.fn(() =>
      Promise.reject(
        new Error("Auth owner lookup must be reused from preflight")
      )
    );
    const traceSpy = vi
      .spyOn(
        runtimeCoordinatorClient,
        "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
      )
      .mockRejectedValue(
        new Error("Hosted Stop must not use a Local runtime head")
      );
    const env = buildEnv(harness.db, {
      authWorker: { resolveProfileById },
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
      },
    });
    env.__spaceStub.rpcReadWakeStopIntent.mockImplementation(async () => ({
      status: workerSubmit.mock.calls.length ? "requested" : "not_requested",
    }));
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: 1000,
        })
      ).resolves.toEqual({
        shouldAck: true,
        status: "submitted",
      });
      expect(cancelExecution).toHaveBeenCalledWith({
        conversationId: SPACE_ID,
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        reason: "User stopped this Wake.",
        spaceId: SPACE_ID,
        submissionId: "sub_stopped_during_submit",
        v: 1,
      });
      expect(resolveProfileById).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_stopped_during_submit",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });
      expect(env.__spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      expect(traceSpy).not.toHaveBeenCalled();
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch_1",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          submissionId: "sub_stopped_during_submit",
          triggerMessageId: "signal_1",
          status: "failed",
          failureCode: "remote_agent.execution_cancelled",
          failureMessage: "Stopped.",
        })
      ).resolves.toMatchObject({ status: "accepted" });
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_stopped_during_submit",
        terminal: {
          kind: "stopped",
          noticeText: "The Agent stopped this reply.",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        },
      });
    } finally {
      traceSpy.mockRestore();
      await harness.close();
    }
  });
  it("keeps one worker admission authoritative beyond the old timeout", async () => {
    vi.useFakeTimers();
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    let resolveWorkerSubmit!: (value: {
      accepted: true;
      createdAt: number;
      requestId: string;
      status: "pending";
      submissionId: string;
    }) => void;
    const workerSubmit = vi.fn(
      () =>
        new Promise<{
          accepted: true;
          createdAt: number;
          requestId: string;
          status: "pending";
          submissionId: string;
        }>((resolve) => {
          resolveWorkerSubmit = resolve;
        })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      const submission = submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(45_000);
      let settled = false;
      submission.finally(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      resolveWorkerSubmit({
        accepted: true,
        createdAt: 46_000,
        requestId: "req_after_old_timeout",
        status: "pending",
        submissionId: "sub_after_old_timeout",
      });
      await expect(submission).resolves.toEqual({
        shouldAck: true,
        status: "submitted",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
        submissionId: "sub_after_old_timeout",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
      vi.useRealTimers();
    }
  });
  it.each([
    "found",
    "not_found",
    "legacy",
  ] as const)("forwards pre-ACK Stop before settling its visible outcome (fence %s)", async (fenceStatus) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await seedWaitingNativeDeliveryDispatch(harness);
    const probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[] = [];
    const workerSubmit = vi.fn((_request: RemoteAgentWorkerSubmitTurnRequest) =>
      Promise.reject(new Error("ACK response lost"))
    );
    const cancelExecution = vi.fn(async () => ({
      status: "not_found" as const,
    }));
    const readAdmissionStop = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) =>
        fenceStatus === "found"
          ? {
              v: 1 as const,
              status: "found" as const,
              stopIntent: {
                v: 1 as const,
                organizationId: request.organizationId,
                spaceId: request.spaceId,
                idempotencyKey: request.idempotencyKey,
                requestedAtMs: 1200,
                reason: "User stopped this Wake.",
              },
            }
          : { v: 1 as const, status: "not_found" as const }
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: vi.fn((probe) => {
        probes.push(probe);
        return Promise.resolve();
      }),
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        cancelExecution,
        ...(fenceStatus === "legacy" ? {} : { readAdmissionStop }),
      },
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: 1000,
        })
      ).resolves.toEqual({ shouldAck: false, status: "submitted" });
      const sentRequest = workerSubmit.mock.calls[0]?.[0] as
        | RemoteAgentWorkerSubmitTurnRequest
        | undefined;
      if (!sentRequest) {
        throw new Error("Expected an outward admission request");
      }
      env.__spaceStub.rpcReadWakeStopIntent.mockResolvedValue({
        status: "requested",
      });
      const readFinalOutcome = vi.fn(async () => ({
        outcome: "stopped",
        signalId: "visible-stop",
      }));
      Object.assign(env.__spaceStub, {
        rpcReadFinalReplyClaimOutcome: readFinalOutcome,
      });
      const probe = probes[0];
      if (!probe) {
        throw new Error("Expected an admission probe");
      }
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: probe.deadlineAtMs,
        probe,
      });
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: sentRequest.idempotencyKey,
          organizationId: sentRequest.organizationId,
          spaceId: sentRequest.spaceId,
        })
      );
      if (fenceStatus !== "legacy") {
        expect(readAdmissionStop).toHaveBeenCalledWith(sentRequest);
      }
      if (fenceStatus === "not_found") {
        expect(readFinalOutcome).not.toHaveBeenCalled();
      } else {
        expect(cancelExecution.mock.invocationCallOrder[0]).toBeLessThan(
          readFinalOutcome.mock.invocationCallOrder[0] ?? 0
        );
      }
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: sentRequest.idempotencyKey,
        })
      ).resolves.toMatchObject({
        submissionId: null,
        acceptedAtMs: null,
        status: fenceStatus === "not_found" ? "submitted" : "failed",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "found",
    "not_found",
    "legacy",
    "running",
    "aborted",
    "wrong_identity",
    "ack_race",
  ] as const)("forwards a parent Stop while its continuation ACK is missing (%s)", async (state) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn((_request: RemoteAgentWorkerSubmitTurnRequest) =>
      Promise.reject(new Error("ACK response lost"))
    );
    const cancelExecution = vi.fn(async (input) => {
      if (state === "ack_race") {
        await markRemoteAgentNativeDeliveryAck({
          accepted: true,
          db: harness.db,
          idempotencyKey: input.idempotencyKey,
          nowMs: 1300,
          submissionId: input.submissionId,
        });
      }
      if (
        state !== "running" &&
        state !== "aborted" &&
        state !== "wrong_identity"
      ) {
        return Promise.resolve({ status: "not_found" as const });
      }
      const { conversationId: _conversationId, reason, ...identity } = input;
      const aborted = state !== "running";
      return Promise.resolve({
        status: aborted
          ? ("already_cancelled" as const)
          : ("cancellation_requested" as const),
        execution: {
          ...identity,
          organizationId:
            state === "wrong_identity"
              ? "different-org"
              : identity.organizationId,
          acceptedAtMs: 1200,
          cancellationReason: reason ?? null,
          completedAtMs: aborted ? 1300 : null,
          lastProgressAtMs: 1300,
          lastProgressKind: aborted
            ? ("aborted" as const)
            : ("cancellation_requested" as const),
          status: aborted
            ? ("aborted" as const)
            : ("cancellation_requested" as const),
        },
      });
    });
    const readAdmissionStop = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) =>
        state === "found" || state === "ack_race"
          ? {
              v: 1 as const,
              status: "found" as const,
              stopIntent: {
                v: 1 as const,
                organizationId: request.organizationId,
                spaceId: request.spaceId,
                idempotencyKey: request.idempotencyKey,
                requestedAtMs: 1250,
                reason: "Parent task was stopped.",
              },
            }
          : { v: 1 as const, status: "not_found" as const }
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: workerSubmit,
        cancelExecution,
        ...(state === "legacy" ? {} : { readAdmissionStop }),
      },
    });
    try {
      const delivery = await stageAmbiguousTaskContinuationAdmission({
        db: harness.db,
        env,
        idempotencyKey: `parent-stop:${state}`,
      });
      const request = workerSubmit.mock.calls[0]?.[0];
      if (!request) {
        throw new Error("Expected the original continuation request");
      }
      const stop = requestRemoteAgentNativeDeliveryStop({
        db: harness.db,
        delivery,
        env,
        nowMs: 1400,
      });
      if (state === "wrong_identity") {
        await expect(stop).rejects.toThrow(
          "remote_agent.parent_stop_execution_identity_mismatch"
        );
      } else {
        await expect(stop).resolves.toBe(
          state === "found" || state === "aborted"
            ? "stopped"
            : "stop_requested"
        );
      }
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: request.organizationId,
          spaceId: request.spaceId,
          idempotencyKey: request.idempotencyKey,
          submissionId: request.dispatchId,
        })
      );
      if (state === "found" || state === "not_found" || state === "ack_race") {
        expect(readAdmissionStop).toHaveBeenCalledWith(request);
      }
      let expectedStatus = "submitted";
      if (state === "found" || state === "aborted") {
        expectedStatus = "failed";
      } else if (state === "ack_race") {
        expectedStatus = "accepted";
      }
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: request.idempotencyKey,
        })
      ).resolves.toMatchObject({
        status: expectedStatus,
        submissionId: state === "ack_race" ? request.dispatchId : null,
        acceptedAtMs: state === "ack_race" ? 1300 : null,
        failureCode:
          state === "found" || state === "aborted"
            ? "runtime_coordinator.pre_agent_stop_requested"
            : null,
      });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("retries an ambiguous Space worker submit without recounting it after UTC midnight", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const firstNowMs = Date.parse("2026-07-12T23:59:59.000Z");
    let submitAttempt = 0;
    const submittedRequests: RemoteAgentWorkerSubmitTurnRequest[] = [];
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: vi.fn(
          (request: RemoteAgentWorkerSubmitTurnRequest) => {
            submittedRequests.push(request);
            submitAttempt += 1;
            if (submitAttempt === 1) {
              throw new Error("simulated RPC disconnect after admission");
            }
            return Promise.resolve({
              accepted: true,
              createdAt: firstNowMs + 2000,
              idempotencyKey: request.idempotencyKey,
              status: "pending" as const,
              submissionId: "sub_ambiguous_retry",
            });
          }
        ),
      },
      spaceGuide: "Use the durable admission request.",
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: firstNowMs,
        })
      ).resolves.toEqual({ shouldAck: false, status: "submitted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "submitted",
        submissionId: null,
        workerSubmitRequest: expect.objectContaining({
          idempotencyKey: "idem_1",
        }),
      });
      const contextReadCounts = {
        dispatchContinuity:
          env.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
            .mock.calls.length,
        meta: env.__spaceStub.rpcGetMeta.mock.calls.length,
        signals: env.__spaceStub.rpcListSignalsResult.mock.calls.length,
      };
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: firstNowMs + 2000,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(submittedRequests).toHaveLength(2);
      expect(submittedRequests[1]).toEqual(submittedRequests[0]);
      expect({
        dispatchContinuity:
          env.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
            .mock.calls.length,
        meta: env.__spaceStub.rpcGetMeta.mock.calls.length,
        signals: env.__spaceStub.rpcListSignalsResult.mock.calls.length,
      }).toEqual(contextReadCounts);
      expect(
        await harness.queryAll<{
          admitted_count: number;
          day_utc: string;
        }>({
          values: ["org_1"],
          text: `
            SELECT admitted_count, day_utc
            FROM "openmeld"."openMeldRemoteAgent_daily_admissions"
            WHERE organization_id = $1
          `,
        })
      ).toEqual([]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it.each([
    true,
    false,
  ])("keeps pre-admission Stop out of DLQ (withdrawal already visible=%s)", async (withdrawn) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await seedWaitingNativeDeliveryDispatch(harness);
    const workerSubmit = vi.fn();
    const probes = vi.fn(
      async (
        _probe: Parameters<
          typeof processRemoteAgentNativeDeliveryDeadlineProbe
        >[0]["probe"]
      ) => undefined
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: probes,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    env.__spaceStub.rpcReadWakeStopIntent.mockResolvedValue({
      status: "requested",
    });
    const finalOutcome = {
      outcome: withdrawn ? "stopped" : null,
      signalId: withdrawn ? "stopped-claim" : null,
    };
    Object.assign(env.__spaceStub, {
      rpcReadFinalReplyClaimOutcome: vi.fn(async () => finalOutcome),
    });
    const submit = () =>
      submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
    try {
      expect(await submit()).toEqual(
        withdrawn
          ? { shouldAck: true, status: "stopped" }
          : { shouldAck: false, status: "submitted" }
      );
      expect(
        await harness.queryFirst({
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."openMeldDaemon_dlq"',
        })
      ).toEqual({ count: 0 });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
      expect(
        await harness.queryFirst({
          text: 'SELECT COALESCE(SUM(admitted_count), 0)::bigint AS count FROM "openmeld"."openMeldRemoteAgent_daily_admissions"',
        })
      ).toEqual({ count: 0 });
      expect(
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).toMatchObject(
        withdrawn
          ? {
              status: "failed",
              failureCode: "runtime_coordinator.pre_agent_stop_requested",
              publishedSignalId: "stopped-claim",
            }
          : { status: "submitted", failureCode: null }
      );
      finalOutcome.outcome = "stopped";
      finalOutcome.signalId = "stopped-claim";
      if (!withdrawn) {
        const probe = probes.mock.calls[0]?.[0];
        if (!probe) {
          throw new Error("Missing durable Stop reconciliation probe");
        }
        expect(
          await processRemoteAgentNativeDeliveryDeadlineProbe({
            db: harness.db,
            env,
            nowMs: probe.deadlineAtMs,
            probe,
          })
        ).toMatchObject({
          status: "skipped",
          reasonCode: "remote_agent.execution_cancelled",
        });
      }
      expect(await submit()).toEqual({ shouldAck: true, status: "stopped" });
      expect(
        await harness.queryFirst({
          text: 'SELECT status FROM "openmeld"."openMeldDaemon_dispatch_ledger" WHERE idempotency_key = \'idem_1\'',
        })
      ).toEqual({ status: "cancelled" });
      expect(
        await harness.queryFirst({
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."openMeldDaemon_dlq"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it.each([
    [
      "remote_agent.conversation_history_limit_exceeded",
      REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
      2,
    ],
    [
      "remote_agent.image_transform_quota_exceeded",
      REMOTE_AGENT_IMAGE_TRANSFORM_QUOTA_EXCEEDED_PUBLIC_COPY,
      1,
    ],
  ] as const)("ends a structured Space admission rejection without retry: %s", async (reasonCode, publicCopy, expectedSubmissions) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: vi.fn(async () => ({
          idempotencyKey: "idem_1",
          message: "Worker diagnostic detail only.",
          outcome: "rejected" as const,
          reasonCode,
          v: 1 as const,
        })),
      },
      sourceSignals: [
        createSignalEnvelope(
          "signal_previous_1",
          "Continue our deployment investigation."
        ),
        createSignalEnvelope("signal_1"),
      ],
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: 1000,
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: reasonCode,
        failureDetail: "Worker diagnostic detail only.",
        status: "failed",
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reasonCode,
            text: publicCopy,
          }),
        })
      );
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          memoryService: null,
          message: createDispatchMessage(),
          nowMs: 2000,
        })
      ).resolves.toMatchObject({ shouldAck: true });
      expect(
        env.OPENMELD_REMOTE_AGENT_WORKER?.submitConversationTurn
      ).toHaveBeenCalledTimes(expectedSubmissions);
    } finally {
      await harness.close();
    }
  });
  it("rejects a Space admission when monthly credits are exhausted with a visible recovery message", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
    vi.mocked(readAiBilling).mockResolvedValueOnce({
      plan: "free",
      source: "free",
      policyVersion: "2026-10-v1",
      monthlyCredits: 5000,
      usedCredits: 5000,
      remainingCredits: 0,
      resetsAt: "2026-08-01T00:00:00.000Z",
      keySuffix: null,
      canManage: false,
      status: "exhausted",
    });
    const workerSubmit = vi.fn();
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_201",
          memoryService: null,
          message: createDispatchMessage({
            dispatchId: "dispatch_201",
            idempotencyKey: "idem_201",
            sourceClientMessageId: "client_201",
            taskId: "task_201",
          }),
          nowMs,
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "terminal_failure",
            reasonCode: "ai_usage.monthly_limit_reached",
            text: expect.stringContaining("monthly reset"),
          }),
          finalOutcomeAuthority: "remote_agent_native_delivery",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_201",
        })
      ).resolves.toMatchObject({
        failureCode: "ai_usage.monthly_limit_reached",
        status: "failed",
      });
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_201",
          memoryService: null,
          message: createDispatchMessage({
            dispatchId: "dispatch_201",
            idempotencyKey: "idem_201",
            sourceClientMessageId: "client_201",
            taskId: "task_201",
          }),
          nowMs: Date.parse("2026-07-13T12:00:00.000Z"),
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledOnce();
      expect(
        await harness.queryAll<{
          admitted_count: number;
          day_utc: string;
        }>({
          values: ["org_1"],
          text: `
            SELECT admitted_count, day_utc
            FROM "openmeld"."openMeldRemoteAgent_daily_admissions"
            WHERE organization_id = $1
            ORDER BY day_utc
          `,
        })
      ).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("enqueues an admission watchdog before submit and terminalizes a hung delivery idempotently", async () => {
    vi.useFakeTimers();
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const order: string[] = [];
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) => {
        order.push("probe");
        return Promise.resolve(message);
      }
    );
    const workerSubmit = vi.fn(() => {
      order.push("submit");
      return new Promise<never>(() => undefined);
    });
    const workerCancel = vi.fn(() =>
      Promise.reject(
        new Error("Remote Agent cancellation is temporarily unavailable")
      )
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: dispatchQueueSend,
      remoteAgentWorker: {
        cancelExecution: workerCancel,
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      const pendingAdmission = submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
      expect(pendingAdmission).toBeInstanceOf(Promise);
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      expect(order).toEqual(["probe", "submit"]);
      const probe = dispatchQueueSend.mock.calls[0]?.[0];
      expect(probe).toMatchObject({
        idempotencyKey: "idem_1",
        kind: "remote_agent_native_delivery_deadline_probe",
      });
      if (!probe) {
        throw new Error("Admission watchdog probe was not captured");
      }
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({ status: "expired" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.admission_timeout",
        status: "failed",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledOnce();
      const failureNotice =
        env.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0];
      expect(failureNotice?.text).toContain(
        "OpenMeld could not confirm whether"
      );
      expect(failureNotice?.text).toContain(
        "check its status before starting more work"
      );
      expect(failureNotice?.text).not.toContain("Please try again");
      expect(workerCancel).toHaveBeenCalledWith({
        conversationId: SPACE_ID,
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        reason: "Core stopped waiting for Remote Agent admission.",
        spaceId: SPACE_ID,
        submissionId: "dispatch_1",
        v: 1,
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toMatchObject({ status: "skipped" });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledOnce();
      expect(workerCancel).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
      vi.useRealTimers();
    }
  });
  it("fails an admission watchdog when its exact durable delivery is missing", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      const probe = createDeadlineProbe({
        idempotencyKey: "missing-admission",
        submissionId: "admission_watchdog:missing-admission",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: buildEnv(harness.db),
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).rejects.toThrow("remote_agent.admission_watchdog_delivery_missing");
    } finally {
      await harness.close();
    }
  });
  it("fails an admission watchdog when its durable delivery identity does not match", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        dispatchId: "different-dispatch",
        idempotencyKey: "mismatched-admission",
        submissionId: "submission-mismatched-admission",
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "mismatched-admission",
        submissionId: "admission_watchdog:mismatched-admission",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: buildEnv(harness.db),
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).rejects.toThrow("remote_agent.admission_watchdog_delivery_mismatch");
    } finally {
      await harness.close();
    }
  });
  it("submits a Think-shaped worker ACK and records an accepted delivery", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const timing = createSpaceBootstrapTimingCollector();
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_1",
      requestId: "req_1",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) =>
        Promise.resolve(message)
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: dispatchQueueSend,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: {
            ...createBinding(),
            controllerNormalization: {
              bindingUpdatedAtMs: 900,
              storedAgentControllerRef: "malformed::legacy-controller",
              storedAgentControllerRefStatus: "malformed",
            },
          },
          timing,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfileOwnerUserId: "user_1",
          idempotencyKey: "idem_1",
          messages: [{ role: "user", content: "Please help." }],
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
          organizationId: "org_1",
          v: 4,
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        acceptedProbeNextDueAtMs: 301_000,
        controllerNormalizationSnapshot: {
          bindingUpdatedAtMs: 900,
          storedAgentControllerRef: "malformed::legacy-controller",
          storedAgentControllerRefStatus: "malformed",
        },
        deadlineProbeEnqueuedAtMs: 1000,
        status: "accepted",
        submissionId: "sub_1",
        workerRequestId: "req_1",
      });
      expect(dispatchQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          v: 3,
          kind: "remote_agent_native_delivery_deadline_probe",
          submissionId: "admission_watchdog:idem_1",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          dispatchId: "dispatch_1",
          enqueuedAtMs: 1000,
          deadlineAtMs:
            1000 + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
        }),
        {
          delaySeconds: REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS,
        }
      );
      expect(dispatchQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          v: 3,
          kind: "remote_agent_native_delivery_deadline_probe",
          submissionId: "sub_1",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          dispatchId: "dispatch_1",
          enqueuedAtMs: 1000,
          deadlineAtMs: 301_000,
        }),
        { delaySeconds: 300 }
      );
      expect(dispatchQueueSend).toHaveBeenCalledTimes(2);
      expect(timing.metrics().map((metric) => metric.name)).toEqual(
        expect.arrayContaining([
          "openmeld_remote_admission_ledger_read",
          "openmeld_remote_admission_replay",
          "openmeld_remote_admission_ledger_upsert",
          "openmeld_remote_admission_designation",
          "openmeld_remote_admission_turn_envelope",
          "openmeld_remote_admission_context",
          "openmeld_remote_admission_memory",
          "openmeld_remote_admission_attachments",
          "openmeld_remote_admission_skill_selection",
          "openmeld_remote_admission_request_persist",
          "openmeld_remote_admission_watchdog",
          "openmeld_remote_admission_worker_rpc",
          "openmeld_remote_admission_finalize",
        ])
      );
      const admissionWatchdog = dispatchQueueSend.mock.calls[0]?.[0];
      if (!admissionWatchdog) {
        throw new Error("Admission watchdog probe was not captured");
      }
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: admissionWatchdog.deadlineAtMs,
          probe: admissionWatchdog,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.admission_watchdog_already_acknowledged",
        status: "skipped",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("backfills accepted deliveries created before their durable probe was restored", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(async () => undefined);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_missing_probe",
        submissionId: "sub_missing_probe",
        spaceId: SPACE_ID,
      });
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env: buildEnv(harness.db, { dispatchQueueSend }),
          nowMs: 2000,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(dispatchQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch_1",
          enqueuedAtMs: 2000,
          idempotencyKey: "idem_missing_probe",
          kind: "remote_agent_native_delivery_deadline_probe",
          submissionId: "sub_missing_probe",
        }),
        { delaySeconds: 300 }
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_missing_probe",
        })
      ).resolves.toMatchObject({ deadlineProbeEnqueuedAtMs: 2000 });
    } finally {
      await harness.close();
    }
  });
  it("re-enqueues an accepted delivery after an older deadline probe chain is lost", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(async () => undefined);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_stale_probe",
        submissionId: "sub_stale_probe",
        spaceId: SPACE_ID,
      });
      await markRemoteAgentNativeDeliveryDeadlineProbeEnqueued({
        db: harness.db,
        idempotencyKey: "idem_stale_probe",
        nowMs: 1000,
        submissionId: "sub_stale_probe",
      });
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env: buildEnv(harness.db, { dispatchQueueSend }),
          nowMs: 302_000,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(dispatchQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({ submissionId: "sub_stale_probe" }),
        { delaySeconds: 300 }
      );
    } finally {
      await harness.close();
    }
  });
  it("claims an expired accepted-delivery probe before concurrent recovery enqueues it", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    let releaseQueueSend: () => void = () => undefined;
    const queueSendGate = new Promise<void>((resolve) => {
      releaseQueueSend = resolve;
    });
    const dispatchQueueSend = vi.fn(async () => {
      await queueSendGate;
    });
    const env = buildEnv(harness.db, { dispatchQueueSend });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_concurrent_probe_recovery",
        submissionId: "sub_concurrent_probe_recovery",
        spaceId: SPACE_ID,
      });
      const firstRecovery = retryMissingRemoteAgentAcceptedDeliveryProbes({
        db: harness.db,
        env,
        nowMs: 302_000,
      });
      await vi.waitFor(() => expect(dispatchQueueSend).toHaveBeenCalledOnce());
      const secondRecovery = retryMissingRemoteAgentAcceptedDeliveryProbes({
        db: harness.db,
        env,
        nowMs: 302_000,
      });
      await Promise.resolve();
      await Promise.resolve();
      releaseQueueSend();
      const summaries = await Promise.all([firstRecovery, secondRecovery]);
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
      expect(summaries).toEqual(
        expect.arrayContaining([
          { enqueued: 1, errors: 0, scanned: 1 },
          { enqueued: 0, errors: 0, scanned: 0 },
        ])
      );
    } finally {
      await harness.close();
    }
  });
  it("keeps a claimed probe lease when its post-send marker write fails", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(async () => undefined);
    const env = buildEnv(harness.db, { dispatchQueueSend });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_post_send_marker_failure",
        submissionId: "sub_post_send_marker_failure",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_post_send_marker_failure",
        submissionId: "sub_post_send_marker_failure",
      });
      await installPostgresWriteFailure({
        harness,
        table: "openMeldRemoteAgent_native_delivery_ledger",
        operation: "UPDATE",
        columns: ["deadline_probe_enqueued_at_ms"],
        message: "accepted probe marker write failed",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_unavailable",
        status: "skipped",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_post_send_marker_failure",
        })
      ).resolves.toMatchObject({
        acceptedProbeNextDueAtMs: probe.deadlineAtMs + 300_000,
      });
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
        })
      ).resolves.toEqual({ enqueued: 0, errors: 0, scanned: 0 });
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("keeps an accepted Space delivery retryable until its durable probe is enqueued", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) =>
        message.submissionId === "sub_probe_retry"
          ? Promise.reject(new Error("queue unavailable"))
          : Promise.resolve()
    );
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env: buildEnv(harness.db, {
            deadlineProbeQueueSend: dispatchQueueSend,
            remoteAgentWorker: {
              submitConversationTurn: async () => ({
                accepted: true,
                createdAt: 1000,
                requestId: "req_probe_retry",
                status: "pending",
                submissionId: "sub_probe_retry",
              }),
            },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
        })
      ).resolves.toEqual({ shouldAck: false, status: "submitted" });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_probe_retry",
        })
      ).resolves.toMatchObject({
        acceptedProbeNextDueAtMs: null,
        deadlineProbeEnqueuedAtMs: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("persists a worker ACK before a pending watchdog so the running Center Agent can link continuations", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    let resolveWatchdog: (() => void) | undefined;
    const watchdog = new Promise<void>((resolve) => {
      resolveWatchdog = resolve;
    });
    const dispatchQueueSend = vi.fn(() => watchdog);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_parent_running",
      status: "pending" as const,
      submissionId: "sub_parent_running",
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const pendingAdmission = submitRemoteAgentNativeDelivery({
      binding: createBinding(),
      db: harness.db,
      env,
      executionAttemptId: "attempt_parent_running",
      message: createDispatchMessage({
        dispatchId: "dispatch_parent_running",
        idempotencyKey: "idem_parent_running",
        taskId: "task_parent_running",
      }),
      nowMs: 1000,
    });
    try {
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      await vi.waitFor(async () => {
        await expect(
          readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: "idem_parent_running",
          })
        ).resolves.toMatchObject({
          status: "accepted",
          submissionId: "sub_parent_running",
        });
      });
      await expect(
        requireCenterAgentContinuationParent({
          actorProfileId: AGENT_PROFILE_ID,
          destinationNeutralContinuations: true,
          db: harness.db,
          organizationId: "org_1",
          parentSubmissionId: "sub_parent_running",
          resumesParent: false,
        })
      ).resolves.toMatchObject({
        deliveryId: expect.any(String),
        status: "accepted",
        submissionId: "sub_parent_running",
      });
    } finally {
      resolveWatchdog?.();
      await pendingAdmission;
      await harness.close();
    }
  });
  it("forwards Center Agent DM attachment references from the triggering signal", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_dm_image",
      requestId: "req_dm_image",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const attachments = [
      {
        id: "attachment-1",
        mimeType: "image/png" as const,
        sizeBytes: 1024,
        width: 800,
        height: 600,
        fileName: "release-plan.png",
      },
    ];
    try {
      await submitRemoteAgentNativeDelivery({
        db: harness.db,
        env: buildEnv(harness.db, {
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
          sourceSignal: {
            ...createSignalEnvelope("signal_1"),
            data: { text: "Please inspect this.", attachments },
          } as SignalEnvelope,
        }),
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "Please inspect this.",
          },
        }),
        nowMs: 1000,
        binding: createBinding(),
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content: "Please inspect this.",
              attachments,
            },
          ],
          turnEnvelope: expect.objectContaining({
            trigger: { source: "web_dm" },
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("does not read or attach a Space guide for a Center Agent DM turn", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1001,
        idempotencyKey: request.idempotencyKey,
        status: "pending" as const,
        submissionId: "submission_1",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      spaceGuide: "This must not enter a Center Agent DM turn.",
    });
    try {
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
      expect(env.__spaceStub.rpcGetMeta).not.toHaveBeenCalled();
      expect(
        workerSubmit.mock.calls[0]?.[0].turnEnvelope.space
      ).not.toHaveProperty("guide");
    } finally {
      await harness.close();
    }
  });
  it("reads the current Space guide for every shared Space turn", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const timing = createSpaceBootstrapTimingCollector();
    await harness.query({
      values: [SPACE_ID],
      text: `
        UPDATE "openmeld"."space_index_spaces"
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = $1
      `,
    });
    let spaceGuide = "Prefer reversible decisions.";
    const workerSubmit = vi.fn(async (request: { idempotencyKey: string }) => ({
      accepted: true,
      createdAt: 1001,
      idempotencyKey: request.idempotencyKey,
      status: "pending" as const,
      submissionId: `submission_${request.idempotencyKey}`,
    }));
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      spaceGuide: () => spaceGuide,
    });
    try {
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
        timing,
      });
      spaceGuide = "Escalate security blockers.";
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_2",
        memoryService: null,
        message: createDispatchMessage({
          dispatchId: "dispatch_2",
          idempotencyKey: "idem_2",
          sourceClientMessageId: "client_2",
          sourceEventId: "signal_2",
          taskId: "task_2",
        }),
        nowMs: 2000,
        timing,
      });
      expect(env.__spaceStub.rpcGetMeta).toHaveBeenCalledTimes(2);
      expect(
        timing
          .metrics()
          .filter(
            (metric) => metric.name === "openmeld_remote_admission_space_guide"
          )
      ).toHaveLength(2);
      expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
        turnEnvelope: {
          space: { guide: "Prefer reversible decisions." },
        },
      });
      expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
        turnEnvelope: {
          space: { guide: "Escalate security blockers." },
        },
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    false,
    true,
  ])("forwards shared Space Wake images, including preceding context for a bare mention (%s)", async (bareMention) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      values: [SPACE_ID],
      text: `
        UPDATE "openmeld"."space_index_spaces"
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = $1
      `,
    });
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_space_image",
      requestId: "req_space_image",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const attachments = [
      {
        id: "attachment-2",
        mimeType: "image/jpeg" as const,
        sizeBytes: 2048,
        fileName: "whiteboard.jpg",
      },
    ];
    const text = bareMention ? "@Codex" : "What is on this whiteboard?";
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    env.__spaceStub.rpcListSignalsResult.mockImplementation(
      async ({ aroundSignalId }: { aroundSignalId: string }) => ({
        ok: true,
        value: {
          signals: [
            {
              ...createSignalEnvelope(aroundSignalId),
              data: {
                text:
                  aroundSignalId === "previous"
                    ? "What is on this whiteboard?"
                    : text,
                attachments:
                  !bareMention || aroundSignalId === "previous"
                    ? attachments
                    : [],
              },
            },
          ],
        },
      })
    );
    try {
      await submitRemoteAgentNativeDelivery({
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text,
            ...(bareMention
              ? {
                  contextMessages: [
                    {
                      signalId: "previous",
                      author: "Felix",
                      text: "What is on this whiteboard?",
                      attachments,
                    },
                  ],
                }
              : {}),
          },
        }),
        nowMs: 1000,
        binding: createBinding(),
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content: bareMention
                ? expect.stringContaining("What is on this whiteboard?")
                : text,
              attachments,
            },
          ],
          turnEnvelope: expect.objectContaining({
            trigger: { source: "space_wake" },
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("freezes and retries canonical Space File image bytes without display geometry or a second attachment", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    let submissionAttempts = 0;
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => {
        const frozen = await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: request.idempotencyKey,
        });
        expect(frozen?.workerSubmitRequest).toEqual(request);
        expect(frozen?.executionRecoverySubmitRequest).toEqual(request);
        expect(JSON.stringify(request)).not.toContain("imageDimensions");
        submissionAttempts += 1;
        if (submissionAttempts === 1) {
          throw new Error("simulated RPC disconnect after admission");
        }
        return {
          accepted: true,
          createdAt: 1001,
          requestId: "req_space_file_image",
          status: "pending" as const,
          submissionId: "sub_space_file_image",
        };
      }
    );
    const file = {
      fileId: "space-file-whiteboard",
      imageDimensions: { width: 300, height: 900 },
      mimeType: "image/png",
      name: "whiteboard.png",
      revision: 2,
      sizeBytes: 4096,
    } as const;
    const actor = {
      displayName: "Ari",
      ownerUserId: "user_1",
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human" as const,
    };
    const spaceFileContent = {
      file: {
        createdAt: "2026-08-23T00:00:00.000Z",
        createdBy: actor,
        id: file.fileId,
        kind: "file" as const,
        latestRevision: {
          imageDimensions: file.imageDimensions,
          createdAt: "2026-08-23T00:00:00.000Z",
          createdBy: actor,
          fileId: file.fileId,
          id: "revision-whiteboard-2",
          mimeType: file.mimeType,
          revision: file.revision,
          sizeBytes: file.sizeBytes,
        },
        name: file.name,
        parentId: null,
        path: `/${file.name}`,
        spaceId: SPACE_ID,
        updatedAt: "2026-08-23T00:00:00.000Z",
        updatedBy: actor,
      },
      objectKey:
        "org/org_1/space/space-file/files/space-file-whiteboard/revisions/revision-whiteboard-2",
      organizationId: "org_1",
      revision: {
        imageDimensions: file.imageDimensions,
        createdAt: "2026-08-23T00:00:00.000Z",
        createdBy: actor,
        fileId: file.fileId,
        id: "revision-whiteboard-2",
        mimeType: file.mimeType,
        revision: file.revision,
        sizeBytes: file.sizeBytes,
      },
    };
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      sourceSignal: {
        ...createSignalEnvelope("signal_1"),
        data: {
          files: [file],
          text: "What changed on this whiteboard?",
        },
      } as SignalEnvelope,
      spaceFileContent,
    });
    try {
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            files: [file],
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "What changed on this whiteboard?",
          },
        }),
        nowMs: 1000,
      });
      expect(env.__spaceStub.rpcResolveSpaceFileContent).toHaveBeenCalledWith({
        content: {
          fileId: file.fileId,
          revision: file.revision,
          spaceId: SPACE_ID,
        },
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({
            kind: "dispatch_continuation",
          }),
        }),
      });
      const persisted = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: "idem_1",
      });
      expect(persisted?.workerSubmitRequest).toEqual(
        workerSubmit.mock.calls[0]?.[0]
      );
      expect(persisted?.executionRecoverySubmitRequest).toEqual(
        workerSubmit.mock.calls[0]?.[0]
      );
      expect(
        JSON.stringify(persisted?.executionRecoverySubmitRequest)
      ).not.toContain("imageDimensions");
      expect(spaceFileContent.file.latestRevision.imageDimensions).toEqual({
        width: 300,
        height: 900,
      });
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            files: [file],
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "What changed on this whiteboard?",
          },
        }),
        nowMs: 1002,
      });
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(workerSubmit.mock.calls[1]?.[0]).toEqual(
        workerSubmit.mock.calls[0]?.[0]
      );
      expect(
        (
          await readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: "idem_1",
          })
        )?.executionRecoverySubmitRequest
      ).toEqual(persisted?.executionRecoverySubmitRequest);
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              attachments: [
                {
                  fileName: file.name,
                  id: file.fileId,
                  mimeType: file.mimeType,
                  objectKey: spaceFileContent.objectKey,
                  sizeBytes: file.sizeBytes,
                },
              ],
              content: expect.stringContaining(
                `fileId=${file.fileId}, revision=${file.revision}`
              ),
              role: "user",
            }),
          ],
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("fails the turn visibly when a canonical Space File image cannot be resolved", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn();
    const file = {
      fileId: "space-file-missing-image",
      mimeType: "image/png",
      name: "missing-image.png",
      revision: 1,
      sizeBytes: 4096,
    } as const;
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      sourceSignal: {
        ...createSignalEnvelope("signal_1"),
        data: {
          files: [file],
          text: "Read this screenshot.",
        },
      } as SignalEnvelope,
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          message: createDispatchMessage({
            sourceSignalSnapshot: {
              files: [file],
              profileId: HUMAN_PROFILE_ID,
              profileKind: "human",
              text: "Read this screenshot.",
            },
          }),
          nowMs: 1000,
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "terminal_failure",
            reasonCode: "remote_agent.turn_envelope_unavailable",
            text: expect.stringContaining(
              "conversation context was unavailable"
            ),
          }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_envelope_unavailable",
        failureDetail: expect.stringContaining("space_file.not_found"),
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("forwards ten canonical Space File images without applying the legacy four-image limit", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_ten_space_file_images",
      status: "pending" as const,
      submissionId: "sub_ten_space_file_images",
    }));
    const files = Array.from({ length: 10 }, (_, index) => ({
      fileId: `space-file-screen-${index + 1}`,
      mimeType: "image/png" as const,
      name: `screen-${index + 1}.png`,
      revision: 1,
      sizeBytes: 10 * 1024 * 1024,
    }));
    const actor = {
      displayName: "Ari",
      ownerUserId: "user_1",
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human" as const,
    };
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      sourceSignal: {
        ...createSignalEnvelope("signal_1"),
        data: {
          files,
          text: "Compare every screenshot and report the exact differences.",
        },
      } as SignalEnvelope,
      spaceFileContent: {},
    });
    env.__spaceStub.rpcResolveSpaceFileContent.mockImplementation(
      (input: {
        content: {
          fileId: string;
          revision: number;
        };
      }) => {
        const file = files.find(
          (candidate) => candidate.fileId === input.content.fileId
        );
        if (!file) {
          throw new Error("space_file.not_found");
        }
        return Promise.resolve({
          file: {
            createdAt: "2026-08-23T00:00:00.000Z",
            createdBy: actor,
            id: file.fileId,
            kind: "file" as const,
            latestRevision: {
              createdAt: "2026-08-23T00:00:00.000Z",
              createdBy: actor,
              fileId: file.fileId,
              id: `revision-${file.fileId}-1`,
              mimeType: file.mimeType,
              revision: file.revision,
              sizeBytes: file.sizeBytes,
            },
            name: file.name,
            parentId: null,
            path: `/${file.name}`,
            spaceId: SPACE_ID,
            updatedAt: "2026-08-23T00:00:00.000Z",
            updatedBy: actor,
          },
          objectKey: `org/org_1/space/${SPACE_ID}/files/${file.fileId}/revisions/revision-1`,
          organizationId: "org_1",
          revision: {
            createdAt: "2026-08-23T00:00:00.000Z",
            createdBy: actor,
            fileId: file.fileId,
            id: `revision-${file.fileId}-1`,
            mimeType: file.mimeType,
            revision: file.revision,
            sizeBytes: file.sizeBytes,
          },
        });
      }
    );
    try {
      await submitRemoteAgentNativeDelivery({
        binding: createBinding(),
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            files,
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "Compare every screenshot and report the exact differences.",
          },
        }),
        nowMs: 1000,
      });
      expect(env.__spaceStub.rpcResolveSpaceFileContent).toHaveBeenCalledTimes(
        10
      );
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              attachments: files.map((file) => ({
                fileName: file.name,
                id: file.fileId,
                mimeType: file.mimeType,
                objectKey: `org/org_1/space/${SPACE_ID}/files/${file.fileId}/revisions/revision-1`,
                sizeBytes: file.sizeBytes,
              })),
              role: "user",
            }),
          ],
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("reports an older Space RPC receiver while preserving the text-only turn", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_rpc_skew",
      requestId: "req_rpc_skew",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await submitRemoteAgentNativeDelivery({
        db: harness.db,
        env: buildEnv(harness.db, {
          listSignalsError: new Error(
            "The RPC receiver does not implement the method rpcListSignalsResult"
          ),
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        executionAttemptId: "attempt_1",
        message: createDispatchMessage(),
        nowMs: 1000,
        binding: createBinding(),
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Please help." }],
        })
      );
      expect(warning).toHaveBeenCalledWith(
        "[core.remote_agent.native_delivery.attachments_degraded]",
        expect.objectContaining({
          event: "remote_agent_attachment_references_degraded",
          reason: "source_signal_rpc_unavailable",
        })
      );
    } finally {
      warning.mockRestore();
      await harness.close();
    }
  });
  it("injects recalled Center Agent memory into native delivery turn envelopes", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_1",
      requestId: "req_1",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const recalledMemory: Awaited<
      ReturnType<CenterAgentMemoryService["recallForTurn"]>
    > = {
      items: [
        {
          source: "ca_dm",
          subject: "member",
          text: "The launch team deploys on Thursday.",
        },
      ],
      truncated: false,
    };
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(async () => recalledMemory),
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: createBinding(),
          memoryService,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(memoryService.recallForTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          query: "Please help.",
          speakerMember: { memberId: "member_1", userId: "user_1" },
        })
      );
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            memory: {
              items: [
                {
                  source: "ca_dm",
                  subject: "member",
                  text: "The launch team deploys on Thursday.",
                },
              ],
              truncated: false,
            },
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("reads Space attachments while slow Center Agent memory is still recalling", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      values: [SPACE_ID],
      text: `
        UPDATE "openmeld"."space_index_spaces"
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = $1
      `,
    });
    let resolveMemory!: (
      value: Awaited<ReturnType<CenterAgentMemoryService["recallForTurn"]>>
    ) => void;
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(
        () =>
          new Promise<
            Awaited<ReturnType<CenterAgentMemoryService["recallForTurn"]>>
          >((resolve) => {
            resolveMemory = resolve;
          })
      ),
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_slow_memory",
      status: "pending" as const,
      submissionId: "sub_slow_memory",
    }));
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
      spaceGuide: "Keep replies concise.",
    });
    const submission = submitRemoteAgentNativeDelivery({
      binding: createBinding(),
      db: harness.db,
      env,
      executionAttemptId: "attempt_slow_memory",
      memoryService,
      message: createDispatchMessage(),
      nowMs: 1000,
    });
    try {
      await vi.waitFor(() =>
        expect(memoryService.recallForTurn).toHaveBeenCalledOnce()
      );
      expect(env.__spaceStub.rpcGetMeta).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcListSignalsResult).toHaveBeenCalledOnce();
    } finally {
      resolveMemory({ items: [], truncated: false });
      await submission;
      await harness.close();
    }
    expect(workerSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        turnEnvelope: expect.objectContaining({
          space: expect.objectContaining({ guide: "Keep replies concise." }),
        }),
      })
    );
  });
  it("keeps the complete turn envelope when Center Agent memory recall times out", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      values: [SPACE_ID],
      text: `
        UPDATE "openmeld"."space_index_spaces"
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = $1
      `,
    });
    const memoryService = createCenterAgentMemoryService({
      adapter: {
        ...createMemoryAdapter({ searchText: "unused" }),
        search: vi.fn(
          () =>
            new Promise<
              Awaited<ReturnType<CenterAgentMemoryAdapter["search"]>>
            >(() => undefined)
        ),
      },
      logger: { warn: vi.fn() },
      nowMs: () => 1000,
      recallTimeoutMs: 1,
      repository: createMemoryRepository({ organizationMemoryOptIn: false }),
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_timed_out_memory",
      status: "pending" as const,
      submissionId: "sub_timed_out_memory",
    }));
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
            spaceGuide: "Keep replies concise.",
          }),
          executionAttemptId: "attempt_timed_out_memory",
          memoryService,
          message: createDispatchMessage(),
          nowMs: 1000,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            centerAgent: expect.objectContaining({
              profileHandle: "center-agent",
            }),
            sender: expect.objectContaining({
              id: "member_1",
              verified: true,
            }),
            space: expect.objectContaining({
              guide: "Keep replies concise.",
            }),
          }),
        })
      );
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            memory: { items: [], truncated: false, status: "unavailable" },
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("injects recalled Center Agent memory into Slack turn envelopes", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const recalledMemory: Awaited<
      ReturnType<CenterAgentMemoryService["recallForTurn"]>
    > = {
      items: [
        {
          source: "slack_conversation",
          subject: "organization",
          text: "Launch reviews happen on Fridays.",
        },
      ],
      truncated: false,
    };
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(async () => recalledMemory),
    });
    try {
      const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
        env: buildEnv(harness.db),
        memoryService,
        organizationId: "org_1",
        query: "What is the launch review day?",
        turnEnvelope: createSlackTurnEnvelope(),
      });
      expect(memoryService.recallForTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          query: "What is the launch review day?",
          speakerMember: { memberId: "member_1", userId: "user_1" },
        })
      );
      expect(turnEnvelope.memory).toEqual(recalledMemory);
    } finally {
      await harness.close();
    }
  });
  it("expands Slack memory recall with recent channel context", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const recalledMemory: Awaited<
      ReturnType<CenterAgentMemoryService["recallForTurn"]>
    > = {
      items: [
        {
          source: "ca_dm",
          subject: "member",
          text: "The Reply daily digest runs every weekday at 09:30 Asia/Taipei.",
        },
      ],
      truncated: false,
    };
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(async () => recalledMemory),
    });
    try {
      const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
        env: buildEnv(harness.db),
        memoryService,
        organizationId: "org_1",
        query: "Open the loop you proposed.",
        turnEnvelope: {
          ...createSlackTurnEnvelope(),
          channelContext: {
            provider: "slack",
            conversationId: "slack:T123:C123:1700000000.000001",
            currentMessageId: "1710000020.000500",
            sync: { mode: "snapshot", status: "complete" },
            messages: [
              {
                id: "1710000015.000400",
                author: {
                  kind: "bot",
                  id: "B_CENTER_AGENT",
                  displayName: "OpenMeld Center Agent",
                },
                sentAtMs: 1_710_000_015_000,
                text: "Proposed loop: every weekday at 09:30 Asia/Taipei, post Linear feedback, open PRs, and two next actions to #ok8-okok.",
              },
            ],
          },
        },
      });
      expect(memoryService.recallForTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          query: expect.stringContaining(
            "Proposed loop: every weekday at 09:30 Asia/Taipei"
          ),
          speakerMember: { memberId: "member_1", userId: "user_1" },
        })
      );
      expect(memoryService.recallForTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("Open the loop you proposed."),
        })
      );
      expect(turnEnvelope.memory).toEqual(recalledMemory);
    } finally {
      await harness.close();
    }
  });
  it("keeps Slack memory recall queries within the provider search limit", async () => {
    const memoryService = createTestMemoryService();
    const currentQuery = `Find the private project detail related to ${"q".repeat(320)}`;
    await attachCenterAgentMemoryToTurnEnvelope({
      env: {} as CoreBindings,
      memoryService,
      organizationId: "org_1",
      query: currentQuery,
      turnEnvelope: {
        ...createSlackTurnEnvelope(),
        channelContext: {
          provider: "slack",
          conversationId: "slack:T123:C123:1700000000.000001",
          currentMessageId: "1710000020.000500",
          sync: { mode: "snapshot", status: "complete" },
          messages: [
            {
              id: "1710000015.000400",
              author: {
                kind: "bot",
                id: "B_CENTER_AGENT",
                displayName: "OpenMeld Center Agent",
              },
              sentAtMs: 1_710_000_015_000,
              text: `Earlier channel context ${"c".repeat(1200)}`,
            },
          ],
        },
      },
    });
    const recallQuery = vi.mocked(memoryService.recallForTurn).mock
      .calls[0]?.[0].query;
    expect(recallQuery).toContain(currentQuery);
    expect(recallQuery?.length).toBeLessThanOrEqual(
      CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS
    );
  });
  it("limits memory recall even when a turn has no channel context", async () => {
    const memoryService = createTestMemoryService();
    await attachCenterAgentMemoryToTurnEnvelope({
      env: {} as CoreBindings,
      memoryService,
      organizationId: "org_1",
      query: "q".repeat(500),
      turnEnvelope: createSlackTurnEnvelope(),
    });
    const recallQuery = vi.mocked(memoryService.recallForTurn).mock
      .calls[0]?.[0].query;
    expect(recallQuery?.length).toBeLessThanOrEqual(
      CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS
    );
  });
  it("keeps the Message Channel provider on recalled memory", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const recalledMemory: Awaited<
      ReturnType<CenterAgentMemoryService["recallForTurn"]>
    > = {
      items: [
        {
          provider: "lark",
          source: "message_channel_conversation",
          subject: "organization",
          text: "Launch reviews happen on Fridays.",
        },
      ],
      truncated: false,
    };
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(async () => recalledMemory),
    });
    try {
      const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
        env: buildEnv(harness.db),
        memoryService,
        organizationId: "org_1",
        query: "What is the launch review day?",
        turnEnvelope: createMessageChannelTurnEnvelope(),
      });
      expect(memoryService.recallForTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
        })
      );
      expect(turnEnvelope.memory).toEqual(recalledMemory);
    } finally {
      await harness.close();
    }
  });
  it("recalls only Organization memory for a connected internal channel member", async () => {
    const recallForOrganization = vi.fn(async () => ({
      items: [
        {
          source: "message_channel_conversation" as const,
          provider: "lark" as const,
          subject: "organization" as const,
          text: "Launch reviews happen on Fridays.",
        },
      ],
      truncated: false,
    }));
    const memoryService = createTestMemoryService({ recallForOrganization });
    const verifiedEnvelope = createMessageChannelTurnEnvelope();
    const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
      env: {} as CoreBindings,
      memoryService,
      organizationId: "org_1",
      query: "When is launch review?",
      turnEnvelope: {
        ...verifiedEnvelope,
        memory: {
          items: [
            {
              source: "ca_dm",
              subject: "member",
              text: "This stale memory must not cross into an external turn.",
            },
          ],
          truncated: false,
        },
        sender: {
          displayName: "Ari",
          id: "lark:connection_1:provider_user_1",
          kind: "member",
          messageChannelIdentity: {
            connectionId: "connection_1",
            provider: "lark",
            providerUserId: "provider_user_1",
          },
          verified: false,
        },
      },
    });
    expect(memoryService.recallForTurn).not.toHaveBeenCalled();
    expect(recallForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        query: "When is launch review?",
      })
    );
    expect(turnEnvelope.memory?.items).toEqual([
      expect.objectContaining({
        subject: "organization",
        text: "Launch reviews happen on Fridays.",
      }),
    ]);
  });
  it("does not recall private or Organization memory for an external channel participant", async () => {
    const memoryService = createTestMemoryService();
    const verifiedEnvelope = createSlackTurnEnvelope();
    const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
      env: {} as CoreBindings,
      memoryService,
      organizationId: "org_1",
      query: "Tell me what this company is planning.",
      turnEnvelope: {
        ...verifiedEnvelope,
        sender: {
          displayName: "External guest",
          id: "slack:T123:U_EXTERNAL",
          kind: "member",
          verified: false,
        },
      },
    });
    expect(memoryService.recallForTurn).not.toHaveBeenCalled();
    expect(memoryService.recallForOrganization).not.toHaveBeenCalled();
    expect(turnEnvelope.memory).toBeUndefined();
  });
  it("submits worker-valid turn envelopes when a recalled memory item exceeds the item limit", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const oversizedMemoryText = "x".repeat(
      REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS + 200
    );
    const workerSubmit = vi.fn((input) => {
      const parsed = remoteAgentWorkerSubmitTurnRequestSchema.parse(input);
      expect(parsed.turnEnvelope.memory?.truncated).toBe(true);
      expect(parsed.turnEnvelope.memory?.items).toEqual([]);
      return Promise.resolve({
        submissionId: "sub_oversized_memory",
        requestId: "req_oversized_memory",
        status: "pending" as const,
        createdAt: 1001,
        accepted: true,
      });
    });
    const memoryService = createCenterAgentMemoryService({
      adapter: createMemoryAdapter({ searchText: oversizedMemoryText }),
      nowMs: () => 1000,
      repository: createMemoryRepository({ organizationMemoryOptIn: false }),
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: createBinding(),
          memoryService,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("submits native delivery with an unavailable status when recall fails", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_1",
      requestId: "req_1",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const memoryService = createTestMemoryService({
      recallForTurn: vi.fn(() => Promise.reject(new Error("Zep unavailable"))),
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: createBinding(),
          memoryService,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            memory: { items: [], truncated: false, status: "unavailable" },
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("records a Think idempotent retry ACK without treating accepted false as failure", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: {
              submitConversationTurn: async () => ({
                submissionId: "sub_retry",
                requestId: "req_retry",
                status: "running",
                createdAt: 1001,
                accepted: false,
              }),
            },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: createBinding(),
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        status: "retry_observed",
        submissionId: "sub_retry",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not overwrite an accepted delivery when the same idempotency key is retried and the worker is unavailable", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        sourceClientMessageId: "client_1",
        submissionId: "sub_1",
        spaceId: SPACE_ID,
        triggerText: "Please help.",
      });
      const workerSubmit = vi.fn(() =>
        Promise.reject(new Error("worker down"))
      );
      const dispatchQueueSend = vi.fn(async () => undefined);
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            dispatchQueueSend,
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1200,
          binding: createBinding(),
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(dispatchQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: "sub_1",
        }),
        expect.objectContaining({ delaySeconds: 300 })
      );
      const repairedDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        });
      expect(repairedDelivery).toMatchObject({
        deadlineProbeEnqueuedAtMs: 1200,
        status: "accepted",
        submissionId: "sub_1",
      });
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env: buildEnv(harness.db, {
            dispatchQueueSend,
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage({
            spaceId: `${SPACE_ID}-conflict`,
          }),
          nowMs: 1300,
        })
      ).rejects.toThrow("immutable admission identity conflict: spaceId");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toEqual(repairedDelivery);
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "accepted",
        failureCode: null,
        submissionId: "sub_1",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, { finalReplyClaimSignalId: "signal_reply_1" }),
          {
            submissionId: "sub_1",
            idempotencyKey: "idem_1",
            organizationId: "org_1",
            spaceId: SPACE_ID,
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            text: "Done.",
          }
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_reply_1",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "completed",
        publishedSignalId: "signal_reply_1",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects native delivery when the hosted profile is no longer the designated Center Agent", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await deleteCenterAgentDesignation(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_unused",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    try {
      const env = buildEnv(harness.db, {
        remoteAgentWorker: { submitConversationTurn: workerSubmit },
      });
      await expect(
        submitRemoteAgentNativeDelivery({
          db: harness.db,
          env,
          executionAttemptId: "attempt_1",
          message: createDispatchMessage(),
          nowMs: 1000,
          binding: createBinding(),
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      expect(workerSubmit).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.center_agent_not_designated",
        status: "failed",
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorName: "Codex",
            actorProfileId: AGENT_PROFILE_ID,
            failureStage: "execution",
            noticeType: "terminal_failure",
            reasonCode: "remote_agent.center_agent_not_designated",
            text: "Center Agent is unavailable for this Organization.",
          }),
          finalOutcomeAuthority: "remote_agent_native_delivery",
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("publishes callback replies with Remote Agent native delivery authority", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await seedWaitingNativeDeliveryDispatch(harness, {
        idempotencyKey: "space_1:dispatch_1",
      });
      await harness.query({
        values: [
          "attachment-1",
          "org_1",
          SPACE_ID,
          "user_1",
          "image/png",
          1024,
          1440,
          900,
          "browser-screenshot.png",
          1000,
        ],
        text: `
          INSERT INTO "openmeld"."space_attachments" (
            id,
            organization_id,
            space_id,
            uploader_user_id,
            mime_type,
            size_bytes,
            width,
            height,
            file_name,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
      });
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal_reply_1",
        webAppUrl: "https://openmeld.ai",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_1",
          idempotencyKey: "space_1:dispatch_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          navigationTarget: {
            kind: "project",
            projectId: "project_123",
          },
          text: "Done.",
          attachments: [
            {
              id: "attachment-1",
              mimeType: "image/png",
              sizeBytes: 1024,
              width: 1440,
              height: 900,
              fileName: "browser-screenshot.png",
            },
          ],
          mentionTargets: ["11111111-1111-4111-8111-111111111111"],
          files: [
            {
              fileId: "space-file-1",
              mimeType: "image/png",
              name: "canonical-screenshot.png",
              revision: 1,
              sizeBytes: 2048,
            },
          ],
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_reply_1",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentStreamId: "stream:sub_1",
          attachments: [
            {
              id: "attachment-1",
              mimeType: "image/png",
              sizeBytes: 1024,
              width: 1440,
              height: 900,
              fileName: "browser-screenshot.png",
            },
          ],
          files: [
            {
              fileId: "space-file-1",
              mimeType: "image/png",
              name: "canonical-screenshot.png",
              revision: 1,
              sizeBytes: 2048,
            },
          ],
          finalOutcomeAuthority: "remote_agent_native_delivery",
          messageEnvelope: expect.objectContaining({
            mentionTargets: ["11111111-1111-4111-8111-111111111111"],
            navigationAction: {
              label: "Open this Project",
              target: {
                kind: "project",
                projectId: "project_123",
              },
              url: "https://openmeld.ai/o/openmeld-labs/projects/project_123",
            },
          }),
          meta: expect.objectContaining({
            clientMessageId: "sub_1",
            purpose: "agent_reply_final",
          }),
        })
      );
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_1",
        terminal: {
          kind: "final_message",
          publishedSignalId: "signal_reply_1",
        },
      });
      await expect(
        readDispatchProjection(harness.db, "space_1:dispatch_1")
      ).resolves.toEqual({
        attemptErrorCode: null,
        attemptErrorMessage: null,
        attemptStatus: "succeeded",
        dispatchStatus: "succeeded",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps the first terminal timestamp when a completed Space callback replays", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await seedWaitingNativeDeliveryDispatch(harness, {
        idempotencyKey: "space_1:dispatch_1",
      });
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_terminal_replay",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal_terminal_replay",
      });
      const callback = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: "sub_terminal_replay",
        text: "Done.",
        triggerMessageId: "signal_1",
      };
      await expect(
        completeRemoteAgentNativeDelivery(env, callback, {
          messageChannelNowMs: () => 2000,
        })
      ).resolves.toEqual({
        publishedSignalId: "signal_terminal_replay",
        status: "accepted",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, callback, {
          messageChannelNowMs: () => 5000,
        })
      ).resolves.toEqual({
        publishedSignalId: "signal_terminal_replay",
        reasonCode: "remote_agent.callback_completed_submission",
        status: "duplicate_rejected",
      });
      await expect(
        listRecentDispatchLedgerEntriesForSpace({
          db: harness.db,
          dispatchId: "dispatch_1",
          limit: 1,
          spaceId: SPACE_ID,
        })
      ).resolves.toMatchObject([
        {
          lastAttemptAtMs: 5000,
          latestAttempt: {
            finishedAtMs: 2000,
            status: "succeeded",
          },
          status: "succeeded",
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("retains the exact Slack callback result when final publication becomes outcome-unknown", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const conversationId = "slack:T123:C123:1700000000.000001";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await createAcceptedDelivery({
        conversationKind: "slack",
        db: harness.db,
        dispatchId: "dispatch_slack_result_unknown",
        idempotencyKey: "idempotency_slack_result_unknown",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: conversationId,
        submissionId: "submission_slack_result_unknown",
        triggerMessageId: "slack-trigger-1",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, { slackBotToken: "xoxb-test" }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: "dispatch_slack_result_unknown",
            idempotencyKey: "idempotency_slack_result_unknown",
            organizationId: "org_1",
            spaceId: conversationId,
            submissionId: "submission_slack_result_unknown",
            text: "The exact retained result.",
            triggerMessageId: "slack-trigger-1",
          }
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      const retained = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission_slack_result_unknown",
      });
      expect(retained).toMatchObject({
        finalPublicationPayload: {
          attachments: [],
          failureCode: null,
          failureDetail: null,
          files: [],
          resumeStatus: "accepted",
          storageVersion: 3,
          text: "The exact retained result.",
        },
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });
      if (!retained) {
        throw new Error("expected retained Slack result");
      }
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      ).toMatchObject({
        metadata: {
          event_payload: {
            delivery_id: expect.any(String),
          },
          event_type: "openmeld_remote_agent_final_publication",
        },
      });
      const env = buildEnv(harness.db, { slackBotToken: "xoxb-test" });
      const inspected = await inspectHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          conversationId,
          dispatchId: retained.dispatchId,
        },
      });
      expect(inspected.recovery).toMatchObject({
        destination: {
          conversationId: "C123",
          messageId: "1700000000.000001",
          spaceId: conversationId,
          surface: "slack",
        },
        recommendedAction: "recover_result",
        tier: "durable_result_replay",
      });
      const slackHistoryMessageId = "1700000000.000099";
      fetchMock.mockImplementation((request) => {
        const url = String(request);
        if (url.includes("assistant.threads.setStatus")) {
          return Promise.resolve(Response.json({ ok: true }));
        }
        if (url.includes("conversations.replies")) {
          return Promise.resolve(
            Response.json({
              messages: [
                {
                  metadata: {
                    event_payload: {
                      delivery_id: retained.deliveryId,
                    },
                    event_type: "openmeld_remote_agent_final_publication",
                  },
                  ts: slackHistoryMessageId,
                },
              ],
              ok: true,
            })
          );
        }
        return Promise.reject(
          new Error(`unexpected Slack recovery request: ${url}`)
        );
      });
      const storage = createExecutionRecoveryStorage();
      const firstRecovery = await executeHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          body: {
            action: "recover_result",
            destination: inspected.recovery.destination,
            expectedIdentity: inspected.recovery.identity,
            operationId: "caller-slack-recovery-1",
          },
          conversationId,
        },
        storage,
      });
      const repeatedRecovery = await executeHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          body: {
            action: "recover_result",
            destination: inspected.recovery.destination,
            expectedIdentity: inspected.recovery.identity,
            operationId: "caller-slack-recovery-2",
          },
          conversationId,
        },
        storage,
      });
      expect(firstRecovery).toMatchObject({
        operationId: "caller-slack-recovery-1",
        publicationId: slackHistoryMessageId,
        status: "already_completed",
      });
      expect(repeatedRecovery).toMatchObject({
        operationId: "caller-slack-recovery-2",
        publicationId: slackHistoryMessageId,
      });
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/chat.postMessage")
        )
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/conversations.replies")
        )
      ).toHaveLength(1);
      const slackStatusCalls = fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/assistant.threads.setStatus")
      );
      expect(slackStatusCalls).toHaveLength(1);
      expect(
        JSON.parse(String(slackStatusCalls[0]?.[1]?.body ?? "{}"))
      ).toMatchObject({ status: "" });
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("never reads the Center Agent Task store for an ordinary Slack callback", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const conversationId = "slack:T123:C123:1700000000.000001";
    const taskTableReads: string[] = [];
    const taskRead = observeNativePostgresQueries(({ text }) => {
      if (text.includes("center_agent_task")) {
        taskTableReads.push(text);
        throw new Error(
          "ordinary Slack callback read a Center Agent Task table"
        );
      }
    });
    onTestFinished(() => taskRead.mockRestore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, ts: "1700000000.000002" }))
    );
    try {
      await createAcceptedDelivery({
        conversationKind: "slack",
        db: harness.db,
        dispatchId: "dispatch_ordinary_slack_callback",
        idempotencyKey: "idempotency_ordinary_slack_callback",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: conversationId,
        submissionId: "submission_ordinary_slack_callback",
        triggerMessageId: "slack-trigger-ordinary",
      });
      const env = buildEnv(harness.db, { slackBotToken: "xoxb-test" });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch_ordinary_slack_callback",
          idempotencyKey: "idempotency_ordinary_slack_callback",
          organizationId: "org_1",
          spaceId: conversationId,
          submissionId: "submission_ordinary_slack_callback",
          text: "The ordinary Slack work is complete.",
          triggerMessageId: "slack-trigger-ordinary",
        })
      ).resolves.toEqual({
        publishedSignalId: "1700000000.000002",
        status: "accepted",
      });
      expect(taskTableReads).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("settles one parent continuation when a retained Slack result is reconciled repeatedly", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const conversationId = "slack:T123:C123:1700000000.000001";
    const dispatchQueueSend = vi.fn(async (_message: unknown) => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true }))
    );
    try {
      await createAcceptedDelivery({
        conversationKind: "slack",
        db: harness.db,
        dispatchId: "dispatch_slack_parent",
        idempotencyKey: "idempotency_slack_parent",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: conversationId,
        submissionId: "submission_slack_parent",
        triggerMessageId: "slack-trigger-parent",
      });
      await createAcceptedDelivery({
        conversationKind: "slack",
        db: harness.db,
        dispatchId: "dispatch_slack_recovered_child",
        idempotencyKey: "idempotency_slack_recovered_child",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: conversationId,
        submissionId: "submission_slack_recovered_child",
        triggerMessageId: "slack-trigger-child",
      });
      const parent = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission_slack_parent",
      });
      const child = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission_slack_recovered_child",
      });
      if (!(parent && child)) {
        throw new Error("expected native delivery recovery fixtures");
      }
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          delegationId: "delegation-slack-recovery",
          instruction: "Continue after the recovered child result.",
          kind: "resume_agent",
          sourceSignalId: "slack-trigger-parent",
          spaceId: conversationId,
          threadContext: null,
        },
        db: harness.db,
        idempotencyKey: "subscription-key:slack-recovery",
        nowMs: 1150,
        observerTask: {
          deliveryId: parent.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        organizationId: "org_1",
        subscriptionId: "subscription-slack-recovery",
        watchedTask: {
          deliveryId: child.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
      });
      const env = buildEnv(harness.db, {
        dispatchQueueSend,
        slackBotToken: "xoxb-test",
      });
      await completeRemoteAgentNativeDelivery(env, {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: "dispatch_slack_recovered_child",
        idempotencyKey: "idempotency_slack_recovered_child",
        organizationId: "org_1",
        spaceId: conversationId,
        submissionId: "submission_slack_recovered_child",
        text: "Recovered exact result.",
        triggerMessageId: "slack-trigger-child",
      });
      const retained = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission_slack_recovered_child",
      });
      if (!retained) {
        throw new Error("expected retained Slack result");
      }
      await reconcileRemoteAgentRetainedResultPublication({
        db: harness.db,
        delivery: retained,
        env,
        nowMs: 1300,
        publicationId: "1700000000.000099",
      });
      await reconcileRemoteAgentRetainedResultPublication({
        db: harness.db,
        delivery: retained,
        env,
        nowMs: 1400,
        publicationId: "1700000000.000099",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-slack-recovery",
        })
      ).resolves.toMatchObject({
        outcome: {
          publishedSignalId: "1700000000.000099",
          status: "succeeded",
        },
        state: "ready",
      });
      const continuationMessages = dispatchQueueSend.mock.calls
        .map(([message]) => message)
        .filter(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            "kind" in message &&
            message.kind === "agent_task_continuation"
        );
      expect(continuationMessages).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("keeps Message Channel callbacks out of every Space publication surface", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const channelConversationId = "lark:connection_lark_1:oc_chat_1:om_root_1";
    const locator = {
      provider: "lark",
      connectionId: "connection_lark_1",
      appId: "cli_lark_1",
      tenantKey: "tenant_lark_1",
      chatId: "oc_chat_1",
      rootMessageId: "om_root_1",
      threadId: null,
    } satisfies MessageChannelConversationLocator;
    try {
      await createAcceptedDelivery({
        conversationKind: "message_channel",
        db: harness.db,
        dispatchId: "dispatch_message_channel_completed",
        idempotencyKey: "message_channel_completed",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "publication_completed",
        spaceId: channelConversationId,
        submissionId: "sub_message_channel_completed",
        triggerMessageId: "om_trigger_completed",
      });
      await createAcceptedDelivery({
        conversationKind: "message_channel",
        db: harness.db,
        dispatchId: "dispatch_message_channel_failed",
        idempotencyKey: "message_channel_failed",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "publication_failed",
        spaceId: channelConversationId,
        submissionId: "sub_message_channel_failed",
        triggerMessageId: "om_trigger_failed",
      });
      const env = buildEnv(harness.db);
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch_message_channel_completed",
          idempotencyKey: "message_channel_completed",
          organizationId: "org_1",
          spaceId: channelConversationId,
          submissionId: "sub_message_channel_completed",
          text: "Done.",
          triggerMessageId: "om_trigger_completed",
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.message_channel_publication_not_ready",
        status: "retryable",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: "dispatch_message_channel_failed",
          failureCode: "remote_agent.turn_not_completed",
          failureMessage: "Center Agent could not finish this request.",
          idempotencyKey: "message_channel_failed",
          organizationId: "org_1",
          spaceId: channelConversationId,
          status: "failed",
          submissionId: "sub_message_channel_failed",
          triggerMessageId: "om_trigger_failed",
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.message_channel_publication_not_ready",
        status: "retryable",
      });
      expect(env.__spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcListSignalsResult).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(
        env.__spaceStub.rpcReadFinalReplyClaimSignalId
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("settles a late callback as stopped without publishing a Space reply", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await createAcceptedDelivery({
      db: harness.db,
      idempotencyKey: "space_1:dispatch_stopped",
      submissionId: "sub_stopped",
      spaceId: SPACE_ID,
    });
    const traceSpy = vi
      .spyOn(
        runtimeCoordinatorClient,
        "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
      )
      .mockRejectedValue(
        new Error("Hosted Stop must not use a Local runtime head")
      );
    const env = buildEnv(harness.db, {
      postSignalId: "stopped-notice",
    });
    env.__spaceStub.rpcReadWakeStopIntent.mockResolvedValue({
      status: "requested",
    });
    try {
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_stopped",
          idempotencyKey: "space_1:dispatch_stopped",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "This reply arrived after Stop.",
        })
      ).resolves.toEqual({
        publishedSignalId: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "wake_stopped",
            text: "This request was stopped.",
          }),
        })
      );
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_stopped",
        terminal: {
          kind: "stopped",
          noticeText: "The Agent stopped this reply.",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        },
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_stopped",
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        publishedSignalId: "stopped-notice",
        status: "failed",
      });
    } finally {
      traceSpy.mockRestore();
      await harness.close();
    }
  });
  it("replays a stopped delivery into the Space Wake dispatch terminal state", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const idempotencyKey = "space_1:dispatch_stopped_replay";
    await seedWaitingNativeDeliveryDispatch(harness, { idempotencyKey });
    await createAcceptedDelivery({
      db: harness.db,
      idempotencyKey,
      onBehalfOfDisplayName: "Ari",
      onBehalfOfProfileId: HUMAN_PROFILE_ID,
      sourceClientMessageId: "client_1",
      submissionId: "sub_stopped_replay",
      spaceId: SPACE_ID,
      triggerText: "Please help.",
    });
    await claimRemoteAgentNativeDeliveryTerminalFailure({
      db: harness.db,
      failureCode: "runtime_coordinator.pre_agent_stop_requested",
      idempotencyKey,
      nowMs: 1200,
      submissionId: "sub_stopped_replay",
    });
    try {
      await expect(
        submitRemoteAgentNativeDelivery({
          binding: createBinding(),
          db: harness.db,
          env: buildEnv(harness.db),
          executionAttemptId: "attempt_1",
          message: createDispatchMessage({ idempotencyKey }),
          nowMs: 1300,
        })
      ).resolves.toEqual({ shouldAck: true, status: "stopped" });
      await expect(
        readDispatchProjection(harness.db, idempotencyKey)
      ).resolves.toEqual({
        attemptErrorCode: "runtime_coordinator.pre_agent_stop_requested",
        attemptErrorMessage: null,
        attemptStatus: "superseded",
        dispatchStatus: "cancelled",
      });
    } finally {
      await harness.close();
    }
  });
  it("settles the atomic Space stopped fence without retrying the callback", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await createAcceptedDelivery({
      db: harness.db,
      idempotencyKey: "space_1:dispatch_stopped_race",
      submissionId: "sub_stopped_race",
      spaceId: SPACE_ID,
    });
    const stoppedPublicationError = Object.assign(
      new Error(
        'HTTP 409: {"ok":false,"error":{"code":"space.final_outcome_stopped","message":"Wake was already stopped."}}'
      ),
      {
        cause: {
          code: "space.final_outcome_stopped",
          message: "Wake was already stopped.",
          status: 409,
        },
        code: "space.final_outcome_stopped",
        status: 409,
      }
    );
    const env = buildEnv(harness.db, {
      postSignalError: stoppedPublicationError,
    });
    // Stop wins between the initial read and reply publication, not before
    // this callback starts. The refused answer must not become a success replay.
    env.__spaceStub.rpcReadFinalReplyClaimSignalId.mockImplementation(
      async () => ({
        signalId: env.__spaceStub.rpcPostSignal.mock.calls.length
          ? "existing-stopped-notice"
          : null,
      })
    );
    try {
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_stopped_race",
          idempotencyKey: "space_1:dispatch_stopped_race",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "This raced with Stop.",
        })
      ).resolves.toEqual({
        publishedSignalId: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_stopped_race",
        terminal: {
          kind: "stopped",
          noticeText: "The Agent stopped this reply.",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        },
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_stopped_race",
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects oversized callback replies before publishing to Space", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_long",
        submissionId: "sub_long",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        enforceSignalTextLimit: true,
        postSignalId: "signal_reply_long",
      });
      const oversizedText = `${"界".repeat(MAX_TEXT_LENGTH + 100)}\nfinal`;
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_long",
          idempotencyKey: "space_1:dispatch_long",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: oversizedText,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_invalid",
        status: "rejected",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_long",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps truncation visible and does not split emoji graphemes", () => {
    const truncationSuffix = "\n\n[Response truncated by OpenMeld]";
    const prefix = "x".repeat(MAX_TEXT_LENGTH - truncationSuffix.length - 1);
    const text = `${prefix}🙂${"x".repeat(truncationSuffix.length + 10)}`;
    const truncated = truncateSpaceTextToProtocolLimit(text);
    expect(truncated).toContain("[Response truncated by OpenMeld]");
    expect(truncated.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(hasLoneSurrogate(truncated)).toBe(false);
    expect(truncated).not.toContain("🙂");
  });
  it.each([
    { callbackCount: 1, alreadyPublished: false },
    { callbackCount: 2, alreadyPublished: false },
    { callbackCount: 2, alreadyPublished: true },
  ])("remembers a completed CA-DM turn once with overlapping callbacks: $callbackCount, published: $alreadyPublished", async ({
    callbackCount,
    alreadyPublished,
  }) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        submissionId: "sub_remember",
        spaceId: SPACE_ID,
        turnEnvelope: createCenterAgentDmTurnEnvelope(),
      });
      const memoryAdapter = createMemoryAdapter({ searchText: "unused" });
      const memoryService = createCenterAgentMemoryService({
        adapter: memoryAdapter,
        nowMs: () => 1000,
        repository: createMemoryRepository({ organizationMemoryOptIn: true }),
      });
      const pendingWrites: Promise<unknown>[] = [];
      const env = buildEnv(harness.db, { postSignalId: "signal_reply_1" });
      // Hold publication until both callbacks have read the accepted delivery.
      // Space's publication key returns the same signal to both callers.
      let arrivals = 0;
      let releasePublication!: () => void;
      const publicationBarrier = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
      if (alreadyPublished) {
        env.__spaceStub.rpcReadFinalReplyClaimSignalId.mockImplementation(
          async () => {
            arrivals += 1;
            if (arrivals === callbackCount) {
              releasePublication();
            }
            await publicationBarrier;
            return { signalId: "signal_reply_1" };
          }
        );
      }
      env.__spaceStub.rpcPostSignalOnceByClientMessageId.mockImplementation(
        async () => {
          arrivals += 1;
          if (arrivals === callbackCount) {
            releasePublication();
          }
          await publicationBarrier;
          return { id: "signal_reply_1" };
        }
      );
      const callbacks = Array.from({ length: callbackCount }, () =>
        completeRemoteAgentNativeDelivery(
          env,
          {
            submissionId: "sub_remember",
            idempotencyKey: "idem_1",
            organizationId: "org_1",
            spaceId: SPACE_ID,
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            text: "Done.",
          },
          {
            memoryService,
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      );
      for (const result of await Promise.all(callbacks)) {
        expect(result).toEqual({
          status: "accepted",
          publishedSignalId: "signal_reply_1",
        });
      }
      await Promise.all(pendingWrites);
      expect(memoryAdapter.addEpisode).toHaveBeenCalledTimes(1);
      expect(memoryAdapter.ensureOrganizationGraph).not.toHaveBeenCalled();
      expect(memoryAdapter.ensureMemberUser).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.objectContaining({
            kind: "member",
            memberId: "member_1",
            userId: "user_1",
          }),
        })
      );
      expect(memoryAdapter.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          episode: expect.objectContaining({
            assistantMessage: "Done.",
            source: "ca_dm",
            sourceConversationId: SPACE_ID,
            sourceMessageId: "signal_1",
            userMessage: "Please help.",
          }),
          ref: expect.objectContaining({
            subject: expect.objectContaining({ kind: "member" }),
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("fails closed when a completed turn has no frozen interaction environment", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_missing_memory_environment",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        submissionId: "sub_missing_memory_environment",
        spaceId: SPACE_ID,
      });
      const memoryService = createTestMemoryService();
      const pendingWrites: Promise<unknown>[] = [];
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, {
            postSignalId: "signal_missing_memory_environment_reply",
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: "dispatch_1",
            idempotencyKey: "idem_missing_memory_environment",
            organizationId: "org_1",
            spaceId: SPACE_ID,
            submissionId: "sub_missing_memory_environment",
            text: "Done.",
            triggerMessageId: "signal_1",
          },
          {
            memoryService,
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "signal_missing_memory_environment_reply",
        status: "accepted",
      });
      await Promise.all(pendingWrites);
      expect(memoryService.rememberTurn).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("fails closed when frozen interaction environments conflict", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_conflicting_memory_environment",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        submissionId: "sub_conflicting_memory_environment",
        spaceId: SPACE_ID,
        turnEnvelope: {
          ...createCenterAgentDmTurnEnvelope(),
          contextScopePlan: {
            authenticationSecrets: "never_available",
            interactionEnvironment: "organization_shared",
            memberMemory: "use_and_share",
            organizationDocuments: "share_when_authorized",
            organizationMemory: "share_when_authorized",
            organizationSkills: "share_when_authorized",
            protectedInformation: "share_when_authorized",
            requesterIdentity: "verified_member",
            resultAudience: "requester_only",
            v: 1,
          },
        },
      });
      const memoryService = createTestMemoryService();
      const pendingWrites: Promise<unknown>[] = [];
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, {
            postSignalId: "signal_conflicting_memory_environment_reply",
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: "dispatch_1",
            idempotencyKey: "idem_conflicting_memory_environment",
            organizationId: "org_1",
            spaceId: SPACE_ID,
            submissionId: "sub_conflicting_memory_environment",
            text: "Done.",
            triggerMessageId: "signal_1",
          },
          {
            memoryService,
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "signal_conflicting_memory_environment_reply",
        status: "accepted",
      });
      await Promise.all(pendingWrites);
      expect(memoryService.rememberTurn).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("fails closed when the frozen requester does not match current membership", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      const dmEnvelope = createCenterAgentDmTurnEnvelope();
      if (dmEnvelope.sender.kind !== "member") {
        throw new Error("Center Agent DM fixture requires a member sender");
      }
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_mismatched_memory_member",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        submissionId: "sub_mismatched_memory_member",
        spaceId: SPACE_ID,
        turnEnvelope: {
          ...dmEnvelope,
          sender: { ...dmEnvelope.sender, id: "member_other" },
        },
      });
      const memoryService = createTestMemoryService();
      const pendingWrites: Promise<unknown>[] = [];
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, {
            postSignalId: "signal_mismatched_memory_member_reply",
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: "dispatch_1",
            idempotencyKey: "idem_mismatched_memory_member",
            organizationId: "org_1",
            spaceId: SPACE_ID,
            submissionId: "sub_mismatched_memory_member",
            text: "Done.",
            triggerMessageId: "signal_1",
          },
          {
            memoryService,
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "signal_mismatched_memory_member_reply",
        status: "accepted",
      });
      await Promise.all(pendingWrites);
      expect(memoryService.rememberTurn).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("remembers completed verified Slack DM turns in member memory", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, ts: "1700000000.000002" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_slack",
      requestId: "req_slack",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    try {
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          nowMs: 1000,
          request: {
            agentProfileId: AGENT_PROFILE_ID,
            agentProfileOwnerUserId: "user_1",
            author: {
              displayName: "Ari",
              profileId: null,
              profileKind: "human",
            },
            bindingId: "binding_1",
            conversationId: "slack:T123:C123:1700000000.000001",
            dispatchId: "slack_dispatch_1",
            idempotencyKey: "slack_idem_1",
            modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
            organizationId: "org_1",
            speakerMember: { memberId: "member_1", userId: "user_1" },
            slackChannelId: "C123",
            slackTeamId: "T123",
            slackThreadTs: "1700000000.000001",
            sourceText: "Remember that launch reviews happen on Fridays.",
            triggerText: "Remember that launch reviews happen on Fridays.",
            triggerMessageId: "slack:T123:C123:1700000000.000001",
            turnEnvelope: {
              ...createSlackTurnEnvelope(),
              interactionEnvironment: "requester_private",
            },
          },
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
          v: 4,
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_slack",
        })
      ).resolves.toMatchObject({
        executionRecoverySubmitRequest: {
          turnEnvelope: {
            interactionEnvironment: "requester_private",
          },
        },
      });
      const memoryAdapter = createMemoryAdapter({ searchText: "unused" });
      const memoryService = createCenterAgentMemoryService({
        adapter: memoryAdapter,
        nowMs: () => 1000,
        repository: createMemoryRepository({ organizationMemoryOptIn: true }),
      });
      const pendingWrites: Promise<unknown>[] = [];
      const env = buildEnv(harness.db, { slackBotToken: "xoxb-test" });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            submissionId: "sub_slack",
            idempotencyKey: "slack_idem_1",
            organizationId: "org_1",
            spaceId: "slack:T123:C123:1700000000.000001",
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            triggerMessageId: "slack:T123:C123:1700000000.000001",
            dispatchId: "slack_dispatch_1",
            text: "Noted.",
          },
          {
            memoryService,
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1700000000.000002",
      });
      await Promise.all(pendingWrites);
      expect(memoryAdapter.ensureOrganizationGraph).not.toHaveBeenCalled();
      expect(memoryAdapter.ensureMemberUser).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.objectContaining({
            kind: "member",
            memberId: "member_1",
            userId: "user_1",
          }),
        })
      );
      expect(memoryAdapter.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          episode: expect.objectContaining({
            assistantMessage: "Noted.",
            source: "slack_conversation",
            sourceConversationId: "slack:T123:C123:1700000000.000001",
            sourceMessageId: "slack:T123:C123:1700000000.000001",
            userMessage: "Remember that launch reviews happen on Fridays.",
          }),
          ref: expect.objectContaining({
            subject: expect.objectContaining({ kind: "member" }),
          }),
        })
      );
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("preserves the Message Channel provider when remembering a completed turn", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" (
          connection_id,
          organization_id,
          provider,
          app_id,
          tenant_key,
          bot_open_id,
          bot_name,
          transport,
          status,
          installed_by_user_id,
          permission_bundle_version,
          granted_capability_groups_json,
          connection_generation,
          last_verified_at_ms,
          failure_reason_code,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'connection_memory_1',
          'org_1',
          'lark',
          'app_memory_1',
          'tenant_memory_1',
          'bot_memory_1',
          'Center Agent',
          'webhook',
          'connected',
          'user_1',
          'channel-preset-v1',
          '["messaging"]',
          1,
          1000,
          NULL,
          1000,
          1000
        )
      `,
    });
    const locator = {
      appId: "app_memory_1",
      chatId: "chat_memory_1",
      connectionId: "connection_memory_1",
      provider: "lark" as const,
      rootMessageId: "message_memory_root_1",
      tenantKey: "tenant_memory_1",
      threadId: null,
    };
    const conversationId =
      "lark:connection_memory_1:chat_memory_1:message_memory_root_1";
    const publishReply = vi.fn(async () => ({
      resultId: "message_memory_reply_1",
      status: "published" as const,
    }));
    const adapter: MessageChannelProviderAdapter = {
      createWorkingCard: vi.fn(),
      publishFile: vi.fn(),
      downloadResource: vi.fn(),
      finalizeWorkingCard: vi.fn(),
      provider: "lark",
      publishFailure: vi.fn(),
      publishIdentityLinkGuidance: vi.fn(),
      publishPrivateNavigationGuidance: vi.fn(),
      publishReply,
      publishWorkingCard: vi.fn(),
      readChannelContext: vi.fn(),
      updateWorkingCard: vi.fn(),
    };
    try {
      await createAcceptedDelivery({
        conversationKind: "message_channel",
        db: harness.db,
        dispatchId: "dispatch_message_channel_memory",
        idempotencyKey: "message_channel_memory",
        messageChannelLocator: locator,
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        providerPublicationIdempotencyKey: "publication_message_memory",
        spaceId: conversationId,
        submissionId: "sub_message_channel_memory",
        triggerMessageId: "message_memory_trigger_1",
        triggerText: "Remember that launch reviews happen on Fridays.",
        turnEnvelope: createMessageChannelTurnEnvelope({
          conversationId,
          interactionEnvironment: "requester_private",
        }),
      });
      const memoryAdapter = createMemoryAdapter({ searchText: "unused" });
      const memoryService = createCenterAgentMemoryService({
        adapter: memoryAdapter,
        nowMs: () => 1000,
        repository: createMemoryRepository({ organizationMemoryOptIn: true }),
      });
      const pendingWrites: Promise<unknown>[] = [];
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: "dispatch_message_channel_memory",
            idempotencyKey: "message_channel_memory",
            organizationId: "org_1",
            spaceId: conversationId,
            submissionId: "sub_message_channel_memory",
            text: "Noted.",
            triggerMessageId: "message_memory_trigger_1",
          },
          {
            memoryService,
            messageChannelNowMs: () => 1200,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
            waitUntil: (promise) => pendingWrites.push(promise),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_memory_reply_1",
        status: "accepted",
      });
      await Promise.all(pendingWrites);
      expect(memoryAdapter.ensureOrganizationGraph).not.toHaveBeenCalled();
      expect(memoryAdapter.ensureMemberUser).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.objectContaining({
            kind: "member",
            memberId: "member_1",
            userId: "user_1",
          }),
        })
      );
      expect(memoryAdapter.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          episode: expect.objectContaining({
            messageChannelProvider: "lark",
            source: "message_channel_conversation",
            sourceConversationId: conversationId,
            sourceMessageId: "message_memory_trigger_1",
          }),
          ref: expect.objectContaining({
            subject: expect.objectContaining({ kind: "member" }),
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("replays the exact persisted Slack worker request after an ambiguous submit", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const submittedRequests: unknown[] = [];
    const workerSubmit = vi
      .fn()
      .mockImplementationOnce((request: unknown) => {
        submittedRequests.push(request);
        throw new Error("simulated RPC disconnect after admission");
      })
      .mockImplementationOnce((request: unknown) => {
        submittedRequests.push(request);
        return {
          submissionId: "sub_slack_replay",
          requestId: "req_slack_replay",
          status: "pending" as const,
          createdAt: 5000,
          accepted: true,
        };
      });
    const request = {
      agentProfileId: AGENT_PROFILE_ID,
      agentProfileOwnerUserId: "user_1",
      author: {
        displayName: "Ari",
        profileId: null,
        profileKind: "human" as const,
      },
      bindingId: "binding_1",
      conversationId: "slack:T123:C123:1700000000.000001",
      dispatchId: "slack_dispatch_replay",
      idempotencyKey: "slack_idem_replay",
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      organizationId: "org_1",
      speakerMember: { memberId: "member_1", userId: "user_1" },
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "1700000000.000001",
      sourceText: "Please retry this safely.",
      triggerText: "Please retry this safely.",
      triggerMessageId: "slack:T123:C123:1700000000.000001",
      turnEnvelope: createSlackTurnEnvelope(),
    };
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ ok: true, ts: "1700000000.000002" }))
      );
      const env = buildEnv(harness.db, {
        remoteAgentWorker: { submitConversationTurn: workerSubmit },
        slackBotToken: "xoxb-test",
      });
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env,
          nowMs: 1000,
          request,
        })
      ).rejects.toThrow("simulated RPC disconnect after admission");
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env,
          nowMs: 4247,
          request: {
            ...request,
            sourceText: "New hydration observed during retry.",
          },
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      expect(submittedRequests).toHaveLength(2);
      expect(submittedRequests[1]).toEqual(submittedRequests[0]);
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it.each([
    "slack",
    "space",
  ] as const)("keeps %s reply recovery durable and publishes to its original request", async (conversationKind) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 2001,
      requestId: "request-hosted-effect-boundary",
      status: "pending" as const,
      submissionId: "submission-hosted-effect-boundary",
    }));
    const dispatchQueueSend = vi.fn(async () => undefined);
    const env = buildEnv(harness.db, {
      dispatchQueueSend,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      const originalDelivery = await createAcceptedContinuationObserver({
        conversationKind,
        db: harness.db,
        idempotencyKey: "slack-original-effect-boundary",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-slack-original-effect-boundary",
        triggerMessageId: "1700000000.000001",
        turnEnvelope:
          conversationKind === "space"
            ? createCenterAgentDmTurnEnvelope()
            : createSlackTurnEnvelope(),
      });
      const result = await submitRemoteAgentExecutionRecoveryTurn({
        action: "resume_controller_conversation",
        db: harness.db,
        env,
        markEffectStarted: async () => {
          expect(workerSubmit).not.toHaveBeenCalled();
          expect(dispatchQueueSend).toHaveBeenCalledOnce();
          expect(
            await harness.queryAll<{
              count: number;
            }>({
              values: [originalDelivery.idempotencyKey],
              text: `
                SELECT COUNT(*) AS count
                FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
                WHERE idempotency_key <> $1
                  AND status = 'submitted'
                  AND worker_submit_request_json IS NOT NULL
              `,
            })
          ).toEqual([{ count: 1 }]);
          return Promise.resolve();
        },
        nowMs: 2000,
        operationId: "hosted-effect-boundary-operation",
        originalDelivery,
        ...(conversationKind === "space"
          ? { resultRef: "controller-resume:original" }
          : {}),
      });
      expect(result.status).toBe("requested");
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          replyRecovery: expect.objectContaining({
            originalDispatchId: originalDelivery.dispatchId,
          }),
          messages: [
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining(
                originalDelivery.triggerMessageId
              ),
            }),
          ],
        })
      );
      if (conversationKind === "space") {
        await expect(
          completeRemoteAgentNativeDelivery(env, {
            submissionId: "submission-hosted-effect-boundary",
            idempotencyKey: result.idempotencyKey,
            organizationId: originalDelivery.organizationId,
            spaceId: originalDelivery.spaceId,
            agentProfileId: originalDelivery.profileId,
            bindingId: originalDelivery.bindingId,
            dispatchId: result.dispatchId,
            triggerMessageId: originalDelivery.triggerMessageId,
            status: "completed",
            text: "Recovered from the saved tool results.",
          })
        ).resolves.toMatchObject({
          status: "accepted",
          publishedSignalId: "recovered-signal",
        });
        expect(
          env.__spaceStub.rpcPostExecutionRecoveryNoticeSignal
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              dispatchId: originalDelivery.dispatchId,
              noticeType: "execution_recovery_completed",
              resultRef: "controller-resume:original",
            }),
          })
        );
        expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      }
    } finally {
      await harness.close();
    }
  });
  it("rejects a saved request for another Agent before sending a stop to the worker", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const cancelExecution = vi.fn();
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { cancelExecution },
    });
    try {
      const delivery = await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "foreign-agent-stop",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "foreign-agent-stop-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });
      await harness.db.query({
        ...{
          text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
         SET worker_submit_request_json = $1 WHERE idempotency_key = $2`,
          values: [],
        },
        values: [
          JSON.stringify(
            remoteAgentWorkerSubmitTurnRequestSchema.parse({
              ...delivery.executionRecoverySubmitRequest,
              agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
            })
          ),
          delivery.idempotencyKey,
        ],
      });
      await expect(
        stopRemoteAgentNativeDelivery({
          db: harness.db,
          delivery,
          env,
          nowMs: 2100,
        })
      ).rejects.toThrow("remote_agent.native_delivery_identity_mismatch");
      expect(cancelExecution).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: delivery.idempotencyKey,
        })
      ).resolves.toMatchObject({ status: "accepted" });
    } finally {
      await harness.close();
    }
  });
  it("keeps a terminal hosted Slack failure fenced from outcome recovery", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: 1001,
        requestId: "request-original",
        status: "pending" as const,
        submissionId: "submission-original",
      })
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: 2001,
        requestId: "request-resume",
        status: "pending" as const,
        submissionId: "submission-resume",
      });
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const originalRequest = {
      agentProfileId: AGENT_PROFILE_ID,
      agentProfileOwnerUserId: "user_1",
      author: {
        displayName: "Ari",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human" as const,
      },
      bindingId: "binding_1",
      conversationId: "slack:T123:C123:1700000000.000001",
      dispatchId: "slack_dispatch_recovery",
      idempotencyKey: "slack_idem_recovery",
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      organizationId: "org_1",
      speakerMember: { memberId: "member_1", userId: "user_1" },
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "1700000000.000001",
      sourceText: "Prepare the launch review.",
      triggerText: "Prepare the launch review.",
      triggerMessageId: "slack:T123:C123:1700000000.000001",
      turnEnvelope: createSlackTurnEnvelope(),
    };
    try {
      await submitRemoteAgentSlackNativeDelivery({
        db: harness.db,
        env,
        nowMs: 1000,
        request: originalRequest,
      });
      const originalDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: originalRequest.idempotencyKey,
        });
      expect(originalDelivery?.workerSubmitRequest).toBeNull();
      expect(originalDelivery?.executionRecoverySubmitRequest).toMatchObject({
        dispatchId: originalRequest.dispatchId,
        messages: [{ content: originalRequest.sourceText, role: "user" }],
      });
      if (!originalDelivery) {
        throw new Error("expected original Slack delivery");
      }
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env,
          nowMs: 1800,
          request: {
            ...originalRequest,
            slackChannelId: "C-conflict",
          },
        })
      ).rejects.toThrow(
        "immutable admission identity conflict: slackChannelId"
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: originalRequest.idempotencyKey,
        })
      ).resolves.toEqual(originalDelivery);
      expect(workerSubmit).toHaveBeenCalledOnce();
      await harness.query({
        values: [originalDelivery.deliveryId],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET status = 'failed',
              failure_code = 'remote_agent.execution_interrupted',
              failure_detail = 'The hosted execution was interrupted.',
              updated_at_ms = 1900
          WHERE delivery_id = $1
        `,
      });
      const inspected = await inspectHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          conversationId: originalRequest.conversationId,
          dispatchId: originalRequest.dispatchId,
        },
      });
      expect(inspected.recovery).toMatchObject({
        destination: {
          conversationId: originalRequest.slackChannelId,
          messageId: originalRequest.slackThreadTs,
          spaceId: originalRequest.conversationId,
          surface: "slack",
        },
        actions: {
          resumeControllerConversation: {
            enabled: false,
            reasonCode: "execution_recovery.exact_conversation_unavailable",
          },
        },
        recommendedAction: null,
        tier: "none",
      });
      const storage = createExecutionRecoveryStorage();
      await expect(
        executeHostedExecutionRecovery({
          db: harness.db,
          env,
          request: {
            activeOrganizationId: "org_1",
            body: {
              action: "resume_controller_conversation",
              destination: {
                conversationId: "wrong-chat",
                messageId: "wrong-message",
                spaceId: originalRequest.conversationId,
                surface: "lark",
              },
              expectedIdentity: inspected.recovery.identity,
              operationId: "wrong-surface-operation",
            },
            conversationId: originalRequest.conversationId,
          },
          storage,
        })
      ).rejects.toThrow("execution_recovery.identity_mismatch");
      expect(workerSubmit).toHaveBeenCalledOnce();
      await expect(
        executeHostedExecutionRecovery({
          db: harness.db,
          env,
          request: {
            activeOrganizationId: "org_1",
            body: {
              action: "resume_controller_conversation",
              destination: inspected.recovery.destination,
              expectedIdentity: inspected.recovery.identity,
              operationId: "caller-resume-1",
            },
            conversationId: originalRequest.conversationId,
          },
          storage,
        })
      ).rejects.toThrow(
        "execution_recovery.action_unavailable:execution_recovery.exact_conversation_unavailable"
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      const recoveryStub = {
        rpcExecuteHostedExecutionRecovery: vi.fn(
          async (request) =>
            await executeHostedExecutionRecovery({
              db: harness.db,
              env,
              request,
              storage,
            })
        ),
        rpcInspectHostedExecutionRecovery: vi.fn(
          async (request) =>
            await inspectHostedExecutionRecovery({
              db: harness.db,
              env,
              request,
            })
        ),
      };
      const recoveryShardName = vi.fn((name: string) => ({
        name,
        toString: () => name,
      }));
      const routedEnv = {
        ...env,
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => recoveryStub),
          idFromName: recoveryShardName,
        } as unknown as CoreBindings["OPENMELD_RUNTIME_TRANSPORT"],
      };
      const context = {
        activeOrganizationId: "org_1",
        actorContext: {
          ownerUserId: "user_1",
          profileKind: "human" as const,
          profileName: "Ari",
          requestId: "request-hosted-recovery-routing",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      };
      const routedInspection = await rpcInspectExecutionRecovery(routedEnv, {
        context,
        dispatchId: originalRequest.dispatchId,
        spaceId: originalRequest.conversationId,
      });
      expect(routedInspection.recovery.destination).toEqual(
        inspected.recovery.destination
      );
      expect(recoveryShardName).toHaveBeenCalledWith(
        `execution-recovery:${originalDelivery.deliveryId}`
      );
      await expect(
        rpcExecuteExecutionRecovery(routedEnv, {
          body: {
            action: "resume_controller_conversation",
            destination: routedInspection.recovery.destination,
            expectedIdentity: routedInspection.recovery.identity,
            operationId: "rpc-caller-resume-3",
          },
          context,
          spaceId: originalRequest.conversationId,
        })
      ).rejects.toThrow(
        "execution_recovery.action_unavailable:execution_recovery.exact_conversation_unavailable"
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        recoveryStub.rpcInspectHostedExecutionRecovery
      ).toHaveBeenCalledOnce();
      expect(
        recoveryStub.rpcExecuteHostedExecutionRecovery
      ).toHaveBeenCalledOnce();
      await expect(
        rpcInspectExecutionRecovery(routedEnv, {
          context: {
            ...context,
            activeOrganizationId: "org_other",
          },
          dispatchId: originalRequest.dispatchId,
          spaceId: originalRequest.conversationId,
        })
      ).rejects.toMatchObject({
        code: "execution_recovery.execution_not_found",
        status: 404,
      });
      await expect(
        rpcInspectExecutionRecovery(routedEnv, {
          context,
          dispatchId: originalRequest.dispatchId,
          spaceId: "lark:another:conversation",
        })
      ).rejects.toMatchObject({
        code: "execution_recovery.execution_not_found",
        status: 404,
      });
      expect(
        recoveryStub.rpcInspectHostedExecutionRecovery
      ).toHaveBeenCalledOnce();
      expect(
        recoveryStub.rpcExecuteHostedExecutionRecovery
      ).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("keeps the immutable Lark locator without reopening a terminal outcome", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const locator = {
      appId: "app_1",
      chatId: "chat_1",
      connectionId: "connection_1",
      provider: "lark" as const,
      rootMessageId: "message_1",
      tenantKey: "tenant_1",
      threadId: null,
    };
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 2001,
        requestId: "request-lark-recovery",
        status: "pending" as const,
        submissionId: "submission-lark-recovery",
      })
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      const originalDelivery = await createAcceptedContinuationObserver({
        conversationKind: "message_channel",
        db: harness.db,
        idempotencyKey: "lark-original-recovery",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "publication-original",
        submissionId: "submission-lark-original",
        triggerMessageId: "message_current_1",
        turnEnvelope: createMessageChannelTurnEnvelope(),
      });
      await harness.query({
        values: [originalDelivery.deliveryId],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET status = 'failed',
              failure_code = 'remote_agent.execution_interrupted',
              failure_detail = 'The hosted execution was interrupted.',
              updated_at_ms = 2000
          WHERE delivery_id = $1
        `,
      });
      const inspected = await inspectHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          conversationId: originalDelivery.spaceId,
          dispatchId: originalDelivery.dispatchId,
        },
      });
      expect(inspected.recovery).toMatchObject({
        destination: {
          conversationId: locator.chatId,
          messageId: locator.rootMessageId,
          spaceId: originalDelivery.spaceId,
          surface: "lark",
        },
        actions: {
          resumeControllerConversation: {
            enabled: false,
            reasonCode: "execution_recovery.exact_conversation_unavailable",
          },
        },
        recommendedAction: null,
        tier: "none",
      });
      const storage = createExecutionRecoveryStorage();
      await expect(
        executeHostedExecutionRecovery({
          db: harness.db,
          env,
          request: {
            activeOrganizationId: "org_1",
            body: {
              action: "resume_controller_conversation",
              destination: inspected.recovery.destination,
              expectedIdentity: inspected.recovery.identity,
              operationId: "caller-lark-resume-1",
            },
            conversationId: originalDelivery.spaceId,
          },
          storage,
        })
      ).rejects.toThrow(
        "execution_recovery.action_unavailable:execution_recovery.exact_conversation_unavailable"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("keeps a fresh hosted Lark Wake outside terminal outcome recovery", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const locator = {
      appId: "app_tier3",
      chatId: "chat_tier3",
      connectionId: "connection_tier3",
      provider: "lark" as const,
      rootMessageId: "message_tier3",
      tenantKey: "tenant_tier3",
      threadId: null,
    };
    const turnEnvelope = createMessageChannelTurnEnvelope();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 3001,
      requestId: "request-lark-fresh",
      status: "pending" as const,
      submissionId: "submission-lark-fresh",
    }));
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding_1",
        conversationKind: "message_channel",
        db: harness.db,
        dispatchId: "dispatch-lark-tier3-original",
        idempotencyKey: "idempotency-lark-tier3-original",
        messageChannelLocator: locator,
        nowMs: 1000,
        onBehalfOfDisplayName: "Ari",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        organizationId: "org_1",
        profileId: AGENT_PROFILE_ID,
        providerPublicationIdempotencyKey:
          "11111111-1111-5111-8111-111111111111",
        spaceId: turnEnvelope.space.id,
        status: "submitted",
        threadContext: null,
        triggerMessageId: "message_tier3",
        triggerText: "Prepare a fresh review.",
      });
      await persistRemoteAgentWorkerSubmitRequest({
        db: harness.db,
        idempotencyKey: "idempotency-lark-tier3-original",
        nowMs: 1100,
        workerSubmitRequest: remoteAgentWorkerSubmitTurnRequestSchema.parse({
          agentProfileId: AGENT_PROFILE_ID,
          agentProfileOwnerUserId: "center-agent-owner",
          author: {
            displayName: "Ari",
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
          },
          bindingId: "binding_1",
          dispatchId: "dispatch-lark-tier3-original",
          idempotencyKey: "idempotency-lark-tier3-original",
          messages: [
            {
              content: "Prepare a fresh review.",
              role: "user",
            },
          ],
          onBehalfOf: {
            displayName: "Ari",
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
          },
          organizationId: "org_1",
          organizationSkillReleases: [],
          sourceClientMessageId: null,
          spaceId: turnEnvelope.space.id,
          triggerMessageId: "message_tier3",
          turnEnvelope,
          v: 1,
        }),
      });
      await markRemoteAgentNativeDeliveryFailure({
        db: harness.db,
        failureCode: "remote_agent.worker_unavailable",
        failureDetail: "The original controller conversation never started.",
        idempotencyKey: "idempotency-lark-tier3-original",
        nowMs: 1200,
        status: "worker_unavailable",
      });
      const inspected = await inspectHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          conversationId: turnEnvelope.space.id,
          dispatchId: "dispatch-lark-tier3-original",
        },
      });
      expect(inspected.recovery).toMatchObject({
        destination: {
          conversationId: locator.chatId,
          messageId: locator.rootMessageId,
          spaceId: turnEnvelope.space.id,
          surface: "lark",
        },
        identity: {
          agentControllerConversationId: null,
        },
        actions: {
          retryAsNewExecution: {
            enabled: false,
            reasonCode: "execution_recovery.new_wake_required",
          },
        },
        recommendedAction: null,
        tier: "none",
      });
      const storage = createExecutionRecoveryStorage();
      await expect(
        executeHostedExecutionRecovery({
          db: harness.db,
          env,
          request: {
            activeOrganizationId: "org_1",
            body: {
              action: "retry_as_new_execution",
              destination: inspected.recovery.destination,
              expectedIdentity: inspected.recovery.identity,
              operationId: "caller-lark-fresh-1",
            },
            conversationId: turnEnvelope.space.id,
          },
          storage,
        })
      ).rejects.toThrow(
        "execution_recovery.action_unavailable:execution_recovery.new_wake_required"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
      await harness.query({
        values: ["idempotency-lark-tier3-original"],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET failure_code = 'remote_agent.conversation_history_limit_exceeded'
          WHERE idempotency_key = $1
        `,
      });
      const historyLimited = await inspectHostedExecutionRecovery({
        db: harness.db,
        env,
        request: {
          activeOrganizationId: "org_1",
          conversationId: turnEnvelope.space.id,
          dispatchId: "dispatch-lark-tier3-original",
        },
      });
      expect(historyLimited.recovery).toMatchObject({
        actions: {
          retryAsNewExecution: {
            enabled: false,
            reasonCode: "execution_recovery.new_wake_required",
          },
        },
        recommendedAction: null,
        status: "unavailable",
        tier: "none",
      });
    } finally {
      await harness.close();
    }
  });
  it("maps a structured Slack admission rejection to Core-owned public copy", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, ts: "1700000000.000002" }))
    );
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: vi.fn(async () => ({
          idempotencyKey: "slack_idem_rejected",
          message: "Worker diagnostic detail only.",
          outcome: "rejected" as const,
          reasonCode:
            "remote_agent.conversation_history_limit_exceeded" as const,
          v: 1 as const,
        })),
      },
      slackBotToken: "xoxb-test",
    });
    try {
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env,
          nowMs: 1000,
          request: {
            agentProfileId: AGENT_PROFILE_ID,
            agentProfileOwnerUserId: "user_1",
            author: {
              displayName: "Ari",
              profileId: null,
              profileKind: "human",
            },
            bindingId: "binding_1",
            conversationId: "slack:T123:C123:1700000000.000001",
            dispatchId: "slack_dispatch_rejected",
            idempotencyKey: "slack_idem_rejected",
            modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
            organizationId: "org_1",
            speakerMember: { memberId: "member_1", userId: "user_1" },
            slackChannelId: "C123",
            slackTeamId: "T123",
            slackThreadTs: "1700000000.000001",
            sourceText: "Please help.",
            triggerText: "Please help.",
            triggerMessageId: "slack:T123:C123:1700000000.000001",
            turnEnvelope: {
              ...createSlackTurnEnvelope(),
              channelContext: {
                conversationId: "slack:T123:C123:1700000000.000001",
                currentMessageId: "slack:T123:C123:1700000000.000001",
                messages: [
                  {
                    author: {
                      displayName: "Ari",
                      id: "member_1",
                      kind: "human",
                    },
                    id: "slack_message_previous_1",
                    sentAtMs: 900,
                    text: "Continue our deployment investigation.",
                  },
                ],
                provider: "slack",
                sync: { mode: "snapshot", status: "complete" },
              },
            },
          },
        })
      ).resolves.toEqual({ shouldAck: true, status: "failed" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "slack_idem_rejected",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.conversation_history_limit_exceeded",
        failureDetail: "Worker diagnostic detail only.",
        status: "failed",
      });
      expect(
        JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? "{}"))
      ).toMatchObject({
        text: "Center Agent could not continue this conversation automatically. Try again or open diagnostics.",
      });
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("truncates oversized Slack trigger text before writing the native delivery ledger", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_slack_long",
      requestId: "req_slack_long",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const sourceText = `${"a".repeat(REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS - 1)}🙂 tail`;
    try {
      await expect(
        submitRemoteAgentSlackNativeDelivery({
          db: harness.db,
          env: buildEnv(harness.db, {
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          nowMs: 1000,
          request: {
            agentProfileId: AGENT_PROFILE_ID,
            agentProfileOwnerUserId: "user_1",
            author: {
              displayName: "Ari",
              profileId: null,
              profileKind: "human",
            },
            bindingId: "binding_1",
            conversationId: "slack:T123:C123:1700000000.000001",
            dispatchId: "slack_dispatch_long",
            idempotencyKey: "slack_idem_long",
            modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
            organizationId: "org_1",
            speakerMember: { memberId: "member_1", userId: "user_1" },
            slackChannelId: "C123",
            slackTeamId: "T123",
            slackThreadTs: "1700000000.000001",
            sourceText,
            triggerText: sourceText,
            triggerMessageId: "slack:T123:C123:1700000000.000001",
            turnEnvelope: createSlackTurnEnvelope(),
          },
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: "slack_idem_long",
      });
      expect(delivery).not.toBeNull();
      expect(delivery?.triggerText).toEqual(expect.any(String));
      const triggerText = delivery?.triggerText ?? "";
      expect(triggerText.length).toBeLessThanOrEqual(
        REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS
      );
      expect(triggerText).not.toContain("\ud83d");
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: sourceText }],
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("restores persisted thread placement context for successful callbacks", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await submitRemoteAgentNativeDelivery({
        db: harness.db,
        env: buildEnv(harness.db, {
          remoteAgentWorker: {
            submitConversationTurn: async () => ({
              submissionId: "sub_threaded",
              requestId: "req_threaded",
              status: "pending" as const,
              createdAt: 1001,
              accepted: true,
            }),
          },
        }),
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({ threadContext: THREAD_CONTEXT }),
        nowMs: 1000,
        binding: createBinding(),
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_threaded",
        })
      ).resolves.toMatchObject({
        threadContext: THREAD_CONTEXT,
      });
      const env = buildEnv(harness.db, { postSignalId: "signal_reply_thread" });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_threaded",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Done in thread.",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_reply_thread",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          threadContext: THREAD_CONTEXT,
        })
      );
    } finally {
      await harness.close();
    }
  });
  it.each([
    false,
    true,
  ])("projects cancellation as stopped and preserves unconfirmed Computer termination=%s", async (unconfirmedTermination) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_cancelled",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, { postSignalId: "signal_cancelled" });
      const noticeText = unconfirmedTermination
        ? "New work for this request was stopped. Some Computer processes have not confirmed termination. Completed actions were not undone. Original command receipts and saved results remain available. Check those results before repeating any operation."
        : "This request was stopped.";
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_cancelled",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          status: "failed",
          failureCode: "remote_agent.execution_cancelled",
          failureMessage: "This request was stopped.",
          ...(unconfirmedTermination
            ? {
                computerCleanup: {
                  stopAccepted: true,
                  automaticRetryPaused: true,
                  state: null,
                },
              }
            : {}),
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_cancelled",
      });
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_cancelled",
        terminal: {
          kind: "stopped",
          reasonCode: "remote_agent.execution_cancelled",
          noticeText,
        },
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            noticeType: "wake_stopped",
            text: noticeText,
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it.each([
    false,
    true,
  ])("publishes terminal turn failures with retained child results=%s exactly once", async (retainedChild) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const resultReader = vi
      .spyOn(summaryRecoveryService, "readInterruptedTaskResults")
      .mockResolvedValue(
        retainedChild
          ? [{ spaceId: SPACE_ID, signalId: "signal-child-result" }]
          : []
      );
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_failed",
        spaceId: SPACE_ID,
        threadContext: THREAD_CONTEXT,
      });
      const workerSubmit = vi.fn();
      const env = buildEnv(harness.db, {
        postSignalId: "signal_failure_1",
        remoteAgentWorker: { submitConversationTurn: workerSubmit },
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_failed",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          status: "failed",
          failureCode: "remote_agent.turn_not_completed",
          failureDetail:
            "Cloudflare AI binding request failed with 502 Bad Gateway.",
          failureMessage:
            "Remote Agent could not finish this request. Please try again or open diagnostics.",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_failure_1",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            clientMessageId: "sub_failed",
            errorCode: "remote_agent.turn_not_completed",
            errorDetail:
              "Cloudflare AI binding request failed with 502 Bad Gateway.",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          }),
          text: expect.stringMatching(INTERRUPTION_REPLAY_CAUTION),
          threadContext: THREAD_CONTEXT,
        })
      );
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_failed",
        terminal: {
          kind: "failed",
          reasonCode: "remote_agent.turn_not_completed",
          noticeText: expect.stringMatching(INTERRUPTION_REPLAY_CAUTION),
        },
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_failed",
        })
      ).resolves.toMatchObject({
        callbackReceivedAtMs: expect.any(Number),
        completedAtMs: expect.any(Number),
        failureCode: "remote_agent.turn_not_completed",
        failureDetail:
          "Cloudflare AI binding request failed with 502 Bad Gateway.",
        publishedSignalId: "signal_failure_1",
        status: "failed",
      });
      const publishedText =
        env.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
          ?.text;
      expect(publishedText).not.toMatch(UNSUPPORTED_INTERRUPTION_DETAIL);
      if (retainedChild) {
        expect(publishedText).toContain(
          `](/spaces/${SPACE_ID}?signalId=signal-child-result)`
        );
      } else {
        expect(publishedText).not.toContain("signal-child-result");
      }
      expect(
        env.__spaceStub.rpcCloseAgentStream.mock.calls[0]?.[0]?.terminal
          .noticeText
      ).toBe(publishedText);
      await completeRemoteAgentNativeDelivery(env, {
        submissionId: "sub_failed",
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        status: "failed",
        failureCode: "remote_agent.turn_not_completed",
        failureMessage: "Please try again.",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(1);
      expect(workerSubmit).not.toHaveBeenCalled();
    } finally {
      resultReader.mockRestore();
      await harness.close();
    }
  });
  it("attributes a personal Agent callback failure to its admitted controller", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET is_default = 1 WHERE profile_id = $1',
      values: [HUMAN_PROFILE_ID],
    });
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = NULL, owner_user_id = \'user_1\' WHERE profile_id = $1',
      values: [AGENT_PROFILE_ID],
    });
    await harness.query({
      text: 'DELETE FROM "openmeld"."center_agent_designations"',
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'disabled_historical', disabled_at_ms = 1000 WHERE binding_id = 'binding_1'",
    });
    await harness.query({
      text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'enabled_primary', disabled_at_ms = NULL, owner_kind = 'owner_account', owner_id = 'user_1', runtime_kind = 'hosted_remote_agent', agent_controller_ref = 'hosted:remote-agent', openmeld_service_runtime_id = 'hosted:remote-agent', hosted_runtime_identity_json = $1 WHERE binding_id = 'binding_1'",
      values: [JSON.stringify(HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY)],
    });
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1001,
        requestId: "request_personal_failure",
        status: "pending" as const,
        submissionId: "submission_personal_failure",
      })
    );
    const env = buildEnv(harness.db, {
      postSignalId: "signal_personal_failure",
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await submitRemoteAgentNativeDelivery({
        binding: { ...createBinding(), personalAgent: true },
        db: harness.db,
        env,
        executionAttemptId: "attempt_1",
        memoryService: null,
        message: createDispatchMessage(),
        nowMs: 1000,
      });
      expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
        v: 4,
        conversationIdentity: { kind: "personal_agent" },
      });
      await completeRemoteAgentNativeDelivery(env, {
        submissionId: "submission_personal_failure",
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        status: "failed",
        failureCode: "remote_agent.turn_not_completed",
        failureDetail: "remote_agent.requester_membership_revoked",
        failureMessage: "Internal callback failure",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            profileName: "Codex",
          }),
          text: expect.stringContaining("Codex stopped"),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("names the failed personal Agent in a Slack callback", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ ok: true, ts: "1700000000.000999" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const conversationId = "slack:T123:C123:1700000000.000001";
    try {
      await createAcceptedDelivery({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "idem_1",
        personalAgent: true,
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: conversationId,
        submissionId: "sub_slack_personal_failure",
      });
      await completeRemoteAgentNativeDelivery(
        buildEnv(harness.db, { slackBotToken: "xoxb-test" }),
        {
          ...createFailedCallbackBody({
            callbackAttempt: 1,
            submissionId: "sub_slack_personal_failure",
          }),
          spaceId: conversationId,
          failureDetail: "remote_agent.requester_membership_revoked",
        }
      );
      expect(
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      ).toMatchObject({
        text: expect.stringContaining("Codex stopped"),
      });
    } finally {
      vi.unstubAllGlobals();
      await harness.close();
    }
  });
  it("attributes a personal Agent Routine failure to its controller", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        personalAgent: true,
        routineRunId: "run_personal_failure",
        routineNameSnapshot: "Daily review",
        spaceId: SPACE_ID,
        submissionId: "sub_routine_personal_failure",
      });
      await harness.query({
        values: ["run_personal_failure"],
        text: `
          INSERT INTO "openmeld"."routine_runs" (
            id, routine_id, organization_id, scheduled_for, status,
            routine_name_snapshot, target_space_id_snapshot,
            destination_kind_snapshot, execution_engine, started_at_ms
          ) VALUES ($1, 'routine-1', 'org_1', 900, 'submitted',
            'Daily review', '${SPACE_ID}', 'space', 'legacy', 900)
        `,
      });
      const env = buildEnv(harness.db);
      const routineOutcome = await completeRemoteAgentNativeDelivery(env, {
        ...createFailedCallbackBody({
          callbackAttempt: 1,
          submissionId: "sub_routine_personal_failure",
        }),
        spaceId: SPACE_ID,
        failureDetail: "remote_agent.requester_membership_revoked",
      });
      expect(routineOutcome).toMatchObject({ status: "accepted" });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            actorContext: expect.objectContaining({
              agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            }),
          }),
          text: expect.stringContaining("Codex stopped"),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("attributes a personal Agent pre-execution failure to its dispatch controller", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      const env = buildEnv(harness.db);
      await publishRemoteAgentFailureNotice({
        env,
        message: createDispatchMessage({
          controllerSnapshot: {
            agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            targetBindingEnabled: true,
            targetBindingState: "bound",
          },
        }),
        errorCode: "remote_agent.requester_membership_revoked",
        text: "Center Agent couldn't start this request.",
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            actorContext: expect.objectContaining({
              agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
              profileName: "Codex",
            }),
          }),
          data: expect.objectContaining({
            actorName: "Codex",
            text: expect.stringContaining("Codex stopped"),
          }),
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("keeps a precise provider rate-limit reason in the published failure", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_rate_limited",
        submissionId: "sub_rate_limited",
        spaceId: SPACE_ID,
        threadContext: THREAD_CONTEXT,
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal_rate_limited",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_rate_limited",
          idempotencyKey: "idem_rate_limited",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          status: "failed",
          failureCode: "remote_agent.provider.rate_limited",
          failureDetail: "Provider request returned 429.",
          failureMessage:
            "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_rate_limited",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            errorCode: "remote_agent.provider.rate_limited",
            errorDetail: "Provider request returned 429.",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          }),
          text: "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
          threadContext: THREAD_CONTEXT,
        })
      );
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_rate_limited",
        terminal: {
          kind: "failed",
          reasonCode: "remote_agent.provider.rate_limited",
          noticeText:
            "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
        },
      });
    } finally {
      await harness.close();
    }
  });
  it("completes member research callbacks without fabricating a Direct Message reply", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const taskId = "member_research_task_completed";
    const submissionId = "sub_member_research_completed";
    try {
      await seedRunningMemberResearchTask(harness, taskId);
      await createAcceptedDelivery({
        db: harness.db,
        dispatchId: taskId,
        idempotencyKey: taskId,
        submissionId,
        spaceId: SPACE_ID,
        triggerMessageId: taskId,
      });
      const reconcileMemberResearch = vi.fn(() => Promise.resolve());
      const env = buildEnv(harness.db, { postSignalId: "should_not_publish" });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: taskId,
            idempotencyKey: taskId,
            organizationId: "org_1",
            spaceId: SPACE_ID,
            submissionId,
            text: "Research completed.",
            triggerMessageId: taskId,
          },
          { reconcileMemberResearch }
        )
      ).resolves.toEqual({
        publishedSignalId: null,
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(reconcileMemberResearch).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        publishedSignalId: null,
        status: "completed",
      });
    } finally {
      await harness.close();
    }
  });
  it("fails member research callbacks without fabricating a Direct Message failure", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const taskId = "member_research_task_failed";
    const submissionId = "sub_member_research_failed";
    try {
      await seedRunningMemberResearchTask(harness, taskId);
      await createAcceptedDelivery({
        db: harness.db,
        dispatchId: taskId,
        idempotencyKey: taskId,
        submissionId,
        spaceId: SPACE_ID,
        triggerMessageId: taskId,
      });
      const reconcileMemberResearch = vi.fn(() => Promise.resolve());
      const env = buildEnv(harness.db, { postSignalId: "should_not_publish" });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_1",
            dispatchId: taskId,
            failureCode: "remote_agent.turn_not_completed",
            failureMessage: "Research could not be completed.",
            idempotencyKey: taskId,
            organizationId: "org_1",
            spaceId: SPACE_ID,
            status: "failed",
            submissionId,
            triggerMessageId: taskId,
          },
          { reconcileMemberResearch }
        )
      ).resolves.toEqual({
        publishedSignalId: null,
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(reconcileMemberResearch).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_not_completed",
        publishedSignalId: null,
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("backs off unavailable reconciliation, preserves uncertainty, and clears it only on an exact native response", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_uncertain",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_1",
        submissionId: "sub_uncertain",
      });
      const reconcileExecution = vi.fn(() =>
        Promise.reject(new Error("temporary transport failure"))
      );
      const dispatchQueueSend = vi.fn(async () => undefined);
      const env = buildEnv(harness.db, {
        remoteAgentWorker: { reconcileExecution },
        dispatchQueueSend,
      });
      let nowMs = probe.deadlineAtMs;
      for (const delaySeconds of [300, 600, 900]) {
        await processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs,
          probe,
        });
        expect(dispatchQueueSend).toHaveBeenLastCalledWith(probe, {
          delaySeconds,
        });
        await expect(
          readRemoteAgentNativeDeliveryBySubmissionId({
            db: harness.db,
            submissionId: "sub_uncertain",
          })
        ).resolves.toMatchObject({
          status: "accepted",
          completedAtMs: null,
          failureCode: null,
          executionReconciliation: {
            failureKind: "transport",
            retryState: "retrying",
          },
        });
        nowMs += delaySeconds * 1000;
      }
      const progress =
        await listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs,
        });
      expect(progress).toEqual([
        expect.objectContaining({
          phase: "running",
          failureReasonCode: "remote_agent.execution_confirmation_pending",
        }),
      ]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      const foundEnv = buildEnv(harness.db, {
        dispatchQueueSend,
        remoteAgentWorker: {
          reconcileExecution: vi.fn(async () => ({
            status: "found" as const,
            execution: {
              v: 1 as const,
              acceptedAtMs: 1000,
              cancellationReason: null,
              completedAtMs: null,
              idempotencyKey: "idem_1",
              organizationId: "org_1",
              spaceId: SPACE_ID,
              submissionId: "sub_uncertain",
              status: "running" as const,
              lastProgressAtMs: nowMs,
              lastProgressKind: "tool_started" as const,
            },
          })),
        },
      });
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env: foundEnv,
        nowMs,
        probe,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_uncertain",
        })
      ).resolves.toMatchObject({
        status: "accepted",
        executionReconciliation: null,
      });
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs,
        })
      ).resolves.toEqual([
        expect.objectContaining({ failureReasonCode: null }),
      ]);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "invalid_response",
    "unsupported",
  ] as const)("pauses %s without failing execution and preserves the native Stop exit", async (kind) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_paused",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_1",
        submissionId: "sub_paused",
      });
      const reconcileExecution = vi.fn(async () => ({
        status: "found",
        execution: {},
      }));
      const dispatchQueueSend = vi.fn(async () => undefined);
      const env = buildEnv(harness.db, {
        dispatchQueueSend,
        // Intentionally violate the RPC wire contract to exercise its parser.
        remoteAgentWorker: (kind === "unsupported"
          ? {}
          : { reconcileExecution }) as unknown as NonNullable<
          CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
        >,
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_paused",
        status: "skipped",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "sub_paused",
      });
      if (!delivery) {
        throw new Error("Missing accepted delivery fixture.");
      }
      expect(delivery).toMatchObject({
        status: "accepted",
        completedAtMs: null,
        failureCode: null,
        submissionId: "sub_paused",
        executionReconciliation: { failureKind: kind, retryState: "paused" },
      });
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env,
          nowMs: 10_000_000,
        })
      ).resolves.toMatchObject({ enqueued: 0, scanned: 0 });
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: 10_000_000,
        probe,
      });
      expect(reconcileExecution).toHaveBeenCalledTimes(
        kind === "unsupported" ? 0 : 1
      );
      expect(dispatchQueueSend).not.toHaveBeenCalled();
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs: 10_000_000,
        })
      ).resolves.toEqual([
        expect.objectContaining({
          phase: "running",
          failureReasonCode: "remote_agent.execution_confirmation_pending",
        }),
      ]);
      const stoppedEnv = buildEnv(harness.db, {
        remoteAgentWorker: {
          cancelExecution: vi.fn(async () => ({
            status: "already_cancelled" as const,
            execution: {
              v: 1 as const,
              acceptedAtMs: 1000,
              cancellationReason: "User requested Stop",
              completedAtMs: 10_000_000,
              idempotencyKey: "idem_1",
              organizationId: "org_1",
              spaceId: SPACE_ID,
              submissionId: "sub_paused",
              status: "aborted" as const,
              lastProgressAtMs: 10_000_000,
              lastProgressKind: "aborted" as const,
            },
          })),
        },
      });
      await expect(
        requestRemoteAgentNativeDeliveryStop({
          db: harness.db,
          env: stoppedEnv,
          delivery,
          nowMs: 10_000_000,
        })
      ).resolves.toBe("stopped");
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs: 10_000_000,
        })
      ).resolves.toEqual([]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("keeps native not_found unknown and lets newer accepted progress supersede an unavailable query", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_missing",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_1",
        submissionId: "sub_missing",
      });
      const dispatchQueueSend = vi.fn(async () => undefined);
      const env = buildEnv(harness.db, {
        dispatchQueueSend,
        remoteAgentWorker: {
          reconcileExecution: vi.fn(async () => ({
            status: "not_found" as const,
          })),
        },
      });
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: probe.deadlineAtMs,
        probe,
      });
      const nowMs = probe.deadlineAtMs + 240_000;
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_missing",
        })
      ).resolves.toMatchObject({
        status: "accepted",
        submissionId: "sub_missing",
        completedAtMs: null,
        failureCode: null,
        executionReconciliation: {
          failureKind: "not_found",
          retryState: "retrying",
        },
      });
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs,
        })
      ).resolves.toEqual([
        expect.objectContaining({
          failureReasonCode: "remote_agent.execution_confirmation_pending",
        }),
      ]);
      await recordRemoteAgentNativeDeliveryExecutionProgress({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_missing",
        nowMs,
        sequence: 1,
      });
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs,
        })
      ).resolves.toEqual([
        expect.objectContaining({ phase: "running", failureReasonCode: null }),
      ]);
      // One fresh progress event must not hide unavailable confirmation forever.
      await expect(
        listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace({
          db: harness.db,
          spaceId: SPACE_ID,
          nowMs: nowMs + 240_000,
        })
      ).resolves.toEqual([
        expect.objectContaining({
          phase: "running",
          failureReasonCode: "remote_agent.execution_confirmation_pending",
        }),
      ]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("reconciles accepted native deliveries without imposing a total deadline", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_expired",
        spaceId: SPACE_ID,
        threadContext: THREAD_CONTEXT,
      });
      const dispatchQueueSend = vi.fn(async () => undefined);
      const reconcileExecution = vi.fn(async () => ({
        status: "found" as const,
        execution: {
          v: 1 as const,
          acceptedAtMs: 1000,
          cancellationReason: null,
          completedAtMs: null,
          idempotencyKey: "idem_1",
          lastProgressAtMs: 240_000,
          lastProgressKind: "tool_started" as const,
          organizationId: "org_1",
          spaceId: SPACE_ID,
          status: "running" as const,
          submissionId: "sub_expired",
        },
      }));
      const env = buildEnv(harness.db, {
        dispatchQueueSend,
        postSignalId: "signal_expired_1",
        remoteAgentWorker: { reconcileExecution },
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_1",
        submissionId: "sub_expired",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs - 1,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.delivery_deadline_probe_not_due",
        status: "skipped",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_scheduled",
        status: "skipped",
      });
      expect(reconcileExecution).toHaveBeenCalledWith({
        v: 1,
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: "sub_expired",
      });
      expect(dispatchQueueSend).toHaveBeenCalledWith(probe, {
        delaySeconds: 300,
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_expired",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        failureCode: null,
        publishedSignalId: null,
        status: "accepted",
      });
      const mixedVersionEnv = buildEnv(harness.db, {
        dispatchQueueSend,
        remoteAgentWorker: {},
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: mixedVersionEnv,
          nowMs: 560_000,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_paused",
        status: "skipped",
      });
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_expired",
        })
      ).resolves.toMatchObject({
        executionReconciliation: {
          failureKind: "unsupported",
          retryState: "paused",
        },
        status: "accepted",
      });
      expect(mixedVersionEnv.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("terminalizes a reconciled execution identity mismatch without renewing its probe", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(async () => undefined);
    const reconcileExecution = vi.fn(async () => ({
      reasonCode: "remote_agent.execution_identity_mismatch" as const,
      status: "identity_mismatch" as const,
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend,
      postSignalId: "signal_execution_identity_mismatch",
      remoteAgentWorker: { reconcileExecution },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_execution_identity_mismatch",
        submissionId: "sub_execution_identity_mismatch",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_execution_identity_mismatch",
        submissionId: "sub_execution_identity_mismatch",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_identity_mismatch",
        status: "expired",
      });
      expect(dispatchQueueSend).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_execution_identity_mismatch",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.execution_identity_mismatch",
        publishedSignalId: "signal_execution_identity_mismatch",
        status: "failed",
      });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            errorCode: "remote_agent.execution_identity_mismatch",
          }),
          text: "OpenMeld stopped this request because it could not confirm that the reply came from Codex. Open Diagnostics in OpenMeld for details.",
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("redrives an identity-mismatch failure publication until it is visible", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const dispatchQueueSend = vi.fn(async () => undefined);
    const reconcileExecution = vi.fn(async () => ({
      reasonCode: "remote_agent.execution_identity_mismatch" as const,
      status: "identity_mismatch" as const,
    }));
    const env = buildEnv(harness.db, {
      dispatchQueueSend,
      postSignalFailuresBeforeSuccess: 1,
      postSignalId: "signal_execution_identity_mismatch_retry",
      remoteAgentWorker: { reconcileExecution },
    });
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_execution_identity_mismatch_retry",
        submissionId: "sub_execution_identity_mismatch_retry",
        spaceId: SPACE_ID,
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_execution_identity_mismatch_retry",
        submissionId: "sub_execution_identity_mismatch_retry",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode:
          "remote_agent.execution_identity_mismatch_publication_pending",
        status: "skipped",
      });
      expect(dispatchQueueSend).toHaveBeenCalledWith(probe, {
        delaySeconds: 300,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_execution_identity_mismatch_retry",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.callback_failure_publish_failed",
        finalPublicationPayload: {
          failureCode: "remote_agent.execution_identity_mismatch",
          text: "OpenMeld stopped this request because it could not confirm that the reply came from Codex. Open Diagnostics in OpenMeld for details.",
        },
        finalPublicationState: null,
        publishedSignalId: null,
        status: "accepted",
      });
      dispatchQueueSend.mockClear();
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs + 300_000,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
      dispatchQueueSend.mockClear();
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs + 300_000,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_identity_mismatch",
        status: "expired",
      });
      expect(reconcileExecution).toHaveBeenCalledOnce();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(2);
      expect(dispatchQueueSend).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_execution_identity_mismatch_retry",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.execution_identity_mismatch",
        finalPublicationState: "published",
        publishedSignalId: "signal_execution_identity_mismatch_retry",
        status: "failed",
      });
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs + 600_000,
        })
      ).resolves.toEqual({ enqueued: 0, errors: 0, scanned: 0 });
    } finally {
      await harness.close();
    }
  });
  it("preserves callback publish failure cause when the deadline probe closes a legacy accepted row", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_legacy_publish_failed",
        submissionId: "sub_legacy_publish_failed",
        spaceId: SPACE_ID,
      });
      await markRemoteAgentCallbackPublishFailure({
        db: harness.db,
        nowMs: 1200,
        submissionId: "sub_legacy_publish_failed",
        failureCode: "remote_agent.callback_publish_failed",
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal_legacy_publish_failed",
      });
      const probe = createDeadlineProbe({
        idempotencyKey: "idem_legacy_publish_failed",
        submissionId: "sub_legacy_publish_failed",
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({ status: "expired" });
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            errorCode: "remote_agent.callback_publish_failed",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          }),
          text: "Codex finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open Diagnostics in OpenMeld.",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_legacy_publish_failed",
        })
      ).resolves.toMatchObject({
        completedAtMs: probe.deadlineAtMs,
        failureCode: "remote_agent.callback_publish_failed",
        publishedSignalId: "signal_legacy_publish_failed",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("skips deadline probes when the callback already completed the delivery", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await seedWaitingNativeDeliveryDispatch(harness);
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_completed",
        spaceId: SPACE_ID,
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        submissionId: "sub_completed",
        publishedSignalId: "signal_reply_1",
      });
      const env = buildEnv(harness.db);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: 250_000,
          probe: createDeadlineProbe({
            idempotencyKey: "idem_1",
            submissionId: "sub_completed",
          }),
        })
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.delivery_deadline_probe_already_published",
        status: "skipped",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_completed",
        })
      ).resolves.toMatchObject({
        publishedSignalId: "signal_reply_1",
        status: "completed",
      });
      await expect(
        readDispatchProjection(harness.db, "idem_1")
      ).resolves.toEqual({
        attemptErrorCode: null,
        attemptErrorMessage: null,
        attemptStatus: "succeeded",
        dispatchStatus: "succeeded",
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    "remote_agent.empty_assistant_response",
    "remote_agent.turn.output_limit_exceeded",
    "remote_agent.execution_cancelled",
  ])("preserves saved files when publishing %s", async (failureCode) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_saved_failure",
        spaceId: SPACE_ID,
      });
      const file = {
        fileId: "saved-report",
        name: "report.md",
        mimeType: "text/markdown",
        revision: 1,
        sizeBytes: 10,
      };
      const env = buildEnv(harness.db, { postSignalId: "saved-failure" });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          ...createFailedCallbackBody({
            callbackAttempt: 1,
            submissionId: "sub_saved_failure",
          }),
          failureCode,
          files: [file],
        })
      ).resolves.toMatchObject({
        status: "accepted",
        publishedSignalId: "saved-failure",
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          clientMessageId: "sub_saved_failure",
          files: [file],
          meta: expect.objectContaining({ errorCode: failureCode }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_saved_failure",
        })
      ).resolves.toMatchObject({
        status: "failed",
        failureCode,
        publishedSignalId: "saved-failure",
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    "publication_rejected",
    "crash_after_claim",
    "space_ack_lost",
  ] as const)("retains blocked explanation and files through %s without upgrading task success", async (fault) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await seedWaitingNativeDeliveryDispatch(harness);
      await createAcceptedDelivery({
        db: harness.db,
        deliveryId: "delivery-blocked",
        idempotencyKey: "idem_1",
        submissionId: "sub_blocked",
        spaceId: SPACE_ID,
      });
      const task = {
        deliveryId: "delivery-blocked",
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "watch-blocked",
        nowMs: 1100,
        organizationId: "org_1",
        observerTask: {
          agentControllerRef: "builtin:codex",
          hostId: "host-1",
          kind: "controller_task",
          taskId: "observer-blocked",
          v: 1,
        },
        subscriptionId: "subscription-blocked",
        watchedTask: task,
      });
      const file = {
        fileId: "saved-report",
        name: "report.md",
        mimeType: "text/markdown",
        revision: 1,
        sizeBytes: 10,
      };
      const text =
        "The report is saved. Publication is unconfirmed; I have not repeated it.";
      const body = {
        ...createFailedCallbackBody({
          callbackAttempt: 1,
          submissionId: "sub_blocked",
        }),
        failureCode: "remote_agent.computer.command_cleanup_failed",
        explanationText: text,
        files: [file],
      };
      const recovered = buildEnv(harness.db, {
        postSignalId: "blocked-result",
      });
      const publishedSignals = new Map<
        string,
        { text: string; files: unknown }
      >();
      if (fault === "space_ack_lost") {
        // Model the Space's public once contract: the write survives a lost
        // transport acknowledgement and the same key returns the saved Signal.
        recovered.__spaceStub.rpcPostSignalOnceByClientMessageId.mockImplementation(
          (request) => {
            if (!publishedSignals.has(request.clientMessageId)) {
              publishedSignals.set(request.clientMessageId, {
                text: request.text,
                files: request.files,
              });
              throw new Error(
                "Space persisted the Signal but its acknowledgement was lost"
              );
            }
            return createSignalEnvelope("blocked-result");
          }
        );
      }
      if (fault === "crash_after_claim") {
        const claimed = await claimRemoteAgentFinalPublication({
          db: harness.db,
          claimId: "crashed-owner",
          claimExpiresAtMs: 2,
          nowMs: 1,
          submissionId: body.submissionId,
          idempotencyKey: body.idempotencyKey,
          terminalFailureCode: body.failureCode,
          payload: {
            storageVersion: 3,
            resumeStatus: "accepted",
            failureCode: body.failureCode,
            failureDetail: null,
            reviewedFailureExplanation: true,
            text,
            files: [file],
            attachments: [],
          },
        });
        expect(claimed?.status).toBe("failed");
      } else if (fault === "space_ack_lost") {
        await expect(
          completeRemoteAgentNativeDelivery(recovered, body)
        ).resolves.toMatchObject({ status: "retryable" });
        expect([...publishedSignals.values()]).toEqual([
          { text, files: [file] },
        ]);
      } else {
        const unavailable = buildEnv(harness.db);
        unavailable.__spaceStub.rpcPostSignalOnceByClientMessageId.mockRejectedValueOnce(
          new Error("Space unavailable")
        );
        await expect(
          completeRemoteAgentNativeDelivery(unavailable, body)
        ).resolves.toMatchObject({ status: "retryable" });
      }
      await expect(
        completeRemoteAgentNativeDelivery(recovered, {
          ...body,
          callbackAttempt: 2,
          explanationText: "An obsolete replacement draft",
          files: [],
        })
      ).resolves.toMatchObject({
        status: "accepted",
        publishedSignalId: "blocked-result",
      });
      expect(
        recovered.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          clientMessageId: "sub_blocked",
          text,
          files: [file],
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_blocked",
        })
      ).resolves.toMatchObject({
        status: "failed",
        failureCode: body.failureCode,
        finalPublicationState: "published",
        publishedSignalId: "blocked-result",
        finalPublicationPayload: expect.objectContaining({
          reviewedFailureExplanation: true,
          text,
          files: [file],
        }),
      });
      await completeRemoteAgentNativeDelivery(recovered, {
        ...body,
        callbackAttempt: 3,
      });
      expect(
        recovered.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledTimes(fault === "space_ack_lost" ? 2 : 1);
      if (fault === "space_ack_lost") {
        expect([...publishedSignals.values()]).toEqual([
          { text, files: [file] },
        ]);
      }
      await expect(
        readDispatchProjection(harness.db, "idem_1")
      ).resolves.toMatchObject({
        dispatchStatus: "failed_terminal",
        attemptStatus: "failed_terminal",
      });
      await expect(
        readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(task),
        })
      ).resolves.toMatchObject({
        task,
        outcome: {
          status: "failed",
          errorCode: body.failureCode,
          publishedSignalId: "blocked-result",
        },
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    "remote_agent.turn_not_completed",
    "remote_agent.empty_assistant_response",
    "remote_agent.turn.output_limit_exceeded",
  ])("retries failed publication and records the %s outcome", async (failureCode) => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    const resultReader = vi
      .spyOn(summaryRecoveryService, "readInterruptedTaskResults")
      .mockResolvedValue([
        { spaceId: SPACE_ID, signalId: "signal-child-result" },
      ]);
    try {
      await seedWaitingNativeDeliveryDispatch(harness);
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_failed_retry",
        spaceId: SPACE_ID,
      });
      const body = {
        ...createFailedCallbackBody({
          callbackAttempt: 1,
          submissionId: "sub_failed_retry",
        }),
        failureDetail:
          "The provider stopped after the model exceeded its context window.",
        failureCode,
      };
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, { postSignalError: "space unavailable" }),
          body
        )
      ).resolves.toEqual({
        status: "retryable",
        reasonCode: "remote_agent.callback_failure_publish_failed",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_failed_retry",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.callback_failure_publish_failed",
        publishedSignalId: null,
        status: "accepted",
      });
      const retained = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "sub_failed_retry",
      });
      // The visible notice was already claimed. Re-publication must not
      // regenerate it as result availability changes, or run the model again.
      resultReader.mockResolvedValue([]);
      const recoveredEnv = buildEnv(harness.db, {
        postSignalId: "signal_failure_retry",
      });
      await expect(
        completeRemoteAgentNativeDelivery(recoveredEnv, {
          ...body,
          callbackAttempt: 2,
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_failure_retry",
      });
      if (failureCode === "remote_agent.turn_not_completed") {
        expect(
          recoveredEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            text: retained?.finalPublicationPayload?.text,
          })
        );
        expect(resultReader).toHaveBeenCalledTimes(1);
      }
      if (
        failureCode === "remote_agent.empty_assistant_response" ||
        failureCode === "remote_agent.turn.output_limit_exceeded"
      ) {
        expect(recoveredEnv.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
        expect(
          recoveredEnv.__spaceStub.rpcPostSystemNoticeSignal
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            finalOutcomeAuthority: "remote_agent_native_delivery",
            data: expect.objectContaining({
              noticeType: "terminal_failure",
              reasonCode: failureCode,
              failureStage: "execution",
              ...(failureCode === "remote_agent.turn.output_limit_exceeded"
                ? { text: expect.stringContaining("response limit") }
                : {}),
            }),
          })
        );
      }
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_failed_retry",
        })
      ).resolves.toMatchObject({
        failureCode,
        publishedSignalId: "signal_failure_retry",
        status: "failed",
      });
      await expect(
        readDispatchProjection(harness.db, "idem_1")
      ).resolves.toEqual({
        attemptErrorCode: failureCode,
        attemptErrorMessage:
          "The provider stopped after the model exceeded its context window.",
        attemptStatus: "failed_terminal",
        dispatchStatus: "failed_terminal",
      });
    } finally {
      resultReader.mockRestore();
      await harness.close();
    }
  });
  it("does not close the Wake trace from an unpublished failed native delivery", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await seedWaitingNativeDeliveryDispatch(harness);
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_unpublished_failed",
        spaceId: SPACE_ID,
      });
      await expect(
        claimRemoteAgentNativeDeliveryTerminalFailure({
          db: harness.db,
          failureCode: "remote_agent.turn_not_completed",
          idempotencyKey: "idem_1",
          nowMs: 1200,
          submissionId: "sub_unpublished_failed",
        })
      ).resolves.toMatchObject({
        publishedSignalId: null,
        status: "failed",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createFailedCallbackBody({
            callbackAttempt: 2,
            submissionId: "sub_unpublished_failed",
          })
        )
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.callback_failed_submission",
        status: "duplicate_rejected",
      });
      await expect(
        readDispatchProjection(harness.db, "idem_1")
      ).resolves.toEqual({
        attemptErrorCode: null,
        attemptErrorMessage: null,
        attemptStatus: "waiting_result",
        dispatchStatus: "dispatching",
      });
    } finally {
      await harness.close();
    }
  });
  it("publishes concurrent failed Space callbacks only once", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_failed_concurrent",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalId: "signal_failure_concurrent",
      });
      const body = createFailedCallbackBody({
        callbackAttempt: 1,
        submissionId: "sub_failed_concurrent",
      });
      const results = await Promise.all([
        completeRemoteAgentNativeDelivery(env, body),
        completeRemoteAgentNativeDelivery(env, {
          ...body,
          callbackAttempt: 2,
        }),
      ]);
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).toHaveBeenCalledOnce();
      expect(results).toContainEqual({
        status: "accepted",
        publishedSignalId: "signal_failure_concurrent",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_failed_concurrent",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_not_completed",
        finalPublicationState: "published",
        publishedSignalId: "signal_failure_concurrent",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps a completed callback retryable after the former attempt ceiling", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_completed_exhausted",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalFailuresBeforeSuccess: 1,
        postSignalId: "signal_publish_failed_notice",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_completed_exhausted",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          callbackAttempt: 5,
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "The finished reply could not be published.",
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publish_failed",
        status: "retryable",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
      expect(env.__spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_completed_exhausted",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.callback_publish_failed",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps concurrent callback publication failures retryable", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_completed_concurrent_exhausted",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalFailuresBeforeSuccess: 2,
        postSignalId: "signal_publish_failed_notice",
      });
      const body = {
        submissionId: "sub_completed_concurrent_exhausted",
        idempotencyKey: "idem_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        callbackAttempt: 5,
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        text: "The finished reply could not be published.",
      };
      const results = await Promise.all([
        completeRemoteAgentNativeDelivery(env, body),
        completeRemoteAgentNativeDelivery(env, body),
      ]);
      expect(results).toEqual(
        expect.arrayContaining([
          {
            reasonCode: "remote_agent.callback_publish_failed",
            status: "retryable",
          },
          {
            reasonCode: "remote_agent.callback_publish_failed",
            status: "retryable",
          },
        ])
      );
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledTimes(2);
      expect(
        env.__spaceStub.rpcPostSignal.mock.calls.filter(
          ([request]) => request.meta?.purpose === REMOTE_AGENT_FAILURE_PURPOSE
        )
      ).toHaveLength(0);
      expect(env.__spaceStub.rpcCloseAgentStream).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_completed_concurrent_exhausted",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.callback_publish_failed",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not replace an undelivered reply with a synthetic failure", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_completed_notice_failed",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        postSignalError: "space still unavailable",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_completed_notice_failed",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          callbackAttempt: 5,
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "The finished reply could not be published.",
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publish_failed",
        status: "retryable",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_completed_notice_failed",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.callback_publish_failed",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps the first persisted final reply id when a callback retry receives a duplicate Space payload", async () => {
    const harness = await createPostgresHarness();
    await seedRemoteAgentSubmitAuthority(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_1",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, {
        finalReplyClaimSignalId: "signal_real_1",
        postSignalId: "signal_ghost_retry",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          submissionId: "sub_1",
          idempotencyKey: "idem_1",
          organizationId: "org_1",
          spaceId: SPACE_ID,
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Done.",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_real_1",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "completed",
        publishedSignalId: "signal_real_1",
      });
    } finally {
      await harness.close();
    }
  });
  it("writes Core-owned failure copy for worker unavailable, runtime policy, and source-missing rejects", async () => {
    const cases = [
      {
        name: "worker unavailable",
        envOptions: {},
        expectedFailureCode: "remote_agent.worker_unavailable",
        expectedText:
          "Center Agent couldn't start this request. Try again. If it keeps happening, open diagnostics in OpenMeld.",
      },
      {
        name: "runtime flag rejected",
        envOptions: { remoteAgentRuntimeEnabled: "false" },
        expectedFailureCode: "remote_agent.runtime_disabled",
        expectedText:
          "Center Agent isn't available right now. Try again in a moment.",
      },
      {
        name: "source missing",
        envOptions: {
          remoteAgentWorker: {
            submitConversationTurn: async () => ({
              submissionId: "sub_unused",
              status: "pending" as const,
              createdAt: 1001,
              accepted: true,
            }),
          },
        },
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            text: " ",
            profileId: null,
            profileKind: null,
          },
        }),
        expectedFailureCode: "remote_agent.source_message_missing",
        expectedText:
          "OpenMeld couldn't find the message that started this request, so Center Agent did not run. Send the request again.",
      },
    ] satisfies Array<{
      expectedFailureCode: string;
      envOptions?: BuildEnvOptions;
      message?: OpenMeldDaemonDispatchQueueMessage;
      name: string;
      expectedText: string;
    }>;
    for (const testCase of cases) {
      const harness = await createPostgresHarness();
      await seedRemoteAgentSubmitAuthority(harness);
      try {
        const env = buildEnv(harness.db, testCase.envOptions);
        await expect(
          submitRemoteAgentNativeDelivery({
            db: harness.db,
            env,
            executionAttemptId: "attempt_1",
            message: testCase.message ?? createDispatchMessage(),
            nowMs: 1000,
            binding: createBinding(),
          })
        ).resolves.toEqual({ shouldAck: true, status: "failed" });
        await expect(
          readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: "idem_1",
          })
        ).resolves.toMatchObject({
          failureCode: testCase.expectedFailureCode,
        });
        expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              actorName: "Codex",
              actorProfileId: AGENT_PROFILE_ID,
              failureStage: "execution",
              noticeType: "terminal_failure",
              reasonCode: testCase.expectedFailureCode,
              text: testCase.expectedText,
            }),
            finalOutcomeAuthority: "remote_agent_native_delivery",
            profile: expect.objectContaining({
              kind: "system",
              profileId: "openmeld-system",
              profileName: "OpenMeld System",
            }),
          })
        );
      } finally {
        await harness.close();
      }
    }
  });
  it("rejects and records an unknown callback submission", async () => {
    const harness = await createPostgresHarness();
    try {
      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          submissionId: "sub_unknown",
          idempotencyKey: "space_1:dispatch_1",
          organizationId: "org_1",
          spaceId: "space_1",
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Done.",
        })
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_unknown_submission",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_unknown",
        })
      ).resolves.toMatchObject({
        status: "callback_rejected",
        failureCode: "remote_agent.callback_unknown_submission",
      });
    } finally {
      await harness.close();
    }
  });
  it("records a stale callback after its delivery already failed", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        spaceId: "space_1",
        profileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        attemptId: "attempt_1",
        idempotencyKey: "space_1:dispatch_1",
        status: "submitted",
      });
      await markRemoteAgentNativeDeliveryFailure({
        db: harness.db,
        failureCode: "remote_agent.admission_timeout",
        idempotencyKey: "space_1:dispatch_1",
        nowMs: 2000,
        status: "failed",
      });
      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          submissionId: "sub_stale",
          idempotencyKey: "space_1:dispatch_1",
          organizationId: "org_1",
          spaceId: "space_1",
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Late result.",
        })
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_unknown_submission",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_stale",
        })
      ).resolves.toMatchObject({
        status: "callback_rejected",
        failureCode: "remote_agent.callback_stale_delivery_already_terminal",
      });
    } finally {
      await harness.close();
    }
  });
  it("publishes a late success after reconciling a retired deadline failure", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        spaceId: SPACE_ID,
        submissionId: "sub_reconciled",
      });
      await expect(
        claimRemoteAgentNativeDeliveryTerminalFailure({
          db: harness.db,
          failureCode: "remote_agent.delivery_expired",
          idempotencyKey: "space_1:dispatch_1",
          nowMs: 2000,
          submissionId: "sub_reconciled",
        })
      ).resolves.toMatchObject({ status: "failed" });
      const env = buildEnv(harness.db, { postSignalId: "signal_late_success" });
      const result = await completeRemoteAgentNativeDelivery(env, {
        submissionId: "sub_reconciled",
        idempotencyKey: "space_1:dispatch_1",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        triggerMessageId: "signal_1",
        dispatchId: "dispatch_1",
        text: "Late result.",
      });
      expect(result).toEqual({
        publishedSignalId: "signal_late_success",
        status: "accepted",
      });
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Late result." })
      );
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_reconciled",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        publishedSignalId: "signal_late_success",
        retiredDeadlineFailureCode: "remote_agent.delivery_expired",
        retiredDeadlineFailurePublishedSignalId: null,
        retiredDeadlineFailureReconciledAtMs: expect.any(Number),
        status: "completed",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects completed callback retries without changing the completed outcome", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        submissionId: "sub_1",
        publishedSignalId: "signal_reply_1",
      });
      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          submissionId: "sub_1",
          idempotencyKey: "space_1:dispatch_1",
          organizationId: "org_1",
          spaceId: "space_1",
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Done again.",
        })
      ).resolves.toEqual({
        status: "duplicate_rejected",
        reasonCode: "remote_agent.callback_completed_submission",
        publishedSignalId: "signal_reply_1",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "completed",
        failureCode: null,
        publishedSignalId: "signal_reply_1",
      });
    } finally {
      await harness.close();
    }
  });
});
async function seedRemoteAgentSubmitAuthority(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await seedRemoteAgentTurnEnvelopeFacts(input);
  await seedCenterAgentDesignation(input);
  await seedCenterAgentTaskAdmissionAuthority(input);
}
async function seedWaitingNativeDeliveryDispatch(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    idempotencyKey?: string;
  } = {}
): Promise<void> {
  const idempotencyKey = input.idempotencyKey ?? "idem_1";
  await harness.query({
    values: [
      idempotencyKey,
      "dispatch_1",
      SPACE_ID,
      "signal_1",
      "client_1",
      AGENT_PROFILE_ID,
      "dispatching",
      900,
      1100,
      1,
      "attempt_1",
    ],
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (
        idempotency_key,
        dispatch_id,
        space_id,
        source_event_id,
        source_client_message_id,
        target_profile_id,
        status,
        first_seen_at_ms,
        last_attempt_at_ms,
        attempt_count,
        latest_attempt_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
  });
  await harness.query({
    values: [
      "attempt_1",
      "dispatch_1",
      idempotencyKey,
      1,
      "waiting_result",
      "task_1",
      AGENT_PROFILE_ID,
      900,
      1000,
    ],
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts" (
        attempt_id,
        dispatch_id,
        idempotency_key,
        attempt_no,
        status,
        task_id,
        target_profile_id,
        created_at_ms,
        started_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
  });
}
async function readDispatchProjection(
  db: PostgresDatabase,
  idempotencyKey: string
): Promise<{
  attemptErrorCode: string | null;
  attemptErrorMessage: string | null;
  attemptStatus: string;
  dispatchStatus: string;
} | null> {
  return await db
    .query<{
      attemptErrorCode: string | null;
      attemptErrorMessage: string | null;
      attemptStatus: string;
      dispatchStatus: string;
    }>({
      ...{
        text: `
        SELECT
          ledger.status AS "dispatchStatus",
          attempt.status AS "attemptStatus",
          attempt.error_code AS "attemptErrorCode",
          attempt.error_message AS "attemptErrorMessage"
        FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
        INNER JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempt
          ON attempt.attempt_id = ledger.latest_attempt_id
        WHERE ledger.idempotency_key = $1
        LIMIT 1
      `,
        values: [],
      },
      values: [idempotencyKey],
    })
    .then((result) => result.rows[0] ?? null);
}
async function seedRunningMemberResearchTask(
  input: Awaited<ReturnType<typeof createPostgresHarness>>,
  taskId: string
) {
  await input.query({
    text: `
      INSERT INTO "openmeld"."center_agent_member_research_batches" (
        id,
        organization_id,
        scope,
        status,
        requested_by_user_id,
        requested_by_member_id,
        requested_by_profile_id,
        requested_by_display_name,
        direct_message_space_id,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        'member_research_batch',
        'org_1',
        'member',
        'running',
        'user_1',
        'member_1',
        '${HUMAN_PROFILE_ID}',
        'Ari',
        '${SPACE_ID}',
        1000,
        1000
      )
    `,
  });
  await input.query({
    text: `
      INSERT INTO "openmeld"."center_agent_member_research_tasks" (
        id,
        batch_id,
        subject_user_id,
        subject_display_name,
        position,
        status,
        failure_code,
        started_at_ms,
        finished_at_ms,
        created_at_ms
      ) VALUES (
        '${taskId}',
        'member_research_batch',
        'user_1',
        'Ari',
        1,
        'running',
        NULL,
        1000,
        NULL,
        1000
      )
    `,
  });
}
async function seedCenterAgentDesignation(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: ["org_1", AGENT_PROFILE_ID, "user_1", 100],
    text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      )
      VALUES ($1, $2, $3, $4)
    `,
  });
}
async function seedCenterAgentTaskAdmissionAuthority(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await input.query({
    values: [
      "binding_1",
      "organization",
      "org_1",
      AGENT_PROFILE_ID,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      "hosted_center_agent",
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      null,
      "enabled_primary",
      100,
      100,
    ],
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        runtime_kind,
        hosted_runtime_identity_json,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
  });
}
async function seedRemoteAgentTurnEnvelopeFacts(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: ["user_1", "Ari", "ari@example.test", 100, 100],
    text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
  });
  await input.query({
    values: ["org_1", "OpenMeld Labs", "openmeld-labs", "{}", 100],
    text: `
      INSERT INTO "openmeld"."organizations" (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
  });
  await input.query({
    values: ["member_1", "org_1", "user_1", "owner", 100],
    text: `
      INSERT INTO "openmeld"."members" (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
  });
  await input.query({
    values: [
      HUMAN_PROFILE_ID,
      "Ari",
      "ari",
      "human",
      null,
      "user_1",
      null,
      "active",
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        organization_id,
        owner_user_id,
        managed_role,
        status,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'migration') ON CONFLICT DO NOTHING`,
  });
  await input.query({
    values: [
      AGENT_PROFILE_ID,
      "Center Agent",
      "center-agent",
      "agent",
      "org_1",
      null,
      "center_agent",
      "active",
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        organization_id,
        owner_user_id,
        managed_role,
        status,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'migration') ON CONFLICT DO NOTHING`,
  });
  await input.query({
    values: [
      SPACE_ID,
      "org_1",
      "private",
      "active",
      "Ari and Center Agent",
      "openmeld_dm_space",
      `${AGENT_PROFILE_ID}:${HUMAN_PROFILE_ID}`,
      100,
      100,
      "projection_1",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        space_name,
        space_purpose,
        direct_message_pair_key,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
  });
}
function createTestMemoryService(
  overrides: Partial<CenterAgentMemoryService> = {}
): CenterAgentMemoryService {
  return {
    deleteSpaceMemory: vi.fn(async () => "deleted" as const),
    deleteMemberMemory: vi.fn(async () => "deleted" as const),
    deleteOrganizationMemory: vi.fn(async () => "deleted" as const),
    recallForOrganization: vi.fn(async () => ({ items: [], truncated: false })),
    recallForTurn: vi.fn(async () => ({ items: [], truncated: false })),
    readOrganizationMemoryPolicy: vi.fn(async () => ({
      organizationMemoryOptIn: false,
      updatedByUserId: null,
    })),
    rememberFactForOrganization: vi.fn(async () => ({
      status: "processing" as const,
    })),
    rememberTurn: vi.fn(async () => undefined),
    setOrganizationMemoryPolicy: vi.fn(async (input) => ({
      organizationMemoryOptIn: input.organizationMemoryOptIn,
      updatedByUserId: input.updatedByUserId,
    })),
    ...overrides,
  };
}
function createMemoryAdapter(input: {
  searchText: string;
}): CenterAgentMemoryAdapter {
  return {
    addEpisode: vi.fn(async () => ({
      episodeId: "episode_1",
      processed: false,
    })),
    deleteMemberUser: vi.fn(async () => "deleted" as const),
    deleteOrganizationGraph: vi.fn(async () => "deleted" as const),
    ensureMemberUser: vi.fn(async () => undefined),
    ensureOrganizationGraph: vi.fn(async () => undefined),
    search: vi.fn(async (searchInput) => [
      {
        captureMethod: "automatic_turn" as const,
        occurredAtMs: 900,
        source: "ca_dm" as const,
        sourceConversationId: "dm_1",
        sourceMessageId: "message_1",
        subject: searchInput.ref.subject.kind,
        text: input.searchText,
      },
    ]),
  };
}
function createMemoryRepository(input: {
  organizationMemoryOptIn: boolean;
}): CenterAgentMemoryRepository {
  return {
    upsertSpaceSubject: vi.fn(async (value) =>
      buildCenterAgentSpaceMemoryRef(value)
    ),
    beginSpaceDeletion: vi.fn(async () => undefined),
    isSpaceSubjectActive: vi.fn(async () => false),
    markSpaceDeleted: vi.fn(async () => false),
    markSpaceDeleteFailed: vi.fn(async () => undefined),
    readActiveSubjects: vi.fn(async (readInput) => [
      ...(readInput.speakerMember
        ? [
            {
              ...buildCenterAgentMemberMemoryRef({
                organizationId: readInput.organizationId,
                ...readInput.speakerMember,
              }),
              updatedAtMs: 1,
            },
          ]
        : []),
      ...(input.organizationMemoryOptIn
        ? [
            {
              ...buildCenterAgentOrganizationMemoryRef(readInput),
              updatedAtMs: 1,
            },
          ]
        : []),
    ]),
    markMemberDeleted: vi.fn(async () => true),
    markMemberDeleteFailed: vi.fn(async () => undefined),
    markOrganizationDeleted: vi.fn(async () => true),
    markOrganizationDeleteFailed: vi.fn(async () => undefined),
    readPolicy: vi.fn(async () => ({
      organizationMemoryOptIn: input.organizationMemoryOptIn,
      updatedByUserId: null,
    })),
    upsertPolicy: vi.fn(async (policyInput) => ({
      organizationMemoryOptIn: policyInput.organizationMemoryOptIn,
      updatedByUserId: policyInput.updatedByUserId,
    })),
    upsertMemberSubject: vi.fn(async (subjectInput) =>
      buildCenterAgentMemberMemoryRef(subjectInput)
    ),
    upsertOrganizationSubject: vi.fn(async (subjectInput) =>
      buildCenterAgentOrganizationMemoryRef(subjectInput)
    ),
  };
}
async function deleteCenterAgentDesignation(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: ["org_1"],
    text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
  });
}
type TestDispatchQueue = NonNullable<
  CoreBindings["OPENMELD_DAEMON_DISPATCH_QUEUE"]
>;
type TestDispatchQueueMessage = Parameters<TestDispatchQueue["send"]>[0];
type TestDispatchQueueSend = (
  message: TestDispatchQueueMessage,
  options?: Parameters<TestDispatchQueue["send"]>[1]
) => Promise<unknown>;
type TestDeadlineProbeQueueSend = (
  message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  options?: Parameters<TestDispatchQueue["send"]>[1]
) => Promise<unknown>;
type BuildEnvOptions = {
  authWorker?: CoreBindings["OPENMELD_AUTH_WORKER"];
  deadlineProbeQueueSend?: TestDeadlineProbeQueueSend;
  dispatchQueueSend?: TestDispatchQueueSend;
  enforceSignalTextLimit?: boolean;
  finalReplyClaimSignalId?: string | null;
  listSignalsError?: Error;
  postSignalError?: Error | string;
  postSignalFailuresBeforeSuccess?: number;
  postSignalId?: string;
  remoteAgentBlockedOrganizationIds?: string;
  remoteAgentRuntimeEnabled?: string;
  remoteAgentWorker?: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"];
  slackBotToken?: string;
  spaceGuide?: string | (() => string | undefined);
  sourceSignal?: SignalEnvelope;
  sourceSignals?: SignalEnvelope[];
  spaceFileContent?: unknown;
  webAppUrl?: string;
};
type TestSpaceStub = {
  rpcReadFinalReplyClaimOutcome: ReturnType<typeof vi.fn>;
  rpcAuthorizeNativeWakeAdmission: ReturnType<typeof vi.fn>;
  rpcReadWakeStopIntent: Mock<
    (
      query: Parameters<typeof readNativeSpaceWakeStopIntent>[0]["query"]
    ) => Promise<unknown>
  >;
  rpcResolveNativeReplyPlacement: ReturnType<typeof vi.fn>;
  rpcPostExecutionRecoveryNoticeSignal: ReturnType<typeof vi.fn>;
  rpcCloseAgentStream: ReturnType<typeof vi.fn>;
  rpcGetMeta: ReturnType<typeof vi.fn>;
  rpcGetViewerMembership: ReturnType<typeof vi.fn>;
  rpcListDispatchConversationContinuitySignalsResult: ReturnType<typeof vi.fn>;
  rpcListSignalsResult: ReturnType<typeof vi.fn>;
  rpcPostSignal: ReturnType<typeof vi.fn>;
  rpcPostSignalOnceByClientMessageId: ReturnType<typeof vi.fn>;
  rpcPostWakeStop?: ReturnType<typeof vi.fn>;
  rpcPostSystemNoticeSignal: ReturnType<typeof vi.fn>;
  rpcReadFinalReplyClaimSignalId: ReturnType<typeof vi.fn>;
  rpcResolveSpaceFileContent: ReturnType<typeof vi.fn>;
};
function buildEnv(
  db: PostgresDatabase,
  options: BuildEnvOptions = {}
): CoreBindings & {
  __spaceStub: TestSpaceStub;
} {
  let postSignalAttempts = 0;
  const postSignal = (input: {
    text?: string;
    messageEnvelope?: { text?: string };
  }) => {
    postSignalAttempts += 1;
    if (
      options.postSignalFailuresBeforeSuccess &&
      postSignalAttempts <= options.postSignalFailuresBeforeSuccess
    ) {
      throw new Error("space temporarily unavailable");
    }
    if (options.postSignalError) {
      throw typeof options.postSignalError === "string"
        ? new Error(options.postSignalError)
        : options.postSignalError;
    }
    if (options.enforceSignalTextLimit) {
      const text = String(input?.text ?? "");
      const envelopeText = String(input?.messageEnvelope?.text ?? "");
      if (
        text.length > MAX_TEXT_LENGTH ||
        envelopeText.length > MAX_TEXT_LENGTH
      ) {
        throw new Error("text exceeds MAX_TEXT_LENGTH");
      }
    }
    return createSignalEnvelope(options.postSignalId ?? "signal_reply_1");
  };
  const listSignalsResult = (input: {
    afterCount?: number;
    aroundSignalId?: string;
    beforeCount?: number;
    limit?: number;
  }) => {
    if (options.listSignalsError) {
      throw options.listSignalsError;
    }
    const semantics = resolveListSignalsReadQuerySemantics({
      recentOnly: false,
      hasExplicitLimit: input.limit !== undefined,
      limit: input.limit ?? null,
      afterSignalId: null,
      aroundSignalId: input.aroundSignalId ?? null,
      beforeCount: input.beforeCount ?? null,
      afterCount: input.afterCount ?? null,
    });
    if (!semantics.ok) {
      return {
        ok: false,
        status: 400,
        message: semantics.issues[0]?.message ?? "Invalid query",
      };
    }
    return {
      ok: true,
      value: {
        signals: options.sourceSignals ?? [
          options.sourceSignal ?? {
            ...createSignalEnvelope("signal_1"),
            data: { text: "Please help." },
          },
        ],
      },
    };
  };
  const spaceStub: TestSpaceStub = {
    rpcReadFinalReplyClaimOutcome: vi.fn(async () => ({
      outcome: null,
      signalId: null,
    })),
    rpcAuthorizeNativeWakeAdmission: vi.fn(
      async (query) => await spaceStub.rpcReadWakeStopIntent(query)
    ),
    rpcReadWakeStopIntent: vi.fn(async () => ({
      status: "not_requested" as const,
    })),
    rpcResolveNativeReplyPlacement: vi.fn(
      async (input: ResolveNativeReplyPlacementInput) => ({
        dispatchId: input.dispatchId,
        sourceSignalId: input.sourceSignalId,
        profileId: input.profileId,
        threadContext: THREAD_CONTEXT,
        locked: input.lock,
      })
    ),
    rpcCloseAgentStream: vi.fn(async () => null),
    rpcGetMeta: vi.fn(() => {
      const guide =
        typeof options.spaceGuide === "function"
          ? options.spaceGuide()
          : options.spaceGuide;
      return {
        spaceId: SPACE_ID,
        organizationId: "org_1",
        visibility: "private" as const,
        ...(guide ? { guide } : {}),
      };
    }),
    rpcGetViewerMembership: vi.fn(() => ({
      activeMemberProfiles: [
        {
          lastEnteredAt: null,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent" as const,
          profileName: "Codex",
        },
      ],
      preferredOpenProfileId: AGENT_PROFILE_ID,
      spaceId: SPACE_ID,
    })),
    rpcListDispatchConversationContinuitySignalsResult:
      vi.fn(listSignalsResult),
    rpcListSignalsResult: vi.fn(listSignalsResult),
    rpcPostSignal: vi.fn(postSignal),
    rpcPostSignalOnceByClientMessageId: vi.fn(postSignal),
    rpcPostExecutionRecoveryNoticeSignal: vi.fn((input) => {
      signalSystemNoticeDataSchema.parse(input.data);
      return {
        publishedSignalId: "recovered-signal",
        status: "published" as const,
      };
    }),
    rpcPostSystemNoticeSignal: vi.fn((input) => {
      if (options.postSignalError) {
        throw typeof options.postSignalError === "string"
          ? new Error(options.postSignalError)
          : options.postSignalError;
      }
      return {
        ...createSignalEnvelope(options.postSignalId ?? "signal_reply_1"),
        type: "signal.system_notice" as const,
        data: input.data,
      };
    }),
    rpcReadFinalReplyClaimSignalId: vi.fn(async () => ({
      signalId: options.finalReplyClaimSignalId ?? null,
    })),
    rpcResolveSpaceFileContent: vi.fn(() => {
      if (!options.spaceFileContent) {
        throw new Error("space_file.not_found");
      }
      return Promise.resolve(options.spaceFileContent);
    }),
  };
  return {
    __spaceStub: spaceStub,
    OPENMELD_POSTGRESQL: postgresTestBinding(db),
    SLACK_OPENMELD_BOT_TOKEN: options.slackBotToken,
    OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS:
      options.remoteAgentBlockedOrganizationIds ?? "",
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED:
      options.remoteAgentRuntimeEnabled ?? "true",
    ...(options.webAppUrl ? { WEB_APP_URL: options.webAppUrl } : {}),
    OPENMELD_DAEMON_DISPATCH_QUEUE: createTestDispatchQueue({
      deadlineProbeSend: options.deadlineProbeQueueSend,
      send: options.dispatchQueueSend,
    }),
    OPENMELD_REMOTE_AGENT_WORKER: options.remoteAgentWorker,
    OPENMELD_AUTH_WORKER:
      options.authWorker ??
      ({
        resolveOrganizationAccountIdentity: (request) => {
          const selector = request.account;
          const matchesTestAccount =
            (selector?.kind === "user_id" && selector.userId === "user_1") ||
            (selector?.kind === "human_profile_id" &&
              selector.profileId === HUMAN_PROFILE_ID) ||
            (selector?.kind === "email" &&
              selector.email === "ari@example.test");
          return Promise.resolve({
            account: matchesTestAccount
              ? {
                  defaultHumanProfile: {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: "Ari",
                  },
                  displayName: "Ari",
                  email: "ari@example.test",
                  membership: { memberId: "member_1", role: "owner" },
                  userId: "user_1",
                }
              : null,
            ok: true,
            organization: {
              id: request.organizationId,
              memberCount: 1,
              name: "OpenMeld Labs",
              personal: false,
              slug: "openmeld-labs",
            },
          });
        },
        resolveProfileById: async () => ({
          ok: true,
          profile: {
            ownerUserId: "user_1",
            profileHandle: "codex",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Codex",
            status: "active",
          },
        }),
      } satisfies NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>),
    OPENMELD_SPACES: {
      get: () => spaceStub,
      idFromString: () => ({ toString: () => SPACE_ID }),
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  } as CoreBindings & {
    __spaceStub: TestSpaceStub;
  };
}
function createTestDispatchQueue(input: {
  deadlineProbeSend?: TestDeadlineProbeQueueSend;
  send?: TestDispatchQueueSend;
}): NonNullable<CoreBindings["OPENMELD_DAEMON_DISPATCH_QUEUE"]> {
  const emptyMetrics = { backlogBytes: 0, backlogCount: 0 };
  const send = input.send ?? (async () => undefined);
  const sendMessage = async (
    message: TestDispatchQueueMessage,
    options?: Parameters<TestDispatchQueue["send"]>[1]
  ) => {
    if (input.deadlineProbeSend) {
      await input.deadlineProbeSend(
        remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema.parse(message),
        options
      );
      return;
    }
    await send(message, options);
  };
  return {
    metrics: async () => emptyMetrics,
    send: async (message, options) => {
      await sendMessage(message, options);
      return { metadata: { metrics: emptyMetrics } };
    },
    sendBatch: async (messages, options) => {
      for (const message of messages) {
        await sendMessage(message.body, {
          ...(options?.delaySeconds === undefined
            ? {}
            : { delaySeconds: options.delaySeconds }),
          ...(message.contentType === undefined
            ? {}
            : { contentType: message.contentType }),
          ...(message.delaySeconds === undefined
            ? {}
            : { delaySeconds: message.delaySeconds }),
        });
      }
      return { metadata: { metrics: emptyMetrics } };
    },
  };
}
function createSignalEnvelope(id: string, text = "Done."): SignalEnvelope {
  return {
    v: 1,
    id,
    profile: {
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileName: "Codex",
    },
    spaceId: SPACE_ID,
    ts: Date.now(),
    type: "signal.text",
    data: { text },
  } as unknown as SignalEnvelope;
}
function createCenterAgentDmTurnEnvelope(): RemoteAgentTurnEnvelope {
  return {
    centerAgent: {
      profileHandle: "center-agent",
      profileName: "Center Agent",
    },
    interactionEnvironment: "requester_private",
    organization: {
      id: "org_1",
      memberCount: 1,
      name: "OpenMeld Labs",
      personal: false,
    },
    sender: {
      displayName: "Ari",
      id: "member_1",
      kind: "member",
      ownerUserId: "user_1",
      profileId: HUMAN_PROFILE_ID,
      role: "owner",
      verified: true,
    },
    space: {
      id: SPACE_ID,
      isCenterAgentDm: true,
      kind: "dm",
      name: "Ari and Center Agent",
    },
    trigger: { source: "space_wake" },
  };
}
function createSlackTurnEnvelope(): RemoteAgentTurnEnvelope {
  return {
    sender: {
      kind: "member",
      id: "member_1",
      displayName: "Ari",
      ownerUserId: "user_1",
      profileId: HUMAN_PROFILE_ID,
      role: "owner",
      verified: true,
    },
    space: {
      id: "slack:T123:C123:1700000000.000001",
      name: "Slack thread",
      kind: "space",
      isCenterAgentDm: false,
    },
    organization: {
      id: "org_1",
      name: "OpenMeld Labs",
      personal: false,
      memberCount: 1,
    },
    centerAgent: {
      profileName: "Center Agent",
      profileHandle: "center-agent",
    },
    trigger: {
      source: "slack",
    },
  };
}
function createMessageChannelTurnEnvelope(
  input: {
    conversationId?: string;
    interactionEnvironment?: NonNullable<
      RemoteAgentTurnEnvelope["interactionEnvironment"]
    >;
  } = {}
): RemoteAgentTurnEnvelope {
  const conversationId =
    input.conversationId ?? "lark:connection_1:chat_1:message_1";
  return {
    sender: {
      kind: "member",
      id: "member_1",
      displayName: "Ari",
      ownerUserId: "user_1",
      profileId: HUMAN_PROFILE_ID,
      role: "owner",
      verified: true,
    },
    space: {
      id: conversationId,
      name: "Lark conversation",
      kind: "space",
      isCenterAgentDm: false,
    },
    organization: {
      id: "org_1",
      name: "OpenMeld Labs",
      personal: false,
      memberCount: 1,
    },
    centerAgent: {
      profileName: "Center Agent",
      profileHandle: "center-agent",
    },
    ...(input.interactionEnvironment
      ? { interactionEnvironment: input.interactionEnvironment }
      : {}),
    trigger: {
      source: "message_channel",
      provider: "lark",
      connectionId: "connection_1",
      conversationId,
    },
    channelContext: {
      provider: "lark",
      conversationId,
      currentMessageId: "message_current_1",
      sync: { mode: "snapshot", status: "complete" },
      messages: [],
    },
  };
}
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55_296 && code <= 56_319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56_320 && next <= 57_343)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 56_320 && code <= 57_343) {
      return true;
    }
  }
  return false;
}
function createBinding(): {
  bindingId: string;
  modelRoute: CenterAgentModelRoute;
  organizationId: string;
  ownerUserId: string;
} {
  return {
    bindingId: "binding_1",
    modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
    organizationId: "org_1",
    ownerUserId: "user_1",
  };
}
function createDispatchMessage(
  overrides: Partial<OpenMeldDaemonDispatchQueueMessage> = {}
): OpenMeldDaemonDispatchQueueMessage {
  return {
    v: 2,
    autoRelayDepth: 0,
    dispatchChainId: "chain_1",
    dispatchContractVersion: 2,
    dispatchId: "dispatch_1",
    dispatchPolicy: "mention_only",
    dispatchSnapshot: {
      dispatchPolicy: "mention_only",
      ruleId: "rule_1",
      ruleReason: "test",
      ruleSource: "registry",
      targetBindingEnabled: true,
      targetBindingState: "bound",
    },
    enqueuedAtMs: 900,
    controllerSnapshot: {
      agentControllerRef: null,
      targetBindingEnabled: true,
      targetBindingState: "bound",
    },
    contextIdMappingSpec: null,
    dispatchRulesSnapshot: {
      dispatchPolicy: "mention_only",
      ruleId: "rule_1",
      ruleReason: "test",
      ruleSource: "registry",
    },
    idempotencyKey: "idem_1",
    ruleId: "rule_1",
    ruleReason: "test",
    ruleSource: "registry",
    sourceClientMessageId: "client_1",
    sourceEventId: "signal_1",
    sourceMessageEnvelope: {
      activationTargets: [AGENT_PROFILE_ID],
      referenceTargets: [],
      text: "@Codex Please help.",
    },
    sourceProfileNameSnapshot: "Ari",
    sourceSignalSnapshot: {
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      text: "Please help.",
    },
    spaceId: SPACE_ID,
    taskId: "task_1",
    targetProfileId: AGENT_PROFILE_ID,
    targetProfileNameSnapshot: "Codex",
    transportMode: null,
    visitedProfileIds: [],
    visitedProfileIdsHash: "hash_1",
    ...overrides,
  };
}
function createDeadlineProbe(input: {
  idempotencyKey: string;
  submissionId: string;
}): RemoteAgentNativeDeliveryDeadlineProbeQueueMessage {
  return {
    v: 3,
    kind: "remote_agent_native_delivery_deadline_probe",
    submissionId: input.submissionId,
    idempotencyKey: input.idempotencyKey,
    organizationId: "org_1",
    spaceId: SPACE_ID,
    dispatchId: "dispatch_1",
    enqueuedAtMs: 1000,
    deadlineAtMs: 1000 + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
  };
}
function requireAdmissionProbe(
  probes: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage[],
  kind: "retry" | "watchdog",
  attempt: number
): RemoteAgentNativeDeliveryDeadlineProbeQueueMessage {
  const admissionProbes = probes.filter((candidate) =>
    candidate.submissionId.startsWith("admission_watchdog:")
  );
  const index = kind === "watchdog" ? (attempt - 1) * 2 : (attempt - 2) * 2 + 1;
  const probe = admissionProbes[index];
  if (!probe) {
    throw new Error(`expected admission ${kind} probe for attempt ${attempt}`);
  }
  return probe;
}
async function stageAmbiguousTaskContinuationAdmission(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  idempotencyKey: string;
  replyLanguageTag?: string;
  subscriptionId?: string;
}) {
  await createAcceptedDelivery({
    db: input.db,
    idempotencyKey: `parent:${input.idempotencyKey}`,
    modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
    onBehalfOfProfileId: HUMAN_PROFILE_ID,
    onBehalfOfUserId: "user_1",
    spaceId: SPACE_ID,
    submissionId: `parent-submission:${input.idempotencyKey}`,
    threadContext: THREAD_CONTEXT,
  });
  const observerDelivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: `parent-submission:${input.idempotencyKey}`,
  });
  if (!observerDelivery) {
    throw new Error("expected task continuation parent fixture");
  }
  const subscriptionId =
    input.subscriptionId ?? `subscription:${input.idempotencyKey}`;
  const watchedTask = {
    deliveryId: `child:${input.idempotencyKey}`,
    kind: "native_delivery" as const,
    v: 1 as const,
  };
  if (input.replyLanguageTag) {
    await registerAgentTaskCompletionSubscription({
      completionCondition: "terminal",
      continuation: {
        kind: "resume_task_watch",
        watchId: "watch-language",
        instruction: "Continue the request.",
        replyLanguageTag: input.replyLanguageTag,
      },
      db: input.db,
      idempotencyKey: `register:${subscriptionId}`,
      nowMs: 1000,
      observerTask: {
        kind: "native_delivery",
        deliveryId: observerDelivery.deliveryId,
        v: 1,
      },
      organizationId: "org_1",
      subscriptionId,
      watchedTask,
    });
    await recordAgentTaskTerminalOutcome({
      db: input.db,
      nowMs: 1050,
      task: watchedTask,
      outcome: {
        errorCode: null,
        eventId: "terminal-task-result",
        occurredAtMs: 1050,
        publishedSignalId: "signal-task-result",
        status: "succeeded",
      },
    });
    await claimReadyAgentTaskCompletionSubscription({
      db: input.db,
      claimId: "language-claim",
      claimLeaseMs: 30_000,
      nowMs: 1060,
      subscriptionId,
    });
  }
  let submissionError: unknown;
  try {
    await submitRemoteAgentTaskContinuationDelivery({
      db: input.db,
      env: input.env,
      idempotencyKey: input.idempotencyKey,
      instruction: "Continue after the exact task.",
      replyLanguageTag: input.replyLanguageTag,
      isAuthorized: async () => true,
      nowMs: 1100,
      observerDelivery,
      outcome: {
        errorCode: null,
        eventId: "terminal-task-result",
        occurredAtMs: 1050,
        publishedSignalId: "signal-task-result",
        status: "succeeded",
      },
      settlementNowMs: () => 1200,
      subscriptionId,
      watchedTask,
      watchId: `watch:${input.idempotencyKey}`,
    });
  } catch (error) {
    submissionError = error;
  }
  if (
    !(
      submissionError instanceof Error &&
      submissionError.message.includes(
        "remote_agent.task_continuation.submit_outcome_unknown"
      )
    )
  ) {
    throw new Error("expected an ambiguous task continuation admission", {
      cause: submissionError,
    });
  }
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  if (!delivery) {
    throw new Error("expected staged task continuation delivery");
  }
  return delivery;
}
function createFailedCallbackBody(input: {
  callbackAttempt: number;
  submissionId: string;
}) {
  return {
    submissionId: input.submissionId,
    idempotencyKey: "idem_1",
    organizationId: "org_1",
    spaceId: SPACE_ID,
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    callbackAttempt: input.callbackAttempt,
    triggerMessageId: "signal_1",
    dispatchId: "dispatch_1",
    status: "failed" as const,
    failureCode: "remote_agent.turn_not_completed",
    failureMessage:
      "Remote Agent could not finish this request. Please try again or open diagnostics.",
  };
}
async function createAcceptedDelivery(input: {
  db: PostgresDatabase;
  conversationKind?: "message_channel" | "space" | "slack";
  personalAgent?: boolean;
  routineRunId?: string;
  routineNameSnapshot?: string;
  deliveryId?: string;
  dispatchId?: string;
  idempotencyKey: string;
  messageChannelLocator?: MessageChannelConversationLocator | null;
  modelRoute?: CenterAgentModelRoute;
  onBehalfOfDisplayName?: string | null;
  onBehalfOfProfileId?: string | null;
  onBehalfOfUserId?: string | null;
  providerPublicationIdempotencyKey?: string | null;
  slackChannelId?: string | null;
  slackTeamId?: string | null;
  slackThreadTs?: string | null;
  sourceClientMessageId?: string | null;
  spaceId?: string;
  submissionId: string;
  threadContext?: OpenMeldDaemonDispatchQueueMessage["threadContext"];
  triggerMessageId?: string;
  triggerText?: string | null;
  turnEnvelope?: RemoteAgentTurnEnvelope;
}): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    db: input.db,
    deliveryId: input.deliveryId,
    nowMs: 1000,
    organizationId: "org_1",
    conversationKind: input.conversationKind,
    ...(input.personalAgent
      ? {
          controllerNormalizationSnapshot: {
            bindingUpdatedAtMs: 1000,
            storedAgentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            storedAgentControllerRefStatus: "canonical" as const,
          },
        }
      : {}),
    routineRunId: input.routineRunId,
    routineNameSnapshot: input.routineNameSnapshot,
    spaceId: input.spaceId ?? "space_1",
    profileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: input.triggerMessageId ?? "signal_1",
    sourceClientMessageId: input.sourceClientMessageId ?? null,
    triggerText: input.triggerText ?? null,
    dispatchId: input.dispatchId ?? "dispatch_1",
    attemptId: "attempt_1",
    idempotencyKey: input.idempotencyKey,
    messageChannelLocator: input.messageChannelLocator ?? null,
    onBehalfOfDisplayName: input.onBehalfOfDisplayName ?? null,
    onBehalfOfProfileId: input.onBehalfOfProfileId ?? null,
    onBehalfOfUserId: input.onBehalfOfUserId ?? null,
    providerPublicationIdempotencyKey:
      input.providerPublicationIdempotencyKey ?? null,
    slackChannelId: input.slackChannelId ?? null,
    slackTeamId: input.slackTeamId ?? null,
    slackThreadTs: input.slackThreadTs ?? null,
    status: "submitted",
    threadContext: input.threadContext ?? null,
  });
  if (input.modelRoute || input.turnEnvelope) {
    await persistTestCenterAgentWorkerSubmitRequest({
      bindingId: "binding_1",
      db: input.db,
      dispatchId: input.dispatchId ?? "dispatch_1",
      idempotencyKey: input.idempotencyKey,
      modelRoute: input.modelRoute,
      spaceId: input.spaceId ?? "space_1",
      triggerMessageId: input.triggerMessageId ?? "signal_1",
      turnEnvelope: input.turnEnvelope,
    });
  }
  await markRemoteAgentNativeDeliveryAck({
    db: input.db,
    nowMs: 1100,
    idempotencyKey: input.idempotencyKey,
    submissionId: input.submissionId,
    workerRequestId: "req_1",
    accepted: true,
  });
}
async function persistTestCenterAgentWorkerSubmitRequest(input: {
  bindingId: string;
  conversationId?: string;
  db: PostgresDatabase;
  dispatchId: string;
  idempotencyKey: string;
  modelRoute?: CenterAgentModelRoute;
  requestVersion?: 2 | 4;
  requestTimeContext?: RemoteAgentTurnEnvelope["requestTimeContext"];
  spaceId: string;
  triggerMessageId: string;
  turnEnvelope?: RemoteAgentTurnEnvelope;
}): Promise<void> {
  const logicalConversationId = input.conversationId ?? input.spaceId;
  await persistRemoteAgentWorkerSubmitRequest({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: 1050,
    workerSubmitRequest: remoteAgentWorkerSubmitTurnRequestSchema.parse({
      agentProfileId: AGENT_PROFILE_ID,
      agentProfileOwnerUserId: "center-agent-owner",
      author: {
        displayName: "Ari",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      bindingId: input.bindingId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      dispatchId: input.dispatchId,
      idempotencyKey: input.idempotencyKey,
      messages: [{ content: "Coordinate this task.", role: "user" }],
      modelRoute: input.modelRoute ?? TEST_CENTER_AGENT_MODEL_ROUTE,
      onBehalfOf: {
        displayName: "Ari",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      organizationId: "org_1",
      organizationSkillReleases: [],
      sourceClientMessageId: null,
      spaceId: input.spaceId,
      triggerMessageId: input.triggerMessageId,
      turnEnvelope: input.turnEnvelope ?? {
        ...(input.requestTimeContext
          ? { requestTimeContext: input.requestTimeContext }
          : {}),
        centerAgent: {
          profileHandle: "center-agent",
          profileName: "Center Agent",
        },
        organization: {
          id: "org_1",
          memberCount: 1,
          name: "OpenMeld Labs",
          personal: false,
        },
        sender: {
          displayName: "Ari",
          id: "member_1",
          kind: "member",
          ownerUserId: "user_1",
          profileId: HUMAN_PROFILE_ID,
          role: "owner",
          verified: true,
        },
        space: {
          id: input.spaceId,
          isCenterAgentDm: false,
          kind: "space",
          name: "Test space",
        },
        trigger: { source: "space_wake" },
      },
      ...(input.requestVersion === 4
        ? {
            conversationId: logicalConversationId,
            runtimeConversation: {
              generation: 0,
              id: buildRemoteAgentRuntimeConversationId({
                generation: 0,
                logicalConversationId,
                organizationId: "org_1",
              }),
            },
            v: 4 as const,
          }
        : { v: 2 as const }),
    }),
  });
}
function createExecutionRecoveryStorage() {
  const records = new Map<string, unknown>();
  let transactionTail = Promise.resolve();
  return {
    transaction<T>(
      run: (transaction: {
        get<Value>(key: string): Promise<Value | undefined>;
        put<Value>(key: string, value: Value): Promise<void>;
      }) => Promise<T>
    ): Promise<T> {
      const result = transactionTail.then(() =>
        run({
          get: async <Value>(key: string) =>
            records.get(key) as Value | undefined,
          put: <Value>(key: string, value: Value) => {
            records.set(key, value);
            return Promise.resolve();
          },
        })
      );
      transactionTail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
}
async function createAcceptedContinuationObserver(input: {
  conversationKind: "message_channel" | "slack" | "space";
  db: PostgresDatabase;
  idempotencyKey: string;
  messageChannelLocator?: MessageChannelConversationLocator;
  modelRoute?: CenterAgentModelRoute;
  providerPublicationIdempotencyKey?: string;
  requestVersion?: 2 | 4;
  slackChannelId?: string;
  slackTeamId?: string;
  slackThreadTs?: string;
  submissionId: string;
  triggerMessageId: string;
  turnEnvelope: RemoteAgentTurnEnvelope;
}) {
  const logicalConversationId = `parent-conversation:${input.idempotencyKey}`;
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId: "binding_1",
    conversationKind: input.conversationKind,
    db: input.db,
    dispatchId: `dispatch:${input.idempotencyKey}`,
    idempotencyKey: input.idempotencyKey,
    messageChannelLocator: input.messageChannelLocator ?? null,
    nowMs: 900,
    onBehalfOfDisplayName: "Ari",
    onBehalfOfProfileId: HUMAN_PROFILE_ID,
    onBehalfOfUserId: "user_1",
    organizationId: "org_1",
    profileId: AGENT_PROFILE_ID,
    providerPublicationIdempotencyKey:
      input.providerPublicationIdempotencyKey ?? null,
    slackChannelId: input.slackChannelId ?? null,
    slackTeamId: input.slackTeamId ?? null,
    slackThreadTs: input.slackThreadTs ?? null,
    spaceId: input.turnEnvelope.space.id,
    status: "submitted",
    threadContext: null,
    triggerMessageId: input.triggerMessageId,
    triggerText: "Coordinate this task.",
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: 920,
    workerSubmitRequest: remoteAgentWorkerSubmitTurnRequestSchema.parse({
      agentProfileId: AGENT_PROFILE_ID,
      agentProfileOwnerUserId: "center-agent-owner",
      author: {
        displayName: "Ari",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      bindingId: "binding_1",
      dispatchId: `dispatch:${input.idempotencyKey}`,
      idempotencyKey: input.idempotencyKey,
      messages: [{ content: "Coordinate this task.", role: "user" }],
      onBehalfOf: {
        displayName: "Ari",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      organizationId: "org_1",
      organizationSkillReleases: [],
      sourceClientMessageId: null,
      spaceId: input.turnEnvelope.space.id,
      triggerMessageId: input.triggerMessageId,
      turnEnvelope: input.turnEnvelope,
      ...buildTestParentWorkerProtocol({
        logicalConversationId,
        modelRoute: input.modelRoute,
        requestVersion: input.requestVersion,
      }),
    }),
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: 950,
    submissionId: input.submissionId,
    workerRequestId: `request:${input.idempotencyKey}`,
  });
  const observer = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (!observer) {
    throw new Error("expected continuation observer fixture");
  }
  return observer;
}
function buildTestParentWorkerProtocol(input: {
  logicalConversationId: string;
  modelRoute?: CenterAgentModelRoute;
  requestVersion?: 2 | 4;
}) {
  if (input.requestVersion === 4) {
    return {
      conversationId: input.logicalConversationId,
      modelRoute: input.modelRoute ?? TEST_CENTER_AGENT_MODEL_ROUTE,
      runtimeConversation: {
        generation: 0,
        id: buildRemoteAgentRuntimeConversationId({
          generation: 0,
          logicalConversationId: input.logicalConversationId,
          organizationId: "org_1",
        }),
      },
      v: 4 as const,
    };
  }
  if (input.modelRoute) {
    return { modelRoute: input.modelRoute, v: 2 as const };
  }
  return { v: 1 as const };
}
