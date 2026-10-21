import type {
  PostgreSQLBinding,
  PostgresDatabase,
} from "@openmeld/db/postgresql";
import { observePostgresDatabase } from "../test-support/postgresql-query.test-support";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

const finalizationDatabases = vi.hoisted(
  () => new WeakMap<PostgreSQLBinding, PostgresDatabase>()
);
vi.mock("@openmeld/db/postgresql", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@openmeld/db/postgresql")>();
  return {
    ...actual,
    getPostgresDatabase: (bindings: {
      OPENMELD_POSTGRESQL?: PostgreSQLBinding;
    }) =>
      (bindings.OPENMELD_POSTGRESQL &&
        finalizationDatabases.get(bindings.OPENMELD_POSTGRESQL)) ??
      actual.getPostgresDatabase(bindings),
  };
});

import { runInDurableObject } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  AgentTaskTerminalOutcome,
  RuntimeCoordinatorFinalizationCommand,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { buildDefaultSpaceContract } from "@openmeld/space-mesh";
import { describe, expect, it, vi } from "vitest";
import type { AgentTransportSpaceActionDeliveryInput } from "../src/dispatch/application/dispatch-execution-service";
import { buildLocalAgentStreamId } from "../src/runtime-transport/application/local-agent-stream";
import type { DispatchResultInboxRecord } from "../src/runtime-transport/infrastructure/postgresql/dispatch-result-inbox-repo";
import { buildAcceptedDispatchFinalizationQueueMessage } from "../src/space/application/accepted-dispatch-finalization";
import {
  type AgentStreamProjectionStorage,
  applyAgentStreamPart,
} from "../src/space/application/agent-stream-projection";
import {
  type AcceptedDispatchFinalizationFact,
  listAcceptedDispatchResultInboxRefsForSpace,
} from "../src/space/infrastructure/postgresql/accepted-dispatch-finalization-repo";
import {
  insertSignalRecord,
  readFinalReplyClaimSignalId,
} from "../src/space/infrastructure/sql/space-signal-repo";
import { parseStoredSignal } from "../src/space/rules/parsers/stored-signal";
import {
  resolveConfirmedAcceptedDispatchOutcome,
  resolveRuntimeCoordinatorFinalizationClaimRead,
  resolveRuntimeCoordinatorFinalizationVisibleFinalMessage,
  Space,
} from "../src/space/transport/do/space";
import { createProjectionPostgresDatabase } from "../test-support/postgresql-query.test-support";
import { env } from "../test-support/worker-env";

const DISPATCH_WRITE_PATTERN =
  /UPDATE "openmeld"."openMeldDaemon_dispatch_(ledger|attempts)"/u;

const sourceSignal = {
  v: 1,
  id: "signal-1",
  spaceId: "space-1",
  ts: 1_700_000_000_000,
  type: "signal.text",
  profile: {
    kind: "human",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileName: "Test User",
  },
  data: {
    text: "@agent(wake) hey",
    messageEnvelope: {
      activationTargets: ["agt_11111111-1111-4111-8111-111111111111"],
      referenceTargets: [],
      text: "@agent(wake) hey",
    },
  },
} satisfies SignalEnvelope;

const requestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Test User",
    requestId: "req-1",
  },
};

const baseFact = {
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  dispatchOwner: {
    id: "owner-1",
    kind: "owner_account",
  },
  enqueuedAtMs: 1_700_000_000_001,
  idempotencyKey: "source|target",
  sourceClientMessageId: "client-message-1",
  sourceEventId: "signal-1",
  spaceId: "space-1",
  targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
  taskId: "task-1",
} satisfies AcceptedDispatchFinalizationFact;

const baseInboxRecord = {
  acceptedAtMs: 1_700_000_000_100,
  attemptId: "attempt-1",
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-1",
  executionTokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  executionTokenRunId: "run-1",
  leaseEpoch: 1,
  publicationErrorCode: null,
  publishedSignalId: null,
  publishState: "result_accepted",
  resultKey: "dispatch-1::attempt-1",
  runtimeCoordinatorExecutionId: "rce-1",
  submittedConnectionGeneration: 2,
  targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
  taskId: "task-1",
  taskResult: {
    v: 4,
    code: "service.task_result",
    payload: {
      agentId: "agt_11111111-1111-4111-8111-111111111111",
      attemptId: "attempt-1",
      agentControllerRef: "builtin:codex",
      deduped: false,
      output: "Hey, I'm here.",
      sourceEventId: "signal-1",
      status: "success",
      taskId: "task-1",
    },
  },
  updatedAtMs: 1_700_000_000_100,
} satisfies DispatchResultInboxRecord;

const baseFinalizationCommand = {
  acceptedResult: {
    acceptedAtMs: baseInboxRecord.acceptedAtMs,
    attemptId: baseInboxRecord.attemptId,
    daemonSessionId: baseInboxRecord.daemonSessionId,
    dispatchId: baseInboxRecord.dispatchId,
    executionTokenFingerprint: baseInboxRecord.executionTokenFingerprint,
    executionTokenRunId: "run-1",
    leaseEpoch: baseInboxRecord.leaseEpoch,
    runtimeCoordinatorExecutionId: "rce-1",
    submittedConnectionGeneration:
      baseInboxRecord.submittedConnectionGeneration,
    targetProfileId: baseInboxRecord.targetProfileId,
    taskId: baseInboxRecord.taskId,
    taskResult: baseInboxRecord.taskResult,
  },
  createdAtMs: 1_700_000_000_150,
  dispatchFact: baseFact,
  dispatchId: baseInboxRecord.dispatchId,
  executionTokenRunId: "run-1",
  finalizationCommandId: "command-1",
  modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
  publicationIdempotencyKey: "publication:rce-1:run-1",
  resultIdempotencyKey: baseInboxRecord.resultKey,
  runtimeCoordinatorExecutionId: "rce-1",
  spaceId: "space-1",
  targetOwnerUserId: "owner-1",
  targetProfileId: baseInboxRecord.targetProfileId,
  targetProfileMentionLabel: null,
  targetProfileName: "Test Agent",
} satisfies RuntimeCoordinatorFinalizationCommand;

describe("accepted dispatch finalization", () => {
  it.each([
    [false, null],
    [true, null],
    [false, "computer.file_access.owner_declined"],
    [true, "computer.file_access.owner_declined"],
    [false, "context.workspace_recovery_declined"],
    [true, "context.workspace_recovery_declined"],
  ] as const)("elects one actual Space final claim (reply first: %s, owner refused: %s)", async (replyFirst, ownerRefused) => {
    const spaces = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
    ).OPENMELD_SPACES;
    const id = spaces.newUniqueId();
    const spaceId = id.toString();
    const space = spaces.get(id);
    await space.rpcInitializeDirectMessageMeta({
      spaceId,
      name: "Stop final claim",
      purpose: "direct_message",
      pairKey: spaceId,
      guide: "",
      organizationId: "org-1",
      visibility: "private",
    });
    const command: RuntimeCoordinatorFinalizationCommand = {
      ...baseFinalizationCommand,
      spaceId,
      dispatchFact: { ...baseFact, spaceId },
    };
    if (ownerRefused) {
      command.acceptedResult = {
        ...command.acceptedResult,
        taskResult: {
          ...baseInboxRecord.taskResult,
          payload: {
            agentId: baseFact.targetProfileId,
            attemptId: baseFact.attemptId,
            deduped: false,
            taskId: baseFact.taskId,
            sourceEventId: baseFact.sourceEventId,
            status: "failed",
            errorType: "policy",
            errorCode: ownerRefused,
            errorMessage: "Private path must not become public copy",
          },
        },
      };
    }
    const reply: SignalEnvelope = {
      ...sourceSignal,
      spaceId,
      id: "reply-before-stop",
      profile: {
        kind: "agent",
        profileId: baseFact.targetProfileId,
        profileName: "Test Agent",
      },
      data: {
        text: "Done",
        meta: {
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          dispatchId: baseFact.dispatchId,
          targetProfileId: baseFact.targetProfileId,
        },
      },
    };
    if (replyFirst) {
      await runInDurableObject(space, (_instance, state) => {
        insertSignalRecord(state.storage.sql, reply);
      });
    }
    const outcome =
      await space.rpcApplyRuntimeCoordinatorWakeStopCommand(command);
    expect(outcome.status).toBe(
      replyFirst ? "finalization_visible" : "wake_stopped_visible"
    );
    await expect(
      space.rpcApplyRuntimeCoordinatorWakeStopCommand(command)
    ).resolves.toEqual(outcome);
    await runInDurableObject(space, (_instance, state) => {
      expect(
        insertSignalRecord(state.storage.sql, { ...reply, id: "late-reply" })
          .duplicateFinalReplyBlocked
      ).toBe(true);
      const rows = state.storage.sql
        .exec<{ payload_json: string }>(
          "SELECT payload_json FROM space_signals"
        )
        .toArray();
      expect(rows).toHaveLength(1);
      if (!replyFirst && ownerRefused) {
        expect(JSON.parse(rows[0]?.payload_json ?? "null").data).toMatchObject({
          noticeType: "wake_stopped",
          reasonCode: ownerRefused,
          text: "The Computer owner stopped this task before the Agent started.",
        });
      }
      expect(JSON.parse(rows[0]?.payload_json ?? "null")).toMatchObject(
        replyFirst
          ? { id: reply.id }
          : {
              type: "signal.system_notice",
              data: {
                noticeType: "wake_stopped",
                dispatchId: baseFact.dispatchId,
              },
            }
      );
    });
  });

  it("confirms the original final claim after recovering its historical mention label", () => {
    const stored = JSON.stringify({
      ...sourceSignal,
      id: "historical-final",
      profile: { kind: "agent", profileId: baseFact.targetProfileId },
      data: {
        text: "Already completed",
        meta: {
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          dispatchId: baseFact.dispatchId,
          targetProfileId: baseFact.targetProfileId,
          targetProfileName: "Codex (1)",
          targetMentionLabel: "Codex (1)",
        },
      },
    });
    expect(
      resolveRuntimeCoordinatorFinalizationClaimRead({
        command: baseFinalizationCommand,
        readFinalReplyClaimSignalId: () => "historical-final",
        readSignalById: () => parseStoredSignal(stored),
      })
    ).toMatchObject({
      status: "finalization_visible",
      outcome: {
        ok: true,
        status: "already_final",
        publishState: "reply_published",
        publishedSignalId: "historical-final",
      },
    });
  });
  it("requires reply_published to point at the claimed visible final Space message", () => {
    const finalReplySignal = {
      ...sourceSignal,
      id: "signal-final-1",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      data: {
        text: "Hey, I'm here.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;

    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-final-1",
        readSignalById: (signalId) =>
          signalId === finalReplySignal.id ? finalReplySignal : null,
      })
    ).toEqual({ ok: true, publishedSignalId: "signal-final-1" });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-final-1",
        readSignalById: () => null,
      })
    ).toEqual({ ok: false });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => null,
        readSignalById: () => ({
          ...finalReplySignal,
          data: {
            text: "Not a final reply.",
            meta: {
              dispatchId: "dispatch-1",
              targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
            },
          },
        }),
      })
    ).toEqual({ ok: false });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-other",
        readSignalById: (signalId) =>
          signalId === finalReplySignal.id ? finalReplySignal : null,
      })
    ).toEqual({ ok: false });
  });

  it("closes on an already visible final reply when replay reports a different signal id", () => {
    const existingFinalReplySignal = {
      ...sourceSignal,
      id: "signal-final-existing",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      data: {
        text: "Already visible.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;

    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-replay-unpersisted",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-final-existing",
        readSignalById: (signalId) =>
          signalId === existingFinalReplySignal.id
            ? existingFinalReplySignal
            : null,
      })
    ).toEqual({ ok: true, publishedSignalId: "signal-final-existing" });
  });

  it("requires status and notice final outcomes to be the claimed target Wake result", () => {
    const statusSignal = {
      ...sourceSignal,
      id: "signal-status-final-1",
      type: "signal.status",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        status: "working",
        text: "Updated the task.",
      },
    } satisfies SignalEnvelope;
    const textSignal = {
      ...sourceSignal,
      id: "signal-text-final-1",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      data: {
        text: "The provider rejected this request.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;
    const terminalNoticeSignal = {
      ...sourceSignal,
      id: "signal-notice-final-1",
      type: "signal.system_notice",
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld",
      },
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.result.failed",
        text: "The agent could not complete this Wake.",
      },
    } satisfies SignalEnvelope;
    const failedCommand = {
      ...baseFinalizationCommand,
      acceptedResult: {
        ...baseFinalizationCommand.acceptedResult,
        taskResult: {
          ...baseFinalizationCommand.acceptedResult.taskResult,
          payload: {
            agentId: "agt_11111111-1111-4111-8111-111111111111",
            attemptId: "attempt-1",
            deduped: false,
            errorCode: "provider.rate_limited",
            errorMessage: "Provider quota exhausted.",
            errorType: "adapter",
            sourceEventId: "signal-1",
            status: "failed",
            taskId: "task-1",
          },
        },
      },
    } satisfies RuntimeCoordinatorFinalizationCommand;

    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-status-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => null,
        readSignalById: () => statusSignal,
      })
    ).toEqual({ ok: false });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-status-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-status-final-1",
        readSignalById: (signalId) =>
          signalId === statusSignal.id ? statusSignal : null,
      })
    ).toEqual({ ok: true, publishedSignalId: "signal-status-final-1" });
    for (const signal of [statusSignal, textSignal]) {
      expect(
        resolveConfirmedAcceptedDispatchOutcome({
          command: failedCommand,
          signal,
        })
      ).toEqual({
        errorCode: "provider.rate_limited",
        errorMessage: "Provider quota exhausted.",
        kind: "failure",
      });
    }
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-notice-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-notice-final-1",
        readSignalById: (signalId) =>
          signalId === terminalNoticeSignal.id ? terminalNoticeSignal : null,
      })
    ).toEqual({ ok: true, publishedSignalId: "signal-notice-final-1" });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: "signal-notice-final-1",
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => "signal-notice-final-1",
        readSignalById: () => ({
          ...terminalNoticeSignal,
          data: {
            ...terminalNoticeSignal.data,
            noticeType: "policy_blocked",
          },
        }),
      })
    ).toEqual({ ok: true, publishedSignalId: "signal-notice-final-1" });
    expect(
      resolveConfirmedAcceptedDispatchOutcome({
        command: baseFinalizationCommand,
        signal: {
          ...terminalNoticeSignal,
          data: {
            ...terminalNoticeSignal.data,
            noticeType: "policy_blocked",
          },
        },
      })
    ).toEqual({
      errorCode: "reply.invalid_space_action",
      errorMessage: "The agent could not complete this Wake.",
      kind: "failure",
    });
  });

  it("keeps a visible publication-exhaustion notice from being reclassified as a successful reply", () => {
    const publicationFailureSignal = {
      ...sourceSignal,
      id: "signal-publication-failed-1",
      type: "signal.system_notice",
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld",
      },
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-1",
        failureStage: "publication",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "runtime_coordinator.publication_retry_exhausted",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        text: "Test Agent finished, but OpenMeld couldn't post its reply.",
      },
    } satisfies SignalEnvelope;

    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command: baseFinalizationCommand,
        outcome: {
          publishedSignalId: publicationFailureSignal.id,
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => publicationFailureSignal.id,
        readSignalById: () => publicationFailureSignal,
      })
    ).toEqual({ ok: false });
    expect(
      resolveRuntimeCoordinatorFinalizationClaimRead({
        command: baseFinalizationCommand,
        readFinalReplyClaimSignalId: () => publicationFailureSignal.id,
        readSignalById: () => publicationFailureSignal,
      })
    ).toEqual({
      publishedSignalId: publicationFailureSignal.id,
      status: "publication_failed_visible",
    });
  });

  it("atomically claims a visible publication failure before RuntimeCoordinator terminalizes it", async () => {
    const { finalReplyClaims, signalRows, sql } = createSpaceSqlHarness([
      sourceSignal,
    ]);
    const broadcastSignal = vi.fn();
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown,
        options?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      ctx: { storage: { sql: SqlStorage } };
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext?: unknown
      ) => {
        dispatchMessages: unknown[];
        duplicateFinalReplyBlocked: boolean;
        persistedSignal: boolean;
      };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorPublicationExhaustionCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => unknown;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: { value: env },
      applySpaceRef: {
        value: vi.fn((spaceId: string) => {
          space.spaceId = spaceId;
        }),
      },
      broadcastSignal: { value: broadcastSignal },
      buildSystemNoticeSignal: {
        value: vi.fn(
          (
            profile: SignalEnvelope["profile"],
            data: Extract<
              SignalEnvelope,
              { type: "signal.system_notice" }
            >["data"]
          ) =>
            ({
              v: 1,
              id: "signal-publication-failed-1",
              spaceId: "space-1",
              ts: 1_700_000_000_100,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      ctx: { value: { storage: { sql } } },
      persistSignalWithOptionalOutbox: {
        value: vi.fn((signal: SignalEnvelope) => ({
          dispatchMessages: [],
          ...insertSignalRecord(sql, signal),
        })),
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand(
        baseFinalizationCommand
      )
    ).resolves.toEqual({
      publishedSignalId: "signal-publication-failed-1",
      status: "publication_failed_visible",
    });
    expect(
      finalReplyClaims.get(
        "dispatch-1:agt_11111111-1111-4111-8111-111111111111"
      )
    ).toBe("signal-publication-failed-1");
    expect(
      JSON.parse(
        String(signalRows.get("signal-publication-failed-1")?.payloadJson)
      )
    ).toMatchObject({
      data: {
        actorName: "Test Agent",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-1",
        failureStage: "publication",
        noticeType: "terminal_failure",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
        text: "Test Agent finished, but OpenMeld couldn't post its reply. Wake Test Agent again. If this keeps happening, open diagnostics.",
      },
      type: "signal.system_notice",
    });
    expect(broadcastSignal).toHaveBeenCalledOnce();
    await expect(
      space.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand(
        baseFinalizationCommand
      )
    ).resolves.toEqual({
      publishedSignalId: "signal-publication-failed-1",
      status: "publication_failed_visible",
    });
    expect(broadcastSignal).toHaveBeenCalledOnce();

    const lateReply = {
      ...sourceSignal,
      id: "signal-late-final-1",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      data: {
        text: "This reply arrived after publication was closed.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;
    expect(insertSignalRecord(sql, lateReply)).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      finalReplyClaims.get(
        "dispatch-1:agt_11111111-1111-4111-8111-111111111111"
      )
    ).toBe("signal-publication-failed-1");
  });

  it("does not replay accepted results from Space history reads", async () => {
    const access = createAuthenticatedSpaceAccessContext({
      requestContext,
      spaceId: "space-1",
    });
    const reconcileAcceptedResults = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("GET /signals must not replay accepted results");
    });
    const applyFailurePublicationCommand = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("GET /signals must not publish failure notices");
    });
    const handleListSignals = vi.fn(
      async () => new Response(JSON.stringify({ signals: [] }), { status: 200 })
    );
    const space = Object.create(Space.prototype) as {
      authorizeSpaceAccess: () => Promise<{ ok: true }>;
      dispatchSignalsRequest: (
        request: Request,
        options?: unknown
      ) => Promise<Response>;
      handleListSignals: (input: unknown) => Promise<Response>;
      reconcileAcceptedDispatchResultsFromDurableInbox: () => Promise<void>;
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: () => Promise<never>;
      resolveSpaceAccessFromRequest: () => {
        ok: true;
        spaceAccess: typeof access;
      };
    };
    Object.defineProperties(space, {
      authorizeSpaceAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      handleListSignals: {
        value: handleListSignals,
      },
      reconcileAcceptedDispatchResultsFromDurableInbox: {
        value: reconcileAcceptedResults,
      },
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: {
        value: applyFailurePublicationCommand,
      },
      resolveSpaceAccessFromRequest: {
        value: vi.fn(() => ({
          ok: true,
          spaceAccess: access,
        })),
      },
    });

    const response = await space.dispatchSignalsRequest(
      new Request("https://openmeld.test/signals", { method: "GET" })
    );

    expect(response.status).toBe(200);
    expect(handleListSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "11111111-1111-4111-8111-111111111111",
      })
    );
    expect(reconcileAcceptedResults).not.toHaveBeenCalled();
    expect(applyFailurePublicationCommand).not.toHaveBeenCalled();
  });

  it("does not replay accepted results when creating a diagnostic report", async () => {
    const waitUntil = vi.fn();
    const db = await createFinalizationPublishingPostgresDb({ fact: baseFact });
    const sql = {
      exec: vi.fn(() => ({
        toArray: () => [],
      })),
    } as unknown as SqlStorage;
    const reconcileAcceptedResults = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("diagnostic reports must not replay accepted results");
    });
    const applyFailurePublicationCommand = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("diagnostic reports must not publish failure notices");
    });
    const space = Object.create(Space.prototype) as {
      bindings: { OPENMELD_POSTGRESQL: PostgreSQLBinding };
      ctx: { storage: { sql: SqlStorage }; waitUntil: typeof waitUntil };
      handleCreateDiagnosticReport: (
        request: Request,
        context: typeof requestContext
      ) => Promise<Response>;
      readSignalById: (signalId: string) => SignalEnvelope | null;
      reconcileAcceptedDispatchResultsFromDurableInbox: () => Promise<void>;
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: () => Promise<never>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: { value: { OPENMELD_POSTGRESQL: db.binding } },
      ctx: { value: { storage: { sql }, waitUntil } },
      readSignalById: {
        value: vi.fn((signalId: string) =>
          signalId === sourceSignal.id ? sourceSignal : null
        ),
      },
      reconcileAcceptedDispatchResultsFromDurableInbox: {
        value: reconcileAcceptedResults,
      },
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: {
        value: applyFailurePublicationCommand,
      },
      spaceId: { value: "space-1", writable: true },
    });

    const response = await space.handleCreateDiagnosticReport(
      new Request("https://openmeld.test/diagnostic-reports", {
        method: "POST",
        body: JSON.stringify({
          reportedSignalId: sourceSignal.id,
          problemType: "no_reply",
        }),
      }),
      requestContext
    );

    expect(response.status).toBe(201);
    expect(
      await db.fixture
        .rows("openMeldDaemon_space_diagnostic_reports", ["report_id"])
        .size()
    ).toBe(1);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(reconcileAcceptedResults).not.toHaveBeenCalled();
    expect(applyFailurePublicationCommand).not.toHaveBeenCalled();
  });

  it("rebuilds a finalization dispatch message from durable facts without an outbox record", () => {
    const message = buildAcceptedDispatchFinalizationQueueMessage({
      fact: baseFact,
      inboxRecord: baseInboxRecord,
      organizationId: "org-1",
      sourceSignal,
      spaceContract: buildDefaultSpaceContract(),
      threadContext: {
        rootSignalId: "signal-1",
        threadId: "thread-1",
      },
    });

    expect(message).toMatchObject({
      dispatchId: "dispatch-1",
      organizationId: "org-1",
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
      idempotencyKey: "source|target",
      sourceClientMessageId: "client-message-1",
      sourceEventId: "signal-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      taskId: "task-1",
      controllerSnapshot: {
        agentControllerRef: "builtin:codex",
        targetBindingEnabled: true,
        targetBindingState: "bound",
      },
      replyToSnapshot: {
        signalId: "signal-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Test User",
        previewText: "@agent(wake) hey",
      },
      sourceSignalSnapshot: {
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        text: "@agent(wake) hey",
      },
      threadContext: {
        rootSignalId: "signal-1",
        threadId: "thread-1",
      },
    });
    expect(message && "spacePassword" in message).toBe(false);
  });

  it("falls back to a resolved or raw profile id when a service-authored source signal has no profile.profileName", () => {
    // A Center Agent tool call (services/remote-agent's
    // toOpenMeldRequestContext) never sets actorContext.profileName, unlike a
    // Gateway-authenticated human session which always populates it. The
    // persisted source signal's profile.profileName is therefore absent here.
    // The durable finalization rebuild must not silently drop
    // replyToSnapshot just because the display name is missing -- it must
    // fall back the same way buildDispatchReplyToSnapshot already does at
    // dispatch time (resolved Space membership snapshot, then profile id).
    const centerAgentSourceSignal = {
      ...sourceSignal,
      id: "signal-center-agent-source-1",
      profile: {
        kind: "agent",
        profileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    } satisfies SignalEnvelope;
    const fact = {
      ...baseFact,
      sourceEventId: centerAgentSourceSignal.id,
    } satisfies AcceptedDispatchFinalizationFact;

    const withoutResolvedName = buildAcceptedDispatchFinalizationQueueMessage({
      fact,
      inboxRecord: baseInboxRecord,
      sourceSignal: centerAgentSourceSignal,
      spaceContract: buildDefaultSpaceContract(),
      threadContext: null,
    });
    expect(withoutResolvedName?.replyToSnapshot).toEqual({
      signalId: "signal-center-agent-source-1",
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
      profileName: "agt_22222222-2222-4222-8222-222222222222",
      previewText: "@agent(wake) hey",
    });

    const withResolvedName = buildAcceptedDispatchFinalizationQueueMessage({
      fact,
      inboxRecord: baseInboxRecord,
      sourceSignal: centerAgentSourceSignal,
      sourceProfileNameSnapshot: "Center Agent",
      spaceContract: buildDefaultSpaceContract(),
      threadContext: null,
    });
    expect(withResolvedName?.replyToSnapshot).toEqual({
      signalId: "signal-center-agent-source-1",
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
      profileName: "Center Agent",
      previewText: "@agent(wake) hey",
    });
  });

  it("preserves Codex App Server transport when rebuilding a finalization dispatch message", () => {
    const message = buildAcceptedDispatchFinalizationQueueMessage({
      fact: baseFact,
      inboxRecord: {
        ...baseInboxRecord,
        taskResult: {
          ...baseInboxRecord.taskResult,
          payload: {
            ...baseInboxRecord.taskResult.payload,
            transportMode: "codex-app-server",
          },
        },
      },
      sourceSignal,
      spaceContract: buildDefaultSpaceContract(),
      threadContext: null,
    });

    expect(message).toMatchObject({
      transportMode: "codex-app-server",
    });
  });

  it("publishes accepted post_status finalization through Space action delivery without a space password", async () => {
    const historicalSpaceContract: ReturnType<
      typeof buildDefaultSpaceContract
    > = {
      ...buildDefaultSpaceContract(),
      allowedActions: ["post_message", "post_status", "stay_silent"],
    };
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const sourceProfileId = "22222222-2222-4222-8222-222222222222";
    const source = {
      ...sourceSignal,
      id: "signal-protected-source-1",
      spaceId,
      profile: {
        ...sourceSignal.profile,
        profileId: sourceProfileId,
      },
      data: {
        text: "@Test Agent(wake) status please",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "@Test Agent(wake) status please",
        },
      },
    } satisfies SignalEnvelope;
    const dispatchFact = {
      ...baseFact,
      attemptId: "attempt-protected-status-1",
      dispatchId: "dispatch-protected-status-1",
      idempotencyKey: "signal-protected-source-1|target",
      sourceClientMessageId: "client-message-protected-status-1",
      sourceEventId: source.id,
      spaceId,
      targetProfileId,
      taskId: "task-protected-status-1",
    } satisfies AcceptedDispatchFinalizationFact;
    const inboxRecord = {
      ...baseInboxRecord,
      attemptId: "attempt-protected-status-1",
      dispatchId: dispatchFact.dispatchId,
      resultKey: "dispatch-protected-status-1:attempt-protected-status-1",
      targetProfileId,
      taskId: dispatchFact.taskId,
      taskResult: {
        ...baseInboxRecord.taskResult,
        payload: {
          ...baseInboxRecord.taskResult.payload,
          agentControllerConversationId: "ctx-protected-status-1",
          agentId: targetProfileId,
          attemptId: "attempt-protected-status-1",
          output: "Blocked waiting for approval.",
          sourceEventId: source.id,
          spaceAction: {
            type: "post_status",
            status: "blocked",
            text: "Blocked waiting for approval.",
            saveResult: false,
          },
          status: "success",
          taskId: dispatchFact.taskId,
        },
      },
    } satisfies DispatchResultInboxRecord;
    const command = {
      ...baseFinalizationCommand,
      acceptedResult: {
        ...baseFinalizationCommand.acceptedResult,
        acceptedAtMs: inboxRecord.acceptedAtMs,
        attemptId: inboxRecord.attemptId,
        dispatchId: inboxRecord.dispatchId,
        targetProfileId,
        taskId: inboxRecord.taskId,
        taskResult: inboxRecord.taskResult,
      },
      dispatchFact,
      dispatchId: dispatchFact.dispatchId,
      finalizationCommandId: "command-protected-status-1",
      publicationIdempotencyKey: "publication:rce-1:run-protected-status-1",
      resultIdempotencyKey: inboxRecord.resultKey,
      spaceId,
      targetProfileId,
      targetProfileName: "Test Agent",
    } satisfies RuntimeCoordinatorFinalizationCommand;
    const dispatchMessage = buildAcceptedDispatchFinalizationQueueMessage({
      fact: dispatchFact,
      inboxRecord,
      sourceSignal: source,
      spaceContract: historicalSpaceContract,
      threadContext: null,
    });
    expect(dispatchMessage && "spacePassword" in dispatchMessage).toBe(false);

    const { finalReplyClaims, signalRows, sql } = createSpaceSqlHarness([
      source,
    ]);
    const wakeEvidenceDatabase = await createFinalizationPublishingPostgresDb({
      fact: dispatchFact,
    });
    const coordinationDatabase = wakeEvidenceDatabase;
    const ordinarySignalPublicationCalls: string[] = [];
    const ordinaryRpcFetch = vi.fn((request: Request) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname.includes("/rpc/signals/")) {
        ordinarySignalPublicationCalls.push(pathname);
      }
      return Response.json(
        {
          code: "space.password_required",
          message: "ordinary Space RPC publication path should not be used",
        },
        { status: 401 }
      );
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (nextSpaceId: string) => void;
      bindings: unknown;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      ctx: {
        storage: {
          sql: SqlStorage;
          transactionSync: <T>(operation: () => T) => T;
        };
        waitUntil: (promise: Promise<unknown>) => void;
      };
      durableObjectId: string;
      lastPostCleanupAtMs: number;
      lastTimestamp: number;
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      readSpaceMetaRecord: () => {
        createdAt: string;
        name: string;
        organizationId: string;
        spaceId: string;
        visibility: "public" | "private";
      };
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      rpcReadRuntimeCoordinatorFinalizationClaimOutcome: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((nextSpaceId: string) => {
          space.spaceId = nextSpaceId;
        }),
      },
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: coordinationDatabase.binding,
          OPENMELD_SPACES: {
            get: vi.fn(() => ({ fetch: ordinaryRpcFetch })),
            idFromString: vi.fn((value: string) => value),
          },
        },
      },
      broadcastSignal: { value: vi.fn() },
      ctx: {
        value: {
          storage: {
            sql,
            transactionSync: <T>(operation: () => T) => operation(),
          },
          waitUntil: vi.fn(),
        },
      },
      durableObjectId: { value: spaceId },
      lastPostCleanupAtMs: { value: 0, writable: true },
      lastTimestamp: { value: 1_700_000_000_000, writable: true },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => historicalSpaceContract),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({
          createdAt: new Date(source.ts).toISOString(),
          name: "Protected status space",
          organizationId: "org-1",
          spaceId,
          visibility: "private",
        })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: spaceId, writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(command)
    ).resolves.toMatchObject({
      finalizationCommandId: "command-protected-status-1",
      ok: true,
      publicationErrorCode: null,
      publishState: "reply_published",
      status: "finalized",
    });
    expect(coordinationDatabase.binding).toBe(wakeEvidenceDatabase.binding);
    const outcomes = await coordinationDatabase.fixture
      .rows("agent_task_terminal_outcomes", ["task_key"])
      .values();
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(String(outcomes[0]?.task_handle_json))).toMatchObject({
      kind: "space_wake",
      spaceId,
      targetProfileId,
    });
    expect(outcomes[0]?.event_id).toBe(command.finalizationCommandId);
    expect(coordinationDatabase.readTaskOutcomeWriteCount()).toBe(1);
    expect(wakeEvidenceDatabase.readDispatchLedgerStatuses()).toEqual([
      "succeeded",
    ]);
    expect(wakeEvidenceDatabase.readDispatchSuccessWriteCount()).toBe(2);
    expect(
      await coordinationDatabase.fixture
        .rows("openMeldDaemon_dispatch_ledger", ["idempotency_key"])
        .get(dispatchFact.idempotencyKey)
    ).toMatchObject({
      dispatch_id: dispatchFact.dispatchId,
      space_id: spaceId,
      target_profile_id: targetProfileId,
      status: "succeeded",
    });
    expect(ordinarySignalPublicationCalls).toEqual([]);
    const finalSignalId = readFinalReplyClaimSignalId(sql, {
      dispatchId: dispatchFact.dispatchId,
      profileId: targetProfileId,
    });
    expect(finalSignalId).toBeTruthy();
    const persistedSignal = finalSignalId
      ? (JSON.parse(String(signalRows.get(finalSignalId)?.payloadJson)) as
          | SignalEnvelope
          | undefined)
      : undefined;
    expect(persistedSignal).toMatchObject({
      spaceId,
      type: "signal.status",
      data: {
        actorProfileId: targetProfileId,
        dispatchId: dispatchFact.dispatchId,
        generatedBy: "openmeld",
        status: "blocked",
        text: "Blocked waiting for approval.",
      },
    });
    expect(
      resolveRuntimeCoordinatorFinalizationVisibleFinalMessage({
        command,
        outcome: {
          publishedSignalId: finalSignalId,
          publishState: "reply_published",
        },
        readFinalReplyClaimSignalId: () => finalSignalId,
        readSignalById: (signalId) =>
          signalId && signalId === persistedSignal?.id
            ? (persistedSignal ?? null)
            : null,
      })
    ).toEqual({ ok: true, publishedSignalId: finalSignalId });
    expect(
      finalReplyClaims.get(`${dispatchFact.dispatchId}:${targetProfileId}`)
    ).toBe(finalSignalId);
    await expect(
      space.rpcReadRuntimeCoordinatorFinalizationClaimOutcome(command)
    ).resolves.toMatchObject({
      outcome: {
        finalMessageKind: "success_reply",
        finalizationCommandId: "command-protected-status-1",
        ok: true,
        publishedSignalId: finalSignalId,
        publishState: "reply_published",
        status: "already_final",
      },
      status: "finalization_visible",
    });
    const stoppedSignal = {
      v: 1,
      id: "signal-wake-stopped-1",
      spaceId,
      ts: source.ts + 1,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        actorName: "Codex Agent",
        actorProfileId: targetProfileId,
        dispatchId: dispatchFact.dispatchId,
        generatedBy: "openmeld",
        noticeType: "wake_stopped",
        reason: "runtime_coordinator.wake_stop_requested",
        text: "Wake was stopped for @Codex Agent.",
      },
    } as unknown as SignalEnvelope;
    expect(
      resolveRuntimeCoordinatorFinalizationClaimRead({
        command,
        readFinalReplyClaimSignalId: () => stoppedSignal.id,
        readSignalById: () => stoppedSignal,
      })
    ).toEqual({
      publishedSignalId: stoppedSignal.id,
      status: "wake_stopped_visible",
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(command)
    ).resolves.toMatchObject({
      finalizationCommandId: "command-protected-status-1",
      ok: true,
      publicationErrorCode: null,
      publishedSignalId: finalSignalId,
      publishState: "reply_published",
      status: "finalized",
    });
    await coordinationDatabase.replaceTaskOutcome({
      errorCode: "runtime_coordinator.publication_retry_exhausted",
      eventId: command.finalizationCommandId,
      occurredAtMs: command.createdAtMs,
      publishedSignalId: "signal-publication-failed-legacy",
      status: "publication_failed",
    });
    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(command)
    ).resolves.toMatchObject({
      finalizationCommandId: command.finalizationCommandId,
      ok: false,
    });
    const persistedFinalSignals = [...signalRows.values()]
      .map((row) => JSON.parse(row.payloadJson) as SignalEnvelope)
      .filter(
        (signal) =>
          signal.type === "signal.status" &&
          signal.data.dispatchId === dispatchFact.dispatchId &&
          signal.data.actorProfileId === targetProfileId
      );
    expect(persistedFinalSignals.map((signal) => signal.id)).toEqual([
      finalSignalId,
    ]);
  });

  it("publishes failed finalization as a system notice without Space action delivery", async () => {
    const spaceId =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const targetProfileId = "agt_55555555-5555-4555-8555-555555555555";
    const sourceProfileId = "66666666-6666-4666-8666-666666666666";
    const source = {
      ...sourceSignal,
      id: "signal-failed-source-1",
      spaceId,
      profile: {
        ...sourceSignal.profile,
        profileId: sourceProfileId,
        profileName: "Wake User",
      },
      data: {
        text: "@Test Agent(wake) please run",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "@Test Agent(wake) please run",
        },
      },
    } satisfies SignalEnvelope;
    const dispatchFact = {
      ...baseFact,
      attemptId: "attempt-failed-notice-1",
      dispatchId: "dispatch-failed-notice-1",
      idempotencyKey: "signal-failed-source-1|target",
      sourceClientMessageId: "client-message-failed-notice-1",
      sourceEventId: source.id,
      spaceId,
      targetProfileId,
      taskId: "task-failed-notice-1",
    } satisfies AcceptedDispatchFinalizationFact;
    const inboxRecord = {
      ...baseInboxRecord,
      attemptId: dispatchFact.attemptId,
      dispatchId: dispatchFact.dispatchId,
      resultKey: "dispatch-failed-notice-1:attempt-failed-notice-1",
      targetProfileId,
      taskId: dispatchFact.taskId,
      taskResult: {
        ...baseInboxRecord.taskResult,
        payload: {
          agentId: targetProfileId,
          agentControllerConversationId: "ctx-failed-notice-1",
          agentControllerRef: "builtin:codex",
          attemptId: dispatchFact.attemptId,
          deduped: false,
          errorCode: "upstream_unreachable",
          errorMessage: "failed to connect to websocket: 403 Forbidden",
          errorType: "adapter",
          sourceEventId: source.id,
          status: "failed",
          taskId: dispatchFact.taskId,
        },
      },
    } satisfies DispatchResultInboxRecord;
    const command = {
      ...baseFinalizationCommand,
      acceptedResult: {
        ...baseFinalizationCommand.acceptedResult,
        acceptedAtMs: inboxRecord.acceptedAtMs,
        attemptId: inboxRecord.attemptId,
        dispatchId: inboxRecord.dispatchId,
        targetProfileId,
        taskId: inboxRecord.taskId,
        taskResult: inboxRecord.taskResult,
      },
      dispatchFact,
      dispatchId: dispatchFact.dispatchId,
      finalizationCommandId: "command-failed-notice-1",
      publicationIdempotencyKey: "publication:rce-1:run-failed-notice-1",
      resultIdempotencyKey: inboxRecord.resultKey,
      spaceId,
      targetProfileId,
      targetProfileName: "Test Agent",
    } satisfies RuntimeCoordinatorFinalizationCommand;

    const { finalReplyClaims, signalRows, sql } = createSpaceSqlHarness([
      source,
    ]);
    const wakeEvidenceDatabase = await createFinalizationPublishingPostgresDb({
      allowResultInsert: true,
      fact: dispatchFact,
    });
    const coordinationDatabase = wakeEvidenceDatabase;
    let builtNoticeCount = 0;
    const deliverAgentTransportSpaceAction = vi.fn(() => {
      throw new Error("failed system notices must not use Space Action");
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (nextSpaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      bindings: unknown;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      ctx: {
        storage: { sql: SqlStorage };
        waitUntil: (promise: Promise<unknown>) => void;
      };
      deliverAgentTransportSpaceAction: typeof deliverAgentTransportSpaceAction;
      durableObjectId: string;
      lastPostCleanupAtMs: number;
      lastTimestamp: number;
      publishSystemNoticeSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      readSpaceMetaRecord: () => {
        createdAt: string;
        name: string;
        organizationId: string;
        spaceId: string;
        visibility: "public" | "private";
      };
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      rpcPostSystemNoticeSignal: Space["rpcPostSystemNoticeSignal"];
      spaceId: string;
    };
    const ordinaryRpcFetch = vi.fn(() =>
      Response.json(
        {
          code: "space.password_required",
          message: "ordinary Space RPC publication path should not be used",
        },
        { status: 401 }
      )
    );
    const systemNoticeRpcPost = vi.fn(
      (input: Parameters<Space["rpcPostSystemNoticeSignal"]>[0]) =>
        space.rpcPostSystemNoticeSignal(input)
    );
    const authorizeSpacePasswordAccess = vi.fn(async () => ({
      ok: false,
      response: Response.json(
        {
          code: "space.password_required",
          message: "space password required",
        },
        { status: 401 }
      ),
    }));
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((nextSpaceId: string) => {
          space.spaceId = nextSpaceId;
        }),
      },
      authorizeSpacePasswordAccess: {
        value: authorizeSpacePasswordAccess,
      },
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: coordinationDatabase.binding,
          OPENMELD_SPACES: {
            get: vi.fn(() => ({
              fetch: ordinaryRpcFetch,
              rpcPostSystemNoticeSignal: systemNoticeRpcPost,
            })),
            idFromString: vi.fn((value: string) => value),
          },
        },
      },
      broadcastSignal: { value: vi.fn() },
      buildSystemNoticeSignal: {
        value: vi.fn(
          (
            profile: SignalEnvelope["profile"],
            data: Extract<
              SignalEnvelope,
              { type: "signal.system_notice" }
            >["data"]
          ) =>
            ({
              v: 1,
              id: `signal-failed-notice-${++builtNoticeCount}`,
              spaceId,
              ts: 1_700_000_030_000 + builtNoticeCount,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      ctx: {
        value: {
          storage: { sql },
          waitUntil: vi.fn(),
        },
      },
      deliverAgentTransportSpaceAction: {
        value: deliverAgentTransportSpaceAction,
      },
      durableObjectId: { value: spaceId },
      lastPostCleanupAtMs: { value: 0, writable: true },
      lastTimestamp: { value: 1_700_000_030_000, writable: true },
      publishSystemNoticeSignal: {
        value: vi.fn((signal: SignalEnvelope) => {
          insertSignalRecord(sql, signal);
        }),
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => buildDefaultSpaceContract()),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({
          createdAt: new Date(source.ts).toISOString(),
          name: "Failed finalization notice space",
          organizationId: "org-1",
          spaceId,
          visibility: "private",
        })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: spaceId, writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(command)
    ).resolves.toMatchObject({
      finalMessageKind: "failure_notice",
      finalizationCommandId: "command-failed-notice-1",
      ok: true,
      publicationErrorCode: null,
      publishState: "reply_published",
      status: "finalized",
    });
    expect(coordinationDatabase.binding).toBe(wakeEvidenceDatabase.binding);
    const outcomes = await coordinationDatabase.fixture
      .rows("agent_task_terminal_outcomes", ["task_key"])
      .values();
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(String(outcomes[0]?.task_handle_json))).toMatchObject({
      kind: "space_wake",
      spaceId,
      targetProfileId,
    });
    expect(outcomes[0]?.event_id).toBe(command.finalizationCommandId);
    expect(coordinationDatabase.readTaskOutcomeWriteCount()).toBe(1);
    expect(wakeEvidenceDatabase.readDispatchLedgerStatuses()).not.toContain(
      "succeeded"
    );
    expect(wakeEvidenceDatabase.readDispatchLedgerStatuses().at(-1)).toBe(
      "failed_terminal"
    );
    expect(deliverAgentTransportSpaceAction).not.toHaveBeenCalled();
    expect(ordinaryRpcFetch).not.toHaveBeenCalled();
    expect(systemNoticeRpcPost).toHaveBeenCalledTimes(1);
    expect(systemNoticeRpcPost.mock.calls[0]?.[0].spaceAccess).toMatchObject({
      actor: {
        dispatchId: dispatchFact.dispatchId,
        kind: "dispatch_continuation",
        sourceSignalId: source.id,
        targetProfileId,
      },
      spaceId,
    });
    expect(authorizeSpacePasswordAccess).not.toHaveBeenCalled();
    const finalSignalId = readFinalReplyClaimSignalId(sql, {
      dispatchId: dispatchFact.dispatchId,
      profileId: targetProfileId,
    });
    expect(finalSignalId).toBe("signal-failed-notice-1");
    const persistedSignal = finalSignalId
      ? (JSON.parse(String(signalRows.get(finalSignalId)?.payloadJson)) as
          | SignalEnvelope
          | undefined)
      : undefined;
    expect(persistedSignal).toMatchObject({
      spaceId,
      type: "signal.system_notice",
      profile: {
        kind: "system",
      },
      data: {
        actorProfileId: targetProfileId,
        dispatchId: dispatchFact.dispatchId,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: source.id,
          profileId: sourceProfileId,
          profileKind: "human",
          profileName: "Wake User",
          previewText: "@Test Agent(wake) please run",
        },
      },
    });
    expect(
      finalReplyClaims.get(`${dispatchFact.dispatchId}:${targetProfileId}`)
    ).toBe(finalSignalId);
  });

  it("threads replyTo into a terminal failure notice for a Center Agent-authored Wake without profile.profileName", async () => {
    // Reproduces the W-ERR2-R1 dogfood gap: a Center Agent tool call posts the
    // Wake with authoringPolicy "user_authored" and profile.kind "agent", but
    // services/remote-agent's toOpenMeldRequestContext never sets
    // actorContext.profileName (unlike a Gateway-authenticated human
    // session), so the persisted source signal's profile.profileName is
    // absent. Before the fix, buildOptionalReplyToSnapshot required
    // profile.profileName with no fallback and silently dropped
    // replyToSnapshot, so the published terminal_failure notice had no
    // replyTo and Web rendered it unanchored. It must now carry replyTo,
    // matching the human-authored path above.
    const spaceId =
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const targetProfileId = "agt_77777777-7777-4777-8777-777777777777";
    const centerAgentProfileId = "agt_88888888-8888-4888-8888-888888888888";
    const source = {
      ...sourceSignal,
      id: "signal-center-agent-failed-source-1",
      spaceId,
      profile: {
        kind: "agent",
        profileId: centerAgentProfileId,
      },
      data: {
        text: "@Test Agent(wake) please run",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "@Test Agent(wake) please run",
        },
      },
    } satisfies SignalEnvelope;
    const dispatchFact = {
      ...baseFact,
      attemptId: "attempt-center-agent-failed-notice-1",
      dispatchId: "dispatch-center-agent-failed-notice-1",
      idempotencyKey: "signal-center-agent-failed-source-1|target",
      sourceClientMessageId: "client-message-center-agent-failed-notice-1",
      sourceEventId: source.id,
      spaceId,
      targetProfileId,
      taskId: "task-center-agent-failed-notice-1",
    } satisfies AcceptedDispatchFinalizationFact;
    const inboxRecord = {
      ...baseInboxRecord,
      attemptId: dispatchFact.attemptId,
      dispatchId: dispatchFact.dispatchId,
      resultKey:
        "dispatch-center-agent-failed-notice-1:attempt-center-agent-failed-notice-1",
      targetProfileId,
      taskId: dispatchFact.taskId,
      taskResult: {
        ...baseInboxRecord.taskResult,
        payload: {
          agentId: targetProfileId,
          agentControllerConversationId: "ctx-center-agent-failed-notice-1",
          agentControllerRef: "builtin:codex",
          attemptId: dispatchFact.attemptId,
          deduped: false,
          errorCode: "upstream_unreachable",
          errorMessage: "failed to connect to websocket: 403 Forbidden",
          errorType: "adapter",
          sourceEventId: source.id,
          status: "failed",
          taskId: dispatchFact.taskId,
        },
      },
    } satisfies DispatchResultInboxRecord;
    const command = {
      ...baseFinalizationCommand,
      acceptedResult: {
        ...baseFinalizationCommand.acceptedResult,
        acceptedAtMs: inboxRecord.acceptedAtMs,
        attemptId: inboxRecord.attemptId,
        dispatchId: inboxRecord.dispatchId,
        targetProfileId,
        taskId: inboxRecord.taskId,
        taskResult: inboxRecord.taskResult,
      },
      dispatchFact,
      dispatchId: dispatchFact.dispatchId,
      finalizationCommandId: "command-center-agent-failed-notice-1",
      publicationIdempotencyKey:
        "publication:rce-1:run-center-agent-failed-notice-1",
      resultIdempotencyKey: inboxRecord.resultKey,
      spaceId,
      targetProfileId,
      targetProfileName: "Test Agent",
    } satisfies RuntimeCoordinatorFinalizationCommand;

    const { signalRows, sql } = createSpaceSqlHarness([source]);
    const db = await createFinalizationPublishingPostgresDb({
      allowResultInsert: true,
      fact: dispatchFact,
    });
    let builtNoticeCount = 0;
    const deliverAgentTransportSpaceAction = vi.fn(() => {
      throw new Error("failed system notices must not use Space Action");
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (nextSpaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      bindings: unknown;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      ctx: {
        storage: { sql: SqlStorage };
        waitUntil: (promise: Promise<unknown>) => void;
      };
      deliverAgentTransportSpaceAction: typeof deliverAgentTransportSpaceAction;
      durableObjectId: string;
      lastPostCleanupAtMs: number;
      lastTimestamp: number;
      publishSystemNoticeSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      readSpaceMetaRecord: () => {
        createdAt: string;
        name: string;
        organizationId: string;
        spaceId: string;
        visibility: "public" | "private";
      };
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      rpcPostSystemNoticeSignal: Space["rpcPostSystemNoticeSignal"];
      spaceId: string;
    };
    const ordinaryRpcFetch = vi.fn(() =>
      Response.json(
        {
          code: "space.password_required",
          message: "ordinary Space RPC publication path should not be used",
        },
        { status: 401 }
      )
    );
    const systemNoticeRpcPost = vi.fn(
      (input: Parameters<Space["rpcPostSystemNoticeSignal"]>[0]) =>
        space.rpcPostSystemNoticeSignal(input)
    );
    const authorizeSpacePasswordAccess = vi.fn(async () => ({
      ok: false,
      response: Response.json(
        {
          code: "space.password_required",
          message: "space password required",
        },
        { status: 401 }
      ),
    }));
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((nextSpaceId: string) => {
          space.spaceId = nextSpaceId;
        }),
      },
      authorizeSpacePasswordAccess: {
        value: authorizeSpacePasswordAccess,
      },
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: db.binding,
          OPENMELD_SPACES: {
            get: vi.fn(() => ({
              fetch: ordinaryRpcFetch,
              rpcPostSystemNoticeSignal: systemNoticeRpcPost,
            })),
            idFromString: vi.fn((value: string) => value),
          },
        },
      },
      broadcastSignal: { value: vi.fn() },
      buildSystemNoticeSignal: {
        value: vi.fn(
          (
            profile: SignalEnvelope["profile"],
            data: Extract<
              SignalEnvelope,
              { type: "signal.system_notice" }
            >["data"]
          ) =>
            ({
              v: 1,
              id: `signal-center-agent-failed-notice-${++builtNoticeCount}`,
              spaceId,
              ts: 1_700_000_030_000 + builtNoticeCount,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      ctx: {
        value: {
          storage: { sql },
          waitUntil: vi.fn(),
        },
      },
      deliverAgentTransportSpaceAction: {
        value: deliverAgentTransportSpaceAction,
      },
      durableObjectId: { value: spaceId },
      lastPostCleanupAtMs: { value: 0, writable: true },
      lastTimestamp: { value: 1_700_000_030_000, writable: true },
      publishSystemNoticeSignal: {
        value: vi.fn((signal: SignalEnvelope) => {
          insertSignalRecord(sql, signal);
        }),
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => buildDefaultSpaceContract()),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({
          createdAt: new Date(source.ts).toISOString(),
          name: "Center Agent failed finalization notice space",
          organizationId: "org-1",
          spaceId,
          visibility: "private",
        })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: spaceId, writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(command)
    ).resolves.toMatchObject({
      finalMessageKind: "failure_notice",
      finalizationCommandId: "command-center-agent-failed-notice-1",
      ok: true,
      publicationErrorCode: null,
      publishState: "reply_published",
      status: "finalized",
    });
    const finalSignalId = readFinalReplyClaimSignalId(sql, {
      dispatchId: dispatchFact.dispatchId,
      profileId: targetProfileId,
    });
    expect(finalSignalId).toBe("signal-center-agent-failed-notice-1");
    const persistedSignal = finalSignalId
      ? (JSON.parse(String(signalRows.get(finalSignalId)?.payloadJson)) as
          | SignalEnvelope
          | undefined)
      : undefined;
    expect(persistedSignal).toMatchObject({
      spaceId,
      type: "signal.system_notice",
      data: {
        actorProfileId: targetProfileId,
        dispatchId: dispatchFact.dispatchId,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: source.id,
          profileId: centerAgentProfileId,
          profileKind: "agent",
          // No Space member snapshot is wired into this harness, so the
          // fallback resolves to the raw profile id -- the point of this
          // assertion is that replyTo exists at all instead of being
          // dropped, not the display value.
          profileName: centerAgentProfileId,
          previewText: "@Test Agent(wake) please run",
        },
      },
    });
  });

  it.each([
    { readableFinal: true, sourceInThread: true },
    { readableFinal: true, sourceInThread: false },
    { readableFinal: false, sourceInThread: true },
  ])("publishes a threaded final reply for a main or thread Wake and requires a readable result ($sourceInThread/$readableFinal)", async ({
    readableFinal,
    sourceInThread,
  }) => {
    const spaceId =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const targetProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const sourceProfileId = "44444444-4444-4444-8444-444444444444";
    const threadContext = {
      rootSignalId: "signal-thread-source-1",
      threadId: "thr_33333333-3333-4333-8333-333333333333",
    };
    const source = {
      v: 1,
      id: threadContext.rootSignalId,
      spaceId,
      ts: 1_700_000_020_000,
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: sourceProfileId,
        profileName: "Thread User",
      },
      data: {
        text: "@agent follow up in thread",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "@agent follow up in thread",
        },
      },
    } satisfies SignalEnvelope;
    const inboxRecord = {
      ...baseInboxRecord,
      acceptedAtMs: 1_700_000_020_100,
      attemptId: "attempt-thread-message-1",
      dispatchId: "dispatch-thread-message-1",
      targetProfileId,
      taskId: "task-thread-message-1",
      taskResult: {
        v: 4,
        code: "service.task_result",
        payload: {
          agentId: targetProfileId,
          agentControllerConversationId: "ctx-thread-message-1",
          attemptId: "attempt-thread-message-1",
          agentControllerRef: "builtin:codex",
          deduped: false,
          output: "Thread reply delivered.",
          sourceEventId: source.id,
          status: "success",
          taskId: "task-thread-message-1",
        },
      },
      updatedAtMs: 1_700_000_020_100,
    } satisfies DispatchResultInboxRecord;
    const dispatchFact = {
      ...baseFact,
      attemptId: inboxRecord.attemptId,
      dispatchId: inboxRecord.dispatchId,
      idempotencyKey: `${source.id}|${targetProfileId}`,
      sourceClientMessageId: "client-thread-message-1",
      sourceEventId: source.id,
      spaceId,
      targetProfileId,
      taskId: inboxRecord.taskId,
    } satisfies AcceptedDispatchFinalizationFact;
    const dispatchMessage = buildAcceptedDispatchFinalizationQueueMessage({
      fact: dispatchFact,
      inboxRecord,
      sourceSignal: source,
      spaceContract: buildDefaultSpaceContract(),
      threadContext: sourceInThread ? threadContext : null,
    });
    expect(dispatchMessage).toBeTruthy();
    if (!dispatchMessage) {
      throw new Error("expected threaded dispatch message to rebuild");
    }

    const { signalRows, sql, threadPlacements } = createSpaceSqlHarness([
      source,
    ]);
    const projectionStorage = createAgentStreamProjectionStorage(sql);
    const oldStreamId = buildLocalAgentStreamId({
      attemptId: "attempt-thread-message-old",
      dispatchId: dispatchFact.dispatchId,
    });
    const currentStreamId = buildLocalAgentStreamId({
      attemptId: inboxRecord.attemptId,
      dispatchId: dispatchFact.dispatchId,
    });
    await applyAgentStreamPart({
      storage: projectionStorage,
      nowMs: Date.now() - 100,
      part: {
        v: 1,
        spaceId,
        streamId: oldStreamId,
        sequence: 1,
        profileId: targetProfileId,
        triggerMessageId: source.id,
        dispatchId: dispatchFact.dispatchId,
        part: {
          type: "tool",
          toolCallId: "tool-call-old-attempt",
          toolName: "github_search_issues",
          state: "output-available",
        },
      },
    });
    await applyAgentStreamPart({
      storage: projectionStorage,
      nowMs: Date.now() - 50,
      part: {
        v: 1,
        spaceId,
        streamId: currentStreamId,
        sequence: 1,
        profileId: targetProfileId,
        triggerMessageId: source.id,
        dispatchId: dispatchFact.dispatchId,
        part: {
          type: "tool",
          toolCallId: "tool-call-current-attempt",
          toolName: "openmeld_list_spaces",
          state: "output-available",
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
      },
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (nextSpaceId: string) => void;
      bindings: unknown;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      ctx: {
        storage: { sql: SqlStorage };
        waitUntil: (promise: Promise<unknown>) => void;
      };
      durableObjectId: string;
      flushPendingDispatchOutbox: () => Promise<void>;
      lastPostCleanupAtMs: number;
      lastTimestamp: number;
      prepareDispatchOutboxPlanForSignal: () => {
        nonReadyDecisions: [];
        outboxRecords: [];
        plannerContext: null;
      };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      rpcResolveNativeReplyPlacement: () => Promise<{
        threadContext: typeof threadContext;
      }>;
      readSpaceMetaRecord: () => {
        createdAt: string;
        name: string;
        organizationId: string;
        spaceId: string;
        visibility: "public" | "private";
      };
      spaceId: string;
      deliverAgentTransportSpaceAction: (
        input: AgentTransportSpaceActionDeliveryInput
      ) => Promise<{
        emittedSignal: SignalEnvelope | null;
        finalReplySettled: boolean;
      }>;
    };
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((nextSpaceId: string) => {
          space.spaceId = nextSpaceId;
        }),
      },
      // Final-reply delivery reads caller identity before its persisted reply.
      // Keep the real test binding instead of failing before the intended read.
      bindings: { value: env },
      broadcastSignal: { value: vi.fn() },
      ctx: {
        value: { storage: projectionStorage, waitUntil: vi.fn() },
      },
      durableObjectId: { value: spaceId },
      flushPendingDispatchOutbox: {
        value: vi.fn().mockResolvedValue(undefined),
      },
      lastPostCleanupAtMs: { value: 0, writable: true },
      lastTimestamp: { value: 1_700_000_020_000, writable: true },
      prepareDispatchOutboxPlanForSignal: {
        value: vi.fn(() => ({
          nonReadyDecisions: [],
          outboxRecords: [],
          plannerContext: null,
        })),
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          if (!readableFinal && signalId !== source.id) {
            return null;
          }
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      rpcResolveNativeReplyPlacement: {
        value: vi.fn().mockResolvedValue({ threadContext }),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({
          createdAt: new Date(source.ts).toISOString(),
          name: "Threaded action space",
          organizationId: "org-1",
          spaceId,
          visibility: "private",
        })),
      },
      spaceId: { value: spaceId, writable: true },
    });

    const messageEnvelope = {
      activationTargets: [],
      referenceTargets: [],
      replyToSignalId: source.id,
      text: "Thread reply delivered.",
    };
    const delivery = space.deliverAgentTransportSpaceAction({
      agentControllerConversationId: "ctx-thread-message-1",
      attemptId: inboxRecord.attemptId,
      agentControllerRef: "builtin:codex",
      dispatchMessage,
      finalOutcomeAuthority: "runtime_coordinator_finalization",
      messageEnvelope,
      plan: {
        archiveMode: "none",
        blockedExplicitAction: false,
        kind: "message",
        messageEnvelope,
        publicOutcome: "post_message",
        shouldArchive: false,
        text: "Thread reply delivered.",
      },
      profileHandle: null,
      resultRef: null,
      targetOwnerUserId: "owner-1",
      targetProfileMentionLabel: null,
      targetProfileName: "Thread Agent",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "conversation-thread-message-1",
      },
      workingDirectory: "/tmp/thread-agent",
    });

    if (!readableFinal) {
      await expect(delivery).rejects.toMatchObject({
        code: "space.agent_reply.final_signal_unreadable",
      });
      return;
    }
    const receipt = await delivery;
    expect(receipt.finalReplySettled).toBe(true);
    expect(receipt.emittedSignal).toMatchObject({
      spaceId,
      type: "signal.text",
      data: {
        text: "Thread reply delivered.",
        meta: {
          agentActivity: {
            v: 1,
            steps: [
              {
                toolName: "openmeld_list_spaces",
                state: "output-available",
                work: {
                  v: 1,
                  key: "spaces.read",
                },
              },
            ],
            truncated: false,
          },
          dispatchId: dispatchFact.dispatchId,
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId,
        },
      },
    });
    const emittedSignalId = receipt.emittedSignal?.id;
    expect(emittedSignalId).toBeTruthy();
    expect(emittedSignalId && threadPlacements.get(emittedSignalId)).toEqual({
      threadId: threadContext.threadId,
      placement: "thread",
      createdAtMs: receipt.emittedSignal?.ts,
    });
  });

  it("marks a dispatch reply with the number of newer text messages", async () => {
    const targetProfileId = "agt_55555555-5555-4555-8555-555555555555";
    const source = createDispatchSourceSignal({
      id: "signal-staleness-source-1",
      targetProfileId,
    });
    const emittedSignal = await buildAgentTransportMessageSignal({
      initialSignals: [
        source,
        createLaterTextSignal({
          id: "signal-staleness-later-1",
          profileId: "66666666-6666-4666-8666-666666666666",
          ts: source.ts + 1,
        }),
        createLaterTextSignal({
          id: "signal-staleness-later-2",
          profileId: "77777777-7777-4777-8777-777777777777",
          ts: source.ts + 2,
        }),
      ],
      source,
      targetProfileId,
    });

    expect(emittedSignal).toMatchObject({
      type: "signal.text",
      data: {
        meta: {
          staleness: {
            newMessagesDuringComposition: 2,
          },
        },
      },
    });
  });

  it("does not count the dispatch target's own newer text messages", async () => {
    const targetProfileId = "agt_99999999-9999-4999-8999-999999999999";
    const source = createDispatchSourceSignal({
      id: "signal-staleness-source-2",
      targetProfileId,
    });
    const emittedSignal = await buildAgentTransportMessageSignal({
      initialSignals: [
        source,
        createLaterTextSignal({
          id: "signal-staleness-target-own-message",
          profileId: targetProfileId,
          profileKind: "agent",
          ts: source.ts + 1,
        }),
        createLaterTextSignal({
          id: "signal-staleness-other-message",
          profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          ts: source.ts + 2,
        }),
      ],
      source,
      targetProfileId,
    });

    expect(emittedSignal).toMatchObject({
      type: "signal.text",
      data: {
        meta: {
          staleness: {
            newMessagesDuringComposition: 1,
          },
        },
      },
    });
  });

  it("omits reply staleness metadata when no newer text messages exist", async () => {
    const targetProfileId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const source = createDispatchSourceSignal({
      id: "signal-staleness-source-3",
      targetProfileId,
    });
    const emittedSignal = await buildAgentTransportMessageSignal({
      initialSignals: [source],
      source,
      targetProfileId,
    });
    if (emittedSignal?.type !== "signal.text") {
      throw new Error("expected a final text reply");
    }

    expect(emittedSignal.data.meta).not.toHaveProperty("staleness");
  });

  it("atomically rejects an Agent reply prepared before a newer collaboration message", () => {
    const targetProfileId = "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const source = createDispatchSourceSignal({
      id: "signal-observation-source-1",
      targetProfileId,
    });
    const later = createLaterTextSignal({
      id: "signal-observation-later-1",
      profileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      ts: source.ts + 1,
    });
    const proposedReply = createLaterTextSignal({
      id: "signal-observation-proposed-reply",
      profileId: targetProfileId,
      profileKind: "agent",
      ts: source.ts + 2,
    });
    const { signalRows, sql } = createSpaceSqlHarness([source, later]);
    const transactionSync = vi.fn(<T>(operation: () => T) => operation());
    const space = Object.create(Space.prototype) as {
      ctx: {
        storage: {
          sql: SqlStorage;
          transactionSync: <T>(operation: () => T) => T;
        };
      };
      durableObjectId: string;
      lastPostCleanupAtMs: number;
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext: {
          agentReplyObservation: {
            observedThroughSignalId: string;
            sourceSignalId: string;
            targetProfileId: string;
          };
        }
      ) => unknown;
      prepareDispatchOutboxPlanForSignal: () => {
        nonReadyDecisions: [];
        outboxRecords: [];
        plannerContext: null;
      };
      spaceId: string;
    };
    Object.defineProperties(space, {
      ctx: { value: { storage: { sql, transactionSync } } },
      durableObjectId: { value: source.spaceId },
      lastPostCleanupAtMs: { value: 0, writable: true },
      prepareDispatchOutboxPlanForSignal: {
        value: () => ({
          nonReadyDecisions: [],
          outboxRecords: [],
          plannerContext: null,
        }),
      },
      spaceId: { value: source.spaceId, writable: true },
    });

    expect(() =>
      space.persistSignalWithOptionalOutbox(proposedReply, false, {
        agentReplyObservation: {
          observedThroughSignalId: source.id,
          sourceSignalId: source.id,
          targetProfileId,
        },
      })
    ).toThrow("The Space changed after this Agent prepared its reply");
    expect(transactionSync).toHaveBeenCalledOnce();
    expect(signalRows.has(proposedReply.id)).toBe(false);
  });

  it("persists the Inbox projection inside the guarded Agent reply transaction", () => {
    const targetProfileId = "agt_ffffffff-ffff-4fff-8fff-ffffffffffff";
    const source = createDispatchSourceSignal({
      id: "signal-observation-current-source",
      targetProfileId,
    });
    const proposedReply = createLaterTextSignal({
      id: "signal-observation-current-reply",
      profileId: targetProfileId,
      profileKind: "agent",
      ts: source.ts + 1,
    });
    const { signalRows, sql } = createSpaceSqlHarness([source]);
    let insideTransaction = false;
    const transactionSync = vi.fn(<T>(operation: () => T) => {
      insideTransaction = true;
      try {
        return operation();
      } finally {
        insideTransaction = false;
      }
    });
    const insertSpaceInboxProjectionForPublishedSignal = vi.fn(() => {
      expect(insideTransaction).toBe(true);
    });
    const space = Object.create(Space.prototype) as {
      ctx: {
        storage: {
          sql: SqlStorage;
          transactionSync: <T>(operation: () => T) => T;
        };
      };
      durableObjectId: string;
      insertSpaceInboxProjectionForPublishedSignal: typeof insertSpaceInboxProjectionForPublishedSignal;
      lastPostCleanupAtMs: number;
      lastRetentionWarningAtMs: number;
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext: {
          agentReplyObservation: {
            observedThroughSignalId: string;
            sourceSignalId: string;
            sourceThreadId?: string | null;
            targetProfileId: string;
          };
          threadContext?: { rootSignalId: string; threadId: string };
        }
      ) => {
        persistedSignal: boolean;
      };
      prepareDispatchOutboxPlanForSignal: () => {
        nonReadyDecisions: [];
        outboxRecords: [];
        plannerContext: null;
      };
      spaceId: string;
    };
    Object.defineProperties(space, {
      ctx: { value: { storage: { sql, transactionSync } } },
      durableObjectId: { value: source.spaceId },
      insertSpaceInboxProjectionForPublishedSignal: {
        value: insertSpaceInboxProjectionForPublishedSignal,
      },
      lastPostCleanupAtMs: { value: 0, writable: true },
      lastRetentionWarningAtMs: { value: 0, writable: true },
      prepareDispatchOutboxPlanForSignal: {
        value: () => ({
          nonReadyDecisions: [],
          outboxRecords: [],
          plannerContext: null,
        }),
      },
      spaceId: { value: source.spaceId, writable: true },
    });

    const result = space.persistSignalWithOptionalOutbox(proposedReply, false, {
      agentReplyObservation: {
        observedThroughSignalId: source.id,
        sourceSignalId: source.id,
        sourceThreadId: null,
        targetProfileId,
      },
      threadContext: {
        rootSignalId: source.id,
        threadId: "thr_33333333-3333-4333-8333-333333333333",
      },
    });

    expect(result.persistedSignal).toBe(true);
    expect(transactionSync).toHaveBeenCalledOnce();
    expect(insertSpaceInboxProjectionForPublishedSignal).toHaveBeenCalledOnce();
    expect(signalRows.has(proposedReply.id)).toBe(true);
  });

  it("still builds the dispatch reply when staleness lookup fails", async () => {
    const targetProfileId = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const source = createDispatchSourceSignal({
      id: "signal-staleness-source-read-failure",
      targetProfileId,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const emittedSignal = await buildAgentTransportMessageSignal({
        failStalenessRead: true,
        initialSignals: [source],
        source,
        targetProfileId,
      });

      expect(emittedSignal).toMatchObject({
        type: "signal.text",
        data: { text: "Final reply" },
      });
      if (emittedSignal.type !== "signal.text") {
        throw new Error("expected a final text reply");
      }
      expect(emittedSignal.data.meta).not.toHaveProperty("staleness");
      expect(warn).toHaveBeenCalledWith(
        "[core.openmeld.space.reply_staleness_read_failed]",
        expect.objectContaining({
          dispatchId: `dispatch-${source.id}`,
          sourceEventId: source.id,
          targetProfileId,
        })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses to rebuild when the accepted result does not match the durable dispatch fact", () => {
    const message = buildAcceptedDispatchFinalizationQueueMessage({
      fact: {
        ...baseFact,
        taskId: "different-task",
      },
      inboxRecord: baseInboxRecord,
      sourceSignal,
      spaceContract: buildDefaultSpaceContract(),
      threadContext: null,
    });

    expect(message).toBeNull();
  });

  it("requests RuntimeCoordinator command replay for a durable accepted result", async () => {
    const replayRequests: unknown[] = [];
    const db = await createAcceptedInboxReadDb(baseInboxRecord);
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: db.binding,
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => ({
              rpcReplayRuntimeCoordinatorFinalizationCommand: vi.fn(
                (input: unknown) => {
                  replayRequests.push(input);
                  return Promise.resolve({
                    ok: true,
                    outcome: {
                      finalizationCommandId: "command-1",
                      ok: true,
                      publicationErrorCode: null,
                      publishedSignalId: "signal-final-1",
                      publishState: "reply_published",
                      status: "finalized",
                    },
                  });
                }
              ),
            })),
            idFromName: vi.fn((ownerUserId: string) => ownerUserId),
          },
        },
      },
      durableObjectId: { value: "space-1" },
      resolveOutboxActiveAttemptOwnerUserId: {
        value: vi.fn(async () => ({
          ownerUserId: "owner-1",
          status: "ok",
        })),
      },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({ ok: true, status: "finalized" });
    expect(replayRequests).toEqual([
      {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: "run-1",
        runtimeCoordinatorExecutionId: "rce-1",
        spaceId: "space-1",
      },
    ]);
  });

  it("requests RuntimeCoordinator command replay for a durable publication failure", async () => {
    const replayRequests: unknown[] = [];
    const db = await createAcceptedInboxReadDb({
      ...baseInboxRecord,
      publicationErrorCode: "space.reply_write_failed",
      publishState: "reply_publication_failed",
      updatedAtMs: 1_700_000_000_200,
    });
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: db.binding,
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => ({
              rpcReplayRuntimeCoordinatorFinalizationCommand: vi.fn(
                (input: unknown) => {
                  replayRequests.push(input);
                  return Promise.resolve({
                    ok: true,
                    outcome: {
                      finalizationCommandId: "command-1",
                      ok: true,
                      publicationErrorCode: null,
                      publishedSignalId: "signal-final-1",
                      publishState: "reply_published",
                      status: "finalized",
                    },
                  });
                }
              ),
            })),
            idFromName: vi.fn((ownerUserId: string) => ownerUserId),
          },
        },
      },
      durableObjectId: { value: "space-1" },
      resolveOutboxActiveAttemptOwnerUserId: {
        value: vi.fn(async () => ({
          ownerUserId: "owner-1",
          status: "ok",
        })),
      },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({ ok: true, status: "finalized" });
    expect(replayRequests).toEqual([
      {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        executionTokenRunId: "run-1",
        runtimeCoordinatorExecutionId: "rce-1",
        spaceId: "space-1",
      },
    ]);
  });

  it("includes publication failures in the durable finalization replay scan", async () => {
    let capturedQuery = "";
    const db = createProjectionPostgresDatabase(({ text }) => {
      capturedQuery = text;
      return [{ attemptId: "attempt-1", dispatchId: "dispatch-1" }];
    });

    await expect(
      listAcceptedDispatchResultInboxRefsForSpace({
        db,
        limit: 5,
        spaceId: "space-1",
      })
    ).resolves.toEqual([
      {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
      },
    ]);
    expect(capturedQuery).toContain("'result_accepted'");
    expect(capturedQuery).toContain("'reply_publication_failed'");
  });

  it("keeps Space finalization retryable when RuntimeCoordinator replay records a failed publication outcome", async () => {
    const db = await createAcceptedInboxReadDb(baseInboxRecord);
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: db.binding,
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => ({
              rpcReplayRuntimeCoordinatorFinalizationCommand: vi.fn(() =>
                Promise.resolve({
                  ok: true,
                  outcome: {
                    finalizationCommandId: "command-1",
                    ok: false,
                    publicationErrorCode:
                      "daemon.result.finalization_unavailable",
                    publishedSignalId: null,
                    publishState: "reply_publication_failed",
                    status: "retry_later",
                  },
                })
              ),
            })),
            idFromName: vi.fn((ownerUserId: string) => ownerUserId),
          },
        },
      },
      durableObjectId: { value: "space-1" },
      resolveOutboxActiveAttemptOwnerUserId: {
        value: vi.fn(async () => ({
          ownerUserId: "owner-1",
          status: "ok",
        })),
      },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
  });

  it("keeps Space finalization redrive fail-soft when RuntimeCoordinator replay throws", async () => {
    const db = await createAcceptedInboxReadDb(baseInboxRecord);
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: db.binding,
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => ({
              rpcReplayRuntimeCoordinatorFinalizationCommand: vi.fn(() => {
                throw new Error("replay transport unavailable");
              }),
            })),
            idFromName: vi.fn((ownerUserId: string) => ownerUserId),
          },
        },
      },
      durableObjectId: { value: "space-1" },
      resolveOutboxActiveAttemptOwnerUserId: {
        value: vi.fn(async () => ({
          ownerUserId: "owner-1",
          status: "ok",
        })),
      },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
  });

  it("rejects an invalid RuntimeCoordinator finalization command without publishing", async () => {
    const space = Object.create(Space.prototype) as {
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: unknown
      ) => Promise<unknown>;
    };

    Object.defineProperty(space, "bindings", { value: env });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand({})
    ).resolves.toEqual({
      finalizationCommandId: "invalid",
      ok: false,
      publicationErrorCode: "runtime_coordinator.finalization_command_invalid",
      publishedSignalId: null,
      publishState: "reply_publication_failed",
      status: "retry_later",
    });
  });

  it("does not treat PostgreSQL terminal-looking result state as a visible Space reply", async () => {
    const archivedResultSignalId = "signal-final-from-postgresql";
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("SELECT signal_id")) {
          return {
            toArray: () => [],
          };
        }
        throw new Error(`unexpected Space SQL query: ${query}`);
      }),
    } as unknown as SqlStorage;
    const db = await createFinalizationApplyPostgresDb({
      publishedSignalId: archivedResultSignalId,
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      bindings: { OPENMELD_POSTGRESQL: PostgreSQLBinding };
      ctx: { storage: { sql: SqlStorage } };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      bindings: { value: { OPENMELD_POSTGRESQL: db.binding } },
      ctx: { value: { storage: { sql } } },
      readSignalById: {
        value: vi.fn((signalId: string) =>
          signalId === sourceSignal.id ? sourceSignal : null
        ),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => buildDefaultSpaceContract()),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({ organizationId: "org-1", spaceId: "space-1" })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(
        baseFinalizationCommand
      )
    ).resolves.toEqual({
      finalizationCommandId: "command-1",
      ok: false,
      publicationErrorCode: "daemon.result.finalization_no_public_reply",
      publishedSignalId: null,
      publishState: "reply_publication_failed",
      status: "retry_later",
    });
    expect(
      db.calls.some((call) =>
        call.text.includes('UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"')
      )
    ).toBe(false);
    expect(
      db.calls.some((call) =>
        call.text.includes(
          'UPDATE "openmeld"."openMeldDaemon_dispatch_attempts"'
        )
      )
    ).toBe(false);
  });

  it("does not treat an archived internal-only result as a successful Wake outcome", async () => {
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("SELECT signal_id")) {
          return { toArray: () => [] };
        }
        throw new Error(`unexpected Space SQL query: ${query}`);
      }),
    } as unknown as SqlStorage;
    const db = await createFinalizationApplyPostgresDb({
      publicOutcome: "internal_only",
      publishedSignalId: null,
    });
    const internalOnlyCommand = {
      ...baseFinalizationCommand,
      acceptedResult: {
        ...baseFinalizationCommand.acceptedResult,
        taskResult: {
          ...baseFinalizationCommand.acceptedResult.taskResult,
          payload: {
            ...baseFinalizationCommand.acceptedResult.taskResult.payload,
            suppressPublicOutcome: true,
          },
        },
      },
    } satisfies RuntimeCoordinatorFinalizationCommand;
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      bindings: { OPENMELD_POSTGRESQL: PostgreSQLBinding };
      ctx: { storage: { sql: SqlStorage } };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      bindings: { value: { OPENMELD_POSTGRESQL: db.binding } },
      ctx: { value: { storage: { sql } } },
      readSignalById: {
        value: vi.fn((signalId: string) =>
          signalId === sourceSignal.id ? sourceSignal : null
        ),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => buildDefaultSpaceContract()),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({ organizationId: "org-1", spaceId: "space-1" })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(internalOnlyCommand)
    ).resolves.toEqual({
      finalizationCommandId: "command-1",
      ok: false,
      publicationErrorCode: "daemon.result.finalization_no_public_reply",
      publishedSignalId: null,
      publishState: "reply_publication_failed",
      status: "retry_later",
    });
    expect(
      db.calls.some((call) =>
        call.text.includes('UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"')
      )
    ).toBe(false);
    expect(
      db.calls.some((call) =>
        call.text.includes(
          'UPDATE "openmeld"."openMeldDaemon_dispatch_attempts"'
        )
      )
    ).toBe(false);
  });

  it("keeps finalization retryable when a non-silent result has no visible Space outcome", async () => {
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("SELECT signal_id")) {
          return { toArray: () => [] };
        }
        throw new Error(`unexpected Space SQL query: ${query}`);
      }),
    } as unknown as SqlStorage;
    const db = await createFinalizationApplyPostgresDb({
      publishedSignalId: null,
    });
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      bindings: { OPENMELD_POSTGRESQL: PostgreSQLBinding };
      ctx: { storage: { sql: SqlStorage } };
      readSignalById: (signalId: string) => SignalEnvelope | null;
      readSpaceContractRecord: () => ReturnType<
        typeof buildDefaultSpaceContract
      >;
      resolveThreadContextForSignal: () => null;
      rpcApplyRuntimeCoordinatorFinalizationCommand: (
        input: RuntimeCoordinatorFinalizationCommand
      ) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      bindings: { value: { OPENMELD_POSTGRESQL: db.binding } },
      ctx: { value: { storage: { sql } } },
      readSignalById: {
        value: vi.fn((signalId: string) =>
          signalId === sourceSignal.id ? sourceSignal : null
        ),
      },
      readSpaceContractRecord: {
        value: vi.fn(() => buildDefaultSpaceContract()),
      },
      readSpaceMetaRecord: {
        value: vi.fn(() => ({ organizationId: "org-1", spaceId: "space-1" })),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => null) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFinalizationCommand(
        baseFinalizationCommand
      )
    ).resolves.toEqual({
      finalizationCommandId: "command-1",
      ok: false,
      publicationErrorCode: "daemon.result.finalization_no_public_reply",
      publishedSignalId: null,
      publishState: "reply_publication_failed",
      status: "retry_later",
    });
  });

  it("does not request RuntimeCoordinator replay when the accepted inbox row has no exact run pointer", async () => {
    const replayRequests: unknown[] = [];
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: {
        value: {
          OPENMELD_POSTGRESQL: (
            await createAcceptedInboxReadDb({
              ...baseInboxRecord,
              executionTokenRunId: null,
            })
          ).binding,
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => ({
              rpcReplayRuntimeCoordinatorFinalizationCommand: vi.fn(
                (input: unknown) => {
                  replayRequests.push(input);
                  return Promise.resolve({ ok: true });
                }
              ),
            })),
            idFromName: vi.fn((ownerUserId: string) => ownerUserId),
          },
        },
      },
      durableObjectId: { value: "space-1" },
      resolveOutboxActiveAttemptOwnerUserId: {
        value: vi.fn(async () => ({
          ownerUserId: "owner-1",
          status: "ok",
        })),
      },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({
      ok: true,
      status: "quarantined",
    });
    expect(replayRequests).toEqual([]);
  });

  it("quarantines a legacy accepted inbox row that has no exact RuntimeCoordinator run pointer", async () => {
    const db = await createAcceptedInboxReadDb({
      ...baseInboxRecord,
      executionTokenFingerprint: null,
      executionTokenRunId: null,
      runtimeCoordinatorExecutionId: null,
    });
    const space = Object.create(Space.prototype) as {
      bindings: unknown;
      durableObjectId: string;
      rpcFinalizeAcceptedDispatchResult: (input: {
        attemptId: string;
        dispatchId: string;
        spaceId: string;
      }) => Promise<unknown>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      bindings: { value: { OPENMELD_POSTGRESQL: db.binding } },
      durableObjectId: { value: "space-1" },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcFinalizeAcceptedDispatchResult({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
      })
    ).resolves.toEqual({
      ok: true,
      status: "quarantined",
    });

    expect(
      await db.fixture
        .rows("openMeldDaemon_dispatch_result_inbox", ["result_key"])
        .get(baseInboxRecord.resultKey)
    ).toMatchObject({
      publish_state: "legacy_result_quarantined",
      publication_error_code: "runtime_coordinator.execution_token_required",
    });
  });
});

async function createAcceptedInboxReadDb(record: DispatchResultInboxRecord) {
  const db = await createFinalizationPublishingPostgresDb({
    fact: {
      ...baseFact,
      dispatchId: record.dispatchId,
      attemptId: record.attemptId,
      targetProfileId: record.targetProfileId,
      taskId: record.taskId,
    },
  });
  await db.fixture.writeRow(
    "openMeldDaemon_dispatch_result_inbox",
    {
      accepted_at_ms: record.acceptedAtMs,
      attempt_id: record.attemptId,
      daemon_session_id: record.daemonSessionId,
      dispatch_id: record.dispatchId,
      execution_token_fingerprint: record.executionTokenFingerprint,
      execution_token_run_id: record.executionTokenRunId,
      lease_epoch: record.leaseEpoch,
      publication_error_code: record.publicationErrorCode,
      publish_state: record.publishState,
      published_signal_id: record.publishedSignalId,
      result_key: record.resultKey,
      result_payload_json: JSON.stringify(record.taskResult),
      runtime_coordinator_execution_id: record.runtimeCoordinatorExecutionId,
      submitted_connection_generation: record.submittedConnectionGeneration,
      target_profile_id: record.targetProfileId,
      task_id: record.taskId,
      updated_at_ms: record.updatedAtMs,
    },
    ["result_key"]
  );
  return db;
}

async function createFinalizationApplyPostgresDb(input: {
  publishedSignalId: string | null;
  publicOutcome?: "internal_only" | "post_message";
}) {
  const db = await createFinalizationPublishingPostgresDb({ fact: baseFact });
  await db.fixture.writeRow(
    "openMeldDaemon_dispatch_results",
    {
      actor_name: "Test Agent",
      actor_profile_id: baseFact.targetProfileId,
      created_at_ms: 1_700_000_000_250,
      dispatch_id: baseFact.dispatchId,
      final_text: "Hey, I'm here.",
      message_envelope_json: null,
      preview_text: "Hey, I'm here.",
      public_outcome: input.publicOutcome ?? "post_message",
      published_signal_id: input.publishedSignalId,
      reply_to_signal_id: "signal-1",
      result_kind: "text",
      result_ref: "result-dispatch-1",
      space_id: baseFact.spaceId,
      status_type: null,
    },
    ["result_ref"]
  );
  return db;
}

function createDispatchSourceSignal(input: {
  id: string;
  targetProfileId: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-staleness-1",
    ts: 1_700_000_030_000,
    type: "signal.text",
    profile: {
      kind: "human",
      profileId: "88888888-8888-4888-8888-888888888888",
      profileName: "Test User",
    },
    data: {
      text: "@Agent(wake) summarize this",
      messageEnvelope: {
        activationTargets: [input.targetProfileId],
        referenceTargets: [],
        text: "@Agent(wake) summarize this",
      },
    },
  };
}

function createLaterTextSignal(input: {
  id: string;
  profileId: string;
  profileKind?: "human" | "agent";
  ts: number;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-staleness-1",
    ts: input.ts,
    type: "signal.text",
    profile: {
      kind: input.profileKind ?? "human",
      profileId: input.profileId,
      profileName: "Room participant",
    },
    data: { text: `Later message ${input.id}` },
  };
}

async function buildAgentTransportMessageSignal(input: {
  failStalenessRead?: boolean;
  initialSignals: readonly SignalEnvelope[];
  source: SignalEnvelope;
  targetProfileId: string;
}): Promise<SignalEnvelope> {
  const dispatchId = `dispatch-${input.source.id}`;
  const taskId = `task-${input.source.id}`;
  const dispatchFact = {
    ...baseFact,
    attemptId: `attempt-${input.source.id}`,
    dispatchId,
    idempotencyKey: `${input.source.id}|${input.targetProfileId}`,
    sourceClientMessageId: `client-${input.source.id}`,
    sourceEventId: input.source.id,
    spaceId: input.source.spaceId,
    targetProfileId: input.targetProfileId,
    taskId,
  } satisfies AcceptedDispatchFinalizationFact;
  const inboxRecord = {
    ...baseInboxRecord,
    attemptId: dispatchFact.attemptId,
    dispatchId,
    resultKey: `${dispatchId}:${dispatchFact.attemptId}`,
    targetProfileId: input.targetProfileId,
    taskId,
    taskResult: {
      ...baseInboxRecord.taskResult,
      payload: {
        ...baseInboxRecord.taskResult.payload,
        agentId: input.targetProfileId,
        attemptId: dispatchFact.attemptId,
        output: "Final reply",
        sourceEventId: input.source.id,
        taskId,
      },
    },
  } satisfies DispatchResultInboxRecord;
  const dispatchMessage = buildAcceptedDispatchFinalizationQueueMessage({
    fact: dispatchFact,
    inboxRecord,
    sourceSignal: input.source,
    spaceContract: buildDefaultSpaceContract(),
    threadContext: null,
  });
  if (!dispatchMessage) {
    throw new Error("expected dispatch message to rebuild");
  }

  const { sql } = createSpaceSqlHarness(input.initialSignals, {
    failStalenessRead: input.failStalenessRead,
  });
  const space = Object.create(Space.prototype) as {
    bindings: unknown;
    buildAgentTransportSpaceActionSignal: (
      deliveryInput: AgentTransportSpaceActionDeliveryInput
    ) => Promise<SignalEnvelope>;
    ctx: { storage: { sql: SqlStorage } };
    lastTimestamp: number;
    spaceId: string;
  };
  Object.defineProperties(space, {
    bindings: { value: {} },
    ctx: { value: { storage: { sql } } },
    lastTimestamp: {
      value: Math.max(...input.initialSignals.map((signal) => signal.ts)),
      writable: true,
    },
    spaceId: { value: input.source.spaceId, writable: true },
  });
  const messageEnvelope = {
    activationTargets: [],
    referenceTargets: [],
    replyToSignalId: input.source.id,
    text: "Final reply",
  };

  return await space.buildAgentTransportSpaceActionSignal({
    agentControllerConversationId: null,
    attemptId: inboxRecord.attemptId,
    agentControllerRef: "builtin:codex",
    dispatchMessage,
    finalOutcomeAuthority: "runtime_coordinator_finalization",
    messageEnvelope,
    plan: {
      archiveMode: "none",
      blockedExplicitAction: false,
      kind: "message",
      messageEnvelope,
      publicOutcome: "post_message",
      shouldArchive: false,
      text: "Final reply",
    },
    profileHandle: null,
    resultRef: null,
    targetOwnerUserId: "owner-1",
    targetProfileMentionLabel: null,
    targetProfileName: "Test Agent",
    agentControllerConversation: null,
    workingDirectory: null,
  });
}

function createSpaceSqlHarness(
  initialSignals: readonly SignalEnvelope[] = [],
  options: { failStalenessRead?: boolean } = {}
) {
  const finalReplyClaims = new Map<string, string>();
  const signalRows = new Map<string, { payloadJson: string; ts: number }>();
  const threadPlacements = new Map<
    string,
    { threadId: string; placement: string; createdAtMs: number }
  >();
  const sql = {
    databaseSize: 0,
    exec: vi.fn((query: string, ...params: unknown[]) => {
      if (query.includes("SELECT signal_id")) {
        const claimKey = `${String(params[0])}:${String(params[1])}`;
        return {
          toArray: () =>
            finalReplyClaims.has(claimKey)
              ? [{ signal_id: finalReplyClaims.get(claimKey) }]
              : [],
        };
      }
      if (query.includes("INSERT OR IGNORE INTO space_final_reply_claims")) {
        const claimKey = `${String(params[0])}:${String(params[1])}`;
        if (finalReplyClaims.has(claimKey)) {
          return { rowsWritten: 0 };
        }
        finalReplyClaims.set(claimKey, String(params[2]));
        return { rowsWritten: 1 };
      }
      if (query.includes("INSERT OR IGNORE INTO space_signals")) {
        const signalId = String(params[0]);
        if (signalRows.has(signalId)) {
          return { rowsWritten: 0 };
        }
        signalRows.set(signalId, {
          payloadJson: String(params[6]),
          ts: Number(params[1]),
        });
        return { rowsWritten: 1 };
      }
      if (query.includes("INSERT INTO space_thread_signal_placements")) {
        threadPlacements.set(String(params[0]), {
          threadId: String(params[1]),
          placement: String(params[2]),
          createdAtMs: Number(params[3]),
        });
        return { rowsWritten: 1 };
      }
      if (query.includes("COUNT(*) AS signal_count")) {
        if (options.failStalenessRead) {
          throw new Error("staleness lookup unavailable");
        }
        const anchorSignalId = String(params[0]);
        const afterTimestampMs = Number(params[1]);
        const excludedProfileId = String(params[2]);
        const signalEntries = [...signalRows.entries()];
        const anchorIndex = signalEntries.findIndex(
          ([signalId]) => signalId === anchorSignalId
        );
        const candidateEntries =
          anchorIndex < 0
            ? signalEntries.filter(([, row]) => row.ts > afterTimestampMs)
            : signalEntries.slice(anchorIndex + 1);
        const signalCount = candidateEntries.filter(([, row]) => {
          const signal = JSON.parse(row.payloadJson) as SignalEnvelope;
          return (
            signal.type === "signal.text" &&
            signal.profile.kind !== "system" &&
            signal.profile.profileId !== excludedProfileId &&
            signal.data.meta?.transient !== true
          );
        }).length;
        return { toArray: () => [{ signal_count: signalCount }] };
      }
      if (query.includes("AS context_changed")) {
        const anchorSignalId = String(params[0]);
        const threadId = params[1] === null ? null : String(params[1]);
        const signalEntries = [...signalRows.entries()];
        const anchorIndex = signalEntries.findIndex(
          ([signalId]) => signalId === anchorSignalId
        );
        const contextChanged =
          anchorIndex >= 0 &&
          signalEntries.slice(anchorIndex + 1).some(([signalId, row]) => {
            const signal = JSON.parse(row.payloadJson) as SignalEnvelope;
            const placement = threadPlacements.get(signalId);
            const isInScope = threadId
              ? placement?.threadId === threadId &&
                placement.placement === "thread"
              : !placement || placement.placement === "root";
            return (
              isInScope &&
              (signal.type === "signal.text" ||
                signal.type === "signal.status") &&
              signal.profile.kind !== "system" &&
              (signal.type !== "signal.text" ||
                signal.data.meta?.transient !== true)
            );
          });
        return {
          toArray: () => [
            {
              anchor_exists: anchorIndex >= 0 ? 1 : 0,
              context_changed: contextChanged ? 1 : 0,
            },
          ],
        };
      }
      if (
        query.includes("FROM space_signals") &&
        query.includes("WHERE id = ?")
      ) {
        const signalId = String(params[0]);
        const row = signalRows.get(signalId);
        return {
          toArray: () =>
            row
              ? [
                  {
                    id: signalId,
                    payload_json: row.payloadJson,
                    ts: row.ts,
                  },
                ]
              : [],
        };
      }
      if (query.includes("DELETE FROM space_signals")) {
        return { rowsWritten: 0 };
      }
      return { rowsWritten: 1, toArray: () => [] };
    }),
  } as unknown as SqlStorage;
  for (const signal of initialSignals) {
    insertSignalRecord(sql, signal);
  }
  return { finalReplyClaims, signalRows, sql, threadPlacements };
}

async function createFinalizationPublishingPostgresDb(input: {
  allowResultInsert?: boolean;
  fact: AcceptedDispatchFinalizationFact;
}) {
  const fixture = await createWorkerPostgresFixture(env);
  const write = fixture.writeRow;
  const fact = input.fact;
  if (!fact.dispatchOwner || fact.dispatchOwner.kind !== "owner_account") {
    throw new Error("An owner-account fixture is required");
  }
  const owner = fact.dispatchOwner;
  const now = 1_700_000_000_000;
  await write(
    "users",
    { id: owner.id, name: "Owner", email: `${owner.id}@example.com` },
    ["id"]
  );
  await write(
    "organizations",
    { id: "org-1", name: "Organization", slug: "org-1", created_at: now },
    ["id"]
  );
  await write(
    "openmeld_profiles",
    {
      profile_id: fact.targetProfileId,
      profile_name: "Test Agent",
      profile_handle: "test-agent",
      profile_kind: "agent",
      organization_id: "org-1",
      owner_user_id: owner.id,
      source: "migration",
    },
    ["profile_id"]
  );
  await write(
    "openmeld_profiles",
    {
      profile_id: sourceSignal.profile.profileId,
      profile_name: "Test User",
      profile_handle: "test-human",
      profile_kind: "human",
      owner_user_id: owner.id,
      source: "auth_bootstrap",
      is_default: 1,
    },
    ["profile_id"]
  );
  await write(
    "openMeldDaemon_dispatch_ledger",
    {
      idempotency_key: fact.idempotencyKey,
      dispatch_id: fact.dispatchId,
      space_id: fact.spaceId,
      source_event_id: fact.sourceEventId,
      source_client_message_id: fact.sourceClientMessageId,
      dispatch_owner_kind: owner.kind,
      dispatch_owner_id: owner.id,
      target_profile_id: fact.targetProfileId,
      status: "waiting_result",
      first_seen_at_ms: fact.enqueuedAtMs,
      last_attempt_at_ms: fact.enqueuedAtMs,
      attempt_count: 1,
      latest_attempt_id: fact.attemptId,
    },
    ["idempotency_key"]
  );
  await write(
    "openMeldDaemon_dispatch_attempts",
    {
      attempt_id: fact.attemptId,
      dispatch_id: fact.dispatchId,
      idempotency_key: fact.idempotencyKey,
      attempt_no: 1,
      status: "waiting_result",
      task_id: fact.taskId,
      target_profile_id: fact.targetProfileId,
      created_at_ms: fact.enqueuedAtMs,
    },
    ["attempt_id"]
  );
  const calls: { text: string; values: unknown[] }[] = [];
  const db = observePostgresDatabase(fixture.db, (query) => {
    calls.push({ text: query.text, values: query.values ?? [] });
    if (
      !input.allowResultInsert &&
      query.text.includes(
        'INSERT INTO "openmeld"."openMeldDaemon_dispatch_results"'
      )
    ) {
      throw new Error("non-archived finalization must not write a result row");
    }
  });
  finalizationDatabases.set(fixture.binding, db);
  return {
    binding: fixture.binding,
    fixture,
    calls,
    db,
    readDispatchLedgerStatuses: () =>
      calls
        .filter(
          (call) =>
            call.text.includes(
              'UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"'
            ) && !call.text.includes("final_reply_sent_at_ms")
        )
        .map((call) => String(call.values[0])),
    readDispatchSuccessWriteCount: () =>
      calls.filter(
        (call) =>
          DISPATCH_WRITE_PATTERN.test(call.text) &&
          !call.text.includes("final_reply_sent_at_ms")
      ).length,
    readTaskOutcomeWriteCount: () =>
      calls.filter((call) =>
        call.text.includes(
          'INSERT INTO "openmeld"."agent_task_terminal_outcomes"'
        )
      ).length,
    replaceTaskOutcome: async (outcome: AgentTaskTerminalOutcome) => {
      const rows = await fixture
        .rows("agent_task_terminal_outcomes", ["task_key"])
        .values();
      if (rows.length !== 1) {
        throw new Error("Expected one Agent Task terminal outcome row");
      }
      await fixture.operator.query({
        text: 'UPDATE "openmeld"."agent_task_terminal_outcomes" SET event_id=$1,occurred_at_ms=$2,outcome_json=$3,status=$4 WHERE task_key=$5',
        values: [
          outcome.eventId,
          outcome.occurredAtMs,
          JSON.stringify(outcome),
          outcome.status,
          rows[0]?.task_key,
        ],
      });
    },
  };
}

function createAgentStreamProjectionStorage(
  sql: SqlStorage
): AgentStreamProjectionStorage & {
  sql: SqlStorage;
  transactionSync: <T>(operation: () => T) => T;
} {
  const values = new Map<string, unknown>();
  const storage: AgentStreamProjectionStorage & {
    sql: SqlStorage;
    transactionSync: <T>(operation: () => T) => T;
  } = {
    sql,
    transactionSync: <T>(operation: () => T) => operation(),
    delete: (key) => {
      if (Array.isArray(key)) {
        let deleted = 0;
        for (const item of key) {
          deleted += values.delete(item) ? 1 : 0;
        }
        return Promise.resolve(deleted);
      }
      return Promise.resolve(values.delete(key));
    },
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    list: <T>(options: { prefix: string }) =>
      Promise.resolve(
        new Map(
          [...values.entries()].filter(([key]) =>
            key.startsWith(options.prefix)
          )
        ) as Map<string, T>
      ),
    put: <T>(key: string, value: T) => {
      values.set(key, value);
      return Promise.resolve();
    },
    transaction: async <T>(
      closure: (transaction: AgentStreamProjectionStorage) => Promise<T>
    ) => await closure(storage),
  };
  return storage;
}
