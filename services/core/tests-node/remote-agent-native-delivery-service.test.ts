import { MAX_TEXT_LENGTH, type SignalEnvelope } from "@openmeld/protocol";
import {
  buildAgentTaskKey,
  buildRemoteAgentRuntimeConversationId,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_FAILURE_PURPOSE,
  REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS,
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_MAX_ATTEMPTS,
  remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
  resolveListSignalsReadQuerySemantics,
} from "@openmeld/schemas";
import type {
  CenterAgentModelRoute,
  MessageChannelConversationLocator,
  OpenMeldDaemonDispatchQueueMessage,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  readAgentTaskCompletionSubscription,
  readAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import { requireCenterAgentContinuationParent } from "../src/center-agent/application/center-agent-delegation-service";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS,
  type CenterAgentMemoryAdapter,
  type CenterAgentMemoryRepository,
} from "../src/center-agent-memory/contract";
import {
  type CenterAgentMemoryService,
  createCenterAgentMemoryService,
} from "../src/center-agent-memory/memory-service";
import {
  appendCenterAgentTaskEvent,
  buildCenterAgentTaskReplacementStopIdempotencyKey,
  createCenterAgentTask,
  createCenterAgentTaskAttempt,
  listCenterAgentTaskEvents,
  readCenterAgentTask,
  requestCenterAgentTaskStop,
  transitionCenterAgentTaskAttempt,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import { listRecentDispatchLedgerEntriesForSpace } from "../src/dispatch/infrastructure/d1/dispatch-ledger-d1";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeCoordinatorClient from "../src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import {
  executeHostedExecutionRecovery,
  inspectHostedExecutionRecovery,
} from "../src/execution-recovery/application/hosted-execution-recovery-coordinator";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import { REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS } from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  requestRemoteAgentNativeDeliveryStop,
  stopRemoteAgentNativeDelivery,
} from "../src/remote-agent/application/native-delivery-cancellation-service";
import {
  completeRemoteAgentNativeDelivery,
  processRemoteAgentNativeDeliveryDeadlineProbe,
  reconcileRemoteAgentRetainedResultPublication,
  retryMissingRemoteAgentAcceptedDeliveryProbes,
  retryPendingCenterAgentTaskTerminalProjections,
  submitRemoteAgentCenterAgentTaskTurn,
  submitRemoteAgentExecutionRecoveryTurn,
  submitRemoteAgentNativeDelivery,
  submitRemoteAgentSlackNativeDelivery,
  submitRemoteAgentTaskContinuationDelivery,
} from "../src/remote-agent/application/native-delivery-service";
import { attachCenterAgentMemoryToTurnEnvelope } from "../src/remote-agent/application/remote-agent-memory-context";
import {
  claimRemoteAgentNativeDeliveryTerminalFailure,
  markRemoteAgentCallbackPublishFailure,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  markRemoteAgentNativeDeliveryDeadlineProbeEnqueued,
  markRemoteAgentNativeDeliveryFailure,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  rpcExecuteExecutionRecovery,
  rpcInspectExecutionRecovery,
} from "../src/rpc/methods";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../src/runtime-transport/application/runtime-coordinator-authority";
import { createSpaceBootstrapTimingCollector } from "../src/space/application/space-bootstrap-timing";
import { truncateSpaceTextToProtocolLimit } from "../src/space/application/space-text";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./helpers/center-agent-model-route.test-support";
import {
  applyDrizzleMigrationsForTables,
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

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
describe("Remote Agent native delivery callback service", () => {
  it("continues the same delivery after a tool-budget checkpoint and publishes only the later final result", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("publishes an explicit failure instead of looping after the safe continuation limit", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledTimes(1);
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          text: REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY,
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
      harness.close();
    }
  });

  it("keeps a Routine parent private while its Center Agent continuation is pending", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyRoutineContinuationMigrations(harness);
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
      harness.run({
        params: [runId, parentDeliveryId],
        sql: `
          INSERT INTO routine_runs (
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
          ) VALUES (?, 'routine-1', 'org_1', 900, 'submitted',
            'Daily learning', '${SPACE_ID}', 'space', 'workflow', ?, 900)
        `,
      });
      harness.run({
        params: [runId],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET worker_submit_request_json = '{"sentinel":"retained"}'
          WHERE idempotency_key = ?
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
        harness.queryFirst<{ worker_submit_request_json: string | null }>({
          params: [runId],
          sql: `
            SELECT worker_submit_request_json
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE idempotency_key = ?
          `,
        })
      ).toEqual({ worker_submit_request_json: '{"sentinel":"retained"}' });
      expect(
        harness.queryFirst<{ native_delivery_id: string; status: string }>({
          params: [runId],
          sql: `
            SELECT native_delivery_id, status
            FROM routine_runs
            WHERE id = ?
          `,
        })
      ).toEqual({ native_delivery_id: parentDeliveryId, status: "submitted" });
    } finally {
      harness.close();
    }
  });

  it("submits one idempotent Center Agent continuation with exact child evidence", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1200,
      requestId: "request-continuation",
      status: "pending" as const,
      submissionId: "submission-continuation",
    }));
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
                publishedSignalId: "signal-child-result",
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
        isAuthorized: async () => true,
        memoryService: continuationMemoryService,
        nowMs: 1100,
        observerDelivery,
        outcome: {
          errorCode: null,
          eventId: "terminal-child-1",
          occurredAtMs: 1050,
          publishedSignalId: "signal-child-result",
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

      const first =
        await submitRemoteAgentTaskContinuationDelivery(continuationInput);
      const replay = await submitRemoteAgentTaskContinuationDelivery({
        ...continuationInput,
        nowMs: 1300,
      });

      expect(replay).toEqual(first);
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: "agent-task-continuation:subscription-1",
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(
                '"publishedSignalId":"signal-child-result"'
              ),
            }),
          ],
          turnEnvelope: expect.objectContaining({
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
              subscriptionId: "subscription-1",
              watchedTask: continuationInput.watchedTask,
            },
          }),
        })
      );
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
      harness.close();
    }
  });

  it("continues from a persisted v4 observer and rolls its runtime generation automatically", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      const observerDelivery =
        await readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "submission-v4-parent",
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
            errorCode: null,
            eventId: "terminal-v4-child",
            occurredAtMs: 1050,
            publishedSignalId: "signal-v4-child-result",
            status: "succeeded",
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
    } finally {
      harness.close();
    }
  });

  it("resumes an ordinary Slack parent in its frozen Slack thread", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("rejects a Slack continuation when its frozen locator disagrees with its conversation id", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("fails a continuation when privacy clearing removed its original model route", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.run({
        params: ["idempotency-cleared-model-parent"],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            worker_submit_request_json = NULL,
            execution_recovery_submit_request_json = NULL
          WHERE idempotency_key = ?
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
      harness.close();
    }
  });

  it("publishes a deterministic Slack continuation rejection to its original thread", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      harness.run({
        params: [continuationInput.idempotencyKey],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            final_publication_state = 'claimed',
            final_publication_claim_id = 'claim-slack-crashed',
            final_publication_claimed_at_ms = 1150,
            final_publication_claim_expires_at_ms = 1200,
            published_signal_id = NULL,
            completed_at_ms = NULL,
            updated_at_ms = 1200
          WHERE idempotency_key = ?
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
            (JSON.parse(String(init?.body ?? "{}")) as { status?: unknown })
              .status === ""
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
      harness.close();
    }
  });

  it("resumes a Lark task watch through its frozen Message Channel locator", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("retries a deterministic Lark continuation failure without resubmitting the worker", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_lark_platform_channel_connections"
    );
    harness.run({
      sql: `
        INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
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

      harness.run({
        params: [continuationInput.idempotencyKey],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            final_publication_state = 'claimed',
            final_publication_claim_id = 'claim-lark-crashed',
            final_publication_claimed_at_ms = 1250,
            final_publication_claim_expires_at_ms = 1300,
            provider_publication_result_id = NULL,
            completed_at_ms = NULL,
            updated_at_ms = 1300
          WHERE idempotency_key = ?
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
      harness.close();
    }
  });

  it("keeps a deterministically rejected continuation terminal across replay", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("projects a deterministic continuation rejection for a watcher registered during admission", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("projects a continuation admission timeout to its watcher and replays it idempotently", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      harness.run({
        params: [idempotencyKey],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            status = 'failed',
            failure_code = 'remote_agent.admission_timeout',
            failure_detail = 'A retryable publisher still owns this admission.',
            completed_at_ms = 1160,
            updated_at_ms = 1160
          WHERE idempotency_key = ?
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
      harness.close();
    }
  });

  it("retries an ambiguous Center Agent watch admission without settling it", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("cancels a continuation stopped after worker admission but before ACK persistence", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("projects a Remote Agent callback onto its exact observed Space Wake task", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("replays stopped parent propagation after its subscription is already cancelled", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(harness, "inbox_items");
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "stopped-parent-replay-task",
        db: harness.db,
        idempotencyKey: "stopped-parent-replay",
        spaceId: SPACE_ID,
        submissionId: "submission-stopped-parent-replay",
      });
      const parentDelivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission-stopped-parent-replay",
      });
      if (!parentDelivery) {
        throw new Error("expected stopped parent delivery fixture");
      }
      const parentTask = {
        deliveryId: parentDelivery.deliveryId,
        kind: "native_delivery" as const,
        v: 1 as const,
      };
      await createCenterAgentTask({
        db: harness.db,
        goal: "Coordinate owned Space work.",
        idempotencyKey: "create-stopped-parent-replay-task",
        nowMs: 980,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "stopped-parent-replay-task",
        title: "Coordinate owned work",
      });
      await appendCenterAgentTaskEvent({
        actor: "requester",
        attemptGeneration: null,
        db: harness.db,
        eventId: "stopped-parent-replay-created",
        expectedTaskVersion: 1,
        idempotencyKey: "stopped-parent-replay-created",
        kind: "task_created",
        observedAtMs: 980,
        occurredAtMs: 980,
        organizationId: "org_1",
        taskId: "stopped-parent-replay-task",
        text: "Coordinate owned Space work.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "stopped-parent-replay-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "stopped-parent-replay-attempt",
        nowMs: 990,
        organizationId: "org_1",
        taskHandle: parentTask,
        taskId: "stopped-parent-replay-task",
      });
      const running = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 995,
        organizationId: "org_1",
        status: "running",
        taskId: "stopped-parent-replay-task",
      });
      await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "stopped-parent-replay-stop-requested",
        expectedTaskVersion: running.task.version,
        idempotencyKey: "stopped-parent-replay-stop-requested",
        nowMs: 999,
        organizationId: "org_1",
        taskId: "stopped-parent-replay-task",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });
      const childTask = {
        kind: "space_wake" as const,
        sourceClientMessageId: "client-stopped-parent-child",
        spaceId: SPACE_ID,
        targetProfileId: AGENT_PROFILE_ID,
        v: 1 as const,
      };
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "child_reports_directly" },
        db: harness.db,
        delegationId: "delegation-stopped-parent-replay",
        idempotencyKey: "delegation-key:stopped-parent-replay",
        nowMs: 1000,
        organizationId: "org_1",
        parentTask,
        spaceId: SPACE_ID,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-stopped-parent-replay",
        nowMs: 1001,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "subscription-key:stopped-parent-replay",
        nowMs: 1002,
        observerTask: parentTask,
        organizationId: "org_1",
        subscriptionId: "subscription-stopped-parent-replay",
        watchedTask: childTask,
      });
      await claimRemoteAgentNativeDeliveryTerminalFailure({
        db: harness.db,
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        idempotencyKey: "stopped-parent-replay",
        nowMs: 1100,
        submissionId: "submission-stopped-parent-replay",
      });
      const env = buildEnv(harness.db);
      env.__spaceStub.rpcPostWakeStop = vi.fn(() =>
        Promise.reject(
          new Error(
            'The RPC receiver does not implement the method "rpcPostWakeStop".'
          )
        )
      );
      const callback = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "stopped-parent-replay",
        organizationId: "org_1",
        spaceId: SPACE_ID,
        submissionId: "submission-stopped-parent-replay",
        text: "Late result.",
        triggerMessageId: "signal_1",
      } as const;

      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).rejects.toThrow("agent_task_parent_stop.space_unavailable");
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "stopped-parent-replay-task",
        })
      ).resolves.toMatchObject({ status: "stopping" });
      env.__spaceStub.rpcPostWakeStop = vi.fn(async () => ({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: null,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "requested" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child-replay",
        status: "cancellation_requested" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      }));
      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).rejects.toThrow("agent_task_parent_stop.cancellation_requested");
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "stopped-parent-replay-task",
        })
      ).resolves.toMatchObject({ status: "stopping" });
      env.__spaceStub.rpcPostWakeStop = vi.fn(async () => ({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: 1250,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "cancelled" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child-replay",
        status: "cancelled" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      }));
      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).resolves.toMatchObject({
        reasonCode: "remote_agent.callback_failed_submission",
        status: "duplicate_rejected",
      });
      expect(env.__spaceStub.rpcPostWakeStop).toHaveBeenCalledOnce();
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "stopped-parent-replay-task",
        })
      ).resolves.toMatchObject({ status: "stopped" });
    } finally {
      harness.close();
    }
  });

  it("cancels a worker admitted while the Space Wake was being stopped", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      .mockImplementation((input) => {
        const identity = input.request.targetWakeLifecycleIdentity;
        return Promise.resolve({
          lifecycle: {
            createdAtMs: 1000,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "user_1",
            primaryDispatchId: "dispatch_1",
            publicationIntent: {
              intentId: `rcpi:stopped:${identity.targetWakeLifecycleId}`,
              kind: "stopped_notice",
              readyAtMs: 1001,
              reasonCode: "runtime_coordinator.pre_agent_stop_requested",
              status: "ready_for_phase_6",
            },
            runtimeCoordinatorExecutionId: null,
            status: "stopped_before_execution",
            targetWakeLifecycleIdentity: identity,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            updatedAtMs: 1001,
            waitingBoundary: null,
          },
          ok: true,
          readStatus: "found",
        });
      });
    const env = buildEnv(harness.db, {
      authWorker: { resolveProfileById },
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
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
      ).resolves.toEqual({
        shouldAck: true,
        status: "stopped",
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
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
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
      harness.close();
    }
  });

  it("keeps one worker admission authoritative beyond the old timeout", async () => {
    vi.useFakeTimers();
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
      vi.useRealTimers();
    }
  });

  it("retries an ambiguous Space worker submit without recounting it after UTC midnight", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
        harness.queryAll<{ admitted_count: number; day_utc: string }>({
          params: ["org_1"],
          sql: `
            SELECT admitted_count, day_utc
            FROM openMeldRemoteAgent_daily_admissions
            WHERE organization_id = ?
          `,
        })
      ).toEqual([{ admitted_count: 1, day_utc: "2026-07-12" }]);
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("maps a structured Space admission rejection to Core-owned public copy", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const env = buildEnv(harness.db, {
      remoteAgentWorker: {
        submitConversationTurn: vi.fn(async () => ({
          idempotencyKey: "idem_1",
          message: "Worker diagnostic detail only.",
          outcome: "rejected" as const,
          reasonCode:
            "remote_agent.conversation_history_limit_exceeded" as const,
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
        failureCode: "remote_agent.conversation_history_limit_exceeded",
        failureDetail: "Worker diagnostic detail only.",
        status: "failed",
      });
      expect(env.__spaceStub.rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reasonCode: "remote_agent.conversation_history_limit_exceeded",
            text: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
          }),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("rejects the 201st daily Space admission with a visible UTC reset message", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
    harness.run({
      params: ["org_1", "2026-07-12", 200, "seeded_admission", nowMs, nowMs],
      sql: `
        INSERT INTO openMeldRemoteAgent_daily_admissions (
          organization_id,
          day_utc,
          admitted_count,
          last_admission_idempotency_key,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
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
            reasonCode: "remote_agent.daily_quota_exceeded",
            text: expect.stringContaining("00:00 UTC"),
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
        failureCode: "remote_agent.daily_quota_exceeded",
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
        harness.queryAll<{ admitted_count: number; day_utc: string }>({
          params: ["org_1"],
          sql: `
            SELECT admitted_count, day_utc
            FROM openMeldRemoteAgent_daily_admissions
            WHERE organization_id = ?
            ORDER BY day_utc
          `,
        })
      ).toEqual([{ admitted_count: 200, day_utc: "2026-07-12" }]);
    } finally {
      harness.close();
    }
  });

  it("enqueues an admission watchdog before submit and terminalizes a hung delivery idempotently", async () => {
    vi.useFakeTimers();
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
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
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
      expect(workerCancel).toHaveBeenCalledOnce();
    } finally {
      harness.close();
      vi.useRealTimers();
    }
  });

  it("fails an admission watchdog when its exact durable delivery is missing", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("fails an admission watchdog when its durable delivery identity does not match", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("submits a Think-shaped worker ACK and records an accepted delivery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("backfills accepted deliveries created before their durable probe was restored", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("re-enqueues an accepted delivery after an older deadline probe chain is lost", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("claims an expired accepted-delivery probe before concurrent recovery enqueues it", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("keeps a claimed probe lease when its post-send marker write fails", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.run({
        sql: `
          CREATE TRIGGER fail_accepted_probe_marker_write
          BEFORE UPDATE OF deadline_probe_enqueued_at_ms
          ON openMeldRemoteAgent_native_delivery_ledger
          BEGIN
            SELECT RAISE(FAIL, 'accepted probe marker write failed');
          END
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
      harness.close();
    }
  });

  it("keeps an accepted Space delivery retryable until its durable probe is enqueued", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("persists a worker ACK before a pending watchdog so the running Center Agent can link continuations", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("forwards Center Agent DM attachment references from the triggering signal", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("does not read or attach a Space guide for a Center Agent DM turn", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("reads the current Space guide for every shared Space turn", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const timing = createSpaceBootstrapTimingCollector();
    harness.run({
      params: [SPACE_ID],
      sql: `
        UPDATE space_index_spaces
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = ?
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
      harness.close();
    }
  });

  it("forwards shared Space wake attachment references from the triggering signal", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    harness.run({
      params: [SPACE_ID],
      sql: `
        UPDATE space_index_spaces
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = ?
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
    try {
      await submitRemoteAgentNativeDelivery({
        db: harness.db,
        env: buildEnv(harness.db, {
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
          sourceSignal: {
            ...createSignalEnvelope("signal_1"),
            data: { text: "What is on this whiteboard?", attachments },
          } as SignalEnvelope,
        }),
        executionAttemptId: "attempt_1",
        message: createDispatchMessage({
          sourceSignalSnapshot: {
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "What is on this whiteboard?",
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
              content: "What is on this whiteboard?",
              attachments,
            },
          ],
          turnEnvelope: expect.objectContaining({
            trigger: { source: "space_wake" },
          }),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("forwards canonical Space File image bytes without creating a second attachment", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "req_space_file_image",
      status: "pending" as const,
      submissionId: "sub_space_file_image",
    }));
    const file = {
      fileId: "space-file-whiteboard",
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
      harness.close();
    }
  });

  it("fails the turn visibly when a canonical Space File image cannot be resolved", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("forwards ten canonical Space File images without applying the legacy four-image limit", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      (input: { content: { fileId: string; revision: number } }) => {
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
      harness.close();
    }
  });

  it("reports an older Space RPC receiver while preserving the text-only turn", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("injects recalled Center Agent memory into native delivery turn envelopes", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("reads Space attachments while slow Center Agent memory is still recalling", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    harness.run({
      params: [SPACE_ID],
      sql: `
        UPDATE space_index_spaces
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = ?
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
      harness.close();
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
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    harness.run({
      params: [SPACE_ID],
      sql: `
        UPDATE space_index_spaces
        SET space_purpose = NULL,
            direct_message_pair_key = NULL,
            space_name = 'Launch Room'
        WHERE space_id = ?
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
          turnEnvelope: expect.not.objectContaining({
            memory: expect.anything(),
          }),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("injects recalled Center Agent memory into Slack turn envelopes", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("expands Slack memory recall with recent channel context", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
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
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
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
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const oversizedMemoryText = "x".repeat(
      REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS + 200
    );
    const workerSubmit = vi.fn((input) => {
      const parsed = remoteAgentWorkerSubmitTurnRequestSchema.parse(input);
      expect(parsed.turnEnvelope.memory?.truncated).toBe(true);
      expect(parsed.turnEnvelope.memory?.items[0]?.text).toHaveLength(
        REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS
      );
      expect(parsed.turnEnvelope.memory?.items[0]?.text.endsWith("...")).toBe(
        true
      );
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
      harness.close();
    }
  });

  it("submits native delivery without memory when recall fails", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
          turnEnvelope: expect.not.objectContaining({
            memory: expect.anything(),
          }),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("records a Think idempotent retry ACK without treating accepted false as failure", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("does not overwrite an accepted delivery when the same idempotency key is retried and the worker is unavailable", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("rejects native delivery when the hosted profile is no longer the designated Center Agent", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    deleteCenterAgentDesignation(harness);
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
      harness.close();
    }
  });

  it("publishes callback replies with Remote Agent native delivery authority", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(harness, "space_attachments");
    try {
      seedWaitingNativeDeliveryDispatch(harness, {
        idempotencyKey: "space_1:dispatch_1",
      });
      harness.run({
        params: [
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
        sql: `
          INSERT INTO space_attachments (
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          centerAgentTaskReferences: [{ taskId: "task-1" }],
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
            centerAgentTaskReferences: [{ taskId: "task-1" }],
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
      harness.close();
    }
  });

  it("keeps the first terminal timestamp when a completed Space callback replays", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      seedWaitingNativeDeliveryDispatch(harness, {
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
      harness.close();
    }
  });

  it("projects the real Space callback result into its canonical Task conversation", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "space-result-task",
        db: harness.db,
        deliveryId: "space-task-result-delivery",
        dispatchId: "space-task-result-delivery",
        idempotencyKey: "space-task-result",
        submissionId: "submission-space-task-result",
        spaceId: SPACE_ID,
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "submission-space-task-result",
      });
      if (!delivery) {
        throw new Error("expected accepted Task delivery");
      }
      await createCenterAgentTask({
        db: harness.db,
        goal: "Return the complete onboarding comparison.",
        idempotencyKey: "create-space-result-task",
        nowMs: 1200,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: null,
        taskId: "space-result-task",
        title: "Compare onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "space-result-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "space-result-task-created",
        kind: "task_created",
        observedAtMs: 1200,
        occurredAtMs: 1200,
        organizationId: "org_1",
        taskId: "space-result-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "space-result-task-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "space-result-task-attempt",
        nowMs: 1201,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "space-result-task",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1202,
        organizationId: "org_1",
        status: "running",
        taskId: "space-result-task",
      });

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: delivery.dispatchId,
          idempotencyKey: delivery.idempotencyKey,
          organizationId: "org_1",
          spaceId: SPACE_ID,
          submissionId: "submission-space-task-result",
          text: "The onboarding comparison found three concrete gaps.",
          triggerMessageId: delivery.triggerMessageId,
        })
      ).resolves.toMatchObject({ status: "accepted" });

      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org_1",
          taskId: "space-result-task",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        {
          kind: "task_succeeded",
          text: "The onboarding comparison found three concrete gaps.",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("retains the exact Slack callback result when final publication becomes outcome-unknown", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("never reads the Center Agent Task store for an ordinary Slack callback", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const conversationId = "slack:T123:C123:1700000000.000001";
    const taskTableReads: string[] = [];
    const localStatePrepare = vi.fn((sql: string) => {
      if (sql.includes("center_agent_task")) {
        taskTableReads.push(sql);
        throw new Error(
          "ordinary Slack callback read a Center Agent Task table"
        );
      }
      return harness.db.prepare(sql);
    });
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
      env.OPENMELD_LOCAL_STATE_DB = {
        prepare: localStatePrepare,
      } as unknown as D1Database;

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
      harness.close();
    }
  });

  it("settles one parent continuation when a retained Slack result is reconciled repeatedly", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("keeps Message Channel callbacks out of every Space publication surface", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("settles a late callback as stopped without publishing a Space reply", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      .mockImplementation((input) => {
        const identity = input.request.targetWakeLifecycleIdentity;
        return Promise.resolve({
          lifecycle: {
            createdAtMs: 1000,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "user_1",
            primaryDispatchId: "dispatch_1",
            publicationIntent: {
              intentId: `rcpi:stopped:${identity.targetWakeLifecycleId}`,
              kind: "stopped_notice",
              readyAtMs: 1001,
              reasonCode: "runtime_coordinator.pre_agent_stop_requested",
              status: "ready_for_phase_6",
            },
            runtimeCoordinatorExecutionId: null,
            status: "stopped_before_execution",
            targetWakeLifecycleIdentity: identity,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            updatedAtMs: 1001,
            waitingBoundary: null,
          },
          ok: true,
          readStatus: "found",
        });
      });
    const env = buildEnv(harness.db, {
      postSignalId: "late_reply_must_not_publish",
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
        publishedSignalId: null,
        status: "failed",
      });
    } finally {
      traceSpy.mockRestore();
      harness.close();
    }
  });

  it("replays a stopped delivery into the Space Wake dispatch terminal state", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const idempotencyKey = "space_1:dispatch_stopped_replay";
    seedWaitingNativeDeliveryDispatch(harness, { idempotencyKey });
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
      harness.close();
    }
  });

  it("settles the atomic Space stopped fence without retrying the callback", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("rejects oversized callback replies before publishing to Space", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
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

  it("remembers completed CA-DM turns after callback publication", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      await expect(
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
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_reply_1",
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
      harness.close();
    }
  });

  it("fails closed when a completed turn has no frozen interaction environment", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("fails closed when frozen interaction environments conflict", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("fails closed when the frozen requester does not match current membership", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("remembers completed verified Slack DM turns in member memory", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("preserves the Message Channel provider when remembering a completed turn", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_lark_platform_channel_connections"
    );
    harness.run({
      sql: `
        INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
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
      harness.close();
    }
  });

  it("replays the exact persisted Slack worker request after an ambiguous submit", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
          request,
        })
      ).resolves.toEqual({ shouldAck: true, status: "submitted" });

      expect(submittedRequests).toHaveLength(2);
      expect(submittedRequests[1]).toEqual(submittedRequests[0]);
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("marks a hosted recovery effect only after its row, request, and watchdog are durable", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "slack-original-effect-boundary",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "submission-slack-original-effect-boundary",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });

      const result = await submitRemoteAgentExecutionRecoveryTurn({
        action: "resume_controller_conversation",
        db: harness.db,
        env,
        markEffectStarted: () => {
          expect(workerSubmit).not.toHaveBeenCalled();
          expect(dispatchQueueSend).toHaveBeenCalledOnce();
          expect(
            harness.queryAll<{ count: number }>({
              params: [originalDelivery.idempotencyKey],
              sql: `
                SELECT COUNT(*) AS count
                FROM openMeldRemoteAgent_native_delivery_ledger
                WHERE idempotency_key <> ?
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
      });

      expect(result.status).toBe("requested");
      expect(workerSubmit).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  it("rechecks runtime, Organization, Center Agent, and member authority before Task admission", async () => {
    const scenarios = [
      {
        code: "remote_agent.runtime_disabled",
        name: "runtime disabled",
        remoteAgentBlockedOrganizationIds: null,
        remoteAgentRuntimeEnabled: "false",
        sql: null,
      },
      {
        code: "remote_agent.organization_blocked",
        name: "Organization blocked",
        remoteAgentBlockedOrganizationIds: "org_1",
        remoteAgentRuntimeEnabled: null,
        sql: null,
      },
      {
        code: "remote_agent.center_agent_paused",
        name: "Center Agent paused",
        remoteAgentBlockedOrganizationIds: null,
        remoteAgentRuntimeEnabled: null,
        sql: "UPDATE center_agent_designations SET operating_state = 'paused' WHERE organization_id = 'org_1'",
      },
      {
        code: "center_agent_task.requester_membership_unavailable",
        name: "requester membership removed",
        remoteAgentBlockedOrganizationIds: null,
        remoteAgentRuntimeEnabled: null,
        sql: "DELETE FROM members WHERE organization_id = 'org_1' AND user_id = 'user_1'",
      },
    ] as const;

    for (const scenario of scenarios) {
      const harness = createSqliteD1Harness();
      applyRemoteAgentSubmitMigrations(harness);
      const workerSubmit = vi.fn();
      const env = buildEnv(harness.db, {
        dispatchQueueSend: vi.fn(async () => undefined),
        ...(scenario.remoteAgentBlockedOrganizationIds
          ? {
              remoteAgentBlockedOrganizationIds:
                scenario.remoteAgentBlockedOrganizationIds,
            }
          : {}),
        ...(scenario.remoteAgentRuntimeEnabled
          ? { remoteAgentRuntimeEnabled: scenario.remoteAgentRuntimeEnabled }
          : {}),
        remoteAgentWorker: { submitConversationTurn: workerSubmit },
      });
      try {
        await createAcceptedContinuationObserver({
          conversationKind: "slack",
          db: harness.db,
          idempotencyKey: `task-authority-source:${scenario.name}`,
          slackChannelId: "C123",
          slackTeamId: "T123",
          slackThreadTs: "1700000000.000001",
          submissionId: `task-authority-source-submission:${scenario.name}`,
          triggerMessageId: "1700000000.000001",
          turnEnvelope: createSlackTurnEnvelope(),
        });
        if (scenario.sql) {
          harness.run({ sql: scenario.sql });
        }

        await expect(
          submitRemoteAgentCenterAgentTaskTurn({
            db: harness.db,
            deliveryId: `task-authority-delivery:${scenario.name}`,
            env,
            idempotencyKey: `task-authority-attempt:${scenario.name}`,
            instruction: "This Task must fail closed.",
            nowMs: 2000,
            parent: {
              kind: "submission",
              submissionId: `task-authority-source-submission:${scenario.name}`,
            },
            requesterUserId: "user_1",
            taskEventId: `task-authority-event:${scenario.name}`,
            taskId: `task-authority:${scenario.name}`,
          })
        ).rejects.toThrow(scenario.code);
        expect(workerSubmit, scenario.name).not.toHaveBeenCalled();
        await expect(
          readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: `task-authority-attempt:${scenario.name}`,
          })
        ).resolves.toBeNull();
      } finally {
        harness.close();
      }
    }
  });

  it("runs a Center Agent Task in its own conversation while preserving the source destination", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 2001,
        requestId: "request-task-attempt-1",
        status: "pending" as const,
        submissionId: "submission-task-attempt-1",
      })
    );
    const cancelExecution = vi.fn((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 2001,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 2100,
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
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "task-source-delivery",
        requestVersion: 4,
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-source-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: {
          ...createSlackTurnEnvelope(),
          centerAgentInteractionSource: {
            client: "codex",
            kind: "local_agent",
            sessionId: "private-local-session",
          },
          channelContext: {
            provider: "slack",
            conversationId: "slack:T123:C123:1700000000.000001",
            currentMessageId: "1700000000.000001",
            messages: [
              {
                author: {
                  displayName: "Ari",
                  id: "U123",
                  kind: "human",
                },
                id: "1699999999.000001",
                sentAtMs: 1_699_999_999_000,
                text: "Create another Task with this same request.",
              },
            ],
            sync: { mode: "snapshot", status: "complete" },
          },
          memory: {
            items: [
              {
                source: "ca_dm",
                subject: "member",
                text: "Create another Task with this same request.",
              },
            ],
            truncated: false,
          },
        },
      });

      const result = await submitRemoteAgentCenterAgentTaskTurn({
        db: harness.db,
        deliveryId: "task-attempt-delivery-1",
        env,
        idempotencyKey: "task-attempt-1",
        instruction: "Research competitor onboarding and report the findings.",
        nowMs: 2000,
        parent: { kind: "submission", submissionId: "task-source-submission" },
        requesterUserId: "user_1",
        taskEventId: "task-event-1",
        taskId: "task-1",
      });

      expect(result).toMatchObject({
        deliveryId: "task-attempt-delivery-1",
        outcome: "accepted",
        status: "submitted",
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:task-1",
          conversationIdentity: {
            kind: "center_agent_task",
            taskId: "task-1",
          },
          dispatchId: "task-attempt-delivery-1",
          idempotencyKey: "task-attempt-1",
          messages: [
            {
              content:
                "Research competitor onboarding and report the findings.",
              role: "user",
            },
          ],
          spaceId: expect.stringContaining("slack:"),
          triggerMessageId: "1700000000.000001",
          turnEnvelope: expect.objectContaining({
            centerAgentInteractionSource: {
              client: "codex",
              kind: "local_agent",
              sessionId: "private-local-session",
            },
          }),
          v: 4,
        })
      );
      const submittedRequest = workerSubmit.mock.calls[0]?.[0];
      expect(submittedRequest?.turnEnvelope.memory).toBeUndefined();
      expect(submittedRequest?.turnEnvelope.channelContext).toBeUndefined();
      expect(submittedRequest?.turnEnvelope.contextScopePlan).toMatchObject({
        interactionEnvironment: "externally_shared",
        memberMemory: "use_privately",
        requesterIdentity: "verified_member",
        resultAudience: "external_conversation",
        v: 1,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "task-attempt-1",
        })
      ).resolves.toMatchObject({
        conversationKind: "slack",
        deliveryId: "task-attempt-delivery-1",
        onBehalfOfUserId: "user_1",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        triggerMessageId: "1700000000.000001",
      });
      const taskDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: "task-attempt-1",
      });
      if (!taskDelivery) {
        throw new Error("expected the Task delivery");
      }
      await stopRemoteAgentNativeDelivery({
        db: harness.db,
        delivery: taskDelivery,
        env,
        nowMs: 2100,
      });
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:task-1",
          submissionId: "submission-task-attempt-1",
        })
      );
    } finally {
      harness.close();
    }
  });

  it("uses a deterministically failed pre-admission Task delivery as the parent of its retry", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
    });
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "task-retry-source",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-retry-source-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });

      await expect(
        submitRemoteAgentCenterAgentTaskTurn({
          db: harness.db,
          deliveryId: "task-failed-delivery-1",
          env,
          idempotencyKey: "task-failed-attempt-1",
          instruction: "Research competitor onboarding.",
          nowMs: 2000,
          parent: {
            kind: "submission",
            submissionId: "task-retry-source-submission",
          },
          requesterUserId: "user_1",
          taskEventId: "task-event-failed-1",
          taskId: "task-retry-1",
        })
      ).rejects.toThrow("center_agent_task.worker_unavailable");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "task-failed-attempt-1",
        })
      ).resolves.toMatchObject({
        deliveryId: "task-failed-delivery-1",
        status: "submitted",
        workerSubmitRequest: expect.objectContaining({
          conversationId: "center-agent-task:task-retry-1",
        }),
      });

      const workerSubmit = vi.fn(async () => ({
        accepted: true,
        createdAt: 2101,
        requestId: "request-task-retry-2",
        status: "pending" as const,
        submissionId: "submission-task-retry-2",
      }));
      env.OPENMELD_REMOTE_AGENT_WORKER = {
        submitConversationTurn: workerSubmit,
      };
      await expect(
        submitRemoteAgentCenterAgentTaskTurn({
          db: harness.db,
          deliveryId: "task-retry-delivery-2",
          env,
          idempotencyKey: "task-retry-attempt-2",
          instruction: "Retry the research without losing its context.",
          nowMs: 2100,
          parent: {
            deliveryId: "task-failed-delivery-1",
            kind: "delivery",
          },
          requesterUserId: "user_1",
          taskEventId: "task-event-retry-2",
          taskId: "task-retry-1",
        })
      ).resolves.toEqual({
        deliveryId: "task-retry-delivery-2",
        outcome: "accepted",
        status: "submitted",
      });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:task-retry-1",
          messages: [
            {
              content: "Retry the research without losing its context.",
              role: "user",
            },
          ],
        })
      );
    } finally {
      harness.close();
    }
  });

  it("keeps an ambiguous Task admission recoverable in the native delivery ledger", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("RPC disconnected after admission"))
    );
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "task-ambiguous-source",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-ambiguous-source-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });

      await expect(
        submitRemoteAgentCenterAgentTaskTurn({
          db: harness.db,
          deliveryId: "task-ambiguous-delivery-1",
          env,
          idempotencyKey: "task-ambiguous-attempt-1",
          instruction: "Research competitor onboarding.",
          nowMs: 2000,
          parent: {
            kind: "submission",
            submissionId: "task-ambiguous-source-submission",
          },
          requesterUserId: "user_1",
          taskEventId: "task-event-ambiguous-1",
          taskId: "task-ambiguous-1",
        })
      ).resolves.toEqual({
        deliveryId: "task-ambiguous-delivery-1",
        outcome: "unknown",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "task-ambiguous-attempt-1",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "submitted",
        workerSubmitRequest: expect.objectContaining({
          conversationId: "center-agent-task:task-ambiguous-1",
        }),
      });
    } finally {
      harness.close();
    }
  });

  it("forwards a durable Task stop as soon as an ambiguous admission returns its ACK", async () => {
    const nativeStore = createSqliteD1Harness();
    const taskStore = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(nativeStore);
    seedTaskIdentityTables(taskStore);
    applyDrizzleMigrationsForTables(taskStore, [
      "center_agent_tasks",
      "center_agent_task_attempts",
      "center_agent_task_events",
    ]);
    let resolveAdmission!: (value: {
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
          resolveAdmission = resolve;
        })
    );
    const cancelExecution = vi.fn((input) => {
      const { conversationId: _conversationId, reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 2001,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 2003,
          lastProgressKind: "cancellation_requested" as const,
          status: "cancellation_requested" as const,
        },
        status: "cancellation_requested" as const,
      });
    });
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) =>
        Promise.resolve(message)
    );
    const env = buildEnv(nativeStore.db, {
      deadlineProbeQueueSend: dispatchQueueSend,
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
      },
    });
    env.OPENMELD_LOCAL_STATE_DB = taskStore.db;
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: nativeStore.db,
        idempotencyKey: "task-ambiguous-stop-source",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-ambiguous-stop-source-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });
      await createCenterAgentTask({
        db: taskStore.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-task-ambiguous-stop",
        nowMs: 1998,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "task-ambiguous-stop",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "requester",
        attemptGeneration: null,
        db: taskStore.db,
        eventId: "task-ambiguous-stop-created",
        expectedTaskVersion: 1,
        idempotencyKey: "task-ambiguous-stop-created",
        kind: "task_created",
        observedAtMs: 1998,
        occurredAtMs: 1998,
        organizationId: "org_1",
        taskId: "task-ambiguous-stop",
        text: "Research competitor onboarding.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "task-ambiguous-stop-attempt",
        db: taskStore.db,
        expectedTaskVersion: 2,
        idempotencyKey: "task-ambiguous-stop-attempt",
        nowMs: 1999,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: "task-ambiguous-stop-delivery",
          kind: "native_delivery",
          v: 1,
        },
        taskId: "task-ambiguous-stop",
      });

      const submission = submitRemoteAgentCenterAgentTaskTurn({
        db: nativeStore.db,
        deliveryId: "task-ambiguous-stop-delivery",
        env,
        idempotencyKey: "task-ambiguous-stop-delivery-key",
        instruction: "Research competitor onboarding.",
        nowMs: 2000,
        parent: {
          kind: "submission",
          submissionId: "task-ambiguous-stop-source-submission",
        },
        requesterUserId: "user_1",
        taskEventId: "task-ambiguous-stop-created",
        taskId: "task-ambiguous-stop",
      });
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: taskStore.db,
        eventId: "task-ambiguous-stop-requested",
        expectedTaskVersion: 3,
        idempotencyKey: "task-ambiguous-stop-requested",
        nowMs: 2002,
        organizationId: "org_1",
        taskId: "task-ambiguous-stop",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });
      resolveAdmission({
        accepted: true,
        createdAt: 2001,
        requestId: "task-ambiguous-stop-request",
        status: "pending",
        submissionId: "task-ambiguous-stop-submission",
      });

      await expect(submission).resolves.toEqual({
        deliveryId: "task-ambiguous-stop-delivery",
        outcome: "accepted",
        status: "submitted",
      });
      expect(cancelExecution).toHaveBeenCalledOnce();
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:task-ambiguous-stop",
          submissionId: "task-ambiguous-stop-submission",
        })
      );
      await expect(
        readCenterAgentTask({
          db: taskStore.db,
          organizationId: "org_1",
          taskId: "task-ambiguous-stop",
        })
      ).resolves.toMatchObject({ status: "stopping" });
      const events = await listCenterAgentTaskEvents({
        db: taskStore.db,
        organizationId: "org_1",
        taskId: "task-ambiguous-stop",
      });
      expect(events.map((event) => event.kind)).toEqual([
        "task_created",
        "stop_requested",
      ]);

      const admissionWatchdog = dispatchQueueSend.mock.calls[0]?.[0];
      if (!admissionWatchdog) {
        throw new Error("expected the Task admission watchdog probe");
      }
      cancelExecution.mockClear();
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: nativeStore.db,
          env,
          nowMs: admissionWatchdog.deadlineAtMs,
          probe: admissionWatchdog,
        })
      ).rejects.toThrow("center_agent_task.admission_stop_pending");
      expect(cancelExecution).toHaveBeenCalledOnce();
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:task-ambiguous-stop",
          submissionId: "task-ambiguous-stop-submission",
        })
      );
      await expect(
        listCenterAgentTaskEvents({
          db: taskStore.db,
          organizationId: "org_1",
          taskId: "task-ambiguous-stop",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        { kind: "stop_requested" },
      ]);
    } finally {
      nativeStore.close();
      taskStore.close();
    }
  });

  it("does not admit native work after the Task owner has persisted Stop", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(harness, "inbox_items");
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 2001,
      requestId: "task-stop-retry-request",
      status: "pending" as const,
      submissionId: "task-stop-retry-submission",
    }));
    const cancelExecution = vi.fn();
    const dispatchQueueSend = vi.fn(
      (message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage) =>
        Promise.resolve(message)
    );
    const env = buildEnv(harness.db, {
      deadlineProbeQueueSend: dispatchQueueSend,
      remoteAgentWorker: {
        cancelExecution,
        submitConversationTurn: workerSubmit,
      },
    });
    try {
      await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "task-stop-retry-source",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-stop-retry-source-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-task-stop-retry",
        nowMs: 1998,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "task-stop-retry",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "requester",
        attemptGeneration: null,
        db: harness.db,
        eventId: "task-stop-retry-created",
        expectedTaskVersion: 1,
        idempotencyKey: "task-stop-retry-created",
        kind: "task_created",
        observedAtMs: 1998,
        occurredAtMs: 1998,
        organizationId: "org_1",
        taskId: "task-stop-retry",
        text: "Research competitor onboarding.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "task-stop-retry-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "task-stop-retry-attempt",
        nowMs: 1999,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: "task-stop-retry-delivery",
          kind: "native_delivery",
          v: 1,
        },
        taskId: "task-stop-retry",
      });
      await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "task-stop-retry-requested",
        expectedTaskVersion: 3,
        idempotencyKey: "task-stop-retry-requested",
        nowMs: 2000,
        organizationId: "org_1",
        taskId: "task-stop-retry",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });

      await expect(
        submitRemoteAgentCenterAgentTaskTurn({
          db: harness.db,
          deliveryId: "task-stop-retry-delivery",
          env,
          idempotencyKey: "task-stop-retry-delivery-key",
          instruction: "Research competitor onboarding.",
          nowMs: 2001,
          parent: {
            kind: "submission",
            submissionId: "task-stop-retry-source-submission",
          },
          requesterUserId: "user_1",
          taskEventId: "task-stop-retry-created",
          taskId: "task-stop-retry",
        })
      ).resolves.toEqual({
        deliveryId: "task-stop-retry-delivery",
        outcome: "accepted",
        status: "stopped_before_submission",
      });
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(cancelExecution).not.toHaveBeenCalled();
      expect(dispatchQueueSend).toHaveBeenCalledOnce();
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "task-stop-retry",
        })
      ).resolves.toMatchObject({ status: "stopped" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "task-stop-retry-delivery-key",
        })
      ).resolves.toMatchObject({
        failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("settles a Task delivery only after worker cancellation is confirmed aborted", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const cancelExecution = vi
      .fn()
      .mockImplementationOnce((input) => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 2001,
            cancellationReason: reason ?? null,
            completedAtMs: null,
            lastProgressAtMs: 2100,
            lastProgressKind: "cancellation_requested" as const,
            status: "cancellation_requested" as const,
          },
          status: "cancellation_requested" as const,
        });
      })
      .mockImplementationOnce((input) => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 2001,
            cancellationReason: reason ?? null,
            completedAtMs: 2150,
            lastProgressAtMs: 2150,
            lastProgressKind: "prompt_completed" as const,
            status: "completed" as const,
          },
          status: "not_stoppable" as const,
        });
      })
      .mockImplementationOnce((input) => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 2001,
            cancellationReason: reason ?? null,
            completedAtMs: 2200,
            lastProgressAtMs: 2200,
            lastProgressKind: "aborted" as const,
            status: "aborted" as const,
          },
          status: "already_cancelled" as const,
        });
      });
    const env = buildEnv(harness.db, {
      remoteAgentWorker: { cancelExecution },
    });
    try {
      const delivery = await createAcceptedContinuationObserver({
        conversationKind: "slack",
        db: harness.db,
        idempotencyKey: "task-cancellation-confirmation",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        submissionId: "task-cancellation-submission",
        triggerMessageId: "1700000000.000001",
        turnEnvelope: createSlackTurnEnvelope(),
      });

      await expect(
        requestRemoteAgentNativeDeliveryStop({
          db: harness.db,
          delivery,
          env,
          nowMs: 2100,
        })
      ).resolves.toBe("stop_requested");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: delivery.idempotencyKey,
        })
      ).resolves.toMatchObject({ status: "accepted" });

      await expect(
        stopRemoteAgentNativeDelivery({
          db: harness.db,
          delivery,
          env,
          nowMs: 2150,
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: delivery.idempotencyKey,
        })
      ).resolves.toMatchObject({ status: "accepted" });

      await expect(
        stopRemoteAgentNativeDelivery({
          db: harness.db,
          delivery,
          env,
          nowMs: 2200,
        })
      ).resolves.toMatchObject({
        failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        status: "failed",
      });
      expect(cancelExecution).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });

  it("rejects a saved request for another Agent before sending a stop to the worker", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      await harness.db
        .prepare(
          `UPDATE openMeldRemoteAgent_native_delivery_ledger
         SET worker_submit_request_json = ? WHERE idempotency_key = ?`
        )
        .bind(
          JSON.stringify(
            remoteAgentWorkerSubmitTurnRequestSchema.parse({
              ...delivery.executionRecoverySubmitRequest,
              agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
            })
          ),
          delivery.idempotencyKey
        )
        .run();

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
      harness.close();
    }
  });

  it("settles a trusted late Task callback as stopped after confirmation timeout without publishing its result", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const env = buildEnv(harness.db, {
      postSignalId: "late-task-result-must-not-publish",
    });
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "stopping-task",
        db: harness.db,
        deliveryId: "stopping-task-delivery",
        dispatchId: "stopping-task-delivery",
        idempotencyKey: "stopping-task-delivery",
        spaceId: SPACE_ID,
        submissionId: "stopping-task-submission",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "stopping-task-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted stopping Task delivery");
      }
      expect(delivery).toMatchObject({
        attemptId: null,
        deliveryId: "stopping-task-delivery",
        dispatchId: "stopping-task-delivery",
        executionRecoverySubmitRequest: {
          conversationId: "center-agent-task:stopping-task",
          dispatchId: "stopping-task-delivery",
          idempotencyKey: "stopping-task-delivery",
        },
      });
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-stopping-task",
        nowMs: 2000,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: null,
        taskId: "stopping-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "stopping-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "stopping-task-created",
        kind: "task_created",
        observedAtMs: 2000,
        occurredAtMs: 2000,
        organizationId: "org_1",
        taskId: "stopping-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "stopping-task-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "stopping-task-attempt",
        nowMs: 2001,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "stopping-task",
      });
      const running = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 2002,
        organizationId: "org_1",
        status: "running",
        taskId: "stopping-task",
      });
      const stopRequested = await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "stopping-task-stop-requested",
        expectedTaskVersion: running.task.version,
        idempotencyKey: "stopping-task-stop-requested",
        nowMs: 2003,
        organizationId: "org_1",
        taskId: "stopping-task",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: stopRequested.task.version,
        failureCode: null,
        generation: 1,
        nowMs: 2004,
        organizationId: "org_1",
        status: "needs_attention",
        taskId: "stopping-task",
      });

      const callback = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_1",
        dispatchId: delivery.dispatchId,
        idempotencyKey: delivery.idempotencyKey,
        organizationId: "org_1",
        spaceId: delivery.spaceId,
        submissionId: "stopping-task-submission",
        text: "This late result must remain sealed.",
        triggerMessageId: delivery.triggerMessageId,
      };
      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).resolves.toEqual({
        publishedSignalId: null,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        status: "accepted",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, callback)
      ).resolves.toEqual({
        publishedSignalId: null,
        reasonCode: "remote_agent.callback_failed_submission",
        status: "duplicate_rejected",
      });
      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(
        env.__spaceStub.rpcPostSignalOnceByClientMessageId
      ).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "stopping-task-submission",
        })
      ).resolves.toMatchObject({
        failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        publishedSignalId: null,
        status: "failed",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "stopping-task",
        })
      ).resolves.toMatchObject({ status: "stopped" });
      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org_1",
        taskId: "stopping-task",
      });
      expect(events.map((event) => event.kind)).toEqual([
        "task_created",
        "stop_requested",
        "task_stopped",
      ]);
    } finally {
      harness.close();
    }
  });

  it("starts an accepted replacement after an asynchronous Task stop settles", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    applyMigrationForTable(harness, "inbox_items");
    const workerSubmit = vi.fn().mockResolvedValue({
      accepted: true,
      createdAt: 3001,
      requestId: "replacement-request",
      status: "pending" as const,
      submissionId: "replacement-submission",
    });
    const env = buildEnv(harness.db, {
      dispatchQueueSend: vi.fn(async () => undefined),
      postSignalId: "replacement-result-must-not-publish",
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "replacement-task",
        db: harness.db,
        deliveryId: "replacement-task-delivery",
        dispatchId: "replacement-task-delivery",
        idempotencyKey: "replacement-task-delivery",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "replacement-task-submission",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "replacement-task-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted replacement Task delivery");
      }
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-replacement-task",
        nowMs: 2000,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "replacement-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "requester",
        attemptGeneration: null,
        db: harness.db,
        eventId: "replacement-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "replacement-task-created",
        kind: "task_created",
        observedAtMs: 2000,
        occurredAtMs: 2000,
        organizationId: "org_1",
        taskId: "replacement-task",
        text: "Research competitor onboarding.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "replacement-task-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "replacement-task-attempt",
        nowMs: 2001,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "replacement-task",
      });
      const running = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 2002,
        organizationId: "org_1",
        status: "running",
        taskId: "replacement-task",
      });
      await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "replacement-task-stop-requested",
        expectedTaskVersion: running.task.version,
        idempotencyKey: buildCenterAgentTaskReplacementStopIdempotencyKey(
          "replacement-task-instruction"
        ),
        nowMs: 2003,
        organizationId: "org_1",
        replacementInstruction: {
          eventId: "replacement-task-instruction",
          idempotencyKey: "replace-with-security-review",
          occurredAtMs: 2004,
          text: "Replace the current work with a security-focused review.",
        },
        taskId: "replacement-task",
        text: "Stop requested before replacing the current instruction.",
      });

      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: delivery.dispatchId,
          idempotencyKey: delivery.idempotencyKey,
          organizationId: "org_1",
          spaceId: delivery.spaceId,
          submissionId: "replacement-task-submission",
          text: "This replaced result must remain sealed.",
          triggerMessageId: delivery.triggerMessageId,
        })
      ).resolves.toMatchObject({
        publishedSignalId: null,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        status: "accepted",
      });

      expect(env.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "center-agent-task:replacement-task",
          messages: [
            {
              content:
                "Replace the current work with a security-focused review.",
              role: "user",
            },
          ],
        })
      );
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "replacement-task",
        })
      ).resolves.toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
      });
      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org_1",
        taskId: "replacement-task",
      });
      expect(events.map((event) => event.kind)).toEqual([
        "task_created",
        "stop_requested",
        "requester_message",
        "task_stopped",
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps a terminal hosted Slack failure fenced from outcome recovery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.run({
        params: [originalDelivery.deliveryId],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET status = 'failed',
              failure_code = 'remote_agent.execution_interrupted',
              failure_detail = 'The hosted execution was interrupted.',
              updated_at_ms = 1900
          WHERE delivery_id = ?
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
      harness.close();
    }
  });

  it("keeps the immutable Lark locator without reopening a terminal outcome", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.run({
        params: [originalDelivery.deliveryId],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET status = 'failed',
              failure_code = 'remote_agent.execution_interrupted',
              failure_detail = 'The hosted execution was interrupted.',
              updated_at_ms = 2000
          WHERE delivery_id = ?
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
      harness.close();
    }
  });

  it("keeps a fresh hosted Lark Wake outside terminal outcome recovery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      harness.run({
        params: ["idempotency-lark-tier3-original"],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET failure_code = 'remote_agent.conversation_history_limit_exceeded'
          WHERE idempotency_key = ?
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
      harness.close();
    }
  });

  it("maps a structured Slack admission rejection to Core-owned public copy", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("truncates oversized Slack trigger text before writing the native delivery ledger", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      submissionId: "sub_slack_long",
      requestId: "req_slack_long",
      status: "pending" as const,
      createdAt: 1001,
      accepted: true,
    }));
    const sourceText = `${"a".repeat(
      REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS - 1
    )}🙂 tail`;
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
      harness.close();
    }
  });

  it("restores persisted thread placement context for successful callbacks", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("projects a confirmed cancellation callback as stopped rather than failed", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_cancelled",
        spaceId: SPACE_ID,
      });
      const env = buildEnv(harness.db, { postSignalId: "signal_cancelled" });
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
          noticeText: "This request was stopped.",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("publishes terminal turn failures as Remote Agent native delivery outcomes", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "idem_1",
        submissionId: "sub_failed",
        spaceId: SPACE_ID,
        threadContext: THREAD_CONTEXT,
      });
      const env = buildEnv(harness.db, { postSignalId: "signal_failure_1" });

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

      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            clientMessageId: "sub_failed",
            errorCode: "remote_agent.turn_not_completed",
            errorDetail:
              "Cloudflare AI binding request failed with 502 Bad Gateway.",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          }),
          text: "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
          threadContext: THREAD_CONTEXT,
        })
      );
      expect(env.__spaceStub.rpcCloseAgentStream).toHaveBeenCalledWith({
        spaceId: SPACE_ID,
        streamId: "stream:sub_failed",
        terminal: {
          kind: "failed",
          reasonCode: "remote_agent.turn_not_completed",
          noticeText:
            "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
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
    } finally {
      harness.close();
    }
  });

  it("keeps a precise provider rate-limit reason in the published failure", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
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
      harness.close();
    }
  });

  it("completes member research callbacks without fabricating a Direct Message reply", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const taskId = "member_research_task_completed";
    const submissionId = "sub_member_research_completed";
    try {
      seedRunningMemberResearchTask(harness, taskId);
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
      harness.close();
    }
  });

  it("fails member research callbacks without fabricating a Direct Message failure", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    const taskId = "member_research_task_failed";
    const submissionId = "sub_member_research_failed";
    try {
      seedRunningMemberResearchTask(harness, taskId);
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
      harness.close();
    }
  });

  it("reconciles accepted native deliveries without imposing a total deadline", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
        reasonCode: "remote_agent.execution_reconciliation_unavailable",
        status: "skipped",
      });
      expect(dispatchQueueSend).toHaveBeenLastCalledWith(probe, {
        delaySeconds: 300,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_expired",
        })
      ).resolves.toMatchObject({ acceptedProbeNextDueAtMs: 860_000 });
      expect(mixedVersionEnv.__spaceStub.rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("terminalizes a reconciled execution identity mismatch without renewing its probe", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            errorCode: "remote_agent.execution_identity_mismatch",
          }),
          text: "OpenMeld stopped this request because it could not confirm that the reply came from your Center Agent. Send the request again. If it keeps happening, open diagnostics in OpenMeld.",
        })
      );
    } finally {
      harness.close();
    }
  });

  it("redrives an identity-mismatch failure publication until it is visible", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
          text: "OpenMeld stopped this request because it could not confirm that the reply came from your Center Agent. Send the request again. If it keeps happening, open diagnostics in OpenMeld.",
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
      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledTimes(2);
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
      harness.close();
    }
  });

  it("preserves callback publish failure cause when the deadline probe closes a legacy accepted row", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          finalOutcomeAuthority: "remote_agent_native_delivery",
          meta: expect.objectContaining({
            errorCode: "remote_agent.callback_publish_failed",
            purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          }),
          text: "Center Agent finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open diagnostics in OpenMeld.",
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
      harness.close();
    }
  });

  it("skips deadline probes when the callback already completed the delivery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      seedWaitingNativeDeliveryDispatch(harness);
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
      harness.close();
    }
  });

  it("returns retryable when callback failure text publishing fails, then completes on retry", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      seedWaitingNativeDeliveryDispatch(harness);
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

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, { postSignalId: "signal_failure_retry" }),
          { ...body, callbackAttempt: 2 }
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "signal_failure_retry",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_failed_retry",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_not_completed",
        publishedSignalId: "signal_failure_retry",
        status: "failed",
      });
      await expect(
        readDispatchProjection(harness.db, "idem_1")
      ).resolves.toEqual({
        attemptErrorCode: "remote_agent.turn_not_completed",
        attemptErrorMessage:
          "The provider stopped after the model exceeded its context window.",
        attemptStatus: "failed_terminal",
        dispatchStatus: "failed_terminal",
      });
    } finally {
      harness.close();
    }
  });

  it("does not close the Wake trace from an unpublished failed native delivery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      seedWaitingNativeDeliveryDispatch(harness);
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
      harness.close();
    }
  });

  it("publishes concurrent failed Space callbacks only once", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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

      expect(env.__spaceStub.rpcPostSignal).toHaveBeenCalledOnce();
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
      harness.close();
    }
  });

  it("keeps a completed callback retryable after the former attempt ceiling", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("keeps concurrent callback publication failures retryable", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("does not replace an undelivered reply with a synthetic failure", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
    }
  });

  it("keeps the first persisted final reply id when a callback retry receives a duplicate Space payload", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
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
      harness.close();
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
      const harness = createSqliteD1Harness();
      applyRemoteAgentSubmitMigrations(harness);
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
        harness.close();
      }
    }
  });

  it("rejects and records an unknown callback submission", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("records a stale callback after its delivery already failed", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("publishes a late success after reconciling a retired deadline failure", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("rejects mismatched callback roots before writing a Space reply", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentSubmitMigrations(harness);
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "callback-rejected-task",
        db: harness.db,
        deliveryId: "dispatch_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "sub_1",
      });
      if (!delivery) {
        throw new Error("expected accepted delivery");
      }
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-callback-rejected-task",
        nowMs: 1100,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: null,
        taskId: "callback-rejected-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "callback-rejected-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "callback-rejected-task-created",
        kind: "task_created",
        observedAtMs: 1100,
        occurredAtMs: 1100,
        organizationId: "org_1",
        taskId: "callback-rejected-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "callback-rejected-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "callback-rejected-attempt",
        nowMs: 1101,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "callback-rejected-task",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1102,
        organizationId: "org_1",
        status: "running",
        taskId: "callback-rejected-task",
      });

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          submissionId: "sub_1",
          idempotencyKey: "space_1:dispatch_1",
          organizationId: "org_1",
          spaceId: "space_1",
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_other",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          text: "Done.",
        })
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_binding_mismatch",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "callback_rejected",
        failureCode: "remote_agent.callback_binding_mismatch",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "callback-rejected-task",
        })
      ).resolves.toMatchObject({
        status: "failed",
      });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org_1",
          taskId: "callback-rejected-task",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        {
          kind: "task_failed",
          text: "Center Agent could not finish this Task. Retry it or open diagnostics.",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("projects a rejected Task callback across independent native, Task, and Inbox stores", async () => {
    const nativeStore = createSqliteD1Harness();
    const taskStore = createSqliteD1Harness();
    const inboxStore = createSqliteD1Harness();
    applyMigrationForTable(
      nativeStore,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    seedTaskIdentityTables(taskStore);
    applyDrizzleMigrationsForTables(taskStore, [
      "center_agent_tasks",
      "center_agent_task_attempts",
      "center_agent_task_events",
    ]);
    seedTaskIdentityTables(inboxStore);
    applyDrizzleMigrationsForTables(inboxStore, [
      "space_index_spaces",
      "space_index_memberships",
      "center_agent_task_authorized_readers",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "split-store-task",
        db: nativeStore.db,
        deliveryId: "dispatch_1",
        dispatchId: "dispatch_1",
        idempotencyKey: "split-task-delivery",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        submissionId: "split-task-submission",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: nativeStore.db,
        submissionId: "split-task-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted split-store delivery");
      }
      await createCenterAgentTask({
        db: taskStore.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-split-store-task",
        nowMs: 1100,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "split-store-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: taskStore.db,
        eventId: "split-store-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "split-store-task-created",
        kind: "task_created",
        observedAtMs: 1100,
        occurredAtMs: 1100,
        organizationId: "org_1",
        taskId: "split-store-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "split-store-attempt",
        db: taskStore.db,
        expectedTaskVersion: 2,
        idempotencyKey: "split-store-attempt",
        nowMs: 1101,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "split-store-task",
      });
      await transitionCenterAgentTaskAttempt({
        db: taskStore.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1102,
        organizationId: "org_1",
        status: "running",
        taskId: "split-store-task",
      });
      const env = buildEnv(inboxStore.db);
      env.OPENMELD_LOCAL_STATE_DB = taskStore.db;
      env.OPENMELD_WAKE_EVIDENCE_DB = nativeStore.db;

      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_other",
          dispatchId: "dispatch_1",
          idempotencyKey: "split-task-delivery",
          organizationId: "org_1",
          spaceId: "space_1",
          submissionId: "split-task-submission",
          text: "Private mismatch detail must not be published.",
          triggerMessageId: "signal_1",
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_binding_mismatch",
        status: "rejected",
      });

      await expect(
        readCenterAgentTask({
          db: taskStore.db,
          organizationId: "org_1",
          taskId: "split-store-task",
        })
      ).resolves.toMatchObject({ status: "failed" });
      expect(
        inboxStore.queryAll<{
          attention: string;
          preview: string;
          source_kind: string;
        }>({
          sql: "SELECT attention, preview, source_kind FROM inbox_items",
        })
      ).toEqual([
        {
          attention: "update",
          preview:
            "Center Agent could not finish this Task. Retry it or open diagnostics.",
          source_kind: "center_agent_task_event",
        },
      ]);
    } finally {
      nativeStore.close();
      taskStore.close();
      inboxStore.close();
    }
  });

  it("redrives the exact completed Task result after terminal projection is delayed", async () => {
    const harness = createSqliteD1Harness();
    seedTaskIdentityTables(harness);
    applyRemoteAgentLedgerMigration(harness);
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "delayed-terminal-task",
        db: harness.db,
        deliveryId: "delayed-terminal-delivery",
        dispatchId: "delayed-terminal-delivery",
        idempotencyKey: "delayed-terminal-delivery",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "delayed-terminal-submission",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "delayed-terminal-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted delayed-terminal delivery");
      }
      const env = buildEnv(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: delivery.dispatchId,
          idempotencyKey: delivery.idempotencyKey,
          organizationId: "org_1",
          spaceId: delivery.spaceId,
          submissionId: "delayed-terminal-submission",
          text: "The onboarding research is complete.",
          triggerMessageId: delivery.triggerMessageId,
        })
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "delayed-terminal-submission",
        })
      ).resolves.toMatchObject({
        finalPublicationPayload: {
          text: "The onboarding research is complete.",
        },
        status: "completed",
      });
      await expect(
        retryPendingCenterAgentTaskTerminalProjections({
          deliveryDb: harness.db,
          env,
          nowMs: 1199,
        })
      ).resolves.toEqual({
        canonicalized: 0,
        errors: 0,
        ownerRejected: 0,
        retained: 1,
        scanned: 1,
      });

      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-delayed-terminal-task",
        nowMs: 1200,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "delayed-terminal-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "delayed-terminal-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "delayed-terminal-task-created",
        kind: "task_created",
        observedAtMs: 1200,
        occurredAtMs: 1200,
        organizationId: "org_1",
        taskId: "delayed-terminal-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "delayed-terminal-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "delayed-terminal-attempt",
        nowMs: 1201,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "delayed-terminal-task",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1202,
        organizationId: "org_1",
        status: "running",
        taskId: "delayed-terminal-task",
      });

      await expect(
        retryPendingCenterAgentTaskTerminalProjections({
          deliveryDb: harness.db,
          env,
          nowMs: 1203,
        })
      ).resolves.toEqual({
        canonicalized: 1,
        errors: 0,
        ownerRejected: 0,
        retained: 0,
        scanned: 1,
      });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org_1",
          taskId: "delayed-terminal-task",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        {
          kind: "task_succeeded",
          text: "The onboarding research is complete.",
        },
      ]);
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "delayed-terminal-submission",
        })
      ).resolves.toMatchObject({
        finalPublicationPayload: null,
        status: "completed",
      });
      await expect(
        retryPendingCenterAgentTaskTerminalProjections({
          deliveryDb: harness.db,
          env,
          nowMs: 1204,
        })
      ).resolves.toEqual({
        canonicalized: 0,
        errors: 0,
        ownerRejected: 0,
        retained: 0,
        scanned: 0,
      });
    } finally {
      harness.close();
    }
  });

  it("rotates retained Task results so one blocked batch cannot starve later work", async () => {
    const harness = createSqliteD1Harness();
    seedTaskIdentityTables(harness);
    applyRemoteAgentLedgerMigration(harness);
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    try {
      const env = buildEnv(harness.db);
      for (let index = 0; index < 51; index += 1) {
        const suffix = String(index).padStart(3, "0");
        await createRetainedTaskResult({
          centerAgentTaskId: `blocked-task-${suffix}`,
          db: harness.db,
          deliveryId: `blocked-delivery-${suffix}`,
          submissionId: `blocked-submission-${suffix}`,
        });
      }
      const readyDeliveryId = "ready-delivery-after-blocked-batch";
      await createRetainedTaskResult({
        centerAgentTaskId: "ready-task-after-blocked-batch",
        db: harness.db,
        deliveryId: readyDeliveryId,
        submissionId: "ready-submission-after-blocked-batch",
      });
      await createCenterAgentTask({
        db: harness.db,
        goal: "Finish the result behind the blocked recovery batch.",
        idempotencyKey: "create-ready-task-after-blocked-batch",
        nowMs: 2000,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "ready-task-after-blocked-batch",
        title: "Finish queued result",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "ready-attempt-after-blocked-batch",
        db: harness.db,
        expectedTaskVersion: 1,
        idempotencyKey: "ready-attempt-after-blocked-batch",
        nowMs: 2001,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: readyDeliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "ready-task-after-blocked-batch",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 2,
        failureCode: null,
        generation: 1,
        nowMs: 2002,
        organizationId: "org_1",
        status: "running",
        taskId: "ready-task-after-blocked-batch",
      });

      await expect(
        retryPendingCenterAgentTaskTerminalProjections({
          deliveryDb: harness.db,
          env,
          limit: 50,
          nowMs: 2003,
        })
      ).resolves.toMatchObject({ retained: 50, scanned: 50 });
      await expect(
        retryPendingCenterAgentTaskTerminalProjections({
          deliveryDb: harness.db,
          env,
          limit: 50,
          nowMs: 2004,
        })
      ).resolves.toEqual({
        canonicalized: 1,
        errors: 0,
        ownerRejected: 0,
        retained: 49,
        scanned: 50,
      });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org_1",
          taskId: "ready-task-after-blocked-batch",
        })
      ).resolves.toMatchObject([
        {
          kind: "task_succeeded",
          text: "The exact retained Task result.",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("erases an exact completed result after the Task owner rejects terminal projection", async () => {
    const harness = createSqliteD1Harness();
    seedTaskIdentityTables(harness);
    applyRemoteAgentLedgerMigration(harness);
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    try {
      await createAcceptedDelivery({
        centerAgentTaskId: "owner-rejected-task",
        db: harness.db,
        deliveryId: "owner-rejected-delivery",
        dispatchId: "owner-rejected-delivery",
        idempotencyKey: "owner-rejected-delivery",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        spaceId: SPACE_ID,
        submissionId: "owner-rejected-submission",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "owner-rejected-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted owner-rejected delivery");
      }
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-owner-rejected-task",
        nowMs: 1200,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "owner-rejected-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "owner-rejected-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "owner-rejected-task-created",
        kind: "task_created",
        observedAtMs: 1200,
        occurredAtMs: 1200,
        organizationId: "org_1",
        taskId: "owner-rejected-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "owner-rejected-attempt",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "owner-rejected-attempt",
        nowMs: 1201,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "owner-rejected-task",
      });
      const running = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1202,
        organizationId: "org_1",
        status: "running",
        taskId: "owner-rejected-task",
      });
      const waiting = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: running.task.version,
        failureCode: null,
        generation: 1,
        nowMs: 1203,
        organizationId: "org_1",
        status: "needs_attention",
        taskId: "owner-rejected-task",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "owner-rejected-needs-attention",
        expectedTaskVersion: waiting.task.version,
        idempotencyKey: "owner-rejected-needs-attention",
        kind: "needs_attention",
        observedAtMs: 1203,
        occurredAtMs: 1203,
        organizationId: "org_1",
        taskId: "owner-rejected-task",
        text: "Choose a release owner.",
      });

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: delivery.dispatchId,
          idempotencyKey: delivery.idempotencyKey,
          organizationId: "org_1",
          spaceId: delivery.spaceId,
          submissionId: "owner-rejected-submission",
          text: "Sensitive exact result that the Task owner cannot accept.",
          triggerMessageId: delivery.triggerMessageId,
        })
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org_1",
          taskId: "owner-rejected-task",
        })
      ).resolves.toMatchObject({ status: "needs_attention" });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org_1",
          taskId: "owner-rejected-task",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        { kind: "needs_attention", text: "Choose a release owner." },
      ]);
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "owner-rejected-submission",
        })
      ).resolves.toMatchObject({
        deliveryId: "owner-rejected-delivery",
        finalPublicationPayload: null,
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a completed Task callback across independent native, Task, and owner stores", async () => {
    const nativeStore = createSqliteD1Harness();
    const taskStore = createSqliteD1Harness();
    const ownerStore = createSqliteD1Harness();
    applyMigrationForTable(
      nativeStore,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    applyMigrationForTable(nativeStore, "openMeldDaemon_dispatch_ledger");
    applyMigrationForTable(nativeStore, "openMeldDaemon_dispatch_attempts");
    seedTaskIdentityTables(taskStore);
    applyDrizzleMigrationsForTables(taskStore, [
      "center_agent_tasks",
      "center_agent_task_attempts",
      "center_agent_task_events",
    ]);
    applyMigrationForTable(taskStore, "slack_workspace_tokens");
    seedTaskIdentityTables(ownerStore);
    applyDrizzleMigrationsForTables(ownerStore, [
      "space_index_spaces",
      "space_index_memberships",
      "center_agent_task_authorized_readers",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    applyMigrationForTable(ownerStore, "agent_delegation_children");
    applyMigrationForTable(ownerStore, "agent_delegations");
    applyMigrationForTable(ownerStore, "agent_task_completion_subscriptions");
    applyMigrationForTable(ownerStore, "agent_task_terminal_outcomes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, ts: "1700000000.000099" }))
    );
    try {
      const slackConversationId = "slack:T123:C123:1700000000.000001";
      await createAcceptedDelivery({
        centerAgentTaskId: "split-completed-task",
        conversationKind: "slack",
        db: nativeStore.db,
        deliveryId: "split-completed-task-delivery",
        dispatchId: "split-completed-task-delivery",
        idempotencyKey: "split-completed-task-delivery",
        onBehalfOfProfileId: HUMAN_PROFILE_ID,
        onBehalfOfUserId: "user_1",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1700000000.000001",
        spaceId: slackConversationId,
        submissionId: "split-completed-task-submission",
        triggerMessageId: "1700000000.000001",
      });
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: nativeStore.db,
        submissionId: "split-completed-task-submission",
      });
      if (!delivery) {
        throw new Error("expected accepted split-store Task delivery");
      }
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: ownerStore.db,
        idempotencyKey: "split-completed-task-subscription-key",
        nowMs: 1099,
        observerTask: {
          deliveryId: "split-completed-task-observer",
          kind: "native_delivery",
          v: 1,
        },
        organizationId: "org_1",
        subscriptionId: "split-completed-task-subscription",
        watchedTask: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
      });
      await createCenterAgentTask({
        db: taskStore.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-split-completed-task",
        nowMs: 1100,
        organizationId: "org_1",
        origin: { kind: "open_meld" },
        requesterUserId: "user_1",
        taskId: "split-completed-task",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: taskStore.db,
        eventId: "split-completed-task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "split-completed-task-created",
        kind: "task_created",
        observedAtMs: 1100,
        occurredAtMs: 1100,
        organizationId: "org_1",
        taskId: "split-completed-task",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "split-completed-task-attempt",
        db: taskStore.db,
        expectedTaskVersion: 2,
        idempotencyKey: "split-completed-task-attempt",
        nowMs: 1101,
        organizationId: "org_1",
        taskHandle: {
          deliveryId: delivery.deliveryId,
          kind: "native_delivery",
          v: 1,
        },
        taskId: "split-completed-task",
      });
      await transitionCenterAgentTaskAttempt({
        db: taskStore.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: 1102,
        organizationId: "org_1",
        status: "running",
        taskId: "split-completed-task",
      });
      const env = buildEnv(ownerStore.db, { slackBotToken: "xoxb-test" });
      env.OPENMELD_LOCAL_STATE_DB = taskStore.db;
      env.OPENMELD_WAKE_EVIDENCE_DB = nativeStore.db;

      await expect(
        completeRemoteAgentNativeDelivery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_1",
          dispatchId: delivery.dispatchId,
          idempotencyKey: delivery.idempotencyKey,
          organizationId: "org_1",
          spaceId: slackConversationId,
          submissionId: "split-completed-task-submission",
          text: "The onboarding research is complete.",
          triggerMessageId: delivery.triggerMessageId,
        })
      ).resolves.toMatchObject({ status: "accepted" });

      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: nativeStore.db,
          submissionId: "split-completed-task-submission",
        })
      ).resolves.toMatchObject({ status: "completed" });
      await expect(
        readCenterAgentTask({
          db: taskStore.db,
          organizationId: "org_1",
          taskId: "split-completed-task",
        })
      ).resolves.toMatchObject({ status: "succeeded" });
      await expect(
        readAgentTaskTerminalOutcome({
          db: ownerStore.db,
          taskKey: buildAgentTaskKey({
            deliveryId: delivery.deliveryId,
            kind: "native_delivery",
            v: 1,
          }),
        })
      ).resolves.toMatchObject({
        outcome: { status: "succeeded" },
      });
      const inboxItems = ownerStore.queryAll<{
        preview: string;
        source_kind: string;
      }>({
        sql: "SELECT preview, source_kind FROM inbox_items",
      });
      expect(inboxItems).toEqual([
        {
          preview: "The onboarding research is complete.",
          source_kind: "center_agent_task_event",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      nativeStore.close();
      taskStore.close();
      ownerStore.close();
    }
  });

  it("rejects completed callback retries without changing the completed outcome", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });
});

function applyRemoteAgentLedgerMigration(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  ensureTaskIdentityTables(input);
  applyDrizzleMigrationsForTables(input, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_authorized_readers",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
  ]);
  applyDrizzleMigrationsForTables(input, [
    "openMeldRemoteAgent_native_delivery_ledger",
    "openMeldRemoteAgent_work_loop_attempts",
  ]);
  applyMigrationForTable(input, "openMeldRemoteAgent_daily_admissions");
  applyMigrationForTable(input, "openMeldRemoteAgent_conversation_generations");
  applyMigrationForTable(input, "slack_workspace_tokens");
  applyMigrationForTable(input, "openMeldDaemon_dispatch_ledger");
  applyMigrationForTable(input, "openMeldDaemon_dispatch_attempts");
  applyMigrationForTable(input, "agent_delegation_children");
  applyMigrationForTable(input, "agent_delegations");
  applyMigrationForTable(input, "agent_task_completion_subscriptions");
  applyMigrationForTable(input, "agent_task_terminal_outcomes");
  applyMemberResearchMigrations(input);
}

function applyRemoteAgentSubmitMigrations(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  applyRemoteAgentTurnEnvelopeFactMigrations(input);
  applyDrizzleMigrationsForTables(input, [
    "organization_skill_releases",
    "organization_skills",
  ]);
  applyRemoteAgentLedgerMigration(input);
  applyMigrationForTable(input, "openMeldDaemon_agent_profile_bindings");
  applyMigrationForTable(input, "openMeldDaemon_dlq");
  seedCenterAgentDesignation(input);
  seedRemoteAgentTurnEnvelopeFacts(input);
  seedCenterAgentTaskAdmissionAuthority(input);
}

function seedTaskIdentityTables(
  input: Parameters<typeof applyMigrationForTable>[0]
): void {
  ensureTaskIdentityTables(input);
  input.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org_1', 'OpenMeld Labs', 'openmeld-labs', 1000)",
  });
  input.run({
    sql: "INSERT INTO users (id, name, email) VALUES ('user_1', 'Ari', 'ari@example.test')",
  });
}

function ensureTaskIdentityTables(
  input: Parameters<typeof applyMigrationForTable>[0]
): void {
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `,
  });
}

function applyRoutineContinuationMigrations(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    sql: `
      CREATE TABLE routines (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        target_space_id TEXT
      )
    `,
  });
  applyMigrationForTable(input, "routine_runs");
}

function seedWaitingNativeDeliveryDispatch(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    idempotencyKey?: string;
  } = {}
): void {
  const idempotencyKey = input.idempotencyKey ?? "idem_1";
  harness.run({
    params: [
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
    sql: `
      INSERT INTO openMeldDaemon_dispatch_ledger (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
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
    sql: `
      INSERT INTO openMeldDaemon_dispatch_attempts (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

async function readDispatchProjection(
  db: D1Database,
  idempotencyKey: string
): Promise<{
  attemptErrorCode: string | null;
  attemptErrorMessage: string | null;
  attemptStatus: string;
  dispatchStatus: string;
} | null> {
  return await db
    .prepare(
      `
        SELECT
          ledger.status AS dispatchStatus,
          attempt.status AS attemptStatus,
          attempt.error_code AS attemptErrorCode,
          attempt.error_message AS attemptErrorMessage
        FROM openMeldDaemon_dispatch_ledger AS ledger
        INNER JOIN openMeldDaemon_dispatch_attempts AS attempt
          ON attempt.attempt_id = ledger.latest_attempt_id
        WHERE ledger.idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(idempotencyKey)
    .first();
}

function applyMemberResearchMigrations(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  applyMigrationForTable(input, "center_agent_member_research_batches");
}

function seedRunningMemberResearchTask(
  input: Parameters<typeof applyMigrationForTable>[0],
  taskId: string
) {
  input.run({
    sql: `
      INSERT INTO center_agent_member_research_batches (
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
  input.run({
    sql: `
      INSERT INTO center_agent_member_research_tasks (
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

function applyRemoteAgentTurnEnvelopeFactMigrations(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS center_agent_designations (
        organization_id TEXT PRIMARY KEY,
        agent_profile_id TEXT NOT NULL,
        duty TEXT,
        designated_by TEXT NOT NULL,
        operating_state TEXT NOT NULL DEFAULT 'active',
        paused_at INTEGER,
        paused_by_user_id TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS openmeld_profiles (
        profile_id TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        profile_handle TEXT NOT NULL,
        profile_kind TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        managed_role TEXT,
        status TEXT NOT NULL
      )
    `,
  });
  applyMigrationForTable(input, "space_index_spaces");
}

function seedCenterAgentDesignation(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: ["org_1", AGENT_PROFILE_ID, "user_1", 100],
    sql: `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `,
  });
}

function seedCenterAgentTaskAdmissionAuthority(
  input: Parameters<typeof applyMigrationForTable>[0]
): void {
  input.run({
    params: [
      "binding_1",
      "owner_account",
      "user_1",
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
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

function seedRemoteAgentTurnEnvelopeFacts(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: ["user_1", "Ari", "ari@example.test", 100, 100],
    sql: `
      INSERT OR IGNORE INTO users (
        id,
        name,
        email,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: ["org_1", "OpenMeld Labs", "openmeld-labs", "{}", 100],
    sql: `
      INSERT OR IGNORE INTO organizations (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: ["member_1", "org_1", "user_1", "owner", 100],
    sql: `
      INSERT OR IGNORE INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      HUMAN_PROFILE_ID,
      "Ari",
      "ari",
      "human",
      "org_1",
      "user_1",
      null,
      "active",
    ],
    sql: `
      INSERT OR IGNORE INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        organization_id,
        owner_user_id,
        managed_role,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      AGENT_PROFILE_ID,
      "Center Agent",
      "center-agent",
      "agent",
      "org_1",
      "user_1",
      "center_agent",
      "active",
    ],
    sql: `
      INSERT OR IGNORE INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        organization_id,
        owner_user_id,
        managed_role,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
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
    sql: `
      INSERT OR IGNORE INTO space_index_spaces (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

function createTestMemoryService(
  overrides: Partial<CenterAgentMemoryService> = {}
): CenterAgentMemoryService {
  return {
    deleteMemberMemory: vi.fn(async () => "deleted" as const),
    deleteOrganizationMemory: vi.fn(async () => "deleted" as const),
    recallForOrganization: vi.fn(async () => ({ items: [], truncated: false })),
    recallForTurn: vi.fn(async () => ({ items: [], truncated: false })),
    readOrganizationMemoryPolicy: vi.fn(async () => ({
      organizationMemoryOptIn: false,
      updatedByUserId: null,
    })),
    rememberFactForOrganization: vi.fn(async () => undefined),
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
    addEpisode: vi.fn(async () => undefined),
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

function deleteCenterAgentDesignation(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: ["org_1"],
    sql: "DELETE FROM center_agent_designations WHERE organization_id = ?",
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
  remoteAgentDailyAdmissionLimit?: string;
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
  db: D1Database,
  options: BuildEnvOptions = {}
): CoreBindings & { __spaceStub: TestSpaceStub } {
  let postSignalAttempts = 0;
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
    rpcPostSignal: vi.fn((input) => {
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
    }),
    rpcPostSignalOnceByClientMessageId: vi.fn(() =>
      createSignalEnvelope(options.postSignalId ?? "signal_reply_1")
    ),
    rpcPostSystemNoticeSignal: vi.fn((input) => ({
      ...createSignalEnvelope(options.postSignalId ?? "signal_reply_1"),
      type: "signal.system_notice" as const,
      data: input.data,
    })),
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
    OPENMELD_DB: db,
    OPENMELD_LOCAL_STATE_DB: db,
    SLACK_OPENMELD_BOT_TOKEN: options.slackBotToken,
    OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS:
      options.remoteAgentBlockedOrganizationIds ?? "",
    OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT:
      options.remoteAgentDailyAdmissionLimit,
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
  } as CoreBindings & { __spaceStub: TestSpaceStub };
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
    if (code >= 0xd8_00 && code <= 0xdb_ff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc_00 && next <= 0xdf_ff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc_00 && code <= 0xdf_ff) {
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

async function createRetainedTaskResult(input: {
  centerAgentTaskId: string;
  db: D1Database;
  deliveryId: string;
  submissionId: string;
}): Promise<void> {
  await createAcceptedDelivery({
    centerAgentTaskId: input.centerAgentTaskId,
    db: input.db,
    deliveryId: input.deliveryId,
    dispatchId: input.deliveryId,
    idempotencyKey: input.deliveryId,
    onBehalfOfProfileId: HUMAN_PROFILE_ID,
    onBehalfOfUserId: "user_1",
    spaceId: SPACE_ID,
    submissionId: input.submissionId,
    triggerMessageId: input.deliveryId,
  });
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'completed',
          final_publication_payload_json = ?,
          callback_received_at_ms = 1200,
          completed_at_ms = 1200,
          updated_at_ms = 1200
        WHERE delivery_id = ?
      `
    )
    .bind(
      JSON.stringify({
        attachments: [],
        failureCode: null,
        failureDetail: null,
        resumeStatus: "accepted",
        storageVersion: 2,
        text: "The exact retained Task result.",
      }),
      input.deliveryId
    )
    .run();
}

async function createAcceptedDelivery(input: {
  centerAgentTaskId?: string;
  db: D1Database;
  conversationKind?: "message_channel" | "space" | "slack";
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
    spaceId: input.spaceId ?? "space_1",
    profileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: input.triggerMessageId ?? "signal_1",
    sourceClientMessageId: input.sourceClientMessageId ?? null,
    triggerText: input.triggerText ?? null,
    dispatchId: input.dispatchId ?? "dispatch_1",
    attemptId: input.centerAgentTaskId ? null : "attempt_1",
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
  if (input.modelRoute || input.centerAgentTaskId || input.turnEnvelope) {
    await persistTestCenterAgentWorkerSubmitRequest({
      bindingId: "binding_1",
      conversationId: input.centerAgentTaskId
        ? `center-agent-task:${input.centerAgentTaskId}`
        : undefined,
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
  db: D1Database;
  dispatchId: string;
  idempotencyKey: string;
  modelRoute?: CenterAgentModelRoute;
  requestVersion?: 2 | 4;
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
  conversationKind: "message_channel" | "slack";
  db: D1Database;
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
