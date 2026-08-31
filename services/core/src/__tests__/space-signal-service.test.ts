import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  projectTargetWakeLifecycleIdentity,
  REMOTE_AGENT_FAILURE_PURPOSE,
  RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE,
  signalSystemNoticeDataSchema,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  ExecutionRecoveryProjection,
  GetActiveSpaceWakeProgressResponse,
  GetSpaceWakeProgressResponse,
  MessageEnvelope,
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeCoordinatorFailurePublicationCommand,
  SpaceDispatchLookupMatch,
  SpaceDispatchTraceSnapshot,
  WakeProgressItem,
  WakeStopEligibilityReadModel,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { DISPATCH_REPLYING_HINT_START_PURPOSE } from "../dispatch/rules/dispatch-hint-policy";
import { inspectExecutionRecovery } from "../execution-recovery/application/execution-recovery-service";
import type { CoreBindings } from "../lib/bindings";
import { buildDefaultSpaceContract } from "../space/application/space-contract-service";
import {
  handlePostSignalUseCase,
  publishPresenceSignalUseCase,
  publishTextSignalUseCase,
  SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
  SpaceSignalAuthoringError,
} from "../space/application/space-signal-service";
import { createDispatchOutboxRecord } from "../space/infrastructure/outbox/dispatch-outbox-repo";
import {
  insertSignalRecord,
  readFinalReplyClaimSignalId,
} from "../space/infrastructure/sql/space-signal-repo";
import {
  handleWebSocketTextSignal,
  persistPostPersistDispatchPlannerEvidenceBestEffort,
  Space,
} from "../space/transport/do/space";

const createSignal = (): Extract<SignalEnvelope, { type: "signal.text" }> => ({
  v: 1,
  id: "evt-1",
  spaceId: "space-1",
  ts: Date.UTC(2026, 2, 4, 0, 0, 0),
  profile: {
    kind: "human",
    profileId: "human-1",
    profileName: "Felix",
  },
  type: "signal.text",
  data: { text: "hello" },
});

const REPLYING_HINT_TARGET_PROFILE_ID =
  "agt_11111111-1111-4111-8111-111111111111";
const REPLYING_HINT_DISPATCH_ID = "dispatch-replying-hint-1";

const createReplyingHintSignal = (): SignalEnvelope => ({
  ...createSignal(),
  id: "sig-replying-hint-1",
  profile: {
    kind: "system",
    profileId: "openmeld-system",
    profileName: "OpenMeld System",
  },
  data: {
    text: "Agent is working.",
    meta: {
      dispatchId: REPLYING_HINT_DISPATCH_ID,
      purpose: DISPATCH_REPLYING_HINT_START_PURPOSE,
      targetProfileId: REPLYING_HINT_TARGET_PROFILE_ID,
      transient: true,
    },
  },
});

const createReplyingHintTerminalSignals = (): Array<{
  label: string;
  signal: SignalEnvelope;
}> => [
  {
    label: "final reply",
    signal: {
      ...createSignal(),
      id: "sig-replying-final-1",
      profile: {
        kind: "agent",
        profileId: REPLYING_HINT_TARGET_PROFILE_ID,
        profileName: "Center Agent",
      },
      data: {
        text: "Done.",
        meta: {
          dispatchId: REPLYING_HINT_DISPATCH_ID,
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: REPLYING_HINT_TARGET_PROFILE_ID,
        },
      },
    },
  },
  {
    label: "terminal failure",
    signal: {
      ...createSignal(),
      id: "sig-replying-failure-1",
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        actorProfileId: REPLYING_HINT_TARGET_PROFILE_ID,
        dispatchId: REPLYING_HINT_DISPATCH_ID,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "remote_agent.execution_failed",
        text: "Center Agent could not reply.",
      },
    },
  },
  {
    label: "stopped notice",
    signal: {
      ...createSignal(),
      id: "sig-replying-stopped-1",
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        actorProfileId: REPLYING_HINT_TARGET_PROFILE_ID,
        dispatchId: REPLYING_HINT_DISPATCH_ID,
        generatedBy: "openmeld",
        noticeType: "wake_stopped",
        reason: "runtime_coordinator.wake_stop_requested",
        text: "Wake was stopped for Center Agent.",
      },
    },
  },
];

const createReplyingHintTrackingSpace = (sql: SqlStorage) => {
  const activeReplyingSignalsByDispatchId = new Map<
    string,
    { encodedSignal: string; expiresAtMs: number }
  >();
  const broadcast = vi.fn();
  const space = Object.create(Space.prototype) as {
    activeReplyingSignalsByDispatchId: typeof activeReplyingSignalsByDispatchId;
    broadcast: typeof broadcast;
    broadcastSignal: (signal: SignalEnvelope) => void;
    ctx: { storage: { sql: SqlStorage } };
    trackReplyingTransientSignal: (signal: SignalEnvelope) => boolean;
  };
  Object.defineProperties(space, {
    activeReplyingSignalsByDispatchId: {
      value: activeReplyingSignalsByDispatchId,
    },
    broadcast: { value: broadcast },
    ctx: { value: { storage: { sql } } },
  });
  return { activeReplyingSignalsByDispatchId, broadcast, space };
};

const TEST_REPLY_TO: SignalTextReplyTo = {
  signalId: "sig-reply-1",
  profileId: "22222222-2222-4222-8222-222222222222",
  profileKind: "human",
  profileName: "Mira",
  previewText: "hello from earlier",
};

const TEST_MESSAGE_ENVELOPE: MessageEnvelope = {
  activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
  referenceTargets: [],
  text: "@Codex Agent(wake) hello",
};

const createFinalOutcomeSql = () => {
  const finalReplyClaims = new Map<string, string>();
  const signalRows = new Map<string, { payloadJson: string; ts: number }>();
  const sqlExec = vi.fn((query: string, ...params: unknown[]) => {
    if (query.includes("FROM space_members")) {
      return { toArray: () => [] };
    }
    if (query.includes("SELECT signal_id")) {
      const claimKey = `${String(params[0])}:${String(params[1])}`;
      return {
        toArray: () => [
          ...(finalReplyClaims.has(claimKey)
            ? [{ signal_id: finalReplyClaims.get(claimKey) }]
            : []),
        ],
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
                  ts: row.ts,
                  payload_json: row.payloadJson,
                },
              ]
            : [],
      };
    }
    if (query.includes("DELETE FROM space_signals")) {
      return { rowsWritten: 0 };
    }
    return { rowsWritten: 1, toArray: () => [] };
  });
  const sql = {
    databaseSize: 0,
    exec: sqlExec,
  } as unknown as SqlStorage;
  return { finalReplyClaims, signalRows, sql, sqlExec };
};

const createSystemWakePublishingHarness = (input: {
  dispatchRuleAllow?: boolean;
  previousOutboxRecord?: ReturnType<typeof createDispatchOutboxRecord>;
  previousSignals?: SignalEnvelope[];
  targetProfileId?: string | null;
}) => {
  const spaceId = "space-1";
  const centerProfileId = "agt_11111111-1111-4111-8111-111111111111";
  const targetProfileId =
    input.targetProfileId ?? "agt_33333333-3333-4333-8333-333333333333";
  const memberRows = [
    {
      added_at: 1_700_000_000_000,
      added_by_display_name_snapshot: null,
      added_by_owner_user_id: null,
      added_by_profile_id: null,
      controller_ref_snapshot: "builtin:center-agent",
      created_at: 1_700_000_000_000,
      first_entered_at: null,
      last_entered_at: null,
      member_source: "joined_directly",
      owner_name_snapshot: "Felix",
      owner_user_id_snapshot: "owner-center",
      profile_id: centerProfileId,
      profile_kind_snapshot: "agent",
      profile_name_snapshot: "Center Agent",
      removal_reason: null,
      removed_at: null,
      removed_by_owner_user_id: null,
      removed_by_profile_id: null,
      space_id: spaceId,
      status: "active",
      updated_at: 1_700_000_000_000,
    },
    ...(input.targetProfileId === null
      ? []
      : [
          {
            added_at: 1_700_000_000_000,
            added_by_display_name_snapshot: null,
            added_by_owner_user_id: null,
            added_by_profile_id: null,
            controller_ref_snapshot: "builtin:codex",
            created_at: 1_700_000_000_000,
            first_entered_at: null,
            last_entered_at: null,
            member_source: "joined_directly",
            owner_name_snapshot: "Felix",
            owner_user_id_snapshot: "owner-target",
            profile_id: targetProfileId,
            profile_kind_snapshot: "agent",
            profile_name_snapshot: "Codex Agent",
            removal_reason: null,
            removed_at: null,
            removed_by_owner_user_id: null,
            removed_by_profile_id: null,
            space_id: spaceId,
            status: "active",
            updated_at: 1_700_000_000_000,
          },
        ]),
  ];
  const finalReplyClaims = new Map<string, string>();
  const signalRows = new Map<
    string,
    { payloadJson: string; signal: SignalEnvelope; ts: number }
  >();
  for (const signal of input.previousSignals ?? []) {
    signalRows.set(signal.id, {
      payloadJson: JSON.stringify(signal),
      signal,
      ts: signal.ts,
    });
  }
  const outboxRows = new Map<string, OpenMeldDaemonDispatchQueueMessage>();
  if (input.previousOutboxRecord) {
    outboxRows.set(
      input.previousOutboxRecord.dispatchId,
      input.previousOutboxRecord
    );
  }
  const sql = {
    databaseSize: 0,
    exec: vi.fn((query: string, ...params: unknown[]) => {
      if (query.includes("FROM space_members")) {
        let rows = memberRows;
        if (query.includes("WHERE profile_id = ?")) {
          rows = memberRows.filter(
            (row) => row.profile_id === String(params[0])
          );
        } else if (query.includes("WHERE status = ?")) {
          rows = memberRows.filter((row) => row.status === String(params[0]));
        }
        return { toArray: () => rows };
      }
      if (query.includes("FROM space_dispatch_rules")) {
        return {
          toArray: () =>
            input.dispatchRuleAllow === false
              ? [
                  {
                    allow: 0,
                    mode: "all_members",
                    rule_id: "space.review_wake.blocked",
                    rule_reason: "review Wake is temporarily blocked",
                    rule_set_version: 1,
                    updated_at_ms: 1_700_000_000_000,
                    updated_by: "system",
                  },
                ]
              : [],
        };
      }
      if (query.includes("FROM space_cursors")) {
        return { toArray: () => [] };
      }
      if (query.includes("SELECT signal_id")) {
        const key = `${String(params[0])}:${String(params[1])}`;
        return {
          toArray: () =>
            finalReplyClaims.has(key)
              ? [{ signal_id: finalReplyClaims.get(key) }]
              : [],
        };
      }
      if (query.includes("INSERT OR IGNORE INTO space_final_reply_claims")) {
        const key = `${String(params[0])}:${String(params[1])}`;
        if (finalReplyClaims.has(key)) {
          return { rowsWritten: 0 };
        }
        finalReplyClaims.set(key, String(params[2]));
        return { rowsWritten: 1 };
      }
      if (query.includes("INSERT OR IGNORE INTO space_signals")) {
        const signalId = String(params[0]);
        if (signalRows.has(signalId)) {
          return { rowsWritten: 0 };
        }
        const signal = JSON.parse(String(params[6])) as SignalEnvelope;
        signalRows.set(signalId, {
          payloadJson: String(params[6]),
          signal,
          ts: Number(params[1]),
        });
        return { rowsWritten: 1 };
      }
      if (
        query.includes("SELECT profile_id, ts, payload_json") &&
        query.includes("FROM space_signals")
      ) {
        return {
          toArray: () =>
            [...signalRows.values()].map((row) => ({
              payload_json: row.payloadJson,
              profile_id: row.signal.profile.profileId,
              ts: row.ts,
            })),
        };
      }
      if (
        query.includes("SELECT id, ts, payload_json") &&
        query.includes("FROM space_signals")
      ) {
        return {
          toArray: () =>
            [...signalRows.entries()]
              .sort(([, left], [, right]) => right.ts - left.ts)
              .map(([id, row]) => ({
                id,
                payload_json: row.payloadJson,
                ts: row.ts,
              })),
        };
      }
      if (query.includes("INTO openMeldDaemon_outbox")) {
        const message = JSON.parse(
          String(params[5])
        ) as OpenMeldDaemonDispatchQueueMessage;
        outboxRows.set(message.dispatchId, message);
        return { rowsWritten: 1 };
      }
      if (
        query.includes("FROM openMeldDaemon_outbox") ||
        query.includes("FROM space_meta")
      ) {
        return { toArray: () => [] };
      }
      if (query.includes("INSERT OR IGNORE INTO space_dispatch_rules")) {
        return { rowsWritten: 1 };
      }
      if (query.includes("DELETE FROM space_signals")) {
        return { rowsWritten: 0 };
      }
      return { rowsWritten: 1, toArray: () => [] };
    }),
  } as unknown as SqlStorage;
  const broadcastSignal = vi.fn();
  const flushPendingDispatchOutbox = vi.fn(async () => undefined);
  const waitUntil = vi.fn();
  const space = Object.create(Space.prototype) as {
    publishTextSignal: (
      signal: SignalEnvelope,
      signalContext?: {
        authoringPolicy: "system_emitted";
        finalOutcomeAuthority: "runtime_coordinator_finalization";
      }
    ) => Promise<void>;
  };
  Object.defineProperties(space, {
    bindings: { value: {} },
    broadcastSignal: { value: broadcastSignal },
    ctx: {
      value: {
        storage: {
          sql,
          transactionSync: (operation: () => unknown) => operation(),
        },
        waitUntil,
      },
    },
    durableObjectId: { value: spaceId },
    flushPendingDispatchOutbox: { value: flushPendingDispatchOutbox },
    lastPostCleanupAtMs: { value: 0, writable: true },
    lastRetentionWarningAtMs: { value: 0, writable: true },
    ownerCreatorProfileIdsByOwnerUserId: { value: new Map() },
    preloadDispatchContinuityCreatorProfileIds: {
      value: vi.fn(async () => undefined),
    },
    readSpaceContractRecord: {
      value: vi.fn(() => buildDefaultSpaceContract()),
    },
    readSpaceMetaRecord: {
      value: vi.fn(() => ({ organizationId: "org-space-1" })),
    },
    sessions: { value: new Map() },
    spaceId: { value: spaceId, writable: true },
  });
  return {
    broadcastSignal,
    centerProfileId,
    flushPendingDispatchOutbox,
    outboxRows,
    signalRows,
    space,
    targetProfileId,
    waitUntil,
  };
};

const buildWakeProgressItemFromLookupTrace = async (
  trace: SpaceDispatchTraceSnapshot,
  terminalFailureNotices: readonly unknown[] = [],
  lookupMatchOverrides: Partial<SpaceDispatchLookupMatch> = {},
  wakeStopEligibility: WakeStopEligibilityReadModel | null = null,
  includeWakeStopEligibility = wakeStopEligibility !== null
): Promise<WakeProgressItem> => {
  const lookupMatch = {
    dispatchId: "dispatch-head-progress-1",
    latestAttemptErrorCode: "queue.dlq.exhausted",
    latestAttemptStatus: "failed_terminal",
    sourceSignalId: "sig-source-1",
    status: "failed_retryable",
    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    ...lookupMatchOverrides,
  } as unknown as SpaceDispatchLookupMatch;
  const space = Object.create(Space.prototype) as {
    buildWakeProgressItemFromLookupEvidence: (input: {
      clientMessageId: string;
      includeTiming?: boolean;
      includeWakeStopEligibility?: boolean;
      lookupMatch: SpaceDispatchLookupMatch;
      outboxRecord: null;
      sourceSignal: null;
      targetLabel: string;
      terminalFailureNotices: readonly unknown[];
    }) => Promise<WakeProgressItem>;
    readSpaceDispatchTrace: () => Promise<{
      trace: SpaceDispatchTraceSnapshot;
    }>;
    readWakeProgressWakeStopEligibility: (
      trace: SpaceDispatchTraceSnapshot | null
    ) => Promise<WakeStopEligibilityReadModel | null>;
    readWakeProgressRuntimeDeviceDisplayName: () => Promise<string | null>;
  };
  Object.defineProperties(space, {
    readSpaceDispatchTrace: {
      value: vi.fn(async () => ({ trace })),
    },
    readWakeProgressRuntimeDeviceDisplayName: {
      value: vi.fn(async () => null),
    },
    readWakeProgressWakeStopEligibility: {
      value: vi.fn(async () => wakeStopEligibility),
    },
  });

  return await space.buildWakeProgressItemFromLookupEvidence({
    clientMessageId: "client-message-1",
    includeTiming: true,
    includeWakeStopEligibility,
    lookupMatch,
    outboxRecord: null,
    sourceSignal: null,
    targetLabel: "Codex Agent",
    terminalFailureNotices,
  });
};

function createWakeProgressReplyProducedTrace(input: {
  finalVisibleMessage?: unknown;
  replySignal?: unknown;
  resultInbox?: unknown;
}): SpaceDispatchTraceSnapshot {
  return {
    dispatch: {
      dispatchId: "dispatch-head-progress-1",
      factSource: "dispatch_ledger",
      firstSeenAt: "2026-03-04T00:00:00.000Z",
      idempotencyKey: "idempotency-1",
      latestAttemptId: "attempt-1",
      lastAttemptAt: "2026-03-04T00:00:00.000Z",
      owner: { kind: "owner_account", id: "owner-1" },
      sourceClientMessageId: "client-message-1",
      sourceEventId: "sig-source-1",
      status: "succeeded",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      attemptCount: 1,
    },
    latestAttempt: {
      attemptId: "attempt-1",
      attemptNo: 1,
      connectionGeneration: 1,
      createdAt: "2026-03-04T00:00:00.000Z",
      daemonSessionId: "daemon-session-1",
      dispatchId: "dispatch-head-progress-1",
      errorCode: null,
      errorMessage: null,
      factSource: "dispatch_attempt",
      finishedAt: "2026-03-04T00:00:00.000Z",
      idempotencyKey: "idempotency-1",
      leaseEpoch: 1,
      startedAt: "2026-03-04T00:00:00.000Z",
      status: "succeeded",
    },
    claimLease: null,
    dispatchExecution: null,
    execution: null,
    executionIdentity: null,
    finalVisibleMessage: input.finalVisibleMessage ?? null,
    openClawBinding: null,
    openClawGatewayVisibility: null,
    origin: null,
    prompt: null,
    recentOpsDecisions: [],
    replySignal: input.replySignal ?? null,
    result: null,
    resultInbox: input.resultInbox ?? null,
    runtime: null,
    runtimeCoordinatorCreationDiagnostics: [],
    runtimeCoordinatorEvents: [],
    runtimeCoordinatorExecution: null,
    runtimeCoordinatorHeadLifecycle: null,
    streaming: null,
    structuredActionFailure: null,
  } as unknown as SpaceDispatchTraceSnapshot;
}

function createRunningRuntimeCoordinatorTrace(): SpaceDispatchTraceSnapshot {
  return {
    ...createWakeProgressReplyProducedTrace({}),
    runtimeCoordinatorExecution: {
      agentControllerRef: "builtin:claude",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-rc-1",
      },
      bindingId: "binding-rc-1",
      createdAtMs: Date.parse("2026-03-04T00:00:00.000Z"),
      dispatchId: "dispatch-head-progress-1",
      factSource: "runtime_coordinator_projection",
      legacyPointers: {
        attemptId: "attempt-1",
        claimLeaseId: null,
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 1,
      },
      modelVersion: "openmeld.runtime_coordinator.execution.v1",
      runtimeCoordinatorExecutionId: "rce-dispatch-running-1",
      sourceClientMessageId: "client-message-1",
      spaceId: "space-1",
      status: "running",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      terminalOutcome: null,
      updatedAtMs: Date.parse("2026-03-04T00:21:00.000Z"),
    },
    runtimeCoordinatorEvents: [
      {
        eventId: "rce-event-running-1",
        eventType: "lifecycle_running",
        factSource: "runtime_coordinator_projection",
        idempotencyKey: "rce-event-running-1",
        observedAtMs: Date.parse("2026-03-04T00:22:00.000Z"),
        payloadJson: {},
        reasonCode: null,
        runtimeCoordinatorExecutionId: "rce-dispatch-running-1",
        statusAfter: "running",
      },
    ],
  } as unknown as SpaceDispatchTraceSnapshot;
}

function createAgentControllerInterfaceSnapshot(input: {
  cancel: boolean;
  interrupt?: boolean;
}): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:claude",
    auth: { status: "authenticated" },
    capabilities: {
      approvals: true,
      cancel: input.cancel,
      interrupt: input.interrupt ?? false,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: "2026-03-04T00:00:00.000Z",
    controllerId: "claude-code",
    displayName: "Claude Code",
    launch: {
      argsPrefix: [],
      commandPath: null,
      installChoiceCount: 0,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface: "claude-agent-sdk",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "1.0.0",
  };
}

function createRuntimeAgentControllerReportDb(input: {
  agentControllerInterface: AgentControllerInterfaceSnapshot | null;
  expiresAtMs: number;
  reportStatus?: string;
}): D1Database {
  const first = vi.fn(async () => ({
    agent_controller_interface_json: input.agentControllerInterface
      ? JSON.stringify(input.agentControllerInterface)
      : null,
    agent_controller_ref: "builtin:claude",
    openmeld_service_runtime_id: "runtime-rc-1",
    accepted_at_ms: Date.UTC(2026, 2, 4, 0, 0),
    expires_at_ms: input.expiresAtMs,
    observed_at_ms: Date.UTC(2026, 2, 4, 0, 0),
    reported_reason_codes_json: "[]",
    report_status: input.reportStatus ?? "ready",
    updated_at_ms: Date.UTC(2026, 2, 4, 0, 0),
  }));
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare } as unknown as D1Database;
}

async function readWakeProgressWakeStopEligibilityForTest(input: {
  db: D1Database;
  trace: SpaceDispatchTraceSnapshot;
}): Promise<WakeProgressItem["wakeStopEligibility"]> {
  const space = Object.create(Space.prototype) as unknown as {
    readWakeProgressWakeStopEligibility: (
      trace: SpaceDispatchTraceSnapshot | null
    ) => Promise<WakeProgressItem["wakeStopEligibility"]>;
  };
  Object.defineProperty(space, "bindings", {
    value: { OPENMELD_DB: input.db },
  });
  return await space.readWakeProgressWakeStopEligibility(input.trace);
}

function createWakeProgressOutboxRecord(input: {
  outboxStatus?: "pending" | "handed_off" | "cancelled";
  sourceClientMessageId?: string | null;
  sourceEventId?: string;
  targetProfileId?: string;
}) {
  const record = createDispatchOutboxRecord({
    bindingEnabled: true,
    bindingState: "bound",
    dispatchOwner: {
      id: "owner-1",
      kind: "owner_account",
    },
    dispatchPolicy: "mention_only",
    spaceId: "space-1",
    sourceEventId: input.sourceEventId ?? "sig-source-1",
    sourceClientMessageId:
      "sourceClientMessageId" in input
        ? input.sourceClientMessageId
        : "client-message-1",
    senderProfileId: "human-1",
    sourceSignalSnapshot: {
      text: "@Codex Agent(wake) hello",
      profileId: "human-1",
      profileKind: "human",
      profileMentionLabel: "Felix",
    },
    targetProfileId:
      input.targetProfileId ?? "agt_33333333-3333-4333-8333-333333333333",
    targetProfileMentionLabel: "Codex Agent",
    targetProfileNameSnapshot: "Codex Agent",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    nowMs: Date.UTC(2026, 2, 4, 0, 0, 0),
  });
  return {
    ...record,
    outboxStatus: input.outboxStatus ?? "handed_off",
    handedOffAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
  };
}

function createWakeProgressSourceSignal(input: {
  clientMessageId?: string | null;
  id?: string;
  targetProfileIds?: readonly string[];
}): Extract<SignalEnvelope, { type: "signal.text" }> {
  const clientMessageId =
    "clientMessageId" in input ? input.clientMessageId : "client-message-1";
  return {
    ...createSignal(),
    id: input.id ?? "sig-source-1",
    data: {
      text: "@Codex Agent(wake) hello",
      messageEnvelope: {
        activationTargets: [
          ...(input.targetProfileIds ?? [
            "agt_33333333-3333-4333-8333-333333333333",
          ]),
        ],
        referenceTargets: [],
        text: "@Codex Agent(wake) hello",
      },
      ...(clientMessageId ? { meta: { clientMessageId } } : {}),
    },
  };
}

type ActiveWakeProgressMemberRow = {
  added_at: number;
  added_by_display_name_snapshot: string | null;
  added_by_owner_user_id: string | null;
  added_by_profile_id: string | null;
  controller_ref_snapshot: string | null;
  created_at: number;
  first_entered_at: number | null;
  last_entered_at: number | null;
  member_source: string;
  owner_name_snapshot: string | null;
  owner_user_id_snapshot: string | null;
  profile_id: string;
  profile_kind_snapshot: string;
  profile_name_snapshot: string;
  removal_reason: string | null;
  removed_at: number | null;
  removed_by_owner_user_id: string | null;
  removed_by_profile_id: string | null;
  space_id: string;
  status: string;
  updated_at: number;
};

function createActiveWakeProgressSql(input: {
  memberRows?: readonly ActiveWakeProgressMemberRow[];
  outboxRows: readonly ReturnType<typeof createWakeProgressOutboxRecord>[];
  sourceSignals?: readonly Extract<SignalEnvelope, { type: "signal.text" }>[];
}): SqlStorage {
  const memberRows = input.memberRows ?? [];
  const { outboxRows } = input;
  const sourceSignals = input.sourceSignals ?? [];
  const sqlExec = vi.fn((query: string, ...params: unknown[]) => {
    if (query.includes("FROM openMeldDaemon_outbox")) {
      const statusParams = new Set(params.map(String));
      return {
        toArray: () =>
          outboxRows
            .map((record) => ({
              record,
              persistedStatus:
                record.outboxStatus === "handed_off"
                  ? "queued"
                  : record.outboxStatus,
            }))
            .filter(({ persistedStatus }) => statusParams.has(persistedStatus))
            .map(({ persistedStatus, record }) => ({
              payload_json: record.payloadJson,
              status: persistedStatus,
              created_at_ms: record.createdAtMs,
              queued_at_ms: record.handedOffAtMs,
            })),
      };
    }
    if (query.includes("FROM space_members")) {
      return {
        toArray: () =>
          query.includes("WHERE status = ?")
            ? memberRows.filter((row) => row.status === String(params[0]))
            : memberRows,
      };
    }
    if (query.includes("FROM space_signals")) {
      if (query.includes("WHERE id = ?")) {
        const signalId = String(params[0] ?? "");
        return {
          toArray: () =>
            sourceSignals
              .filter((signal) => signal.id === signalId)
              .map((signal) => ({
                id: signal.id,
                payload_json: JSON.stringify(signal),
                ts: signal.ts,
              })),
        };
      }
      if (query.includes("WHERE client_message_id = ?")) {
        const clientMessageId = String(params[0] ?? "");
        return {
          toArray: () =>
            sourceSignals
              .filter(
                (signal) =>
                  signal.data.meta?.clientMessageId === clientMessageId
              )
              .map((signal) => ({
                id: signal.id,
                payload_json: JSON.stringify(signal),
                ts: signal.ts,
              })),
        };
      }
      return {
        toArray: () =>
          sourceSignals.map((signal) => ({
            id: signal.id,
            payload_json: JSON.stringify(signal),
            ts: signal.ts,
          })),
      };
    }
    return { rowsWritten: 0, toArray: () => [] };
  });
  return { databaseSize: 0, exec: sqlExec } as unknown as SqlStorage;
}

type WakeProgressExecutionRow = {
  acceptedAtMs?: number;
  callbackReceivedAtMs?: number | null;
  createdAtMs?: number;
  dispatchStatus?: string;
  dispatchId: string;
  executionStatus?: string;
  finalPublicationState?: "claimed" | "outcome_unknown" | "published" | null;
  firstSeenAtMs?: number;
  latestAttemptStatus?: string;
  nativeDeliveryStatus?: string;
  sourceClientMessageId?: string | null;
  sourceEventId: string;
  status?: string;
  targetProfileId: string;
  updatedAtMs?: number;
};

function resolveNativeDeliveryEvidencePhase(
  row: WakeProgressExecutionRow
): "publication_unknown" | "publishing" | "running" {
  if (row.finalPublicationState === "outcome_unknown") {
    return "publication_unknown";
  }
  if (row.callbackReceivedAtMs != null || row.finalPublicationState != null) {
    return "publishing";
  }
  return "running";
}

const ACTIVE_WAKE_PROGRESS_TEST_STATUSES = new Set([
  "accepted_local",
  "cancellation_requested",
  "completed_local",
  "created",
  "delivery_accepted",
  "delivery_pending",
  "failed_retryable",
  "result_accepted",
  "result_received",
  "running",
]);

function createWakeEvidenceDb(
  input: {
    activeDispatchRows?: readonly WakeProgressExecutionRow[];
    activeNativeDeliveryRows?: readonly WakeProgressExecutionRow[];
    executions?: readonly WakeProgressExecutionRow[];
    lookupRows?: readonly WakeProgressExecutionRow[];
  } = {}
): D1Database {
  const prepare = vi.fn((query: string) => {
    const bind = vi.fn((...params: unknown[]) => {
      const all = vi.fn(() => {
        if (
          query.includes(
            "FROM openMeldDaemon_runtime_coordinator_executions AS executions"
          )
        ) {
          return {
            results: (input.executions ?? [])
              .filter((execution) =>
                ACTIVE_WAKE_PROGRESS_TEST_STATUSES.has(
                  execution.executionStatus ??
                    execution.status ??
                    "result_accepted"
                )
              )
              .map((execution, index) => ({
                dispatch_id: execution.dispatchId,
                latest_dispatch_attempt_status:
                  execution.latestAttemptStatus ?? null,
                runtime_coordinator_execution_id: `rce-${execution.dispatchId}`,
                openmeld_service_runtime_id: `runtime-${execution.dispatchId}`,
                source_client_message_id:
                  execution.sourceClientMessageId ?? null,
                source_event_id: execution.sourceEventId,
                created_at_ms:
                  execution.createdAtMs ??
                  Date.UTC(2026, 2, 4, 0, 1, 0) + index,
                status:
                  execution.executionStatus ??
                  execution.status ??
                  "result_accepted",
                target_profile_id: execution.targetProfileId,
                updated_at_ms:
                  execution.updatedAtMs ??
                  Date.UTC(2026, 2, 4, 0, 3, 0) + index,
              })),
          };
        }
        if (
          query.includes(
            "FROM openMeldRemoteAgent_native_delivery_ledger AS deliveries"
          )
        ) {
          return {
            results: (input.activeNativeDeliveryRows ?? [])
              .filter((row) =>
                ["accepted", "retry_observed"].includes(
                  row.nativeDeliveryStatus ?? "accepted"
                )
              )
              .map((row, index) => ({
                started_at_ms:
                  row.acceptedAtMs ?? Date.UTC(2026, 2, 4, 0, 2, 0) + index,
                dispatch_id: row.dispatchId,
                failure_reason_code:
                  row.finalPublicationState === "outcome_unknown"
                    ? "remote_agent.callback_publication_outcome_unknown"
                    : null,
                phase: resolveNativeDeliveryEvidencePhase(row),
                source_client_message_id: row.sourceClientMessageId ?? null,
                target_profile_id: row.targetProfileId,
                trigger_message_id: row.sourceEventId,
                updated_at_ms:
                  row.updatedAtMs ?? Date.UTC(2026, 2, 4, 0, 3, 0) + index,
              })),
          };
        }
        if (
          query.includes("FROM openMeldDaemon_dispatch_ledger AS ledger") &&
          query.includes("ledger.status = 'dispatching'")
        ) {
          return {
            results: (input.activeDispatchRows ?? []).map((row, index) => ({
              dispatch_id: row.dispatchId,
              latest_dispatch_attempt_status: row.latestAttemptStatus ?? null,
              target_profile_id: row.targetProfileId,
              updated_at_ms:
                row.updatedAtMs ?? Date.UTC(2026, 2, 4, 0, 3, 0) + index,
            })),
          };
        }
        if (query.includes("FROM openMeldDaemon_dispatch_ledger AS ledger")) {
          const spaceId = String(params[0] ?? "");
          const selector = String(params[1] ?? "");
          const targetProfileId =
            params.length > 2 ? String(params[2] ?? "") : null;
          return {
            results: (input.lookupRows ?? [])
              .filter(
                (row) =>
                  spaceId === "space-1" &&
                  (row.sourceEventId === selector ||
                    row.sourceClientMessageId === selector) &&
                  (!targetProfileId || row.targetProfileId === targetProfileId)
              )
              .toSorted(
                (left, right) =>
                  (right.firstSeenAtMs ?? 0) - (left.firstSeenAtMs ?? 0) ||
                  right.dispatchId.localeCompare(left.dispatchId)
              )
              .map((row) => ({
                attemptCount: 1,
                dispatchId: row.dispatchId,
                dispatchStatus: row.dispatchStatus ?? row.status ?? "succeeded",
                latestAttemptErrorCode: null,
                latestAttemptErrorMessage: null,
                latestAttemptId: "attempt-1",
                latestAttemptStatus: "succeeded",
                sourceSignalId: row.sourceEventId,
                targetProfileId: row.targetProfileId,
              })),
          };
        }
        return { results: [] };
      });
      const first = vi.fn(() => null);
      return { all, first };
    });
    return { bind };
  });
  return { prepare } as unknown as D1Database;
}

function createRuntimeTransportBindings(input: {
  headLifecycleReadStatus:
    | "missing"
    | "queued"
    | "stopped"
    | "unavailable"
    | "waiting";
}): Pick<CoreBindings, "OPENMELD_RUNTIME_TRANSPORT"> {
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      targetWakeLifecycleIdentity: {
        dispatchId: string;
        targetWakeLifecycleId: string;
      };
    };
    if (input.headLifecycleReadStatus === "unavailable") {
      return Response.json({
        ok: false,
        readStatus: "authority_unavailable",
        reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
        targetWakeLifecycleId:
          body.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });
    }
    if (input.headLifecycleReadStatus === "missing") {
      return Response.json({
        ok: true,
        readStatus: "missing",
        reasonCode: "runtime_coordinator.head_lifecycle_not_found",
        targetWakeLifecycleId:
          body.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });
    }
    if (input.headLifecycleReadStatus === "waiting") {
      const nowMs = Date.now();
      return Response.json({
        ok: true,
        readStatus: "found",
        lifecycle: {
          createdAtMs: nowMs,
          duplicateDispatchCount: 0,
          executionLinkedAtMs: null,
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: null,
          ownerUserId: "owner-1",
          primaryDispatchId: body.targetWakeLifecycleIdentity.dispatchId,
          publicationIntent: null,
          runtimeCoordinatorExecutionId: null,
          status: "waiting",
          targetWakeLifecycleIdentity: body.targetWakeLifecycleIdentity,
          targetWakeLifecycleId:
            body.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          updatedAtMs: nowMs + 1000,
          waitingBoundary: {
            deadlineAtMs: nowMs + 5 * 60_000,
            deadlineOutcome: "publication_intent_ready",
            observedAtMs: nowMs + 1000,
            reasonCode: "daemon.profile.offline",
            softDeadlineAtMs: nowMs + 2 * 60_000,
            trigger: "openmeld_service_route_connected",
            triggerOwner: "runtime_coordinator",
            userRecoveryAction: "start_or_restart_openmeld_service",
            userVisibleState: "waiting_for_openmeld_service",
            waitingCategory: "service_not_connected",
            waitingFor: "openmeld_service_route_connection",
            waitingSinceMs: nowMs + 1000,
          },
        },
      });
    }
    if (input.headLifecycleReadStatus === "queued") {
      const nowMs = Date.now();
      return Response.json({
        ok: true,
        readStatus: "found",
        lifecycle: {
          createdAtMs: nowMs,
          duplicateDispatchCount: 0,
          executionLinkedAtMs: null,
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: null,
          ownerUserId: "owner-1",
          primaryDispatchId: body.targetWakeLifecycleIdentity.dispatchId,
          publicationIntent: null,
          runtimeCoordinatorExecutionId: null,
          status: "queued",
          targetWakeLifecycleIdentity: body.targetWakeLifecycleIdentity,
          targetWakeLifecycleId:
            body.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          updatedAtMs: nowMs + 1000,
          waitingBoundary: null,
        },
      });
    }
    return Response.json({
      ok: true,
      readStatus: "found",
      lifecycle: {
        createdAtMs: Date.UTC(2026, 2, 4, 0, 0, 0),
        duplicateDispatchCount: 0,
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: null,
        ownerUserId: "owner-1",
        primaryDispatchId: body.targetWakeLifecycleIdentity.dispatchId,
        publicationIntent: null,
        runtimeCoordinatorExecutionId: null,
        status: "stopped_before_execution",
        targetWakeLifecycleIdentity: body.targetWakeLifecycleIdentity,
        targetWakeLifecycleId:
          body.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
        waitingBoundary: null,
      },
    });
  });
  return {
    OPENMELD_RUNTIME_TRANSPORT: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => ({ fetch })),
    },
  } as unknown as Pick<CoreBindings, "OPENMELD_RUNTIME_TRANSPORT">;
}

async function readActiveWakeProgressForTest(input: {
  activeDispatchRows?: readonly WakeProgressExecutionRow[];
  activeNativeDeliveryRows?: readonly WakeProgressExecutionRow[];
  actorOwnerUserId?: string;
  executionRows?: readonly WakeProgressExecutionRow[];
  includeTiming?: boolean;
  includeWakeStopEligibility?: boolean;
  lookupRows?: readonly WakeProgressExecutionRow[];
  memberRows?: readonly ActiveWakeProgressMemberRow[];
  outboxRows: readonly ReturnType<typeof createWakeProgressOutboxRecord>[];
  readSpaceWakeProgress?: (input: {
    clientMessageId?: string | null;
    includeWakeStopEligibility?: boolean;
    sourceSignalId?: string | null;
    targetProfileId?: string;
  }) => Promise<GetSpaceWakeProgressResponse>;
  readWakeProgressPendingAgentInteraction?: (input: {
    actorOwnerUserId?: string | null;
    execution: {
      runtimeCoordinatorExecutionId: string;
      openMeldServiceRuntimeId: { source: string; value: string };
    };
  }) => Promise<WakeProgressItem["pendingInteraction"]>;
  sourceSignals?: readonly Extract<SignalEnvelope, { type: "signal.text" }>[];
  targetProfileId?: string;
  headLifecycleReadStatus?:
    | "missing"
    | "queued"
    | "stopped"
    | "unavailable"
    | "waiting";
}): Promise<GetActiveSpaceWakeProgressResponse> {
  const wakeEvidenceDb = createWakeEvidenceDb({
    activeDispatchRows: input.activeDispatchRows,
    activeNativeDeliveryRows: input.activeNativeDeliveryRows,
    executions: input.executionRows,
    lookupRows: input.lookupRows ?? input.executionRows,
  });
  const space = Object.create(Space.prototype) as {
    bindings: CoreBindings;
    ctx: { storage: { sql: SqlStorage } };
    readActiveSpaceWakeProgress: (input: {
      actorOwnerUserId?: string | null;
      db: D1Database;
      includeTiming?: boolean;
      includeWakeStopEligibility?: boolean;
      targetProfileId?: string;
    }) => Promise<GetActiveSpaceWakeProgressResponse>;
    readSpaceWakeProgress: NonNullable<typeof input.readSpaceWakeProgress>;
    readWakeProgressPendingAgentInteraction: NonNullable<
      typeof input.readWakeProgressPendingAgentInteraction
    >;
    spaceId: string;
  };
  Object.defineProperties(space, {
    bindings: {
      value: {
        OPENMELD_DB: wakeEvidenceDb,
        ...createRuntimeTransportBindings({
          headLifecycleReadStatus: input.headLifecycleReadStatus ?? "missing",
        }),
      },
    },
    ctx: {
      value: {
        storage: {
          sql: createActiveWakeProgressSql({
            memberRows: input.memberRows,
            outboxRows: input.outboxRows,
            sourceSignals: input.sourceSignals,
          }),
        },
      },
    },
    spaceId: { value: "space-1" },
  });
  if (input.readSpaceWakeProgress) {
    Object.defineProperty(space, "readSpaceWakeProgress", {
      value: input.readSpaceWakeProgress,
    });
  }
  if (input.readWakeProgressPendingAgentInteraction) {
    Object.defineProperty(space, "readWakeProgressPendingAgentInteraction", {
      value: input.readWakeProgressPendingAgentInteraction,
    });
  }

  return await space.readActiveSpaceWakeProgress({
    actorOwnerUserId: input.actorOwnerUserId,
    db: wakeEvidenceDb,
    includeTiming: input.includeTiming,
    includeWakeStopEligibility: input.includeWakeStopEligibility,
    ...(input.targetProfileId
      ? { targetProfileId: input.targetProfileId }
      : {}),
  });
}

describe("space signal service", () => {
  it.each(
    createReplyingHintTerminalSignals()
  )("clears replying replay state when a $label is broadcast", ({ signal }) => {
    const { sql } = createFinalOutcomeSql();
    const { activeReplyingSignalsByDispatchId, broadcast, space } =
      createReplyingHintTrackingSpace(sql);

    expect(space.trackReplyingTransientSignal(createReplyingHintSignal())).toBe(
      true
    );
    expect(
      activeReplyingSignalsByDispatchId.has(REPLYING_HINT_DISPATCH_ID)
    ).toBe(true);

    space.broadcastSignal(signal);

    expect(
      activeReplyingSignalsByDispatchId.has(REPLYING_HINT_DISPATCH_ID)
    ).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(signal);
  });

  it.each(
    createReplyingHintTerminalSignals()
  )("drops a late replying start after a $label was persisted", ({
    signal,
  }) => {
    const { sql } = createFinalOutcomeSql();
    expect(insertSignalRecord(sql, signal).persistedSignal).toBe(true);
    const { activeReplyingSignalsByDispatchId, space } =
      createReplyingHintTrackingSpace(sql);

    expect(space.trackReplyingTransientSignal(createReplyingHintSignal())).toBe(
      false
    );
    expect(activeReplyingSignalsByDispatchId.size).toBe(0);
  });

  it("keeps thread context when posting a system notice through RPC", async () => {
    const signal = {
      ...createSignal(),
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-threaded-failure-1",
        generatedBy: "openmeld",
        reason: "daemon.profile.offline",
        text: "Codex is offline on this computer.",
      },
    } satisfies SignalEnvelope;
    const publishSystemNoticeSignal = vi.fn();
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      buildSystemNoticeSignal: () => SignalEnvelope;
      publishSystemNoticeSignal: (
        postedSignal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      rpcPostSystemNoticeSignal: Space["rpcPostSystemNoticeSignal"];
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      buildSystemNoticeSignal: { value: vi.fn(() => signal) },
      publishSystemNoticeSignal: { value: publishSystemNoticeSignal },
    });
    const threadContext = {
      threadId: "thr_11111111-1111-4111-8111-111111111111",
      rootSignalId: "sig-source-1",
    };

    await space.rpcPostSystemNoticeSignal({
      context: {
        actorContext: {
          requestId: "req-1",
          openMeldProfileId: "openmeld-system",
          profileKind: "system",
          profileName: "OpenMeld System",
        },
      },
      data: signal.data,
      profile: signal.profile,
      spaceId: "space-1",
      threadContext,
    });

    expect(publishSystemNoticeSignal).toHaveBeenCalledWith(signal, {
      threadContext,
    });
  });

  it("returns an execution recovery publication only after Space persistence and reuses the exact notice", async () => {
    const { signalRows, sql } = createFinalOutcomeSql();
    const broadcastSignal = vi.fn();
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      broadcastSignal: { value: broadcastSignal },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      mergePublishedAuthorProfile: {
        value: (_author: unknown, profile: unknown) => profile,
      },
      persistSignalWithOptionalOutbox: {
        value: (signal: SignalEnvelope) => ({
          dispatchMessages: [],
          ...insertSignalRecord(sql, signal),
        }),
      },
      spaceId: { value: "space-1" },
    });
    const input = {
      context: {
        actorContext: {
          requestId: "recovery-publication-1",
          openMeldProfileId: "openmeld-system",
          profileKind: "system" as const,
          profileName: "OpenMeld System",
        },
      },
      data: {
        noticeType: "execution_recovery_available" as const,
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-recovery-publication-1",
        generatedBy: "openmeld" as const,
        reason: "runtime.progress_stale",
        reasonCode: "runtime_coordinator.late_result_available",
        replyTo: {
          previewText: "Finish the research",
          profileId: "22222222-2222-4222-8222-222222222222",
          profileKind: "human" as const,
          profileName: "Felix",
          signalId: "source-signal-1",
        },
        resultRef: "dispatch-recovery-publication-1::attempt-1",
        text: "OpenMeld retained the completed result.",
      },
      profile: {
        kind: "system" as const,
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      spaceId: "space-1",
    };

    const first = await space.rpcPostExecutionRecoveryNoticeSignal(input);
    const repeated = await space.rpcPostExecutionRecoveryNoticeSignal(input);
    for (const conflictingData of [
      {
        ...input.data,
        reason: "different terminal reason",
      },
      {
        ...input.data,
        text: "Different retained result evidence.",
      },
      {
        ...input.data,
        replyTo: {
          ...input.data.replyTo,
          signalId: "different-source-signal",
        },
      },
    ]) {
      await expect(
        space.rpcPostExecutionRecoveryNoticeSignal({
          ...input,
          data: conflictingData,
        })
      ).rejects.toThrow(
        "execution recovery notice identity was reused with different evidence"
      );
    }
    await expect(space.rpcPostSystemNoticeSignal(input)).rejects.toThrow(
      "execution_recovery_available is reserved for the execution recovery command"
    );

    expect(first).toEqual({
      publishedSignalId:
        "execution-recovery:space-1:dispatch-recovery-publication-1::attempt-1",
      status: "published",
    });
    expect(repeated).toEqual({
      publishedSignalId: first.publishedSignalId,
      status: "already_published",
    });
    expect(signalRows.size).toBe(1);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
  });

  it("persists a completed recovery projection exactly once and rejects generic or conflicting writes", async () => {
    const { signalRows, sql } = createFinalOutcomeSql();
    const broadcastSignal = vi.fn();
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      authorizeWritableSpaceAccess: {
        value: vi.fn(async () => ({
          ok: true,
          profile: {
            kind: "system",
            profileId: "openmeld-system",
            profileName: "OpenMeld System",
          },
        })),
      },
      broadcastSignal: { value: broadcastSignal },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      mergePublishedAuthorProfile: {
        value: (_author: unknown, profile: unknown) => profile,
      },
      persistSignalWithOptionalOutbox: {
        value: (signal: SignalEnvelope) => ({
          dispatchMessages: [],
          ...insertSignalRecord(sql, signal),
        }),
      },
      spaceId: { value: "space-1" },
    });
    const input = {
      context: {
        actorContext: {
          requestId: "recovery-completed-1",
          openMeldProfileId: "openmeld-system",
          profileKind: "system" as const,
          profileName: "OpenMeld System",
        },
      },
      data: {
        noticeType: "execution_recovery_completed" as const,
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-recovery-completed-1",
        generatedBy: "openmeld" as const,
        reasonCode: "execution_recovery.result_replayed",
        recoveryOperationId: "recovery-operation-1",
        resultRef: "dispatch-recovery-completed-1::attempt-1",
        text: "Recovered result output.",
      },
      profile: {
        kind: "system" as const,
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      spaceId: "space-1",
    };

    await expect(space.rpcPostSystemNoticeSignal(input)).rejects.toThrow(
      "execution_recovery_completed is reserved for the execution recovery command"
    );
    const first = await space.rpcPostExecutionRecoveryNoticeSignal(input);
    const repeated = await space.rpcPostExecutionRecoveryNoticeSignal(input);
    await expect(
      space.rpcPostExecutionRecoveryNoticeSignal({
        ...input,
        data: {
          ...input.data,
          text: "Different recovered output.",
        },
      })
    ).rejects.toThrow(
      "execution recovery notice identity was reused with different evidence"
    );

    expect(first).toEqual({
      publishedSignalId:
        "execution-recovery:completed:space-1:dispatch-recovery-completed-1::attempt-1",
      status: "published",
    });
    expect(repeated).toEqual({
      publishedSignalId: first.publishedSignalId,
      status: "already_published",
    });
    expect(signalRows.size).toBe(1);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);
  });

  it("reserves an exact recovery operation before side effects and replays its one completed response", async () => {
    const identity = {
      agentControllerConversationId: "conversation-1",
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      resultRef: "dispatch-1::attempt-1",
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    };
    const destination = {
      spaceId: "space-1",
      surface: "space" as const,
      threadId: "thread-1",
    };
    const projection: ExecutionRecoveryProjection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 1,
    });
    const records = new Map<string, unknown>();
    let transactionTail = Promise.resolve();
    const transaction = vi.fn(
      <T>(
        closure: (storage: {
          get<V>(key: string): Promise<V | undefined>;
          put<V>(key: string, value: V): Promise<void>;
        }) => Promise<T>
      ): Promise<T> => {
        const run = transactionTail.then(() =>
          closure({
            get: async <V>(key: string) => records.get(key) as V | undefined,
            put: <V>(key: string, value: V) => {
              records.set(key, value);
              return Promise.resolve();
            },
          })
        );
        transactionTail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
    );
    const replayStarted = Promise.withResolvers<void>();
    const replayBlocked = Promise.withResolvers<void>();
    const replayRetainedExecutionResult = vi.fn(
      async (input: { markEffectStarted: () => Promise<void> }) => {
        await input.markEffectStarted();
        replayStarted.resolve();
        await replayBlocked.promise;
        return {
          publicationId: "recovery-signal-1",
          status: "completed" as const,
        };
      }
    );
    const inspect = vi.fn(async () => ({ recovery: projection }));
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      ctx: { value: { storage: { transaction } } },
      replayRetainedExecutionResult: {
        value: replayRetainedExecutionResult,
      },
      rpcInspectExecutionRecovery: { value: inspect },
    });
    const command = {
      action: "recover_result" as const,
      destination,
      expectedIdentity: identity,
      operationId: "operation-1",
    };

    const first = space.rpcExecuteExecutionRecovery({
      body: command,
      spaceId: "space-1",
    });
    await replayStarted.promise;
    const concurrentDuplicate = await space.rpcExecuteExecutionRecovery({
      body: command,
      spaceId: "space-1",
    });
    expect(concurrentDuplicate).toMatchObject({
      operationId: "operation-1",
      publicationId: null,
      reasonCode: "execution_recovery.operation_outcome_unknown",
      status: "outcome_unknown",
    });
    expect(replayRetainedExecutionResult).toHaveBeenCalledTimes(1);

    replayBlocked.resolve();
    const completed = await first;
    const repeated = await space.rpcExecuteExecutionRecovery({
      body: command,
      spaceId: "space-1",
    });
    expect(repeated).toEqual(completed);
    expect(replayRetainedExecutionResult).toHaveBeenCalledTimes(1);

    await expect(
      space.rpcExecuteExecutionRecovery({
        body: {
          ...command,
          expectedIdentity: {
            ...identity,
            resultRef: "different-result",
          },
        },
        spaceId: "space-1",
      })
    ).rejects.toThrow("execution_recovery.identity_mismatch");
    expect(replayRetainedExecutionResult).toHaveBeenCalledTimes(1);
  });

  it("claims one recovery action per exact execution and destination across different operation IDs", async () => {
    const identity = {
      agentControllerConversationId: "conversation-1",
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      resultRef: "dispatch-1::attempt-1",
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    };
    const destination = {
      spaceId: "space-1",
      surface: "space" as const,
      threadId: "thread-1",
    };
    const projection: ExecutionRecoveryProjection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 1,
    });
    const records = new Map<string, unknown>();
    let transactionTail = Promise.resolve();
    const transaction = vi.fn(
      <T>(
        closure: (storage: {
          get<V>(key: string): Promise<V | undefined>;
          put<V>(key: string, value: V): Promise<void>;
        }) => Promise<T>
      ): Promise<T> => {
        const run = transactionTail.then(() =>
          closure({
            get: async <V>(key: string) => records.get(key) as V | undefined,
            put: <V>(key: string, value: V) => {
              records.set(key, value);
              return Promise.resolve();
            },
          })
        );
        transactionTail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
    );
    const firstReplayStarted = Promise.withResolvers<void>();
    const releaseFirstReplay = Promise.withResolvers<void>();
    const replayRetainedExecutionResult = vi.fn(
      async (input: { markEffectStarted: () => Promise<void> }) => {
        await input.markEffectStarted();
        if (replayRetainedExecutionResult.mock.calls.length === 1) {
          firstReplayStarted.resolve();
          await releaseFirstReplay.promise;
        }
        return {
          publicationId: "recovery-signal-1",
          status: "completed" as const,
        };
      }
    );
    const inspect = vi.fn(async () => ({ recovery: projection }));
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      ctx: { value: { storage: { transaction } } },
      replayRetainedExecutionResult: {
        value: replayRetainedExecutionResult,
      },
      rpcInspectExecutionRecovery: { value: inspect },
    });
    const firstCommand = {
      action: "recover_result" as const,
      destination,
      expectedIdentity: identity,
      operationId: "operation-1",
    };

    const first = space.rpcExecuteExecutionRecovery({
      body: firstCommand,
      spaceId: "space-1",
    });
    await firstReplayStarted.promise;
    const concurrentDifferentOperation =
      await space.rpcExecuteExecutionRecovery({
        body: {
          ...firstCommand,
          operationId: "operation-2",
        },
        spaceId: "space-1",
      });

    expect(concurrentDifferentOperation).toMatchObject({
      publicationId: null,
      reasonCode: "execution_recovery.operation_outcome_unknown",
      status: "outcome_unknown",
    });
    expect(replayRetainedExecutionResult).toHaveBeenCalledTimes(1);

    releaseFirstReplay.resolve();
    const completed = await first;
    const replayedThroughAnotherOperation =
      await space.rpcExecuteExecutionRecovery({
        body: {
          ...firstCommand,
          operationId: "operation-3",
        },
        spaceId: "space-1",
      });
    expect(replayedThroughAnotherOperation).toEqual({
      ...completed,
      operationId: "operation-3",
    });
    expect(replayRetainedExecutionResult).toHaveBeenCalledTimes(1);
  });

  it("rejects stale recovery identity before reserving an operation or invoking side effects", async () => {
    const identity = {
      agentControllerConversationId: "conversation-1",
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      resultRef: "dispatch-1::attempt-1",
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    };
    const destination = {
      spaceId: "space-1",
      surface: "space" as const,
      threadId: "thread-1",
    };
    const projection: ExecutionRecoveryProjection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: true,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: true,
        serviceSupportsResume: true,
      },
      updatedAtMs: 1,
    });
    const records = new Map<string, unknown>();
    const transaction = vi.fn(
      async <T>(
        closure: (storage: {
          get<V>(key: string): Promise<V | undefined>;
          put<V>(key: string, value: V): Promise<void>;
        }) => Promise<T>
      ): Promise<T> =>
        await closure({
          get: async <V>(key: string) => records.get(key) as V | undefined,
          put: <V>(key: string, value: V) => {
            records.set(key, value);
            return Promise.resolve();
          },
        })
    );
    const replayRetainedExecutionResult = vi.fn();
    const resumeExactControllerConversation = vi.fn();
    const inspect = vi.fn(async () => ({ recovery: projection }));
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      ctx: { value: { storage: { transaction } } },
      replayRetainedExecutionResult: {
        value: replayRetainedExecutionResult,
      },
      resumeExactControllerConversation: {
        value: resumeExactControllerConversation,
      },
      rpcInspectExecutionRecovery: { value: inspect },
    });

    await expect(
      space.rpcExecuteExecutionRecovery({
        body: {
          action: "recover_result",
          destination,
          expectedIdentity: {
            ...identity,
            resultRef: "stale-result",
          },
          operationId: "stale-operation",
        },
        spaceId: "space-1",
      })
    ).rejects.toThrow("execution_recovery.identity_mismatch");

    expect(records.size).toBe(0);
    expect(replayRetainedExecutionResult).not.toHaveBeenCalled();
    expect(resumeExactControllerConversation).not.toHaveBeenCalled();
  });

  it.each([
    { label: "shared Space", spaceId: "space-1" },
    { label: "Direct Message", spaceId: "space-dm-1" },
  ])("replays a fresh execution in a $label with verified continuation authority and the original author", async ({
    spaceId,
  }) => {
    const identity = {
      agentControllerConversationId: null,
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      resultRef: null,
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId,
      targetProfileId: "agent-1",
      taskId: "task-1",
    };
    const destination = {
      spaceId,
      surface: "space" as const,
      threadId: null,
    };
    const projection: ExecutionRecoveryProjection = inspectExecutionRecovery({
      destination,
      explicitUserStop: false,
      freshExecutionCapability: { exactSourceWakeVerified: true },
      identity,
      outcomeUnknown: false,
      retainedResult: {
        available: false,
        recoveredPublicationId: null,
      },
      resumeCapability: {
        exactAssociationVerified: false,
        serviceSupportsResume: false,
      },
      updatedAtMs: 1,
    });
    const sourceSignal: Extract<SignalEnvelope, { type: "signal.text" }> = {
      ...createSignal(),
      id: "source-signal-1",
      spaceId,
      data: {
        text: "finish the research",
        messageEnvelope: {
          activationTargets: ["agent-1"],
          referenceTargets: [],
          text: "finish the research",
        },
        meta: {
          clientMessageId: "original-client-message",
        },
      },
    };
    const trace = {
      dispatch: {
        dispatchId: identity.dispatchId,
        sourceEventId: sourceSignal.id,
        targetProfileId: identity.targetProfileId,
      },
    } as unknown as SpaceDispatchTraceSnapshot;
    const records = new Map<string, unknown>();
    let transactionTail = Promise.resolve();
    const transaction = vi.fn(
      <T>(
        closure: (storage: {
          get<V>(key: string): Promise<V | undefined>;
          put<V>(key: string, value: V): Promise<void>;
        }) => Promise<T>
      ): Promise<T> => {
        const run = transactionTail.then(() =>
          closure({
            get: async <V>(key: string) => records.get(key) as V | undefined,
            put: <V>(key: string, value: V) => {
              records.set(key, value);
              return Promise.resolve();
            },
          })
        );
        transactionTail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
    );
    const postFreshWake = vi.fn(
      async (input: { clientMessageId: string }): Promise<SignalEnvelope> => ({
        ...sourceSignal,
        id: "fresh-source-signal-1",
        data: {
          ...sourceSignal.data,
          meta: { clientMessageId: input.clientMessageId },
        },
      })
    );
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      ctx: {
        value: {
          storage: {
            sql: { exec: vi.fn(() => ({ toArray: () => [] })) },
            transaction,
          },
        },
      },
      readSignalById: {
        value: vi.fn((signalId: string) =>
          signalId === sourceSignal.id ? sourceSignal : null
        ),
      },
      rpcGetDispatchTrace: {
        value: vi.fn(async () => ({ trace })),
      },
      rpcInspectExecutionRecovery: {
        value: vi.fn(async () => ({ recovery: projection })),
      },
      rpcPostSignalOnceByClientMessageId: {
        value: postFreshWake,
      },
      spaceId: { value: spaceId },
    });
    const command = {
      action: "retry_as_new_execution" as const,
      destination,
      expectedIdentity: identity,
      operationId: "operation-fresh-1",
    };

    const result = await space.rpcExecuteExecutionRecovery({
      body: command,
      context: {
        actorContext: {
          ownerUserId: "owner-1",
          profileKind: "human",
          requestId: "request-fresh-recovery-1",
          openMeldProfileId: "human-owner-1",
          profileName: "Agent Owner",
        },
      },
      spaceId,
    });

    expect(result).toMatchObject({
      action: "retry_as_new_execution",
      newExecutionId: expect.any(String),
      operationId: command.operationId,
      status: "new_execution_requested",
    });
    expect(result.newExecutionId).not.toBe(
      sourceSignal.data.meta?.clientMessageId
    );
    expect(postFreshWake).toHaveBeenCalledOnce();
    expect(postFreshWake).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "user_authored",
        clientMessageId: result.newExecutionId,
        messageEnvelope: {
          activationTargets: [identity.targetProfileId],
          referenceTargets: [],
          text: sourceSignal.data.text,
        },
        meta: {
          clientMessageId: result.newExecutionId,
        },
        profile: sourceSignal.profile,
        spaceAccess: {
          actor: expect.objectContaining({
            dispatchId: identity.dispatchId,
            kind: "dispatch_continuation",
            requestContext: expect.objectContaining({
              actorContext: expect.objectContaining({
                openMeldProfileId: sourceSignal.profile.profileId,
                profileKind: sourceSignal.profile.kind,
                profileName: sourceSignal.profile.profileName,
              }),
            }),
            sourceSignalId: sourceSignal.id,
            targetProfileId: identity.targetProfileId,
          }),
          proof: { kind: "none" },
          spaceId,
        },
        text: sourceSignal.data.text,
      })
    );
  });

  it("rejects an execution recovery publication when Space did not persist or find the notice", async () => {
    const { sql } = createFinalOutcomeSql();
    const space = Object.create(Space.prototype) as Space;
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      broadcastSignal: { value: vi.fn() },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      mergePublishedAuthorProfile: {
        value: (_author: unknown, profile: unknown) => profile,
      },
      persistSignalWithOptionalOutbox: {
        value: () => ({
          dispatchMessages: [],
          duplicateFinalReplyBlocked: false,
          persistedSignal: false,
        }),
      },
      spaceId: { value: "space-1" },
    });

    await expect(
      space.rpcPostExecutionRecoveryNoticeSignal({
        context: {
          actorContext: {
            requestId: "recovery-publication-missing",
            openMeldProfileId: "openmeld-system",
            profileKind: "system",
            profileName: "OpenMeld System",
          },
        },
        data: {
          noticeType: "execution_recovery_available",
          actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
          dispatchId: "dispatch-recovery-publication-missing",
          generatedBy: "openmeld",
          resultRef: "dispatch-recovery-publication-missing::attempt-1",
          text: "OpenMeld retained the completed result.",
        },
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        spaceId: "space-1",
      })
    ).rejects.toThrow(
      "execution recovery notice was not durably persisted in Space"
    );
  });

  it("blocks generic OpenMeld status signals from claiming a final outcome slot without owner authority", async () => {
    const signal = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex Agent",
      },
      type: "signal.status",
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-generic-status-final-1",
        generatedBy: "openmeld",
        status: "done",
        text: "Done.",
      },
    } satisfies SignalEnvelope;
    const persistSignalWithOptionalOutbox = vi.fn();
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      buildStatusSignal: () => SignalEnvelope;
      broadcastSignal: () => void;
      persistSignalWithOptionalOutbox: typeof persistSignalWithOptionalOutbox;
      rpcPostStatusSignal: Space["rpcPostStatusSignal"];
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      broadcastSignal: { value: vi.fn() },
      buildStatusSignal: { value: vi.fn(() => signal) },
      persistSignalWithOptionalOutbox: {
        value: persistSignalWithOptionalOutbox,
      },
    });

    await expect(
      space.rpcPostStatusSignal({
        context: {
          actorContext: {
            requestId: "req-1",
            openMeldProfileId: "openmeld-system",
            profileKind: "system",
            profileName: "OpenMeld System",
          },
        },
        data: signal.data,
        profile: signal.profile,
        spaceId: "space-1",
      })
    ).rejects.toThrow("final outcome owner authority is required");
    expect(persistSignalWithOptionalOutbox).not.toHaveBeenCalled();
  });

  it("blocks generic terminal failure notices from claiming a final outcome slot without owner authority", async () => {
    const signal = {
      ...createSignal(),
      type: "signal.system_notice",
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-generic-notice-final-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        text: "Codex Agent is offline.",
      },
    } satisfies SignalEnvelope;
    const persistSignalWithOptionalOutbox = vi.fn();
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      buildSystemNoticeSignal: () => SignalEnvelope;
      broadcastSignal: () => void;
      persistSignalWithOptionalOutbox: typeof persistSignalWithOptionalOutbox;
      rpcPostSystemNoticeSignal: Space["rpcPostSystemNoticeSignal"];
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      broadcastSignal: { value: vi.fn() },
      buildSystemNoticeSignal: { value: vi.fn(() => signal) },
      persistSignalWithOptionalOutbox: {
        value: persistSignalWithOptionalOutbox,
      },
    });

    await expect(
      space.rpcPostSystemNoticeSignal({
        context: {
          actorContext: {
            requestId: "req-1",
            openMeldProfileId: "openmeld-system",
            profileKind: "system",
            profileName: "OpenMeld System",
          },
        },
        data: signal.data,
        profile: signal.profile,
        spaceId: "space-1",
      })
    ).rejects.toThrow("final outcome owner authority is required");
    expect(persistSignalWithOptionalOutbox).not.toHaveBeenCalled();
  });

  it("blocks generic final text replies from claiming a final outcome slot without owner authority", async () => {
    const signal = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-generic-text-final-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;
    const persistTextSignalWithOptionalOutbox = vi.fn();
    const space = Object.create(Space.prototype) as {
      publishTextSignal: (
        signal: SignalEnvelope,
        signalContext?: {
          finalOutcomeAuthority?: "runtime_coordinator_finalization";
        }
      ) => Promise<void>;
    };
    Object.defineProperties(space, {
      persistTextSignalWithOptionalOutbox: {
        value: persistTextSignalWithOptionalOutbox,
      },
    });

    await expect(space.publishTextSignal(signal)).rejects.toThrow(
      "final outcome owner authority is required"
    );
    expect(persistTextSignalWithOptionalOutbox).not.toHaveBeenCalled();
  });

  it("allows approved RuntimeCoordinator final text replies to claim a final outcome slot", async () => {
    const signal = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-approved-text-final-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;
    const persistTextSignalWithOptionalOutbox = vi.fn(async () => ({
      dispatchMessages: [],
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    }));
    const broadcastSignal = vi.fn();
    const flushPendingDispatchOutbox = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();
    type TestFinalTextSignalContext = {
      finalOutcomeAuthority?: "runtime_coordinator_finalization";
    };
    const signalContext = {
      finalOutcomeAuthority: "runtime_coordinator_finalization" as const,
    } satisfies TestFinalTextSignalContext;
    const space = Object.create(Space.prototype) as {
      publishTextSignal: (
        signal: SignalEnvelope,
        signalContext?: TestFinalTextSignalContext
      ) => Promise<void>;
    };
    Object.defineProperties(space, {
      broadcastSignal: { value: broadcastSignal },
      ctx: { value: { waitUntil } },
      flushPendingDispatchOutbox: { value: flushPendingDispatchOutbox },
      persistTextSignalWithOptionalOutbox: {
        value: persistTextSignalWithOptionalOutbox,
      },
      preloadDispatchContinuityCreatorProfileIds: {
        value: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      space.publishTextSignal(signal, signalContext)
    ).resolves.toBeUndefined();
    expect(persistTextSignalWithOptionalOutbox).toHaveBeenCalledWith(
      signal,
      true,
      signalContext
    );
    expect(broadcastSignal).toHaveBeenCalledWith(signal, signalContext, {
      persisted: true,
    });
    expect(flushPendingDispatchOutbox).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("rejects a visible system-authored Wake before publication when the real planner cannot prepare a dispatch", async () => {
    const { outboxRows, signalRows, space, targetProfileId } =
      createSystemWakePublishingHarness({ dispatchRuleAllow: false });
    const signal: Extract<SignalEnvelope, { type: "signal.text" }> = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Center Agent",
      },
      data: {
        text: "Continue the review.",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "Continue the review.",
        },
        meta: {
          dispatchId: "dispatch-center-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    };

    await expect(
      space.publishTextSignal(signal, {
        authoringPolicy: "system_emitted",
        finalOutcomeAuthority: "runtime_coordinator_finalization",
      })
    ).rejects.toThrow(
      `OpenMeld could not start this Wake for ${targetProfileId}`
    );
    expect(signalRows.has(signal.id)).toBe(false);
    expect(outboxRows.size).toBe(0);
  });

  it("publishes a later same-profile Wake only after atomically adding a new dispatch handoff seed", async () => {
    const targetProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const previousSignal: Extract<SignalEnvelope, { type: "signal.text" }> = {
      ...createSignal(),
      id: "signal-center-continue-1",
      ts: createSignal().ts - 1000,
      data: {
        text: "Start the review.",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "Start the review.",
        },
        meta: { clientMessageId: "client-center-continue-1" },
      },
    };
    const previousOutboxRecord = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchOwner: { id: "owner-target", kind: "owner_account" },
      dispatchPolicy: "mention_only",
      nowMs: previousSignal.ts,
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
      ruleSource: "space",
      senderProfileId: previousSignal.profile.profileId,
      sourceClientMessageId: "client-center-continue-1",
      sourceEventId: previousSignal.id,
      sourceSignalSnapshot: {
        profileId: previousSignal.profile.profileId,
        profileKind: previousSignal.profile.kind,
        text: previousSignal.data.text,
      },
      spaceId: previousSignal.spaceId,
      targetProfileId,
    });
    const {
      broadcastSignal,
      centerProfileId,
      flushPendingDispatchOutbox,
      outboxRows,
      signalRows,
      space,
    } = createSystemWakePublishingHarness({
      previousOutboxRecord,
      previousSignals: [previousSignal],
      targetProfileId,
    });
    const signal: Extract<SignalEnvelope, { type: "signal.text" }> = {
      ...createSignal(),
      id: "signal-center-continue-2",
      profile: {
        kind: "agent",
        profileId: centerProfileId,
        profileName: "Center Agent",
      },
      data: {
        text: "Continue the exact review.",
        messageEnvelope: {
          activationTargets: [targetProfileId],
          referenceTargets: [],
          text: "Continue the exact review.",
        },
        meta: {
          dispatchId: "dispatch-center-2",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    };

    await expect(
      space.publishTextSignal(signal, {
        authoringPolicy: "system_emitted",
        finalOutcomeAuthority: "runtime_coordinator_finalization",
      })
    ).resolves.toBeUndefined();

    expect(signalRows.has(signal.id)).toBe(true);
    expect(outboxRows.has(previousOutboxRecord.dispatchId)).toBe(true);
    expect(
      [...outboxRows.values()].filter(
        (record) =>
          record.sourceEventId === signal.id &&
          record.targetProfileId === targetProfileId
      )
    ).toHaveLength(1);
    expect(outboxRows.size).toBe(2);
    expect(flushPendingDispatchOutbox).toHaveBeenCalledOnce();
    expect(broadcastSignal).toHaveBeenCalledWith(
      signal,
      expect.objectContaining({
        authoringPolicy: "system_emitted",
        finalOutcomeAuthority: "runtime_coordinator_finalization",
      }),
      { persisted: true }
    );
  });

  it("allows approved RuntimeCoordinator finalization status signals to claim a final outcome slot", async () => {
    const signal = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex Agent",
      },
      type: "signal.status",
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-approved-status-final-1",
        generatedBy: "openmeld",
        status: "done",
        text: "Done.",
      },
    } satisfies SignalEnvelope;
    const persistSignalWithOptionalOutbox = vi.fn(() => ({
      dispatchMessages: [],
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    }));
    const broadcastSignal = vi.fn();
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      authorizeSpacePasswordAccess: () => Promise<{ ok: true }>;
      buildStatusSignal: () => SignalEnvelope;
      broadcastSignal: typeof broadcastSignal;
      ctx: { storage: Record<string, never> };
      persistSignalWithOptionalOutbox: typeof persistSignalWithOptionalOutbox;
      rpcPostStatusSignal: Space["rpcPostStatusSignal"];
    };
    Object.defineProperties(space, {
      applySpaceRef: { value: vi.fn() },
      authorizeSpacePasswordAccess: {
        value: vi.fn(async () => ({ ok: true })),
      },
      broadcastSignal: { value: broadcastSignal },
      buildStatusSignal: { value: vi.fn(() => signal) },
      ctx: { value: { storage: {} } },
      persistSignalWithOptionalOutbox: {
        value: persistSignalWithOptionalOutbox,
      },
    });

    await expect(
      space.rpcPostStatusSignal({
        context: {
          actorContext: {
            requestId: "req-1",
            openMeldProfileId: "openmeld-system",
            profileKind: "system",
            profileName: "OpenMeld System",
          },
        },
        data: signal.data,
        finalOutcomeAuthority: "runtime_coordinator_finalization",
        profile: signal.profile,
        spaceId: "space-1",
      })
    ).resolves.toBe(signal);
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledWith(
      signal,
      false,
      { finalOutcomeAuthority: "runtime_coordinator_finalization" }
    );
    expect(broadcastSignal).toHaveBeenCalledWith(
      signal,
      {
        finalOutcomeAuthority: "runtime_coordinator_finalization",
      },
      {
        persisted: true,
      }
    );
  });

  it("blocks duplicate terminal failure system notices for the same dispatch and target profile", () => {
    const finalReplyClaims = new Map<string, string>();
    const sql = {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes("SELECT signal_id")) {
          const claimKey = `${String(params[0])}:${String(params[1])}`;
          return {
            toArray: () => [
              ...(finalReplyClaims.has(claimKey)
                ? [{ signal_id: finalReplyClaims.get(claimKey) }]
                : []),
            ],
          };
        }
        if (query.includes("space_final_reply_claims")) {
          const claimKey = `${String(params[0])}:${String(params[1])}`;
          if (finalReplyClaims.has(claimKey)) {
            return { rowsWritten: 0 };
          }
          finalReplyClaims.set(claimKey, String(params[2]));
          return { rowsWritten: 1 };
        }
        return { rowsWritten: 1 };
      }),
    } as unknown as SqlStorage;
    const signal = {
      v: 1,
      id: "sig-preexec-failure-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-preexec-failure-1",
        generatedBy: "openmeld",
        reason: "daemon.profile.offline",
        resultRef: "pre-execution-handoff-failure:dispatch-preexec-failure-1",
        text: "Codex is offline on this computer.",
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, signal)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(
      insertSignalRecord(sql, {
        ...signal,
        id: "sig-preexec-failure-retry-1",
        ts: signal.ts + 1,
      })
    ).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-preexec-failure-1",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toBe("sig-preexec-failure-1");
  });

  it("keeps final outcome claims scoped by target profile for a multi-target Wake", () => {
    const { sql } = createFinalOutcomeSql();
    const dispatchId = "dispatch-multi-target-final-outcome-1";
    const targetA = "agt_11111111-1111-4111-8111-111111111111";
    const targetB = "agt_33333333-3333-4333-8333-333333333333";
    const finalReplySignal = {
      v: 1,
      id: "sig-target-a-final-reply-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "agent",
        profileId: targetA,
        profileName: "Target A",
      },
      type: "signal.text",
      data: {
        text: "Target A is done.",
        meta: {
          dispatchId,
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: targetA,
        },
      },
    } satisfies SignalEnvelope;
    const terminalFailureNotice = {
      v: 1,
      id: "sig-target-b-final-failure-1",
      spaceId: "space-1",
      ts: finalReplySignal.ts + 1,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: targetB,
        dispatchId,
        generatedBy: "openmeld",
        reason: "daemon.profile.offline",
        text: "OpenMeld could not wake Target B because the local OpenMeld Service is not connected for the agent.",
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, finalReplySignal)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, terminalFailureNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId,
        profileId: targetA,
      })
    ).toBe("sig-target-a-final-reply-1");
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId,
        profileId: targetB,
      })
    ).toBe("sig-target-b-final-failure-1");
    expect(
      insertSignalRecord(sql, {
        ...terminalFailureNotice,
        id: "sig-target-b-final-failure-retry-1",
        ts: terminalFailureNotice.ts + 1,
      })
    ).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      insertSignalRecord(sql, {
        ...finalReplySignal,
        id: "sig-target-a-final-reply-retry-1",
        ts: finalReplySignal.ts + 2,
      })
    ).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
  });

  it("claims a Remote Agent failure text as the single final Wake outcome", async () => {
    const { sql } = createFinalOutcomeSql();
    const dispatchId = "dispatch-remote-agent-failure-1";
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const failureSignal = {
      v: 1,
      id: "sig-remote-agent-failure-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 7, 26, 3, 1, 25),
      profile: {
        kind: "agent",
        profileId: targetProfileId,
        profileName: "Center Agent",
      },
      type: "signal.text",
      data: {
        text: "Center Agent could not complete this request.",
        meta: {
          dispatchId,
          errorCode: "remote_agent.turn_not_completed",
          purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          targetProfileId,
        },
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, failureSignal)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId,
        profileId: targetProfileId,
      })
    ).toBe(failureSignal.id);
    const space = Object.create(Space.prototype) as {
      ctx: { storage: { sql: SqlStorage } };
      durableObjectId: string;
      rpcReadFinalReplyClaimOutcome(input: {
        dispatchId: string;
        profileId: string;
        spaceId: string;
      }): Promise<{
        outcome: "failure" | "stopped" | "success" | "unknown" | null;
        signalId: string | null;
      }>;
      spaceId: string;
    };
    Object.defineProperties(space, {
      ctx: { value: { storage: { sql } } },
      durableObjectId: { value: failureSignal.spaceId },
      spaceId: { value: failureSignal.spaceId, writable: true },
    });
    await expect(
      space.rpcReadFinalReplyClaimOutcome({
        dispatchId,
        profileId: targetProfileId,
        spaceId: failureSignal.spaceId,
      })
    ).resolves.toEqual({
      outcome: "failure",
      signalId: failureSignal.id,
    });
    expect(
      insertSignalRecord(sql, {
        ...failureSignal,
        id: "sig-remote-agent-failure-duplicate-1",
        ts: failureSignal.ts + 1,
      })
    ).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      insertSignalRecord(sql, {
        ...failureSignal,
        id: "sig-late-success-after-remote-agent-failure-1",
        ts: failureSignal.ts + 2,
        data: {
          ...failureSignal.data,
          text: "Late success must not replace the failure.",
          meta: {
            ...failureSignal.data.meta,
            purpose: AGENT_REPLY_FINAL_PURPOSE,
          },
        },
      })
    ).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
  });

  it("persists idempotent execution recovery evidence without claiming a second authoritative final", () => {
    const { sql } = createFinalOutcomeSql();
    const dispatchId = "dispatch-late-result-recovery-1";
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const terminalFailureNotice = {
      v: 1,
      id: "sig-terminal-failure-before-late-result",
      spaceId: "space-1",
      ts: Date.UTC(2026, 6, 29, 10, 6, 59),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: targetProfileId,
        dispatchId,
        generatedBy: "openmeld",
        reasonCode: "runtime.progress_stale",
        text: "Codex Agent stopped making progress on this Wake.",
      },
    } satisfies SignalEnvelope;
    const recoveryData = {
      noticeType: "execution_recovery_available",
      actorProfileId: targetProfileId,
      dispatchId,
      generatedBy: "openmeld",
      reasonCode: "runtime_coordinator.late_result_available",
      resultRef: `${dispatchId}::attempt-1`,
      text: "Codex Agent completed locally after the connection was lost. OpenMeld retained the result.",
    };
    expect(signalSystemNoticeDataSchema.safeParse(recoveryData).success).toBe(
      true
    );
    const recoveryNotice = {
      ...terminalFailureNotice,
      id: `execution-recovery:space-1:${recoveryData.resultRef}`,
      ts: terminalFailureNotice.ts + 1,
      data: recoveryData,
    } as SignalEnvelope;

    expect(insertSignalRecord(sql, terminalFailureNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, recoveryNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, recoveryNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: false,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId,
        profileId: targetProfileId,
      })
    ).toBe(terminalFailureNotice.id);
  });

  it("blocks a terminal failure notice after a final reply already claimed the target Wake outcome", () => {
    const { sql } = createFinalOutcomeSql();
    const finalReplySignal = {
      v: 1,
      id: "sig-final-reply-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-final-outcome-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;
    const lateFailureNotice = {
      v: 1,
      id: "sig-late-failure-1",
      spaceId: "space-1",
      ts: finalReplySignal.ts + 1,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-final-outcome-1",
        generatedBy: "openmeld",
        reason: "daemon.profile.offline",
        text: "OpenMeld could not wake Test Agent because the local OpenMeld Service is not connected for the agent. Start or reconnect OpenMeld Service, then wake the agent again.",
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, finalReplySignal)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, lateFailureNotice)).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-final-outcome-1",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toBe("sig-final-reply-1");
  });

  it("blocks a late final reply after a terminal failure notice already claimed the target Wake outcome", () => {
    const { sql } = createFinalOutcomeSql();
    const failureNotice = {
      v: 1,
      id: "sig-final-failure-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-final-outcome-2",
        generatedBy: "openmeld",
        reason: "agent_profile_binding.missing",
        text: "OpenMeld could not wake Test Agent because the agent is not set up on this computer yet. Set up the agent, then wake it again.",
      },
    } satisfies SignalEnvelope;
    const lateFinalReply = {
      v: 1,
      id: "sig-late-final-reply-1",
      spaceId: "space-1",
      ts: failureNotice.ts + 1,
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-final-outcome-2",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, failureNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, lateFinalReply)).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-final-outcome-2",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toBe("sig-final-failure-1");
  });

  it("applies a RuntimeCoordinator failure publication command as one visible terminal failure notice", async () => {
    const { signalRows, sql, sqlExec } = createFinalOutcomeSql();
    const sourceWakeSignal = {
      v: 1,
      id: "sig-source-1",
      spaceId: "space-1",
      ts: 1_700_000_000_000,
      profile: {
        kind: "human",
        profileId: "22222222-2222-4222-8222-222222222222",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text: "@Codex Agent(wake) please check the deploy",
      },
    } satisfies SignalEnvelope;
    signalRows.set(sourceWakeSignal.id, {
      payloadJson: JSON.stringify(sourceWakeSignal),
      ts: sourceWakeSignal.ts,
    });
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-failure-publication-1",
      sourceSignalId: "sig-source-1",
      spaceId: "space-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const command = {
      createdAtMs: 1_700_000_000_000,
      dispatchId: "dispatch-failure-publication-1",
      failurePublicationCommandId: "failure-command-1",
      modelVersion:
        RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
      ownerUserId: "owner-1",
      publicationCategory: "service_not_connected",
      publicationIntentId: "publication-intent-1",
      reasonCode: "daemon.profile.offline",
      spaceId: "space-1",
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      targetProfileName: "Codex Agent",
      targetWakeLifecycleIdentity,
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
      userRecoveryAction: "start_or_restart_openmeld_service",
    } satisfies RuntimeCoordinatorFailurePublicationCommand;
    const threadContext = {
      rootSignalId: sourceWakeSignal.id,
      threadId: "thr_11111111-1111-4111-8111-111111111111",
    };
    const broadcastSignal = vi.fn();
    const persistSignalWithOptionalOutbox = vi.fn((signal: SignalEnvelope) => {
      const result = insertSignalRecord(sql, signal);
      return {
        dispatchMessages: [],
        duplicateFinalReplyBlocked: result.duplicateFinalReplyBlocked,
        persistedSignal: result.persistedSignal,
      };
    });
    let builtNoticeCount = 0;
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      bindings: CoreBindings;
      ctx: { storage: { sql: SqlStorage } };
      lastTimestamp: number;
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
      resolveThreadContextForSignal: () => typeof threadContext;
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: Space["rpcApplyRuntimeCoordinatorFailurePublicationCommand"];
      spaceId: string;
    };
    Object.defineProperties(space, {
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
              id: `sig-runtime-failure-${++builtNoticeCount}`,
              spaceId: "space-1",
              ts: 1_700_000_000_100,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      bindings: { value: {} as CoreBindings },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      persistSignalWithOptionalOutbox: {
        value: persistSignalWithOptionalOutbox,
      },
      readSignalById: {
        value: vi.fn((signalId: string) => {
          const row = signalRows.get(signalId);
          return row ? (JSON.parse(row.payloadJson) as SignalEnvelope) : null;
        }),
      },
      resolveThreadContextForSignal: { value: vi.fn(() => threadContext) },
      spaceId: { value: "space-1", writable: true },
    });

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "failure-command-1",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-runtime-failure-1",
      status: "failure_published",
    });
    const persistedSignalRow = signalRows.get("sig-runtime-failure-1");
    expect(persistedSignalRow).toBeDefined();
    expect(JSON.parse(String(persistedSignalRow?.payloadJson))).toMatchObject({
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        actorName: "Codex Agent",
        dispatchId: "dispatch-failure-publication-1",
        failureStage: "execution",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        reasonCode: "daemon.profile.offline",
        replyTo: {
          previewText: "@Codex Agent(wake) please check the deploy",
          profileId: "22222222-2222-4222-8222-222222222222",
          profileKind: "human",
          profileName: "Mira",
          signalId: "sig-source-1",
        },
        text: "OpenMeld could not reach Codex Agent on this computer for this Wake. Reconnect OpenMeld Service, then try again.",
      },
      type: "signal.system_notice",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sig-runtime-failure-1",
      }),
      false,
      {
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
        threadContext,
      }
    );
    expect(broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sig-runtime-failure-1",
      }),
      {
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
        threadContext,
      },
      {
        persisted: true,
      }
    );
    expect(broadcastSignal).toHaveBeenCalledTimes(1);

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      finalMessageKind: "failure_notice",
      publicationAction: "already_visible",
      publishedSignalId: "sig-runtime-failure-1",
      status: "failure_published",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledTimes(1);
    expect(broadcastSignal).toHaveBeenCalledTimes(1);

    const secondTargetWakeLifecycleIdentity =
      projectTargetWakeLifecycleIdentity({
        clientMessageId: "client-message-1",
        dispatchId: "dispatch-failure-publication-2",
        sourceSignalId: "sig-source-1",
        spaceId: "space-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      });
    const secondCommand = {
      ...command,
      dispatchId: "dispatch-failure-publication-2",
      failurePublicationCommandId: "failure-command-2",
      publicationIntentId: "publication-intent-2",
      reasonCode: "organization_binding_authorization.required",
      targetProfileMentionLabel: "Review Agent",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      targetProfileName: "Review Agent",
      targetWakeLifecycleIdentity: secondTargetWakeLifecycleIdentity,
      targetWakeLifecycleId:
        secondTargetWakeLifecycleIdentity.targetWakeLifecycleId,
    } satisfies RuntimeCoordinatorFailurePublicationCommand;

    await expect(
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(secondCommand)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "failure-command-2",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-runtime-failure-2",
      status: "failure_published",
    });
    const secondPersistedSignalRow = signalRows.get("sig-runtime-failure-2");
    expect(
      JSON.parse(String(secondPersistedSignalRow?.payloadJson))
    ).toMatchObject({
      data: {
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        actorName: "Review Agent",
        dispatchId: "dispatch-failure-publication-2",
        failureStage: "execution",
        reasonCode: "organization_binding_authorization.required",
        text: "Review Agent cannot be used in this workspace. Choose an Agent Profile created here.",
      },
      type: "signal.system_notice",
    });
    expect(persistSignalWithOptionalOutbox).toHaveBeenCalledTimes(2);
    expect(broadcastSignal).toHaveBeenCalledTimes(2);
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("FROM space_members")
      )
    ).toBe(false);
  });

  it("falls back to the profile id when a RuntimeCoordinator failure publication rebuilds replyTo for a source signal without profile.profileName", async () => {
    // Reproduces the W-ERR2-R1 dogfood gap: a Center Agent tool call posts
    // the Wake with profile.kind "agent", but services/remote-agent's
    // toOpenMeldRequestContext never sets actorContext.profileName (unlike a
    // Gateway-authenticated human session), so the persisted source signal's
    // profile.profileName is absent. Before the fix,
    // buildRuntimeCoordinatorFailurePublicationReplyTo required
    // profile.profileName with no fallback and returned null, so the
    // published terminal_failure notice had no replyTo. It must now fall
    // back to a resolved Space membership snapshot, then the profile id.
    const { signalRows, sql } = createFinalOutcomeSql();
    const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
    const sourceWakeSignal = {
      v: 1,
      id: "sig-center-agent-source-1",
      spaceId: "space-1",
      ts: 1_700_000_000_000,
      profile: {
        kind: "agent",
        profileId: centerAgentProfileId,
      },
      type: "signal.text",
      data: {
        text: "@Codex Agent(wake) please check the deploy",
      },
    } satisfies SignalEnvelope;
    signalRows.set(sourceWakeSignal.id, {
      payloadJson: JSON.stringify(sourceWakeSignal),
      ts: sourceWakeSignal.ts,
    });
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-center-agent-failure-publication-1",
      sourceSignalId: sourceWakeSignal.id,
      spaceId: "space-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const command = {
      createdAtMs: 1_700_000_000_000,
      dispatchId: "dispatch-center-agent-failure-publication-1",
      failurePublicationCommandId: "center-agent-failure-command-1",
      modelVersion:
        RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
      ownerUserId: "owner-1",
      publicationCategory: "service_not_connected",
      publicationIntentId: "center-agent-publication-intent-1",
      reasonCode: "daemon.profile.offline",
      spaceId: "space-1",
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      targetProfileName: "Codex Agent",
      targetWakeLifecycleIdentity,
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
      userRecoveryAction: "start_or_restart_openmeld_service",
    } satisfies RuntimeCoordinatorFailurePublicationCommand;
    let builtNoticeCount = 0;
    const space = Object.create(Space.prototype) as {
      applySpaceRef: (spaceId: string) => void;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown
      ) => void;
      buildSystemNoticeSignal: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      bindings: CoreBindings;
      ctx: { storage: { sql: SqlStorage } };
      lastTimestamp: number;
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
      rpcApplyRuntimeCoordinatorFailurePublicationCommand: Space["rpcApplyRuntimeCoordinatorFailurePublicationCommand"];
      spaceId: string;
    };
    Object.defineProperties(space, {
      applySpaceRef: {
        value: vi.fn((spaceId: string) => {
          space.spaceId = spaceId;
        }),
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
              id: `sig-center-agent-runtime-failure-${++builtNoticeCount}`,
              spaceId: "space-1",
              ts: 1_700_000_000_100,
              profile,
              type: "signal.system_notice",
              data,
            }) satisfies SignalEnvelope
        ),
      },
      bindings: { value: {} as CoreBindings },
      ctx: { value: { storage: { sql } } },
      lastTimestamp: { value: 0, writable: true },
      persistSignalWithOptionalOutbox: {
        value: vi.fn((signal: SignalEnvelope) => {
          const result = insertSignalRecord(sql, signal);
          return {
            dispatchMessages: [],
            duplicateFinalReplyBlocked: result.duplicateFinalReplyBlocked,
            persistedSignal: result.persistedSignal,
          };
        }),
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
      space.rpcApplyRuntimeCoordinatorFailurePublicationCommand(command)
    ).resolves.toMatchObject({
      failurePublicationCommandId: "center-agent-failure-command-1",
      finalMessageKind: "failure_notice",
      ok: true,
      publicationAction: "created",
      publishedSignalId: "sig-center-agent-runtime-failure-1",
      status: "failure_published",
    });
    const persistedSignalRow = signalRows.get(
      "sig-center-agent-runtime-failure-1"
    );
    expect(persistedSignalRow).toBeDefined();
    expect(JSON.parse(String(persistedSignalRow?.payloadJson))).toMatchObject({
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-center-agent-failure-publication-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        replyTo: {
          previewText: "@Codex Agent(wake) please check the deploy",
          profileId: centerAgentProfileId,
          profileKind: "agent",
          // No Space member snapshot is wired into this harness, so the
          // fallback resolves to the raw profile id -- the point of this
          // assertion is that replyTo exists at all instead of being
          // dropped, not the display value.
          profileName: centerAgentProfileId,
          signalId: sourceWakeSignal.id,
        },
      },
      type: "signal.system_notice",
    });
  });

  it("claims generated OpenMeld status messages as a target Wake final outcome", () => {
    const finalReplyClaims = new Map<string, string>();
    const sql = {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes("SELECT signal_id")) {
          const claimKey = `${String(params[0])}:${String(params[1])}`;
          return {
            toArray: () => [
              ...(finalReplyClaims.has(claimKey)
                ? [{ signal_id: finalReplyClaims.get(claimKey) }]
                : []),
            ],
          };
        }
        if (query.includes("space_final_reply_claims")) {
          const claimKey = `${String(params[0])}:${String(params[1])}`;
          if (finalReplyClaims.has(claimKey)) {
            return { rowsWritten: 0 };
          }
          finalReplyClaims.set(claimKey, String(params[2]));
          return { rowsWritten: 1 };
        }
        return { rowsWritten: 1 };
      }),
    } as unknown as SqlStorage;
    const signal = {
      v: 1,
      id: "sig-status-final-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Test Agent",
      },
      type: "signal.status",
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        dispatchId: "dispatch-status-1",
        generatedBy: "openmeld",
        status: "done",
        text: "Updated the task.",
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, signal)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-status-1",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toBe("sig-status-final-1");
  });

  it("claims generated OpenMeld policy and stay-silent notices as target Wake final outcomes", () => {
    const { sql } = createFinalOutcomeSql();
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const policyBlockedNotice = {
      v: 1,
      id: "sig-policy-blocked-final-1",
      spaceId: "space-1",
      ts: Date.UTC(2026, 2, 4, 0, 0, 0),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "policy_blocked",
        actorProfileId: targetProfileId,
        dispatchId: "dispatch-policy-blocked-1",
        generatedBy: "openmeld",
        reason: "This room does not allow post_message.",
        text: "OpenMeld blocked a public reply from Test Agent: This room does not allow post_message.",
      },
    } satisfies SignalEnvelope;
    const staySilentNotice = {
      ...policyBlockedNotice,
      id: "sig-stay-silent-final-1",
      ts: policyBlockedNotice.ts + 1,
      data: {
        noticeType: "stay_silent",
        actorProfileId: targetProfileId,
        dispatchId: "dispatch-stay-silent-1",
        generatedBy: "openmeld",
        reason: "No update needed.",
        text: "Test Agent chose to stay silent.",
      },
    } satisfies SignalEnvelope;

    expect(insertSignalRecord(sql, policyBlockedNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(insertSignalRecord(sql, staySilentNotice)).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-policy-blocked-1",
        profileId: targetProfileId,
      })
    ).toBe("sig-policy-blocked-final-1");
    expect(
      readFinalReplyClaimSignalId(sql, {
        dispatchId: "dispatch-stay-silent-1",
        profileId: targetProfileId,
      })
    ).toBe("sig-stay-silent-final-1");
  });

  it("returns 400 when body is invalid", async () => {
    const response = await handlePostSignalUseCase({
      body: null,
      profile: createSignal().profile,
      authoringPolicy: "system_emitted",
      buildTextSignal: () => createSignal(),
      publishTextSignal: async () => undefined,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid JSON");
  });

  it("never persists reply staleness metadata on an ordinary message", async () => {
    const publishedSignals: SignalEnvelope[] = [];
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "Ordinary room message",
          meta: {
            clientMessageId: "ordinary-message-1",
            staleness: {
              newMessagesDuringComposition: 3,
            },
          },
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal: (profile, text, options) => ({
        ...createSignal(),
        profile,
        data: {
          text,
          ...(options?.meta ? { meta: options.meta } : {}),
        },
      }),
      publishTextSignal: (signal) => {
        publishedSignals.push(signal);
        return Promise.resolve();
      },
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    const publishedSignal = publishedSignals.at(0);
    if (publishedSignal?.type !== "signal.text") {
      throw new Error("expected an ordinary text signal to publish");
    }
    expect(publishedSignal.data.meta).not.toHaveProperty("staleness");
    await expect(response.json()).resolves.not.toHaveProperty(
      "data.meta.staleness"
    );
  });

  it("preserves Task references for system-emitted messages and strips them from user messages", async () => {
    const publishedSignals: SignalEnvelope[] = [];
    const body = {
      type: "signal.text",
      data: {
        text: "I started the Task.",
        meta: {
          centerAgentTaskReferences: [{ taskId: "task-1" }],
          purpose: "agent_reply_final",
        },
      },
    };
    const buildTextSignal = (
      profile: Parameters<
        Parameters<typeof handlePostSignalUseCase>[0]["buildTextSignal"]
      >[0],
      text: string,
      options?: Parameters<
        Parameters<typeof handlePostSignalUseCase>[0]["buildTextSignal"]
      >[2]
    ): SignalEnvelope => ({
      ...createSignal(),
      profile,
      data: {
        text,
        ...(options?.meta ? { meta: options.meta } : {}),
      },
    });
    const publishTextSignal = (signal: SignalEnvelope) => {
      publishedSignals.push(signal);
      return Promise.resolve();
    };

    const trustedResponse = await handlePostSignalUseCase({
      body,
      profile: createSignal().profile,
      authoringPolicy: "system_emitted",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });
    const userResponse = await handlePostSignalUseCase({
      body,
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(trustedResponse.status).toBe(200);
    expect(userResponse.status).toBe(200);
    const [trustedSignal, userSignal] = publishedSignals;
    expect(
      trustedSignal?.type === "signal.text"
        ? trustedSignal.data.meta?.centerAgentTaskReferences
        : undefined
    ).toEqual([{ taskId: "task-1" }]);
    expect(
      userSignal?.type === "signal.text" ? userSignal.data.meta : undefined
    ).not.toHaveProperty("centerAgentTaskReferences");
  });

  it("returns 422 when dispatch snapshot is oversize", async () => {
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: { text: "hello" },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal: () => createSignal(),
      publishTextSignal: () => Promise.reject(new Error("snapshot too large")),
      isDispatchSnapshotOversizeError: () => true,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "dispatch.snapshot_oversize",
      message: "dispatch snapshot exceeds size budget",
    });
  });

  it("returns actionable target feedback when user-authored Wake authoring fails", async () => {
    const text = "@Missing Agent(wake) hello";
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text,
          messageEnvelope: {
            ...TEST_MESSAGE_ENVELOPE,
            text,
          },
          meta: {
            clientMessageId: "client-message-1",
          },
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal: () => createSignal(),
      publishTextSignal: () =>
        Promise.reject(
          new SpaceSignalAuthoringError({
            code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
            message:
              "OpenMeld could not start this Wake for agt_missing. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again.",
            targetProfileId: "agt_missing",
          })
        ),
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
      message:
        "OpenMeld could not start this Wake for agt_missing. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again.",
      targetProfileId: "agt_missing",
    });
  });

  it("forwards signal text member-notice meta into buildTextSignal options", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "hello",
          meta: {
            purpose: "space_membership_join_notice",
            targetProfileId: "22222222-2222-4222-8222-222222222222",
            targetProfileKind: "human",
            targetProfileName: "Helper Human",
            addedByProfileId: "11111111-1111-4111-8111-111111111111",
            addedByDisplayName: "Felix",
          },
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "system_emitted",
      buildTextSignal,
      publishTextSignal: async () => undefined,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledWith(
      createSignal().profile,
      "hello",
      {
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: "22222222-2222-4222-8222-222222222222",
          targetProfileKind: "human",
          targetProfileName: "Helper Human",
          addedByProfileId: "11111111-1111-4111-8111-111111111111",
          addedByDisplayName: "Felix",
        },
      }
    );
  });

  it("forwards signal text replyTo into buildTextSignal options", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "reply body",
          replyTo: TEST_REPLY_TO,
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal: async () => undefined,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledWith(
      createSignal().profile,
      "reply body",
      {
        replyTo: TEST_REPLY_TO,
      }
    );
  });

  it("publishes the server-resolved Space File revision snapshot", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const resolveMessageFiles = vi.fn(() => [
      {
        fileId: "file-1",
        revision: 3,
        name: "Canonical brief.md",
        mimeType: "text/markdown",
        sizeBytes: 512,
      },
    ]);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "Latest brief",
          files: [
            {
              fileId: "file-1",
              revision: 3,
              name: "Untrusted client name.md",
              mimeType: "application/pdf",
              sizeBytes: 1,
            },
          ],
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal: async () => undefined,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
      resolveMessageFiles,
    });

    expect(response.status).toBe(200);
    expect(resolveMessageFiles).toHaveBeenCalledWith([
      {
        fileId: "file-1",
        revision: 3,
        name: "Untrusted client name.md",
        mimeType: "application/pdf",
        sizeBytes: 1,
      },
    ]);
    expect(buildTextSignal).toHaveBeenCalledWith(
      createSignal().profile,
      "Latest brief",
      {
        files: [
          {
            fileId: "file-1",
            revision: 3,
            name: "Canonical brief.md",
            mimeType: "text/markdown",
            sizeBytes: 512,
          },
        ],
      }
    );
  });

  it("forwards signal text messageEnvelope into buildTextSignal options", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "system_emitted",
      buildTextSignal,
      publishTextSignal: async () => undefined,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledWith(
      createSignal().profile,
      "@Codex Agent(wake) hello",
      {
        messageEnvelope: TEST_MESSAGE_ENVELOPE,
      }
    );
  });

  it("rejects a user-authored Navigation Action before publication", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "Open this Project",
          messageEnvelope: {
            activationTargets: [],
            navigationAction: {
              label: "Open this Project",
              target: {
                kind: "project",
                projectId: "project_phishing",
              },
              url: "https://example.com/phishing",
            },
            referenceTargets: [],
            text: "Open this Project",
          },
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "space.signal.navigation_action_owner_required",
      message:
        "Navigation Actions can only be published by OpenMeld's Remote Agent delivery path.",
    });
    expect(buildTextSignal).not.toHaveBeenCalled();
    expect(publishTextSignal).not.toHaveBeenCalled();
  });

  it("accepts a Core-built Navigation Action from Remote Agent native delivery", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "Project created.",
          messageEnvelope: {
            activationTargets: [],
            navigationAction: {
              label: "Open this Project",
              target: {
                kind: "project",
                projectId: "project_123",
              },
              url: "https://openmeld.ai/o/amplift/projects/project_123",
            },
            referenceTargets: [],
            text: "Project created.",
          },
        },
      },
      profile: createSignal().profile,
      signalContext: {
        finalOutcomeAuthority: "remote_agent_native_delivery",
      },
      authoringPolicy: "system_emitted",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledOnce();
    expect(publishTextSignal).toHaveBeenCalledOnce();
  });

  it("rejects user-authored Wake posts that do not carry clientMessageId", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
      message:
        "Wake requests from user-authored signal posts require clientMessageId.",
    });
    expect(buildTextSignal).not.toHaveBeenCalled();
    expect(publishTextSignal).not.toHaveBeenCalled();
  });

  it("accepts user-authored Wake posts that carry clientMessageId", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
          meta: {
            clientMessageId: "client-message-1",
          },
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledWith(
      createSignal().profile,
      "@Codex Agent(wake) hello",
      {
        messageEnvelope: TEST_MESSAGE_ENVELOPE,
        meta: {
          clientMessageId: "client-message-1",
        },
      }
    );
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("keeps internal Wake posts nullable for legacy and system callers", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "system_emitted",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledTimes(1);
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit legacy Wake posts nullable", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "legacy_nullable",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledTimes(1);
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("does not require clientMessageId for user-authored non-Wake posts", async () => {
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);
    const response = await handlePostSignalUseCase({
      body: {
        type: "signal.text",
        data: {
          text: "hello without a wake target",
        },
      },
      profile: createSignal().profile,
      authoringPolicy: "user_authored",
      buildTextSignal,
      publishTextSignal,
      isDispatchSnapshotOversizeError: () => false,
      dispatchSnapshotOversizeErrorCode: "dispatch.snapshot_oversize",
    });

    expect(response.status).toBe(200);
    expect(buildTextSignal).toHaveBeenCalledTimes(1);
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("rejects WebSocket Wake posts without publishing or broadcasting", async () => {
    const webSocket = {
      send: vi.fn(),
    } as unknown as WebSocket;
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);

    await handleWebSocketTextSignal({
      webSocket,
      session: { helloAccepted: true, supportsLiveSignalHistory: false },
      profile: createSignal().profile,
      payload: {
        type: "signal.text",
        data: {
          text: "@Codex Agent(wake) hello",
          messageEnvelope: TEST_MESSAGE_ENVELOPE,
        },
      },
      buildTextSignal,
      publishTextSignal,
    });

    expect(webSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        error: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE,
        code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
      })
    );
    expect(buildTextSignal).not.toHaveBeenCalled();
    expect(publishTextSignal).not.toHaveBeenCalled();
  });

  it("rejects unverified attachment references from direct WebSocket authoring", async () => {
    const webSocket = {
      send: vi.fn(),
    } as unknown as WebSocket;
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(async () => undefined);

    await handleWebSocketTextSignal({
      webSocket,
      session: { helloAccepted: true, supportsLiveSignalHistory: false },
      profile: createSignal().profile,
      payload: {
        type: "signal.text",
        data: {
          text: "Here is the diagram.",
          attachments: [
            {
              id: "attachment-1",
              mimeType: "image/png",
              sizeBytes: 1024,
            },
          ],
        },
      },
      buildTextSignal,
      publishTextSignal,
    });

    expect(webSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        error:
          "Image attachments must be sent through the authenticated Space message API.",
        code: "attachment_reference_invalid",
      })
    );
    expect(buildTextSignal).not.toHaveBeenCalled();
    expect(publishTextSignal).not.toHaveBeenCalled();
  });

  it("returns WebSocket Wake authoring failures without publishing the message", async () => {
    const text = "@Missing Agent(wake) hello";
    const webSocket = {
      send: vi.fn(),
    } as unknown as WebSocket;
    const buildTextSignal = vi.fn(() => createSignal());
    const publishTextSignal = vi.fn(() =>
      Promise.reject(
        new SpaceSignalAuthoringError({
          code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
          message:
            "OpenMeld could not start this Wake for agt_missing. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again.",
          targetProfileId: "agt_missing",
        })
      )
    );

    await handleWebSocketTextSignal({
      webSocket,
      session: { helloAccepted: true, supportsLiveSignalHistory: false },
      profile: createSignal().profile,
      payload: {
        type: "signal.text",
        data: {
          text,
          messageEnvelope: {
            ...TEST_MESSAGE_ENVELOPE,
            text,
          },
          meta: {
            clientMessageId: "client-message-1",
          },
        },
      },
      buildTextSignal,
      publishTextSignal,
    });

    expect(webSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        error:
          "OpenMeld could not start this Wake for agt_missing. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again.",
        code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
        clientMessageId: "client-message-1",
        targetProfileId: "agt_missing",
      })
    );
    expect(buildTextSignal).toHaveBeenCalledTimes(1);
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("shows queued Wake progress only from the Agent Profile Work Coordinator head", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      {
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorHeadLifecycle: {
          factSource: "runtime_coordinator_head_lifecycle",
          readStatus: "found",
          status: "queued",
        },
      } as unknown as SpaceDispatchTraceSnapshot,
      [],
      {
        latestAttemptErrorCode: null,
        latestAttemptStatus: "profile_queue_waiting",
        status: "queued",
      }
    );

    expect(item).toMatchObject({
      failureReasonCode: null,
      message: "Wake for @Codex Agent is queued.",
      phase: "queued",
      terminal: false,
    });
  });

  it("shows RuntimeCoordinator head no-execution in Wake progress without claiming final Space failure publication", async () => {
    const item = await buildWakeProgressItemFromLookupTrace({
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorHeadLifecycle: {
        factSource: "runtime_coordinator_head_lifecycle",
        readStatus: "found",
        noExecutionDecision: {
          decidedAt: "2026-03-04T00:00:00.000Z",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.missing",
          source: "dispatch_preflight",
          userRecoveryAction: "set_up_agent_binding",
        },
        publicationIntent: {
          intentId: "rcpi:no_execution:twl-1",
          kind: "no_execution_failure",
          publicationCategory: "binding_required",
          readyAt: "2026-03-04T00:00:00.000Z",
          reasonCode: "agent_profile_binding.missing",
          status: "ready_for_phase_6",
          userRecoveryAction: "set_up_agent_binding",
        },
      },
    } as unknown as SpaceDispatchTraceSnapshot);

    expect(item).toMatchObject({
      failureReasonCode: "agent_profile_binding.missing",
      phase: "failed",
      message: "OpenMeld could not start this Wake for @Codex Agent.",
      terminal: false,
    });
  });

  it("shows RuntimeCoordinator head pre-agent Stop in Wake progress without a RuntimeCoordinator execution", async () => {
    const item = await buildWakeProgressItemFromLookupTrace({
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorHeadLifecycle: {
        factSource: "runtime_coordinator_head_lifecycle",
        readStatus: "found",
        publicationIntent: {
          intentId: "rcpi:stopped:twl-1",
          kind: "stopped_notice",
          readyAt: "2026-03-04T00:00:00.000Z",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          status: "ready_for_phase_6",
        },
        status: "stopped_before_execution",
      },
    } as unknown as SpaceDispatchTraceSnapshot);

    expect(item).toMatchObject({
      failureReasonCode: null,
      phase: "stopped",
      message: "Wake was stopped for @Codex Agent.",
      terminal: true,
    });
  });

  it("shows RuntimeCoordinator head authority unavailability in Wake progress without falling back to Queue retry truth", async () => {
    const item = await buildWakeProgressItemFromLookupTrace({
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorHeadLifecycle: {
        factSource: "runtime_coordinator_head_lifecycle",
        readStatus: "authority_unavailable",
        reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
        targetWakeLifecycleId: "twl-1",
      },
    } as unknown as SpaceDispatchTraceSnapshot);

    expect(item).toMatchObject({
      phase: "retrying",
      message:
        "OpenMeld cannot read Wake owner status for @Codex Agent right now.",
      terminal: false,
    });
  });

  it("keeps a confirmed visible reply terminal when RuntimeCoordinator head authority is unavailable", async () => {
    const item = await buildWakeProgressItemFromLookupTrace({
      ...createWakeProgressReplyProducedTrace({
        finalVisibleMessage: {
          createdAt: "2026-03-04T00:00:00.000Z",
          dispatchId: "dispatch-head-progress-1",
          factSource: "space_signal_by_published_signal_id",
          noticeType: null,
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Codex Agent",
          reasonCode: null,
          signalId: "sig-reply-1",
          signalType: "signal.text",
          statusType: null,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          text: "Done.",
        },
        replySignal: {
          createdAt: "2026-03-04T00:00:00.000Z",
          factSource: "space_signal_by_published_signal_id",
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Codex Agent",
          signalId: "sig-reply-1",
          text: "Done.",
        },
      }),
      runtimeCoordinatorExecution: null,
      runtimeCoordinatorHeadLifecycle: {
        factSource: "runtime_coordinator_head_lifecycle",
        readStatus: "authority_unavailable",
        reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
        targetWakeLifecycleId: "twl-1",
      },
    } as unknown as SpaceDispatchTraceSnapshot);

    expect(item).toMatchObject({
      failureReasonCode: null,
      phase: "replied",
      message: "@Codex Agent replied.",
      terminal: true,
    });
  });

  it("keeps RuntimeCoordinator running Wake progress fresh when legacy dispatch evidence is stale", async () => {
    const runtimeCoordinatorUpdatedAtMs = Date.parse(
      "2026-03-04T00:21:00.000Z"
    );
    const runtimeCoordinatorEventObservedAtMs = Date.parse(
      "2026-03-04T00:22:00.000Z"
    );
    const item = await buildWakeProgressItemFromLookupTrace({
      ...createWakeProgressReplyProducedTrace({}),
      runtimeCoordinatorExecution: {
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-rc-1",
        },
        bindingId: "binding-rc-1",
        createdAtMs: Date.parse("2026-03-04T00:00:00.000Z"),
        dispatchId: "dispatch-head-progress-1",
        factSource: "runtime_coordinator_projection",
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        runtimeCoordinatorExecutionId: "rce-dispatch-running-1",
        sourceClientMessageId: "client-message-1",
        spaceId: "space-1",
        status: "running",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        terminalOutcome: null,
        updatedAtMs: runtimeCoordinatorUpdatedAtMs,
      },
      runtimeCoordinatorEvents: [
        {
          eventId: "rce-event-running-1",
          eventType: "lifecycle_running",
          factSource: "runtime_coordinator_projection",
          idempotencyKey: "rce-event-running-1",
          observedAtMs: runtimeCoordinatorEventObservedAtMs,
          payloadJson: {},
          reasonCode: null,
          runtimeCoordinatorExecutionId: "rce-dispatch-running-1",
          statusAfter: "running",
        },
      ],
    } as unknown as SpaceDispatchTraceSnapshot);

    expect(item).toMatchObject({
      failureReasonCode: null,
      message: "@Codex Agent is working on this computer...",
      phase: "running",
      startedAtMs: Date.parse("2026-03-04T00:00:00.000Z"),
      terminal: false,
      updatedAtMs: runtimeCoordinatorEventObservedAtMs,
    });
  });

  it("projects cancel-backed Wake Stop eligibility into active Wake progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createRunningRuntimeCoordinatorTrace(),
      [],
      {},
      {
        controlMode: "cancel",
        reasonCode: null,
        reliability: "native_cancel",
        status: "eligible",
      }
    );

    expect(item).toMatchObject({
      phase: "running",
      terminal: false,
      wakeStopEligibility: {
        controlMode: "cancel",
        reasonCode: null,
        reliability: "native_cancel",
        status: "eligible",
      },
    });
  });

  it("projects interrupt-backed Wake Stop eligibility into active Wake progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createRunningRuntimeCoordinatorTrace(),
      [],
      {},
      {
        controlMode: "interrupt",
        reasonCode: null,
        reliability: "native_interrupt",
        status: "eligible",
      }
    );

    expect(item).toMatchObject({
      phase: "running",
      terminal: false,
      wakeStopEligibility: {
        controlMode: "interrupt",
        reasonCode: null,
        reliability: "native_interrupt",
        status: "eligible",
      },
    });
  });

  it("omits Wake Stop eligibility from active Wake progress without opt-in", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createRunningRuntimeCoordinatorTrace(),
      [],
      {},
      {
        controlMode: "cancel",
        reasonCode: null,
        reliability: "native_cancel",
        status: "eligible",
      },
      false
    );

    expect(item).toMatchObject({
      phase: "running",
      terminal: false,
    });
    expect("wakeStopEligibility" in item).toBe(false);
  });

  it("projects unsupported Wake Stop eligibility into active Wake progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createRunningRuntimeCoordinatorTrace(),
      [],
      {},
      {
        controlMode: null,
        reasonCode: "agent_controller_interface.stop_unsupported",
        reliability: "unsupported",
        status: "not_eligible",
      }
    );

    expect(item).toMatchObject({
      phase: "running",
      terminal: false,
      wakeStopEligibility: {
        controlMode: null,
        reasonCode: "agent_controller_interface.stop_unsupported",
        reliability: "unsupported",
        status: "not_eligible",
      },
    });
  });

  it("resolves active Wake Stop eligibility from the current cancel-backed ACI report", async () => {
    const eligibility = await readWakeProgressWakeStopEligibilityForTest({
      db: createRuntimeAgentControllerReportDb({
        agentControllerInterface: createAgentControllerInterfaceSnapshot({
          cancel: true,
        }),
        expiresAtMs: Date.now() + 60_000,
      }),
      trace: createRunningRuntimeCoordinatorTrace(),
    });

    expect(eligibility).toEqual({
      controlMode: "cancel",
      reasonCode: null,
      reliability: "native_cancel",
      status: "eligible",
    });
  });

  it("resolves active Wake Stop eligibility from the current interrupt-backed ACI report", async () => {
    const eligibility = await readWakeProgressWakeStopEligibilityForTest({
      db: createRuntimeAgentControllerReportDb({
        agentControllerInterface: createAgentControllerInterfaceSnapshot({
          cancel: false,
          interrupt: true,
        }),
        expiresAtMs: Date.now() + 60_000,
      }),
      trace: createRunningRuntimeCoordinatorTrace(),
    });

    expect(eligibility).toEqual({
      controlMode: "interrupt",
      reasonCode: null,
      reliability: "native_interrupt",
      status: "eligible",
    });
  });

  it("fails closed when the current ACI report has no local control-backed Stop", async () => {
    const eligibility = await readWakeProgressWakeStopEligibilityForTest({
      db: createRuntimeAgentControllerReportDb({
        agentControllerInterface: createAgentControllerInterfaceSnapshot({
          cancel: false,
          interrupt: false,
        }),
        expiresAtMs: Date.now() + 60_000,
      }),
      trace: createRunningRuntimeCoordinatorTrace(),
    });

    expect(eligibility).toEqual({
      controlMode: null,
      reasonCode: "agent_controller_interface.stop_unsupported",
      reliability: "unsupported",
      status: "not_eligible",
    });
  });

  it("keeps ordinary handed-off Wake progress neutral before Coordinator evidence", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });

    const response = await readActiveWakeProgressForTest({
      includeWakeStopEligibility: true,
      outboxRows: [outboxRecord],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      clientMessageId: "client-message-1",
      dispatchId: outboxRecord.dispatchId,
      message: "Wake request sent to @Codex Agent.",
      phase: "request_sent",
      terminal: false,
      wakeStopEligibility: {
        controlMode: "openmeld_owned_pre_agent_cancel",
        reasonCode: null,
        reliability: "openmeld_owned_pre_agent",
        status: "eligible",
      },
    });
  });

  it("projects Profile FIFO queued progress from the Coordinator head lifecycle", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });

    const response = await readActiveWakeProgressForTest({
      headLifecycleReadStatus: "queued",
      includeWakeStopEligibility: true,
      outboxRows: [outboxRecord],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      clientMessageId: "client-message-1",
      dispatchId: outboxRecord.dispatchId,
      message: "Wake for @Codex Agent is queued.",
      phase: "queued",
      terminal: false,
    });
  });

  it("projects active agent-authored Wake progress by source signal when no client message ID exists", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: null,
      id: "sig-agent-source-1",
    });
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
      sourceClientMessageId: null,
      sourceEventId: sourceSignal.id,
    });

    const response = await readActiveWakeProgressForTest({
      includeWakeStopEligibility: true,
      outboxRows: [outboxRecord],
      sourceSignals: [sourceSignal],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      clientMessageId: null,
      dispatchId: outboxRecord.dispatchId,
      phase: "request_sent",
      sourceSignalId: sourceSignal.id,
      targetProfileId: outboxRecord.targetProfileId,
      terminal: false,
    });
  });

  it("keeps active Wake progress selectors separate for the same source signal across targets", async () => {
    const secondTargetProfileId = "agt_44444444-4444-4444-8444-444444444444";
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: null,
      id: "sig-agent-source-1",
      targetProfileIds: [
        "agt_33333333-3333-4333-8333-333333333333",
        secondTargetProfileId,
      ],
    });
    const firstOutboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
      sourceClientMessageId: null,
      sourceEventId: sourceSignal.id,
    });
    const secondOutboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
      sourceClientMessageId: null,
      sourceEventId: sourceSignal.id,
      targetProfileId: secondTargetProfileId,
    });

    const response = await readActiveWakeProgressForTest({
      outboxRows: [firstOutboxRecord, secondOutboxRecord],
      sourceSignals: [sourceSignal],
    });

    expect(
      response.items.map((item) => ({
        clientMessageId: item.clientMessageId,
        dispatchId: item.dispatchId,
        sourceSignalId: item.sourceSignalId,
        targetProfileId: item.targetProfileId,
      }))
    ).toEqual([
      {
        clientMessageId: null,
        dispatchId: firstOutboxRecord.dispatchId,
        sourceSignalId: sourceSignal.id,
        targetProfileId: firstOutboxRecord.targetProfileId,
      },
      {
        clientMessageId: null,
        dispatchId: secondOutboxRecord.dispatchId,
        sourceSignalId: sourceSignal.id,
        targetProfileId: secondTargetProfileId,
      },
    ]);
  });

  it("projects active RuntimeCoordinator summary without rebuilding dispatch traces", async () => {
    const readSpaceWakeProgress = vi.fn();
    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          createdAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
          dispatchId: "dispatch-summary-1",
          executionStatus: "running",
          sourceClientMessageId: "client-message-summary-1",
          sourceEventId: "signal-summary-1",
          targetProfileId: "agent-summary-1",
          updatedAtMs: Date.UTC(2026, 2, 4, 0, 12, 0),
        },
      ],
      includeTiming: true,
      includeWakeStopEligibility: false,
      outboxRows: [],
      readSpaceWakeProgress,
    });

    expect(readSpaceWakeProgress).not.toHaveBeenCalled();
    expect(response.items).toEqual([
      expect.objectContaining({
        clientMessageId: "client-message-summary-1",
        dispatchId: "dispatch-summary-1",
        phase: "running",
        sourceSignalId: "signal-summary-1",
        startedAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
        targetProfileId: "agent-summary-1",
        terminal: false,
      }),
    ]);
  });

  it("keeps a removed Agent Profile's frozen name on its still-active Wake", async () => {
    const targetProfileId = "agt_418831cf-a76d-4073-b606-de76b2f315ce";
    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          createdAtMs: Date.UTC(2026, 7, 25, 9, 42, 22),
          dispatchId: "dispatch-deleted-agent-1",
          executionStatus: "running",
          sourceClientMessageId: "client-message-deleted-agent-1",
          sourceEventId: "signal-deleted-agent-1",
          targetProfileId,
          updatedAtMs: Date.UTC(2026, 7, 25, 15, 25, 3),
        },
      ],
      memberRows: [
        {
          added_at: Date.UTC(2026, 7, 24, 0, 0, 0),
          added_by_display_name_snapshot: "Jiaqi",
          added_by_owner_user_id: "owner-jiaqi",
          added_by_profile_id: "human-jiaqi",
          controller_ref_snapshot: "builtin:codex",
          created_at: Date.UTC(2026, 7, 24, 0, 0, 0),
          first_entered_at: null,
          last_entered_at: null,
          member_source: "joined_directly",
          owner_name_snapshot: "Jiaqi",
          owner_user_id_snapshot: "owner-jiaqi",
          profile_id: targetProfileId,
          profile_kind_snapshot: "agent",
          profile_name_snapshot: "Clico Codex",
          removal_reason: "profile_deleted",
          removed_at: Date.UTC(2026, 7, 25, 13, 35, 58),
          removed_by_owner_user_id: "owner-jiaqi",
          removed_by_profile_id: "human-jiaqi",
          space_id: "space-1",
          status: "removed",
          updated_at: Date.UTC(2026, 7, 25, 13, 35, 58),
        },
      ],
      outboxRows: [],
    });

    expect(response.items).toEqual([
      expect.objectContaining({
        message: "@Clico Codex is working on this computer...",
        targetLabel: "@Clico Codex",
        targetProfileId,
      }),
    ]);
  });

  it("omits active Wake timing unless the caller opts in", async () => {
    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          createdAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
          dispatchId: "dispatch-summary-without-timing-1",
          executionStatus: "running",
          sourceClientMessageId: "client-message-summary-without-timing-1",
          sourceEventId: "signal-summary-without-timing-1",
          targetProfileId: "agent-summary-without-timing-1",
          updatedAtMs: Date.UTC(2026, 2, 4, 0, 12, 0),
        },
      ],
      includeWakeStopEligibility: false,
      outboxRows: [],
      readSpaceWakeProgress: vi.fn(),
    });

    expect(response.items[0]).not.toHaveProperty("startedAtMs");
  });

  it("projects a pending local agent interaction only through the authenticated Wake progress view", async () => {
    const readPendingInteraction = vi.fn(async () => ({
      canRespond: true,
      expiresAtMs: Date.now() + 60_000,
      interactionId: "interaction-1",
      kind: "permission" as const,
      request: {
        description: "The local agent needs permission to run this command.",
        expiresAtMs: Date.now() + 60_000,
        interactionId: "interaction-1",
        kind: "permission" as const,
        options: [
          {
            intent: "allow_once" as const,
            label: "Allow once",
            optionId: "allow-once",
          },
        ],
        requestedAtMs: Date.now(),
        subject: {
          command: "pnpm check",
          type: "command" as const,
        },
        title: "Allow this command?",
        v: 1 as const,
      },
      requestedAtMs: Date.now(),
    }));
    const response = await readActiveWakeProgressForTest({
      actorOwnerUserId: "owner-1",
      executionRows: [
        {
          dispatchId: "dispatch-interaction-1",
          executionStatus: "running",
          sourceClientMessageId: "client-message-interaction-1",
          sourceEventId: "signal-interaction-1",
          targetProfileId: "agent-interaction-1",
        },
      ],
      outboxRows: [],
      readWakeProgressPendingAgentInteraction: readPendingInteraction,
    });

    expect(readPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorOwnerUserId: "owner-1",
        execution: expect.objectContaining({
          runtimeCoordinatorExecutionId: "rce-dispatch-interaction-1",
        }),
      })
    );
    expect(response.items[0]).toMatchObject({
      pendingInteraction: {
        canRespond: true,
        interactionId: "interaction-1",
        kind: "permission",
      },
      runtimeCoordinatorExecutionId: "rce-dispatch-interaction-1",
    });
  });

  it.each([
    ["created", "request_sent"],
    ["delivery_pending", "request_sent"],
    ["delivery_accepted", "connecting"],
  ] as const)("keeps RuntimeCoordinator status authoritative when its summary is %s", async (executionStatus, expectedPhase) => {
    const readSpaceWakeProgress = vi.fn();
    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          dispatchId: "dispatch-native-summary-1",
          dispatchStatus: "dispatching",
          executionStatus,
          latestAttemptStatus: "waiting_result",
          sourceClientMessageId: "client-message-native-summary-1",
          sourceEventId: "signal-native-summary-1",
          targetProfileId: "agent-native-summary-1",
        },
      ],
      includeWakeStopEligibility: false,
      outboxRows: [],
      readSpaceWakeProgress,
    });

    expect(readSpaceWakeProgress).not.toHaveBeenCalled();
    expect(response.items).toEqual([
      expect.objectContaining({
        clientMessageId: "client-message-native-summary-1",
        dispatchId: "dispatch-native-summary-1",
        phase: expectedPhase,
        sourceSignalId: "signal-native-summary-1",
        targetProfileId: "agent-native-summary-1",
        terminal: false,
      }),
    ]);
  });

  it("does not translate Dispatch Ledger waiting_result into active execution", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });
    const readSpaceWakeProgress = vi.fn();
    const response = await readActiveWakeProgressForTest({
      activeDispatchRows: [
        {
          dispatchId: outboxRecord.dispatchId,
          latestAttemptStatus: "waiting_result",
          sourceEventId: outboxRecord.sourceEventId,
          targetProfileId: outboxRecord.targetProfileId,
        },
      ],
      includeWakeStopEligibility: false,
      outboxRows: [outboxRecord],
      readSpaceWakeProgress,
    });

    expect(readSpaceWakeProgress).not.toHaveBeenCalled();
    expect(response.items).toEqual([
      expect.objectContaining({
        clientMessageId: outboxRecord.sourceClientMessageId,
        dispatchId: outboxRecord.dispatchId,
        phase: "request_sent",
        sourceSignalId: outboxRecord.sourceEventId,
        targetProfileId: outboxRecord.targetProfileId,
        terminal: false,
      }),
    ]);
  });

  it("uses accepted native delivery as hosted execution truth", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });
    const response = await readActiveWakeProgressForTest({
      activeNativeDeliveryRows: [
        {
          dispatchId: outboxRecord.dispatchId,
          nativeDeliveryStatus: "accepted",
          sourceEventId: outboxRecord.sourceEventId,
          targetProfileId: outboxRecord.targetProfileId,
        },
      ],
      includeWakeStopEligibility: false,
      outboxRows: [outboxRecord],
    });

    expect(response.items).toEqual([
      expect.objectContaining({
        clientMessageId: outboxRecord.sourceClientMessageId,
        dispatchId: outboxRecord.dispatchId,
        phase: "running",
        sourceSignalId: outboxRecord.sourceEventId,
        targetProfileId: outboxRecord.targetProfileId,
        terminal: false,
      }),
    ]);
  });

  it("rehydrates accepted hosted execution after its handed-off outbox record leaves the active set", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: "client-message-hosted-1",
      id: "signal-hosted-1",
    });
    const acceptedAtMs = Date.UTC(2026, 2, 4, 0, 2, 0);
    const response = await readActiveWakeProgressForTest({
      activeNativeDeliveryRows: [
        {
          acceptedAtMs,
          dispatchId: "dispatch-hosted-1",
          nativeDeliveryStatus: "accepted",
          sourceClientMessageId: "client-message-hosted-1",
          sourceEventId: sourceSignal.id,
          targetProfileId: "agent-hosted-1",
          updatedAtMs: acceptedAtMs + 1000,
        },
      ],
      includeTiming: true,
      includeWakeStopEligibility: false,
      outboxRows: [],
      sourceSignals: [sourceSignal],
    });

    expect(response.items).toEqual([
      expect.objectContaining({
        clientMessageId: "client-message-hosted-1",
        dispatchId: "dispatch-hosted-1",
        phase: "running",
        sourceSignalId: "signal-hosted-1",
        startedAtMs: acceptedAtMs,
        targetProfileId: "agent-hosted-1",
        terminal: false,
      }),
    ]);
  });

  it("rehydrates Stop-enabled hosted progress without an active outbox record", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: "client-message-hosted-stop-1",
      id: "signal-hosted-stop-1",
    });
    const detailedItem = {
      clientMessageId: "client-message-hosted-stop-1",
      dispatchId: "dispatch-hosted-stop-1",
      failureReasonCode: null,
      message: "@agent-hosted-stop-1 is working...",
      phase: "running" as const,
      sourceSignalId: sourceSignal.id,
      targetLabel: "@agent-hosted-stop-1",
      targetProfileId: "agent-hosted-stop-1",
      terminal: false,
      updatedAtMs: Date.UTC(2026, 2, 4, 0, 3, 0),
      wakeStopEligibility: {
        controlMode: "cancel" as const,
        reasonCode: null,
        reliability: "native_cancel" as const,
        status: "eligible" as const,
      },
    };
    const readSpaceWakeProgress = vi.fn().mockResolvedValue({
      query: {
        clientMessageId: "client-message-hosted-stop-1",
        spaceId: "space-1",
        targetProfileId: "agent-hosted-stop-1",
      },
      items: [detailedItem],
    });

    const response = await readActiveWakeProgressForTest({
      activeNativeDeliveryRows: [
        {
          dispatchId: "dispatch-hosted-stop-1",
          nativeDeliveryStatus: "accepted",
          sourceClientMessageId: "client-message-hosted-stop-1",
          sourceEventId: sourceSignal.id,
          targetProfileId: "agent-hosted-stop-1",
        },
      ],
      includeWakeStopEligibility: true,
      outboxRows: [],
      readSpaceWakeProgress,
      sourceSignals: [sourceSignal],
    });

    expect(readSpaceWakeProgress).toHaveBeenCalledWith({
      actorOwnerUserId: undefined,
      clientMessageId: "client-message-hosted-stop-1",
      includeTiming: false,
      includeWakeStopEligibility: true,
      sourceSignalId: "signal-hosted-stop-1",
      targetProfileId: "agent-hosted-stop-1",
    });
    expect(response.items).toEqual([detailedItem]);
  });

  it("omits terminal hosted callback publication uncertainty from active Wake progress", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });
    const response = await readActiveWakeProgressForTest({
      activeNativeDeliveryRows: [
        {
          callbackReceivedAtMs: Date.UTC(2026, 2, 4, 0, 3, 0),
          dispatchId: outboxRecord.dispatchId,
          finalPublicationState: "outcome_unknown",
          nativeDeliveryStatus: "accepted",
          sourceEventId: outboxRecord.sourceEventId,
          targetProfileId: outboxRecord.targetProfileId,
        },
      ],
      includeWakeStopEligibility: false,
      outboxRows: [outboxRecord],
    });

    expect(response.items).toEqual([]);
  });

  it("does not rebuild a selector already closed by a visible final reply", async () => {
    const targetProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const sourceSignal = createWakeProgressSourceSignal({});
    const finalReply = {
      ...createSignal(),
      id: "sig-final-reply-1",
      profile: {
        kind: "agent",
        profileId: targetProfileId,
        profileName: "Codex Agent",
      },
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-terminal-summary-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId,
        },
      },
    } as const satisfies Extract<SignalEnvelope, { type: "signal.text" }>;
    const readSpaceWakeProgress = vi.fn().mockResolvedValue({
      query: {
        clientMessageId: "client-message-1",
        spaceId: "space-1",
        targetProfileId,
      },
      items: [],
    });

    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          dispatchId: "dispatch-terminal-summary-1",
          executionStatus: "result_accepted",
          sourceClientMessageId: "client-message-1",
          sourceEventId: sourceSignal.id,
          targetProfileId,
        },
      ],
      includeWakeStopEligibility: true,
      outboxRows: [],
      readSpaceWakeProgress,
      sourceSignals: [sourceSignal, finalReply],
    });

    expect(readSpaceWakeProgress).not.toHaveBeenCalled();
    expect(response.items).toEqual([]);
  });

  it("reads independent active Wake progress selectors concurrently", async () => {
    let activeReads = 0;
    let maximumActiveReads = 0;
    let releaseReads: (() => void) | undefined;
    let reportConcurrentReads: (() => void) | undefined;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const concurrentReadsStarted = new Promise<void>((resolve) => {
      reportConcurrentReads = resolve;
    });

    const responsePromise = readActiveWakeProgressForTest({
      executionRows: [
        {
          dispatchId: "dispatch-concurrent-1",
          sourceClientMessageId: "client-message-concurrent-1",
          sourceEventId: "signal-concurrent-1",
          targetProfileId: "agent-concurrent-1",
        },
        {
          dispatchId: "dispatch-concurrent-2",
          sourceClientMessageId: "client-message-concurrent-2",
          sourceEventId: "signal-concurrent-2",
          targetProfileId: "agent-concurrent-2",
        },
      ],
      includeWakeStopEligibility: true,
      outboxRows: [],
      readSpaceWakeProgress: async (input) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        if (activeReads === 2) {
          reportConcurrentReads?.();
        }
        await readsReleased;
        activeReads -= 1;
        return {
          query: {
            clientMessageId: input.clientMessageId ?? null,
            spaceId: "space-1",
            targetProfileId: input.targetProfileId ?? null,
          },
          items: [],
        };
      },
    });

    const startedConcurrently = await Promise.race([
      concurrentReadsStarted.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 100);
      }),
    ]);
    releaseReads?.();
    await responsePromise;

    expect(startedConcurrently).toBe(true);
    expect(maximumActiveReads).toBeGreaterThan(1);
  });

  it("projects active RuntimeCoordinator Wake progress by source signal when no client message ID exists", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: null,
      id: "sig-agent-source-1",
    });
    const executionRow = {
      dispatchStatus: "succeeded",
      dispatchId: "dispatch-runtime-1",
      executionStatus: "result_accepted",
      sourceClientMessageId: null,
      sourceEventId: sourceSignal.id,
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    };

    const response = await readActiveWakeProgressForTest({
      executionRows: [executionRow],
      outboxRows: [],
      sourceSignals: [sourceSignal],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      clientMessageId: null,
      dispatchId: executionRow.dispatchId,
      phase: "publishing",
      sourceSignalId: sourceSignal.id,
      targetProfileId: executionRow.targetProfileId,
      terminal: false,
    });
  });

  it("uses the newest dispatch for a source-signal target selector", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: null,
      id: "sig-agent-source-1",
    });
    const targetProfileId = "agt_33333333-3333-4333-8333-333333333333";

    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          dispatchId: "dispatch-selector",
          executionStatus: "result_accepted",
          sourceClientMessageId: null,
          sourceEventId: sourceSignal.id,
          targetProfileId,
        },
      ],
      includeWakeStopEligibility: true,
      lookupRows: [
        {
          dispatchId: "dispatch-old",
          firstSeenAtMs: Date.UTC(2026, 2, 4, 0, 0, 0),
          sourceClientMessageId: null,
          sourceEventId: sourceSignal.id,
          targetProfileId,
        },
        {
          dispatchId: "dispatch-new",
          firstSeenAtMs: Date.UTC(2026, 2, 4, 0, 1, 0),
          sourceClientMessageId: null,
          sourceEventId: sourceSignal.id,
          targetProfileId,
        },
      ],
      outboxRows: [],
      sourceSignals: [sourceSignal],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      dispatchId: "dispatch-new",
      sourceSignalId: sourceSignal.id,
      targetProfileId,
    });
  });

  it("does not project failed terminal RuntimeCoordinator executions as active Wake progress", async () => {
    const sourceSignal = createWakeProgressSourceSignal({
      clientMessageId: null,
      id: "sig-agent-source-1",
    });

    const response = await readActiveWakeProgressForTest({
      executionRows: [
        {
          dispatchId: "dispatch-terminal",
          executionStatus: "failed_terminal",
          sourceClientMessageId: null,
          sourceEventId: sourceSignal.id,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        },
      ],
      outboxRows: [],
      sourceSignals: [sourceSignal],
    });

    expect(response.items).toEqual([]);
  });

  it("keeps a RuntimeCoordinator waiting boundary visible in active Wake progress after reload", async () => {
    const outboxRecord = createWakeProgressOutboxRecord({
      outboxStatus: "handed_off",
    });

    const response = await readActiveWakeProgressForTest({
      headLifecycleReadStatus: "waiting",
      includeWakeStopEligibility: true,
      outboxRows: [outboxRecord],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      clientMessageId: "client-message-1",
      dispatchId: outboxRecord.dispatchId,
      failureReasonCode: null,
      message: "Waiting for OpenMeld Service to connect for @Codex Agent.",
      phase: "retrying",
      terminal: false,
    });
  });

  it("omits OpenMeld-owned pre-agent Wake Stop eligibility when active Wake progress does not opt in", async () => {
    const response = await readActiveWakeProgressForTest({
      includeWakeStopEligibility: false,
      outboxRows: [
        createWakeProgressOutboxRecord({ outboxStatus: "handed_off" }),
      ],
    });

    expect(response.items).toHaveLength(1);
    const item = response.items[0];
    expect(item).toMatchObject({
      phase: "request_sent",
      terminal: false,
    });
    expect(item && "wakeStopEligibility" in item).toBe(false);
  });

  it("fails closed when pre-agent Wake Stop head lifecycle cannot be read", async () => {
    const response = await readActiveWakeProgressForTest({
      headLifecycleReadStatus: "unavailable",
      includeWakeStopEligibility: true,
      outboxRows: [
        createWakeProgressOutboxRecord({ outboxStatus: "handed_off" }),
      ],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      phase: "request_sent",
      terminal: false,
      wakeStopEligibility: {
        controlMode: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_unavailable",
        reliability: "unsupported",
        status: "not_eligible",
      },
    });
  });

  it("does not project pre-agent Wake Stop eligibility after queued Wake progress is stopped", async () => {
    const response = await readActiveWakeProgressForTest({
      includeWakeStopEligibility: true,
      outboxRows: [
        createWakeProgressOutboxRecord({ outboxStatus: "cancelled" }),
      ],
      headLifecycleReadStatus: "stopped",
    });

    expect(response.items).toEqual([]);
  });

  it("keeps produced replies in publishing progress until a final visible message exists", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createWakeProgressReplyProducedTrace({
        finalVisibleMessage: null,
        replySignal: {
          createdAt: "2026-03-04T00:00:00.000Z",
          factSource: "space_signal_by_published_signal_id",
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Codex Agent",
          signalId: "sig-reply-1",
          text: "Done.",
        },
      }),
      [],
      {
        latestAttemptErrorCode: null,
        latestAttemptStatus: "succeeded",
        status: "succeeded",
      }
    );

    expect(item).toMatchObject({
      phase: "publishing",
      message: "Posting final message for @Codex Agent...",
      terminal: false,
    });
  });

  it("returns final replied Wake progress only after the final visible reply is confirmed", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createWakeProgressReplyProducedTrace({
        finalVisibleMessage: {
          createdAt: "2026-03-04T00:00:00.000Z",
          dispatchId: "dispatch-head-progress-1",
          factSource: "space_signal_by_published_signal_id",
          noticeType: null,
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Codex Agent",
          reasonCode: null,
          signalId: "sig-reply-1",
          signalType: "signal.text",
          statusType: null,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          text: "Done.",
        },
        replySignal: {
          createdAt: "2026-03-04T00:00:00.000Z",
          factSource: "space_signal_by_published_signal_id",
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Codex Agent",
          signalId: "sig-reply-1",
          text: "Done.",
        },
      }),
      [],
      {
        latestAttemptErrorCode: null,
        latestAttemptStatus: "succeeded",
        status: "succeeded",
      }
    );

    expect(item).toMatchObject({
      phase: "replied",
      message: "@Codex Agent replied.",
      terminal: true,
    });
  });

  it("returns terminal failed Wake progress for a visible Remote Agent failure text", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      {
        ...createWakeProgressReplyProducedTrace({
          finalVisibleMessage: {
            createdAt: "2026-08-26T03:01:25.000Z",
            dispatchId: "dispatch-head-progress-1",
            factSource: "space_signal_by_published_signal_id",
            noticeType: null,
            profileId: "agt_33333333-3333-4333-8333-333333333333",
            profileKind: "agent",
            profileName: "Center Agent",
            reasonCode: "remote_agent.turn_not_completed",
            signalId: "sig-remote-agent-failure-1",
            signalType: "signal.text",
            statusType: null,
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
            text: "Center Agent could not complete this request.",
          },
          replySignal: {
            createdAt: "2026-08-26T03:01:25.000Z",
            factSource: "space_signal_by_published_signal_id",
            profileId: "agt_33333333-3333-4333-8333-333333333333",
            profileKind: "agent",
            profileName: "Center Agent",
            signalId: "sig-remote-agent-failure-1",
            text: "Center Agent could not complete this request.",
          },
        }),
        dispatch: {
          ...createWakeProgressReplyProducedTrace({}).dispatch,
          status: "failed_terminal",
        },
        latestAttempt: {
          ...createWakeProgressReplyProducedTrace({}).latestAttempt,
          errorCode: "remote_agent.turn_not_completed",
          errorMessage: "Remote Agent turn did not complete.",
          status: "failed_terminal",
        },
      } as SpaceDispatchTraceSnapshot,
      [],
      {
        latestAttemptErrorCode: "remote_agent.turn_not_completed",
        latestAttemptStatus: "failed_terminal",
        status: "failed_terminal",
      }
    );

    expect(item).toMatchObject({
      failureReasonCode: "remote_agent.turn_not_completed",
      phase: "failed",
      terminal: true,
    });
    expect(item.message).not.toContain("Posting");
  });

  it("keeps publication retrying visible as publishing progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createWakeProgressReplyProducedTrace({
        resultInbox: {
          acceptedAt: "2026-03-04T00:00:00.000Z",
          attemptId: "attempt-1",
          daemonSessionId: "daemon-session-1",
          dispatchId: "dispatch-head-progress-1",
          factSource: "dispatch_result_inbox",
          leaseEpoch: 1,
          publicationErrorCode: "space.signal.persist_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed",
          resultKey: "result-key-1",
          submittedConnectionGeneration: 1,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          taskId: "task-1",
          updatedAt: "2026-03-04T00:00:00.000Z",
        },
      }),
      [],
      {
        latestAttemptErrorCode: null,
        latestAttemptStatus: "succeeded",
        status: "succeeded",
      }
    );

    expect(item).toMatchObject({
      failureReasonCode: "final_visible_outcome.publication_retrying",
      phase: "publishing",
      message: "Posting final message for @Codex Agent...",
      terminal: false,
    });
  });

  it("returns publication unresolved as visible failed progress instead of clearing the Wake", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      createWakeProgressReplyProducedTrace({
        resultInbox: {
          acceptedAt: "2026-03-04T00:00:00.000Z",
          attemptId: "attempt-1",
          daemonSessionId: "daemon-session-1",
          dispatchId: "dispatch-head-progress-1",
          factSource: "dispatch_result_inbox",
          leaseEpoch: 1,
          publicationErrorCode: null,
          publishedSignalId: "sig-missing-final",
          publishState: "reply_published",
          resultKey: "result-key-1",
          submittedConnectionGeneration: 1,
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          taskId: "task-1",
          updatedAt: "2026-03-04T00:00:00.000Z",
        },
      }),
      [],
      {
        latestAttemptErrorCode: null,
        latestAttemptStatus: "succeeded",
        status: "succeeded",
      }
    );

    expect(item).toMatchObject({
      failureReasonCode: "final_visible_outcome.publication_unresolved",
      phase: "failed",
      message: "OpenMeld could not post the final message for @Codex Agent.",
      terminal: true,
    });
  });

  it("lets final terminal failure notices dominate RuntimeCoordinator head no-execution progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      {
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorHeadLifecycle: {
          factSource: "runtime_coordinator_head_lifecycle",
          readStatus: "found",
          noExecutionDecision: {
            decidedAt: "2026-03-04T00:00:00.000Z",
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.owner_mismatch",
            source: "dispatch_preflight",
            userRecoveryAction: "repair_agent_binding",
          },
          publicationIntent: {
            intentId: "rcpi:no_execution:twl-1",
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAt: "2026-03-04T00:00:00.000Z",
            reasonCode: "agent_profile_binding.owner_mismatch",
            status: "ready_for_phase_6",
            userRecoveryAction: "repair_agent_binding",
          },
        },
      } as unknown as SpaceDispatchTraceSnapshot,
      [
        {
          actorName: "Codex Agent",
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          dispatchId: "dispatch-head-progress-1",
          reasonCode: "daemon.profile.offline",
          replyToSignalId: "sig-source-1",
          updatedAtMs: Date.UTC(2026, 2, 4, 0, 0, 1),
        },
      ]
    );

    expect(item).toMatchObject({
      failureReasonCode: "daemon.profile.offline",
      phase: "failed",
      message: "@Codex Agent is offline on this computer.",
      terminal: true,
    });
  });

  it("lets final terminal failure notices dominate RuntimeCoordinator waiting boundary progress", async () => {
    const item = await buildWakeProgressItemFromLookupTrace(
      {
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorHeadLifecycle: {
          factSource: "runtime_coordinator_head_lifecycle",
          readStatus: "found",
          waitingBoundary: {
            hardDeadlineAt: "2026-03-04T00:05:00.000Z",
            reasonCode: "daemon.profile.offline",
            softDeadlineAt: "2026-03-04T00:00:01.000Z",
            startedAt: "2026-03-04T00:00:00.000Z",
            status: "waiting_for_runtime",
          },
        },
      } as unknown as SpaceDispatchTraceSnapshot,
      [
        {
          actorName: "Codex Agent",
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          dispatchId: "dispatch-head-progress-1",
          reasonCode: "daemon.profile.offline",
          replyToSignalId: "sig-source-1",
          updatedAtMs: Date.UTC(2026, 2, 4, 0, 5, 1),
        },
      ]
    );

    expect(item).toMatchObject({
      failureReasonCode: "daemon.profile.offline",
      phase: "failed",
      message: "@Codex Agent is offline on this computer.",
      terminal: true,
    });
    expect(item.message).not.toContain("waiting");
    expect(item.message).not.toContain("Still");
  });

  it("publishes text signal and schedules a single outbox flush sender", async () => {
    const signal = createSignal();
    const message: OpenMeldDaemonDispatchQueueMessage = {
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      targetProfileId: "agt-target",
      dispatchChainId: "chain-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "hash-1",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only" as const,
      ruleSource: "registry" as const,
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: "task-1",
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      sourceSignalSnapshot: {
        text: "hello",
        profileId: "human-1",
        profileKind: "human",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "idempotency-1",
      enqueuedAtMs: Date.UTC(2026, 2, 4, 0, 0, 0),
      v: 2 as const,
    };
    const waitUntil = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const recordHumanActivity = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();

    await publishTextSignalUseCase({
      signal,
      persistSignalWithOptionalOutbox: async () => ({
        dispatchMessages: [message],
        duplicateFinalReplyBlocked: false,
        persistedSignal: true,
      }),
      flushPendingDispatchOutbox: flush,
      recordHumanActivity,
      waitUntil,
      broadcast,
    });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(recordHumanActivity).toHaveBeenCalledWith(signal);
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledWith(signal);
  });

  it("does not record Agent-authored text as Human activity", async () => {
    const signal: SignalEnvelope = {
      ...createSignal(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex",
      },
    };
    const waitUntil = vi.fn();
    const recordHumanActivity = vi.fn().mockResolvedValue(undefined);

    await publishTextSignalUseCase({
      signal,
      persistSignalWithOptionalOutbox: async () => ({
        dispatchMessages: [],
        duplicateFinalReplyBlocked: false,
        persistedSignal: true,
      }),
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      recordHumanActivity,
      waitUntil,
      broadcast: vi.fn(),
    });

    expect(recordHumanActivity).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("publishes malformed internal text signals without crashing on activation target logging", async () => {
    const signal = {
      ...createSignal(),
      data: {
        text: "hello",
        messageEnvelope: {
          text: "hello",
        },
      },
    } as unknown as SignalEnvelope;
    const waitUntil = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();

    await expect(
      publishTextSignalUseCase({
        signal,
        persistSignalWithOptionalOutbox: async () => ({
          dispatchMessages: [],
          duplicateFinalReplyBlocked: false,
          persistedSignal: true,
        }),
        flushPendingDispatchOutbox: flush,
        waitUntil,
        broadcast,
      })
    ).resolves.toBeUndefined();

    expect(broadcast).toHaveBeenCalledWith(signal);
  });

  it("treats a missing planner snapshot as best-effort and keeps publishing successful", async () => {
    const signal = createSignal();
    const persistNonReadyDispatchPlannerDecisions = vi.fn();

    await expect(
      persistPostPersistDispatchPlannerEvidenceBestEffort({
        db: undefined,
        nonReadyDecisions: [],
        plannerContext: null,
        persistNonReadyDispatchPlannerDecisions,
        signal,
        spaceId: "space-1",
      })
    ).resolves.toBeUndefined();

    expect(persistNonReadyDispatchPlannerDecisions).not.toHaveBeenCalled();
  });

  it("persists the provided planner snapshot without re-reading live state", async () => {
    const signal: Extract<SignalEnvelope, { type: "signal.text" }> = {
      ...createSignal(),
      type: "signal.text",
      data: {
        meta: {
          clientMessageId: "client-message-1",
        },
        text: "hello",
      },
    };
    const persistNonReadyDispatchPlannerDecisions = vi
      .fn()
      .mockResolvedValue(undefined);
    const plannerContext = {
      senderProfileId: "human-1",
      sourceEventId: "evt-1",
      spaceContract: {} as never,
    };
    const nonReadyDecisions = [
      {
        targetProfileId: "agt-1",
        sourceEventId: "evt-1",
        dispatchId: "dispatch-1",
        status: "blocked" as const,
        errorCode: "route.not_registered",
        ruleSource: "space" as const,
        ruleId: "space.rule.1",
        ruleReason: "route missing",
      },
    ];

    await expect(
      persistPostPersistDispatchPlannerEvidenceBestEffort({
        db: undefined,
        nonReadyDecisions,
        plannerContext,
        persistNonReadyDispatchPlannerDecisions,
        signal,
        spaceId: "space-1",
      })
    ).resolves.toBeUndefined();

    expect(persistNonReadyDispatchPlannerDecisions).toHaveBeenCalledWith({
      db: undefined,
      decisions: nonReadyDecisions,
      sourceClientMessageId: "client-message-1",
      sourceEventId: "evt-1",
      spaceId: "space-1",
    });
  });

  it("treats planner evidence persistence failures as best-effort and keeps publishing successful", async () => {
    const signal = createSignal();
    const warn = vi.fn();
    const plannerContext = {
      senderProfileId: "human-1",
      sourceEventId: "evt-1",
      spaceContract: {} as never,
    };
    const nonReadyDecisions = [
      {
        targetProfileId: "agt-1",
        sourceEventId: "evt-1",
        dispatchId: "dispatch-1",
        status: "blocked" as const,
        errorCode: "route.not_registered",
        ruleSource: "space" as const,
        ruleId: "space.rule.1",
        ruleReason: "route missing",
      },
    ];
    const persistNonReadyDispatchPlannerDecisions = vi
      .fn()
      .mockRejectedValue(new Error("planner evidence persist failed"));

    await expect(
      persistPostPersistDispatchPlannerEvidenceBestEffort({
        db: undefined,
        logger: { warn },
        nonReadyDecisions,
        plannerContext,
        persistNonReadyDispatchPlannerDecisions,
        signal,
        spaceId: "space-1",
      })
    ).resolves.toBeUndefined();

    expect(persistNonReadyDispatchPlannerDecisions).toHaveBeenCalledWith({
      db: undefined,
      decisions: nonReadyDecisions,
      sourceEventId: "evt-1",
      spaceId: "space-1",
    });
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.space.dispatch_planner_evidence_post_persist_failed]",
      expect.objectContaining({
        error: "planner evidence persist failed",
        senderProfileId: "human-1",
        sourceEventId: "evt-1",
        spaceId: "space-1",
      })
    );
  });

  it("does not schedule post-persist planner work when the signal was not persisted", async () => {
    const signal = createSignal();
    const waitUntil = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const recordHumanActivity = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();

    await publishTextSignalUseCase({
      signal,
      persistSignalWithOptionalOutbox: async () => ({
        dispatchMessages: [],
        duplicateFinalReplyBlocked: false,
        persistedSignal: false,
      }),
      flushPendingDispatchOutbox: flush,
      recordHumanActivity,
      waitUntil,
      broadcast,
    });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(recordHumanActivity).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("persists and broadcasts presence signal without outbox side effects", () => {
    const signal = createSignal();
    const broadcast = vi.fn();
    const persistSignal = vi.fn();

    publishPresenceSignalUseCase({
      signal,
      persistSignal,
      broadcast,
    });

    expect(persistSignal).toHaveBeenCalledWith(signal);
    expect(broadcast).toHaveBeenCalledWith(signal);
  });

  it("does not broadcast a signal that was rejected by final outcome persistence", () => {
    const signal = createSignal();
    const broadcast = vi.fn();
    const persistSignal = vi.fn(() => ({ persistedSignal: false }));

    publishPresenceSignalUseCase({
      signal,
      persistSignal,
      broadcast,
    });

    expect(persistSignal).toHaveBeenCalledWith(signal);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
