import type {
  PresenceEnvelope,
  SignalEnvelope,
  SignalTextEnvelope,
  SpaceLiveSignalFrame,
} from "@openmeld/protocol";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
} from "../src/shared/context/openmeld-context";
import { buildDefaultSpaceContract } from "../src/space/application/space-contract-service";
import {
  type SignalTextBuildOptions,
  SPACE_WAKE_HANDOFF_SEED_FAILED_ERROR_CODE,
  SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
  SpaceSignalAuthoringError,
} from "../src/space/application/space-signal-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  createDispatchOutboxRecord,
  type OpenMeldDaemonDispatchOutboxRecoveryCandidate,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { TARGET_BYTES } from "../src/space/infrastructure/sql/space-retention-repo";
import { resolveDispatchPlannerDecisionsForSignal } from "../src/space/rules/mention/mention-dispatch-rules";
import {
  resolveSignalsPageFromEntries,
  Space,
} from "../src/space/transport/do/space";
import {
  acceptSpaceWebSocketHello,
  createPendingSpaceWebSocketSession,
  type SpaceQueuedWebSocketMessage,
} from "../src/space/transport/do/space-websocket-session";

type SignalPublisherTarget = {
  assertRemoteAgentFinalReplyWasNotStopped?: (
    signal: SignalEnvelope,
    signalContext?: SignalPublishContext
  ) => void;
  persistSignal: (signal: SignalEnvelope) => Promise<void>;
  persistSignalWithOptionalOutbox: (
    signal: SignalEnvelope,
    createOutboxRecord: boolean
  ) => PersistSignalWithOptionalOutboxResult;
  enqueueDispatchMessageWithRetry: (message: {
    dispatchId: string;
  }) => Promise<void>;
  flushPendingDispatchOutbox: () => Promise<void>;
  recordOrganizationMemberHumanActivity: (
    signal: SignalEnvelope
  ) => Promise<void>;
  broadcast?: (signal: SignalEnvelope) => void;
  broadcastSignal?: (
    signal: SignalEnvelope,
    signalContext?: unknown,
    history?: unknown
  ) => void;
  ctx: {
    waitUntil: (promise: Promise<void>) => void;
  };
  spaceId: string;
  durableObjectId: string;
};

type PersistSignalWithOptionalOutboxResult = {
  dispatchMessages: OpenMeldDaemonDispatchQueueMessage[];
  duplicateFinalReplyBlocked: boolean;
  persistedSignal: boolean;
};

type DispatchOutboxRecord = ReturnType<
  typeof import("../src/space/infrastructure/outbox/dispatch-outbox-repo").createDispatchOutboxRecord
>;

type DispatchReadyDecision = {
  dispatchId: string;
  sourceEventId: string;
  status: "dispatch_ready";
  targetProfileId: string;
  ruleSource: "system" | "space" | "profile" | "registry";
  ruleId: string;
  ruleReason: string;
};

type DispatchOutboxSubmitReason =
  | "flush_pending_outbox"
  | "runtime_coordinator_head_waiting_recovery";

const createPersistSignalWithOptionalOutboxResult = (
  input: Partial<PersistSignalWithOptionalOutboxResult> = {}
): PersistSignalWithOptionalOutboxResult => {
  return {
    dispatchMessages: input.dispatchMessages ?? [],
    duplicateFinalReplyBlocked: input.duplicateFinalReplyBlocked ?? false,
    persistedSignal: input.persistedSignal ?? true,
  };
};

const publishTextSignal = (
  Space.prototype as unknown as {
    publishTextSignal(
      this: SignalPublisherTarget,
      signal: SignalEnvelope
    ): Promise<void>;
  }
).publishTextSignal;

const publishPresenceSignal = (
  Space.prototype as unknown as {
    publishPresenceSignal(
      this: SignalPublisherTarget,
      signal: SignalEnvelope
    ): void;
  }
).publishPresenceSignal;

const maybeEmitRetentionWarningSignal = (
  Space.prototype as unknown as {
    maybeEmitRetentionWarningSignal(
      this: {
        lastRetentionWarningAtMs: number;
        spaceId: string;
        durableObjectId: string;
        emitRetentionWarningSignal: () => void;
      },
      input: {
        signal: SignalEnvelope;
        createOutboxRecord: boolean;
        finalDatabaseSizeBytes: number;
        nowMs: number;
      }
    ): void;
  }
).maybeEmitRetentionWarningSignal;

const emitRetentionWarningSignal = (
  Space.prototype as unknown as {
    emitRetentionWarningSignal(this: {
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean
      ) => PersistSignalWithOptionalOutboxResult;
      buildTextSignal: (
        profile: SignalEnvelope["profile"],
        text: string
      ) => SignalEnvelope;
      broadcastSignal: (
        signal: SignalEnvelope,
        signalContext?: unknown,
        history?: unknown
      ) => void;
    }): void;
  }
).emitRetentionWarningSignal;

const persistSignalWithOptionalOutbox = (
  Space.prototype as unknown as {
    persistSignalWithOptionalOutbox(
      this: {
        ctx: { storage: { sql: SqlStorage } };
        durableObjectId: string;
        lastPostCleanupAtMs: number;
        prepareDispatchOutboxPlanForSignal: (
          signal: SignalEnvelope,
          signalContext?: SignalPublishContext
        ) => {
          nonReadyDecisions: unknown[];
          outboxRecords: DispatchOutboxRecord[];
          plannerContext: unknown | null;
        };
        collectInsertedDispatchMessages: (
          preparedOutboxRecords: DispatchOutboxRecord[],
          dispatchMessages: Array<{ dispatchId: string }>
        ) => void;
        maybeEmitRetentionWarningSignal?: (input: {
          signal: SignalEnvelope;
          createOutboxRecord: boolean;
          finalDatabaseSizeBytes: number;
          nowMs: number;
        }) => void;
        spaceId: string;
      },
      signal: SignalEnvelope,
      createOutboxRecord: boolean,
      signalContext?: SignalPublishContext
    ): PersistSignalWithOptionalOutboxResult;
  }
).persistSignalWithOptionalOutbox;

const prepareDispatchOutboxPlanForSignal = (
  Space.prototype as unknown as {
    prepareDispatchOutboxPlanForSignal(
      this: unknown,
      signal: SignalEnvelope,
      signalContext?: SignalPublishContext
    ): {
      nonReadyDecisions: unknown[];
      outboxRecords: DispatchOutboxRecord[];
      plannerContext: unknown | null;
    };
  }
).prepareDispatchOutboxPlanForSignal;

const withDispatchPlannerTestDefaults = (
  target: object,
  signal: SignalEnvelope
): object => {
  return {
    ownerCreatorProfileIdsByOwnerUserId: new Map(),
    readSpaceMetaRecord: vi.fn(() => ({
      organizationId: "org-space-1",
    })),
    spaceId: signal.spaceId,
    ...target,
  };
};

const prepareDispatchOutboxRecordsForSignal = function (
  this: object,
  signal: SignalEnvelope,
  signalContext?: SignalPublishContext
): DispatchOutboxRecord[] {
  return prepareDispatchOutboxPlanForSignal.call(
    withDispatchPlannerTestDefaults(this, signal),
    signal,
    signalContext
  ).outboxRecords;
};

const collectInsertedDispatchMessages = (
  Space.prototype as unknown as {
    collectInsertedDispatchMessages(
      this: unknown,
      preparedOutboxRecords: DispatchOutboxRecord[],
      dispatchMessages: Array<{ dispatchId: string }>
    ): void;
  }
).collectInsertedDispatchMessages;

const handlePostThreadSignal = (
  Space.prototype as unknown as {
    handlePostThreadSignal(
      this: {
        buildTextSignal: (
          profile: SignalEnvelope["profile"],
          text: string,
          options?: SignalTextBuildOptions
        ) => SignalEnvelope;
        ctx: {
          blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
          storage: { sql: SqlStorage };
        };
        publishTextSignal: (
          signal: SignalEnvelope,
          signalContext?: SignalPublishContext
        ) => Promise<void>;
        readSourceTextSignalByClientMessageId: (
          clientMessageId: string
        ) => SignalTextEnvelope | null;
      },
      input: {
        context: {
          actorContext: {
            requestId: string;
            openMeldProfileId: string;
            profileKind: "agent" | "human" | "system";
            profileName?: string;
          };
        };
        request: Request;
        spacePassword?: string;
        threadId: string;
      }
    ): Promise<Response>;
  }
).handlePostThreadSignal;

const webSocketMessage = (
  Space.prototype as unknown as {
    webSocketMessage(
      this: {
        sessions: Map<
          unknown,
          {
            profile?: SignalEnvelope["profile"];
            enforcedProfile?: SignalEnvelope["profile"];
            viewerOwnerUserId?: string;
            spacePassword?: string;
            blocked?: SpaceQueuedWebSocketMessage[];
            quit?: boolean;
            helloAccepted: boolean;
            supportsLiveSignalHistory: boolean;
          }
        >;
        buildTextSignal: (
          profile: SignalEnvelope["profile"],
          text: string
        ) => SignalEnvelope;
        publishTextSignal: (
          signal: SignalEnvelope,
          signalContext?: SignalPublishContext
        ) => void | Promise<void>;
      },
      webSocket: {
        close: (code?: number, reason?: string) => void;
        send: (message: string) => void;
      },
      msg: string | ArrayBuffer
    ): Promise<void>;
  }
).webSocketMessage;

const createAcceptedWebSocketSession = (input: {
  profile: SignalEnvelope["profile"];
  spacePassword?: string;
}) => {
  const session = createPendingSpaceWebSocketSession({
    ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
  });
  acceptSpaceWebSocketHello({
    session,
    hello: {
      type: "hello",
      profile: input.profile,
    },
  });
  return session;
};

const resolveDispatchReadyDecisionsFromSignal = function (
  this: object,
  signal: SignalEnvelope
): DispatchReadyDecision[] {
  return prepareDispatchOutboxPlanForSignal
    .call(withDispatchPlannerTestDefaults(this, signal), signal)
    .outboxRecords.map((record) => {
      return {
        dispatchId: record.dispatchId,
        sourceEventId: record.sourceEventId,
        status: "dispatch_ready",
        targetProfileId: record.targetProfileId,
        ruleSource: record.ruleSource,
        ruleId: record.ruleId,
        ruleReason: record.ruleReason,
      };
    });
};

const resolveDispatchQueueSourceSignalSnapshot = (
  Space.prototype as unknown as {
    resolveDispatchQueueSourceSignalSnapshot(
      this: { ctx: { storage: { sql: SqlStorage } } },
      dispatchMessage: OpenMeldDaemonDispatchQueueMessage
    ): OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] | null;
  }
).resolveDispatchQueueSourceSignalSnapshot;

const resolveDispatchQueueReplyToSnapshot = (
  Space.prototype as unknown as {
    resolveDispatchQueueReplyToSnapshot(
      this: { ctx: { storage: { sql: SqlStorage } } },
      dispatchMessage: OpenMeldDaemonDispatchQueueMessage
    ): OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] | null;
  }
).resolveDispatchQueueReplyToSnapshot;

const buildDirectRpcRequest = (
  Space.prototype as unknown as {
    buildDirectRpcRequest(
      this: unknown,
      input: {
        path: string;
        method: "GET" | "POST" | "PATCH" | "DELETE";
        context?: OpenMeldRequestContext;
      }
    ): Request;
  }
).buildDirectRpcRequest;

const rpcPostTransientSignal = (
  Space.prototype as unknown as {
    rpcPostTransientSignal(
      this: {
        applySpaceRef: (spaceId: string) => void;
        authorizeSpacePasswordAccess: (input: {
          requestId: string;
          spacePassword?: string;
        }) => Promise<
          | { ok: true }
          | {
              ok: false;
              response: Response;
            }
        >;
        buildTextSignal: (
          profile: SignalEnvelope["profile"],
          text: string,
          options?: {
            messageEnvelope?: unknown;
            meta?: unknown;
            replyTo?: unknown;
          }
        ) => SignalEnvelope;
        trackReplyingTransientSignal: (signal: SignalEnvelope) => boolean;
        broadcastSignal: (
          signal: SignalEnvelope,
          signalContext?: unknown,
          history?: unknown
        ) => void;
      },
      input: {
        spaceId: string;
        profile: SignalEnvelope["profile"];
        text: string;
        password?: string;
        messageEnvelope?: unknown;
        meta?: unknown;
        replyTo?: unknown;
      }
    ): Promise<void>;
  }
).rpcPostTransientSignal;

const broadcastLiveMessage = (
  Space.prototype as unknown as {
    broadcast(
      this: {
        sessions: Map<
          unknown,
          {
            profile?: SignalEnvelope["profile"];
            blocked?: SpaceQueuedWebSocketMessage[];
            helloAccepted: boolean;
            supportsLiveSignalHistory: boolean;
          }
        >;
      },
      message: SignalEnvelope | SpaceLiveSignalFrame
    ): void;
  }
).broadcast;

const encodeLiveMessageForSession = (
  Space.prototype as unknown as {
    encodeLiveMessageForSession(
      this: {
        redactSignalForViewer: (
          signal: SignalEnvelope,
          session: unknown
        ) => SignalEnvelope;
      },
      message: string | SignalEnvelope | SpaceLiveSignalFrame,
      session: unknown
    ): string;
  }
).encodeLiveMessageForSession;

const buildDispatchMessageFromRecoveryCandidate = (
  Space.prototype as unknown as {
    buildDispatchMessageFromRecoveryCandidate(
      this: {
        resolveDispatchQueueSourceSignalSnapshot: (
          dispatchMessage: OpenMeldDaemonDispatchQueueMessage
        ) => OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] | null;
        resolveDispatchQueueReplyToSnapshot: (
          dispatchMessage: OpenMeldDaemonDispatchQueueMessage
        ) => OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] | null;
      },
      candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate
    ): OpenMeldDaemonDispatchQueueMessage;
  }
).buildDispatchMessageFromRecoveryCandidate;

const resolveHandedOffOutboxCandidateDecision = (
  Space.prototype as unknown as {
    resolveHandedOffOutboxCandidateDecision(
      this: {
        readDispatchLedgerEvidence: (idempotencyKey: string) => Promise<
          | {
              kind: "found";
              row: {
                status: string;
                lastAttemptAtMs: number;
                latestAttemptStatus: string | null;
                latestAttemptErrorCode: string | null;
                daemonSessionId: string | null;
                connectionGeneration: number | null;
                leaseEpoch: number | null;
              };
            }
          | { kind: "missing" }
          | { kind: "unavailable"; reasonCode: string }
        >;
        resolveActiveAttemptWatchdogDecision: (
          candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
          ledgerRow: {
            status: string;
            lastAttemptAtMs: number;
            latestAttemptStatus: string | null;
            latestAttemptErrorCode: string | null;
            daemonSessionId: string | null;
            connectionGeneration: number | null;
            leaseEpoch: number | null;
          }
        ) => Promise<
          | {
              kind: "submit";
              reason: "connection_replaced" | "route_lost";
            }
          | {
              kind: "skip";
              reason: "still_owned";
            }
        >;
        writeDispatchOutboxWatchdogDecision: (input: {
          candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate;
          ledgerRow: {
            daemonSessionId: string | null;
            connectionGeneration: number | null;
            leaseEpoch: number | null;
            latestAttemptStatus: string | null;
            latestAttemptErrorCode?: string | null;
          };
          reason: "connection_replaced" | "route_lost";
        }) => Promise<void>;
        readPreAgentStoppedGuardForOutboxCandidate: (
          candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate
        ) => Promise<
          { stopped: false } | { stopped: true; targetWakeLifecycleId: string }
        >;
      },
      candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
      nowMs: number
    ): Promise<
      | { kind: "delete" }
      | { kind: "skip" }
      | {
          kind: "submit";
          deliveryRecoveryReason?: "connection_replaced" | "route_lost";
        }
    >;
  }
).resolveHandedOffOutboxCandidateDecision;

const flushPendingDispatchOutbox = (
  Space.prototype as unknown as {
    flushPendingDispatchOutbox(this: {
      ctx: { storage: { sql: SqlStorage } };
      readDispatchLedgerEvidence: (idempotencyKey: string) => Promise<
        | {
            kind: "found";
            row: {
              status: string;
              lastAttemptAtMs: number;
              latestAttemptStatus: string | null;
              latestAttemptErrorCode: string | null;
              daemonSessionId: string | null;
              connectionGeneration: number | null;
              leaseEpoch: number | null;
            };
          }
        | { kind: "missing" }
        | { kind: "unavailable"; reasonCode: string }
      >;
      resolveHandedOffOutboxCandidateDecision: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
        nowMs: number
      ) => Promise<
        | { kind: "delete" }
        | { kind: "skip" }
        | {
            kind: "submit";
            deliveryRecoveryReason?: "connection_replaced" | "route_lost";
          }
      >;
      resolveActiveAttemptWatchdogDecision: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
        ledgerRow: {
          status: string;
          lastAttemptAtMs: number;
          latestAttemptStatus: string | null;
          latestAttemptErrorCode: string | null;
          daemonSessionId: string | null;
          connectionGeneration: number | null;
          leaseEpoch: number | null;
        }
      ) => Promise<
        | {
            kind: "submit";
            reason: "connection_replaced" | "route_lost";
          }
        | {
            kind: "skip";
            reason: "still_owned";
          }
      >;
      writeDispatchOutboxWatchdogDecision: (input: {
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate;
        ledgerRow: {
          daemonSessionId: string | null;
          connectionGeneration: number | null;
          leaseEpoch: number | null;
          latestAttemptStatus: string | null;
          latestAttemptErrorCode?: string | null;
        };
        reason: "connection_replaced" | "route_lost";
      }) => Promise<void>;
      readPreAgentStoppedGuardForOutboxCandidate: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate
      ) => Promise<
        { stopped: false } | { stopped: true; targetWakeLifecycleId: string }
      >;
      redriveHandedOffOutboxCandidate: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
        nowMs: number,
        logContext: unknown
      ) => Promise<void>;
      recordOutboxCandidateFailure: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
        logContext: unknown,
        error: unknown,
        nowMs: number
      ) => void;
      publishOutboxPoisonTerminalFailureNotice?: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
        logContext: unknown,
        error: unknown
      ) =>
        | { ok: true; publishedSignalId: string | null }
        | { ok: false; reasonCode: string };
      buildDispatchMessageFromRecoveryCandidate: (
        candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate
      ) => OpenMeldDaemonDispatchQueueMessage;
      buildSystemNoticeSignal?: (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) => SignalEnvelope;
      resolveDispatchQueueSourceSignalSnapshot: (
        dispatchMessage: OpenMeldDaemonDispatchQueueMessage
      ) => OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] | null;
      resolveDispatchQueueReplyToSnapshot: (
        dispatchMessage: OpenMeldDaemonDispatchQueueMessage
      ) => OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] | null;
      submitDispatchOutboxMessage: (
        message: OpenMeldDaemonDispatchQueueMessage,
        reason: DispatchOutboxSubmitReason,
        candidate?: unknown,
        human?: unknown
      ) => Promise<boolean | undefined>;
      enqueueDispatchMessageWithRetry: (
        message: OpenMeldDaemonDispatchQueueMessage,
        reason?: DispatchOutboxSubmitReason,
        candidate?: unknown,
        human?: unknown
      ) => Promise<boolean | undefined>;
      persistSignalWithOptionalOutbox?: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean,
        signalContext?: SignalPublishContext
      ) => {
        dispatchMessages: OpenMeldDaemonDispatchQueueMessage[];
        duplicateFinalReplyBlocked: boolean;
        persistedSignal: boolean;
      };
      readSignalById?: (signalId: string) => SignalEnvelope | null;
      resolveThreadContextForSignal?: (signalId: string) => unknown;
      broadcastSignal?: (
        signal: SignalEnvelope,
        signalContext: SignalPublishContext,
        options: { persisted: boolean }
      ) => void;
      syncDispatchOutboxAlarm: () => Promise<void>;
    }): Promise<void>;
  }
).flushPendingDispatchOutbox;

const redriveHandedOffOutboxCandidate = (
  Space.prototype as unknown as {
    redriveHandedOffOutboxCandidate(
      this: unknown,
      candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
      nowMs: number,
      logContext: unknown
    ): Promise<void>;
  }
).redriveHandedOffOutboxCandidate;

const recordOutboxCandidateFailure = (
  Space.prototype as unknown as {
    recordOutboxCandidateFailure(
      this: unknown,
      candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
      logContext: unknown,
      error: unknown,
      nowMs: number
    ): void;
  }
).recordOutboxCandidateFailure;

const publishOutboxPoisonTerminalFailureNotice = (
  Space.prototype as unknown as {
    publishOutboxPoisonTerminalFailureNotice(
      this: unknown,
      candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
      logContext: unknown,
      error: unknown
    ):
      | { ok: true; publishedSignalId: string | null }
      | { ok: false; reasonCode: string };
  }
).publishOutboxPoisonTerminalFailureNotice;

const createOutboxRedriveMethodTarget = () => ({
  publishOutboxPoisonTerminalFailureNotice,
  recordOutboxCandidateFailure,
  redriveHandedOffOutboxCandidate,
  submitDispatchOutboxMessage(
    this: {
      enqueueDispatchMessageWithRetry: (
        message: OpenMeldDaemonDispatchQueueMessage,
        reason?: DispatchOutboxSubmitReason,
        candidate?: unknown,
        human?: unknown
      ) => Promise<boolean | undefined>;
    },
    message: OpenMeldDaemonDispatchQueueMessage,
    reason: DispatchOutboxSubmitReason,
    candidate?: unknown,
    human?: unknown
  ) {
    return this.enqueueDispatchMessageWithRetry(
      message,
      reason,
      candidate,
      human
    );
  },
});

const runSpaceAlarm = (
  Space.prototype as unknown as {
    alarm(this: unknown): Promise<void>;
  }
).alarm;

const runIsolatedAlarmStep = (
  Space.prototype as unknown as {
    runIsolatedAlarmStep(
      this: unknown,
      step: string,
      run: () => Promise<void>
    ): Promise<void>;
  }
).runIsolatedAlarmStep;

const readDispatchLedgerEvidence = (
  Space.prototype as unknown as {
    readDispatchLedgerEvidence(
      this: {
        bindings: {
          OPENMELD_DB?: {
            prepare: (query: string) => {
              bind: (...args: unknown[]) => {
                first: <TRow>() => Promise<TRow | null>;
              };
            };
          };
        };
        spaceId: string;
      },
      idempotencyKey: string
    ): Promise<
      | {
          kind: "found";
          row: {
            status: string;
            lastAttemptAtMs: number;
            latestAttemptStatus: string | null;
            latestAttemptErrorCode: string | null;
            daemonSessionId: string | null;
            connectionGeneration: number | null;
            leaseEpoch: number | null;
          };
        }
      | { kind: "missing" }
      | { kind: "unavailable"; reasonCode: string }
    >;
  }
).readDispatchLedgerEvidence;

const syncSpaceBackgroundAlarm = (
  Space.prototype as unknown as {
    syncSpaceBackgroundAlarm(this: {
      ctx: {
        storage: {
          sql: SqlStorage;
          getAlarm: () => Promise<number | null>;
          setAlarm: (scheduledAtMs: number) => Promise<void>;
          deleteAlarm: () => Promise<void>;
        };
      };
      agentStreamProjectionStorage: {
        list<T>(options: { prefix: string }): Promise<Map<string, T>>;
      };
      resolveNextDispatchOutboxAlarmAtMs: () => number | null;
      spaceId: string;
    }): Promise<void>;
  }
).syncSpaceBackgroundAlarm;

function makeSignal(type: "signal.text"): SignalTextEnvelope;
function makeSignal(type: "presence.join"): PresenceEnvelope;
function makeSignal(type: "signal.text" | "presence.join"): SignalEnvelope {
  const base = {
    v: 1 as const,
    id: "sig-1",
    spaceId: "space-1",
    ts: Date.now(),
    profile: {
      kind: "human" as const,
      profileId: "profile-1",
      profileName: "Tester",
    },
  };

  if (type === "signal.text") {
    return {
      ...base,
      type,
      data: {
        text: "hello",
      },
    };
  }

  return {
    ...base,
    type,
    data: {},
  };
}

function readSignalText(signal: SignalEnvelope): string {
  if (signal.type !== "signal.text") {
    throw new Error(`Expected signal.text, received ${signal.type}`);
  }
  return signal.data.text;
}

const RETENTION_WARNING_TEXT =
  "Storage is nearly full. Please back up important chat history or create a new space to continue. Older records will be discarded after the storage limit is exceeded.";

const createDispatchMessageFixture = (
  sourceEventId: string
): OpenMeldDaemonDispatchQueueMessage => ({
  v: 2,
  dispatchId: "dispatch-fixture-1",
  spaceId: "space-1",
  organizationId: "org-space-1",
  sourceEventId,
  targetProfileId: "agt_f3333333-3333-4333-8333-333333333333",
  dispatchChainId: "dispatch-fixture-1",
  autoRelayDepth: 0,
  visitedProfileIds: [],
  visitedProfileIdsHash: "stable32:11111111",
  dispatchContractVersion: 2,
  dispatchPolicy: "mention_only",
  ruleSource: "registry",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  taskId: "task-fixture-1",
  transportMode: "local-cli",
  controllerSnapshot: {
    targetBindingState: "bound",
    targetBindingEnabled: true,
    agentControllerRef: "builtin:codex",
  },
  contextIdMappingSpec: {
    sourceField: "CODEX_SESSION_ID",
    mappingVersion: 1,
  },
  dispatchRulesSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    targetBindingState: "bound",
    targetBindingEnabled: true,
  },
  idempotencyKey: "8:evt-fixture|40:agt_f3333333-3333-4333-8333-333333333333",
  enqueuedAtMs: Date.now(),
});

const DISPATCH_SNAPSHOT_OVERSIZE_PATTERN = /dispatch\.snapshot\.oversize/;

const createDispatchRulesSqlStub = (
  allow = 1,
  options?: {
    mentionAliasRows?: {
      profile_id: string | null;
      payload_json: string;
      ts?: number | null;
    }[];
    cursorMentionAliasRows?: {
      profile_id: string | null;
      mention_alias: string | null;
    }[];
    failOnLegacyDispatchPolicyQuery?: boolean;
    spaceMemberRows?: Record<string, unknown>[];
  }
) => {
  const mentionAliasRows = options?.mentionAliasRows ?? [];
  const cursorMentionAliasRows = options?.cursorMentionAliasRows ?? [];
  const spaceMemberRows = options?.spaceMemberRows ?? [];
  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const normalizedQuery = query.replace(/\s+/g, " ").trim();
      if (
        options?.failOnLegacyDispatchPolicyQuery === true &&
        normalizedQuery.includes("space_dispatch_policies")
      ) {
        throw new Error("legacy space dispatch policy storage was queried");
      }
      if (
        normalizedQuery.includes("SELECT") &&
        normalizedQuery.includes("space_dispatch_rules")
      ) {
        return {
          toArray: () => [
            {
              mode: "all_members",
              allow,
              rule_id: "space.default.all_members.v1",
              rule_reason: "default allow all members mention",
              rule_set_version: 1,
              updated_by: "system",
              updated_at_ms: Date.UTC(2026, 1, 26, 10, 0, 0),
            },
          ],
        };
      }
      if (
        normalizedQuery.includes("SELECT profile_id, payload_json") &&
        normalizedQuery.includes("FROM space_signals")
      ) {
        return {
          toArray: () => mentionAliasRows,
        };
      }
      if (
        normalizedQuery.includes("SELECT profile_id, ts, payload_json") &&
        normalizedQuery.includes("FROM space_signals")
      ) {
        return {
          toArray: () => mentionAliasRows,
        };
      }
      if (
        normalizedQuery.includes("SELECT profile_id, mention_alias") &&
        normalizedQuery.includes("FROM space_cursors")
      ) {
        return {
          toArray: () => cursorMentionAliasRows,
        };
      }
      if (
        normalizedQuery.includes("FROM space_members") &&
        normalizedQuery.includes("profile_kind_snapshot")
      ) {
        const statusFilter = String(params[0] ?? "").trim();
        return {
          toArray: () =>
            statusFilter.length > 0
              ? spaceMemberRows.filter(
                  (row) => String(row.status ?? "").trim() === statusFilter
                )
              : spaceMemberRows,
        };
      }
      return {
        rowsWritten: 1,
        toArray: () => [],
      };
    }),
  } as unknown as SqlStorage;
};

const createDispatchRulesSpaceMemberRow = (input: {
  ownerUserIdSnapshot?: string;
  profileId: string;
  profileName: string;
  profileKind?: "human" | "agent";
  status?: "active" | "removed";
  addedAt?: string;
  createdAt?: string;
}): Record<string, unknown> => {
  const addedAt = input.addedAt ?? "2026-03-06T00:00:00.000Z";
  const createdAt = input.createdAt ?? addedAt;
  return {
    space_id: "space-1",
    profile_id: input.profileId,
    profile_kind_snapshot: input.profileKind ?? "agent",
    profile_name_snapshot: input.profileName,
    owner_user_id_snapshot: input.ownerUserIdSnapshot ?? "owner-1",
    owner_name_snapshot: "Owner One",
    controller_ref_snapshot: "builtin:codex",
    status: input.status ?? "active",
    member_source: "joined_directly",
    added_at: Date.parse(addedAt),
    removed_at: null,
    added_by_profile_id: null,
    added_by_owner_user_id: null,
    added_by_display_name_snapshot: null,
    removed_by_profile_id: null,
    removed_by_owner_user_id: null,
    removal_reason: null,
    first_entered_at: Date.parse(addedAt),
    last_entered_at: Date.parse(addedAt),
    created_at: Date.parse(createdAt),
    updated_at: Date.parse(createdAt),
  };
};

const createMessageEnvelope = (input: {
  text: string;
  activationTargets?: string[];
  referenceTargets?: string[];
}) => ({
  activationTargets: input.activationTargets ?? [],
  referenceTargets: input.referenceTargets ?? [],
  text: input.text,
});

describe("space signal consistency matrix", () => {
  it("queues pre-hello live signal frames unencoded until session capabilities are known", () => {
    const session = createPendingSpaceWebSocketSession({
      blocked: [],
    });
    const frame: SpaceLiveSignalFrame = {
      type: "space.signal",
      signal: makeSignal("signal.text"),
      history: {
        persisted: false,
      },
    };

    broadcastLiveMessage.call(
      {
        sessions: new Map([[{}, session]]),
      },
      frame
    );

    expect(session.blocked).toHaveLength(1);
    expect(session.blocked?.[0]).toBe(frame);
  });

  it("omits live history metadata from thread frames sent to non-capable sessions", () => {
    const viewerProfile: SignalEnvelope["profile"] = {
      kind: "human",
      profileId: "hum_viewer",
      profileName: "Viewer",
    };
    const legacySession = createAcceptedWebSocketSession({
      profile: viewerProfile,
    });
    const modernSession = createAcceptedWebSocketSession({
      profile: viewerProfile,
    });
    modernSession.supportsLiveSignalHistory = true;
    const legacySocket = {
      send: vi.fn(),
    };
    const modernSocket = {
      send: vi.fn(),
    };
    const frame: SpaceLiveSignalFrame = {
      type: "space.signal",
      signal: makeSignal("signal.text"),
      history: {
        persisted: true,
      },
      threadContext: {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        rootSignalId: "sig-root-1",
      },
      threadPlacement: {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        signalId: "sig-main-1",
        placement: "thread",
        createdAt: "2026-06-19T00:00:00.000Z",
      },
    };

    broadcastLiveMessage.call(
      {
        sessions: new Map([
          [legacySocket, legacySession],
          [modernSocket, modernSession],
        ]),
        encodeLiveMessageForSession,
        redactSignalForViewer: (signal: SignalEnvelope) => signal,
      },
      frame
    );

    expect(legacySocket.send).toHaveBeenCalledTimes(1);
    expect(modernSocket.send).toHaveBeenCalledTimes(1);
    const legacyMessage = JSON.parse(
      legacySocket.send.mock.calls[0]?.[0] ?? "null"
    );
    const modernMessage = JSON.parse(
      modernSocket.send.mock.calls[0]?.[0] ?? "null"
    );

    expect(legacyMessage).toMatchObject({
      type: "space.signal",
      signal: {
        id: frame.signal.id,
      },
      threadContext: frame.threadContext,
      threadPlacement: frame.threadPlacement,
    });
    expect(legacyMessage).not.toHaveProperty("history");
    expect(modernMessage).toMatchObject({
      history: {
        persisted: true,
      },
      threadContext: frame.threadContext,
      threadPlacement: frame.threadPlacement,
    });
  });

  it("routes transient text signals through the shared parser and broadcasts the normalized envelope", async () => {
    const profile: SignalEnvelope["profile"] = {
      kind: "agent",
      profileId: "agt_f4444444-4444-4444-8444-444444444444",
      profileName: "sender",
    };
    const replyTo = {
      signalId: "sig-1",
      profileId: "agt_99999999-9999-4999-8999-999999999999",
      profileKind: "agent" as const,
      profileName: "Reply Agent",
      previewText: "hello",
    };
    const buildTextSignalSpy = vi.fn(
      (
        resolvedProfile: SignalEnvelope["profile"],
        text: string,
        options?: SignalTextBuildOptions
      ): SignalEnvelope => ({
        v: 1,
        id: "sig-transient",
        spaceId: "space-1",
        ts: Date.now(),
        profile: resolvedProfile,
        type: "signal.text",
        data: {
          text,
          ...(options?.messageEnvelope
            ? { messageEnvelope: options.messageEnvelope }
            : {}),
          ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
          ...(options?.meta ? { meta: options.meta } : {}),
        },
      })
    );
    const trackReplyingTransientSignal = vi.fn().mockReturnValue(true);
    const broadcastSignal = vi.fn();
    const buildTextSignal = (
      resolvedProfile: SignalEnvelope["profile"],
      text: string,
      options?: {
        messageEnvelope?: unknown;
        meta?: unknown;
        replyTo?: unknown;
      }
    ) =>
      buildTextSignalSpy(
        resolvedProfile,
        text,
        options as SignalTextBuildOptions | undefined
      );

    await rpcPostTransientSignal.call(
      {
        applySpaceRef: vi.fn(),
        authorizeSpacePasswordAccess: vi.fn().mockResolvedValue({ ok: true }),
        buildTextSignal,
        trackReplyingTransientSignal,
        broadcastSignal,
      },
      {
        spaceId: "space-1",
        profile,
        text: "  hello  ",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "  hello  ",
          replyToSignalId: " sig-1 ",
        },
        replyTo,
      }
    );

    expect(buildTextSignalSpy).toHaveBeenCalledWith(
      profile,
      "hello",
      expect.objectContaining({
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
          replyToSignalId: "sig-1",
        },
        replyTo,
      })
    );
    const transientSignal = buildTextSignalSpy.mock.results[0]?.value;
    expect(trackReplyingTransientSignal).toHaveBeenCalledWith(transientSignal);
    expect(broadcastSignal).toHaveBeenCalledWith(transientSignal, undefined, {
      persisted: false,
    });
  });

  it("rejects transient text signals when messageEnvelope.text does not match text", async () => {
    const buildTextSignalSpy = vi.fn();
    const trackReplyingTransientSignal = vi.fn();
    const broadcastSignal = vi.fn();

    await expect(
      rpcPostTransientSignal.call(
        {
          applySpaceRef: vi.fn(),
          authorizeSpacePasswordAccess: vi.fn().mockResolvedValue({ ok: true }),
          buildTextSignal: buildTextSignalSpy,
          trackReplyingTransientSignal,
          broadcastSignal,
        },
        {
          spaceId: "space-1",
          profile: {
            kind: "agent",
            profileId: "agt_f4444444-4444-4444-8444-444444444444",
            profileName: "sender",
          },
          text: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "different",
          },
        }
      )
    ).rejects.toThrow("signal.text payload is invalid");
    expect(buildTextSignalSpy).not.toHaveBeenCalled();
    expect(trackReplyingTransientSignal).not.toHaveBeenCalled();
    expect(broadcastSignal).not.toHaveBeenCalled();
  });

  it("rejects transient text signals when replyTo and messageEnvelope.replyToSignalId disagree", async () => {
    const buildTextSignalSpy = vi.fn();
    const replyTo = {
      signalId: "sig-1",
      profileId: "agt_99999999-9999-4999-8999-999999999999",
      profileKind: "agent" as const,
      profileName: "Reply Agent",
      previewText: "hello",
    };

    await expect(
      rpcPostTransientSignal.call(
        {
          applySpaceRef: vi.fn(),
          authorizeSpacePasswordAccess: vi.fn().mockResolvedValue({ ok: true }),
          buildTextSignal: buildTextSignalSpy,
          trackReplyingTransientSignal: vi.fn(),
          broadcastSignal: vi.fn(),
        },
        {
          spaceId: "space-1",
          profile: {
            kind: "agent",
            profileId: "agt_f4444444-4444-4444-8444-444444444444",
            profileName: "sender",
          },
          text: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "hello",
            replyToSignalId: "sig-other",
          },
          replyTo,
        }
      )
    ).rejects.toThrow("signal.text payload is invalid");
    expect(buildTextSignalSpy).not.toHaveBeenCalled();
  });

  it("rejects transient text signals when messageEnvelope reuses a target across relations", async () => {
    const buildTextSignalSpy = vi.fn();
    const repeatedTargetProfileId = "agt_33333333-3333-4333-8333-333333333333";

    await expect(
      rpcPostTransientSignal.call(
        {
          applySpaceRef: vi.fn(),
          authorizeSpacePasswordAccess: vi.fn().mockResolvedValue({ ok: true }),
          buildTextSignal: buildTextSignalSpy,
          trackReplyingTransientSignal: vi.fn(),
          broadcastSignal: vi.fn(),
        },
        {
          spaceId: "space-1",
          profile: {
            kind: "agent",
            profileId: "agt_f4444444-4444-4444-8444-444444444444",
            profileName: "sender",
          },
          text: "hello",
          messageEnvelope: {
            activationTargets: [repeatedTargetProfileId],
            referenceTargets: [repeatedTargetProfileId],
            text: "hello",
          },
        }
      )
    ).rejects.toThrow("signal.text payload is invalid");
    expect(buildTextSignalSpy).not.toHaveBeenCalled();
  });

  it("dispatches unique activationTargets from messageEnvelope", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-mention",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "sender",
      },
      type: "signal.text",
      data: {
        text: "ping @agt_11111111-1111-4111-8111-111111111111 @agt_22222222-2222-4222-8222-222222222222 @agt_22222222-2222-4222-8222-222222222222 and @agt_33333333-3333-4333-8333-333333333333",
        messageEnvelope: createMessageEnvelope({
          text: "ping @agt_11111111-1111-4111-8111-111111111111 @agt_22222222-2222-4222-8222-222222222222 @agt_22222222-2222-4222-8222-222222222222 and @agt_33333333-3333-4333-8333-333333333333",
          activationTargets: [
            "agt_22222222-2222-4222-8222-222222222222",
            "agt_22222222-2222-4222-8222-222222222222",
            "agt_33333333-3333-4333-8333-333333333333",
          ],
        }),
      },
    };

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_22222222-2222-4222-8222-222222222222",
                  profileName: "Agent A",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_33333333-3333-4333-8333-333333333333",
                  profileName: "Agent B",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_11111111-1111-4111-8111-111111111111",
                  profileName: "sender",
                }),
              ],
            }),
          },
        },
      },
      signal
    );
    expect(decisions).toEqual([
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-mention",
        status: "dispatch_ready",
        targetProfileId: "agt_22222222-2222-4222-8222-222222222222",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-mention",
        status: "dispatch_ready",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("uses SpaceContract mention_only without querying legacy policy storage", () => {
    const targetProfileId = "agt_contract_target";
    const otherAgentProfileId = "agt_contract_other";
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-contract-mention-only",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "human-contract-sender",
        profileName: "Contract Sender",
      },
      type: "signal.text",
      data: {
        text: "Please handle this.",
        messageEnvelope: createMessageEnvelope({
          text: "Please handle this.",
          activationTargets: [targetProfileId],
        }),
      },
    };
    const contract = {
      ...buildDefaultSpaceContract(),
      dispatchPolicy: { mode: "mention_only" as const },
    };
    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              failOnLegacyDispatchPolicyQuery: true,
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: targetProfileId,
                  profileName: "Target Agent",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: otherAgentProfileId,
                  profileName: "Other Agent",
                }),
              ],
            }),
          },
        },
        readSpaceContractRecord: vi.fn(() => contract),
      },
      signal
    );

    expect(
      records.map((record) => ({
        dispatchPolicy: record.dispatchPolicy,
        targetProfileId: record.targetProfileId,
      }))
    ).toEqual([
      {
        dispatchPolicy: "mention_only",
        targetProfileId,
      },
    ]);
  });

  it("uses SpaceContract listen_all for explicit and implicit agent targets", () => {
    const explicitTargetProfileId = "agt_contract_explicit";
    const listeningAgentProfileId = "agt_contract_listener";
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-contract-listen-all",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "human-contract-sender",
        profileName: "Contract Sender",
      },
      type: "signal.text",
      data: {
        text: "Please route this update.",
        messageEnvelope: createMessageEnvelope({
          text: "Please route this update.",
          activationTargets: [explicitTargetProfileId],
        }),
      },
    };
    const contract = {
      ...buildDefaultSpaceContract(),
      dispatchPolicy: { mode: "listen_all" as const },
    };
    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              failOnLegacyDispatchPolicyQuery: true,
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: explicitTargetProfileId,
                  profileName: "Explicit Agent",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: listeningAgentProfileId,
                  profileName: "Listening Agent",
                }),
              ],
            }),
          },
        },
        readSpaceContractRecord: vi.fn(() => contract),
      },
      signal
    );

    expect(
      records.map((record) => ({
        dispatchPolicy: record.dispatchPolicy,
        ruleId: record.ruleId,
        targetProfileId: record.targetProfileId,
      }))
    ).toEqual([
      {
        dispatchPolicy: "listen_all",
        ruleId: "space.default.all_members.v1",
        targetProfileId: explicitTargetProfileId,
      },
      {
        dispatchPolicy: "listen_all",
        ruleId: "space_contract.listen_all",
        targetProfileId: listeningAgentProfileId,
      },
    ]);
  });

  it("keeps agent Direct Message dispatch independent of mention policy storage", () => {
    const humanProfileId = "human-dm-sender";
    const agentProfileId = "agt-dm-target";
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-contract-direct-message",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: humanProfileId,
        profileName: "DM Sender",
      },
      type: "signal.text",
      data: {
        text: "Can you help?",
        messageEnvelope: createMessageEnvelope({ text: "Can you help?" }),
      },
    };
    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              failOnLegacyDispatchPolicyQuery: true,
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: humanProfileId,
                  profileKind: "human",
                  profileName: "DM Sender",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: agentProfileId,
                  profileName: "DM Agent",
                }),
              ],
            }),
          },
        },
        readSpaceContractRecord: vi.fn(() => buildDefaultSpaceContract()),
        readSpaceMetaRecord: vi.fn(() => ({
          purpose: "openmeld_dm_space",
        })),
      },
      signal
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      dispatchPolicy: "mention_only",
      ruleId: "space_direct_message.auto_agent.v1",
      targetProfileId: agentProfileId,
    });
  });

  it("records dispatch owner authority from target member owner snapshots", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-owner-evidence",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: "agt_sender",
        profileName: "sender",
      },
      type: "signal.text",
      data: {
        text: "ping @agt_target_a @agt_target_b",
        messageEnvelope: createMessageEnvelope({
          text: "ping @agt_target_a @agt_target_b",
          activationTargets: ["agt_target_a", "agt_target_b"],
        }),
      },
    };

    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  ownerUserIdSnapshot: "owner-target-a",
                  profileId: "agt_target_a",
                  profileName: "Agent A",
                }),
                createDispatchRulesSpaceMemberRow({
                  ownerUserIdSnapshot: "owner-target-b",
                  profileId: "agt_target_b",
                  profileName: "Agent B",
                }),
                createDispatchRulesSpaceMemberRow({
                  ownerUserIdSnapshot: "owner-sender",
                  profileId: "agt_sender",
                  profileName: "sender",
                }),
              ],
            }),
          },
        },
      },
      signal
    );

    expect(
      records.map((record) => ({
        dispatchOwner: record.dispatchOwner,
        targetProfileId: record.targetProfileId,
      }))
    ).toEqual([
      {
        dispatchOwner: {
          id: "owner-target-a",
          kind: "owner_account",
        },
        targetProfileId: "agt_target_a",
      },
      {
        dispatchOwner: {
          id: "owner-target-b",
          kind: "owner_account",
        },
        targetProfileId: "agt_target_b",
      },
    ]);
  });

  it("keeps thread Wake handoff seeds tied to the same client message pointer", () => {
    const threadContext = {
      threadId: "thr_thread_wake",
      rootSignalId: "sig-root-thread",
    };
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-thread-wake",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "hum_thread_author",
        profileName: "Thread Author",
      },
      type: "signal.text",
      data: {
        text: "@agt_thread_target continue here",
        meta: {
          clientMessageId: "client-thread-wake-1",
        },
        messageEnvelope: createMessageEnvelope({
          text: "@agt_thread_target continue here",
          activationTargets: ["agt_thread_target"],
        }),
      },
    };

    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  ownerUserIdSnapshot: "owner-target",
                  profileId: "agt_thread_target",
                  profileName: "Thread Agent",
                }),
                createDispatchRulesSpaceMemberRow({
                  ownerUserIdSnapshot: "owner-author",
                  profileId: "hum_thread_author",
                  profileKind: "human",
                  profileName: "Thread Author",
                }),
              ],
            }),
          },
        },
      },
      signal,
      {
        authoringPolicy: "user_authored",
        threadContext,
        threadPlacement: "thread",
      }
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceClientMessageId: "client-thread-wake-1",
      sourceEventId: "sig-thread-wake",
      targetProfileId: "agt_thread_target",
      threadContext,
    });
  });

  it("does not create mention-driven dispatch decisions for body-only legacy text", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-body-only-legacy",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "wake @codex-e2e-profile",
      },
    };

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_77777777-7777-4777-8777-777777777777",
                  profileName: "codex-e2e-profile",
                }),
              ],
            }),
          },
        },
      },
      signal
    );

    expect(decisions).toEqual([]);
  });

  it("does not precompute alias indexes when no dispatch-ready decisions exist", () => {
    const sessionValues = vi.fn(() => [][Symbol.iterator]());
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-no-dispatch-ready",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "plain prose only",
      },
    };

    const preparedOutboxRecords = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1),
          },
        },
        ownerCreatorProfileIdsByOwnerUserId: new Map(),
        resolveDispatchReadyDecisionsFromSignal,
        sessions: {
          values: sessionValues,
        },
        spaceId: "space-1",
      },
      signal
    );

    expect(preparedOutboxRecords).toEqual([]);
    expect(sessionValues).toHaveBeenCalledTimes(1);
  });

  it("does not create dispatch work for Reference-only addressing", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-reference-only",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@Phase 2a Agent(reference) review this as context.",
        messageEnvelope: createMessageEnvelope({
          text: "@Phase 2a Agent(reference) review this as context.",
          referenceTargets: ["agt_55555555-5555-4555-8555-555555555555"],
        }),
      },
    };

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_55555555-5555-4555-8555-555555555555",
                  profileName: "Reference Target",
                }),
              ],
            }),
          },
        },
      },
      signal
    );

    expect(decisions).toEqual([]);
  });

  it("keeps self-trigger blocked semantics while dispatching other activation targets", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-self-trigger-blocked",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "sender",
      },
      type: "signal.text",
      data: {
        text: "ping @agt_11111111-1111-4111-8111-111111111111 @agt_44444444-4444-4444-8444-444444444444",
        messageEnvelope: createMessageEnvelope({
          text: "ping @agt_11111111-1111-4111-8111-111111111111 @agt_44444444-4444-4444-8444-444444444444",
          activationTargets: [
            "agt_11111111-1111-4111-8111-111111111111",
            "agt_44444444-4444-4444-8444-444444444444",
          ],
        }),
      },
    };

    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      signal,
      sql: createDispatchRulesSqlStub(1, {
        spaceMemberRows: [
          createDispatchRulesSpaceMemberRow({
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            profileName: "sender",
          }),
          createDispatchRulesSpaceMemberRow({
            profileId: "agt_44444444-4444-4444-8444-444444444444",
            profileName: "worker",
          }),
        ],
      }),
    });
    expect(decisions).toEqual([
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-self-trigger-blocked",
        status: "blocked",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        errorCode: "dispatch.blocked.self_trigger",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-self-trigger-blocked",
        status: "dispatch_ready",
        targetProfileId: "agt_44444444-4444-4444-8444-444444444444",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("dispatches from activationTargets even when the message body is ordinary prose", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-envelope-prose-only",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "Please take this task.",
        messageEnvelope: createMessageEnvelope({
          text: "Please take this task.",
          activationTargets: ["agt_77777777-7777-4777-8777-777777777777"],
        }),
      },
    };

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_77777777-7777-4777-8777-777777777777",
                  profileName: "Codex Agent",
                }),
              ],
            }),
          },
        },
      },
      signal
    );

    expect(decisions).toEqual([
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-envelope-prose-only",
        status: "dispatch_ready",
        targetProfileId: "agt_77777777-7777-4777-8777-777777777777",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("logs a bounded dispatch planner target sample instead of every queued target id", () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const activationTargets = Array.from({ length: 12 }, (_, index) => {
      return `agt-${String(index + 1).padStart(12, "0")}-2222-4333-8444-555555555555`;
    });
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-dispatch-planner-log-sample",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "Please route this task.",
        messageEnvelope: createMessageEnvelope({
          text: "Please route this task.",
          activationTargets,
        }),
      },
    };

    try {
      resolveDispatchReadyDecisionsFromSignal.call(
        {
          ctx: {
            storage: {
              sql: createDispatchRulesSqlStub(1, {
                spaceMemberRows: activationTargets.map((profileId, index) =>
                  createDispatchRulesSpaceMemberRow({
                    profileId,
                    profileName: `Agent ${index + 1}`,
                  })
                ),
              }),
            },
          },
        },
        signal
      );

      expect(infoSpy).toHaveBeenCalledWith(
        "[core.openmeld.space.dispatch_planner_evaluated]",
        expect.objectContaining({
          queuedTargetCount: 12,
          queuedTargetProfileIdSample: activationTargets.slice(0, 10),
        })
      );
      expect(
        (infoSpy.mock.calls[0]?.[1] as { queuedTargetProfileIds?: unknown }) ??
          {}
      ).not.toHaveProperty("queuedTargetProfileIds");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("fails activationTargets that point to active human members", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-human-target-invalid",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@Owner(wake) this should not dispatch",
        messageEnvelope: createMessageEnvelope({
          text: "@Owner(wake) this should not dispatch",
          activationTargets: ["11111111-1111-4111-8111-111111111111"],
        }),
      },
    };

    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      signal,
      sql: createDispatchRulesSqlStub(1, {
        spaceMemberRows: [
          createDispatchRulesSpaceMemberRow({
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Owner",
          }),
        ],
      }),
    });

    expect(decisions).toEqual([
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-human-target-invalid",
        status: "failed",
        targetProfileId: "11111111-1111-4111-8111-111111111111",
        errorCode: "controller.ref.invalid",
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "profile target cannot be resolved",
      },
    ]);
  });

  it("fails activationTargets that point to removed members", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-removed-target-invalid",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@Removed Agent(wake) should stay prose",
        messageEnvelope: createMessageEnvelope({
          text: "@Removed Agent(wake) should stay prose",
          activationTargets: ["agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        }),
      },
    };

    const decisions = resolveDispatchPlannerDecisionsForSignal({
      dispatchPolicy: "mention_only",
      sessions: null,
      signal,
      sql: createDispatchRulesSqlStub(1, {
        spaceMemberRows: [
          createDispatchRulesSpaceMemberRow({
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            profileName: "Removed Agent",
            status: "removed",
          }),
        ],
      }),
    });

    expect(decisions).toEqual([
      {
        dispatchId: expect.any(String),
        sourceEventId: "sig-removed-target-invalid",
        status: "failed",
        targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        errorCode: "controller.ref.invalid",
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "profile target cannot be resolved",
      },
    ]);
  });

  it("ignores escaped and legacy body mentions when activationTargets is empty", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-escaped-mention",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@my-codex say hi to \\@claude-code-agent",
        messageEnvelope: createMessageEnvelope({
          text: "@my-codex say hi to \\@claude-code-agent",
        }),
      },
    };

    expect(
      resolveDispatchReadyDecisionsFromSignal.call(
        {
          ctx: {
            storage: {
              sql: createDispatchRulesSqlStub(1, {
                spaceMemberRows: [
                  createDispatchRulesSpaceMemberRow({
                    profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    profileName: "my-codex",
                  }),
                  createDispatchRulesSpaceMemberRow({
                    profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    profileName: "claude-code-agent",
                  }),
                ],
              }),
            },
          },
        },
        signal
      )
    ).toEqual([]);
  });

  it("hydrates missing source signal snapshot from local space signal payload", () => {
    const sourceEventId = "sig-source-text-1";
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("FROM space_signals")) {
          return {
            toArray: () => [
              {
                payload_json: JSON.stringify({
                  v: 1,
                  id: sourceEventId,
                  spaceId: "space-1",
                  ts: Date.now(),
                  profile: {
                    kind: "human",
                    profileId: "usr-owner",
                    profileName: "owner",
                  },
                  type: "signal.text",
                  data: {
                    text: "@codex-e2e wake up",
                  },
                } satisfies SignalEnvelope),
              },
            ],
          };
        }
        return { toArray: () => [] };
      }),
    } as unknown as SqlStorage;

    const dispatchMessage = createDispatchMessageFixture(sourceEventId);
    (
      dispatchMessage as { sourceSignalSnapshot?: unknown }
    ).sourceSignalSnapshot = undefined;

    const snapshot = resolveDispatchQueueSourceSignalSnapshot.call(
      {
        ctx: { storage: { sql } },
      },
      dispatchMessage
    );

    expect(snapshot).toEqual({
      text: "@codex-e2e wake up",
      profileId: "usr-owner",
      profileKind: "human",
    });
  });

  it("keeps existing non-empty source signal snapshot without SQL lookup", () => {
    const sql = {
      exec: vi.fn(() => ({ toArray: () => [] })),
    } as unknown as SqlStorage;

    const dispatchMessage = createDispatchMessageFixture("sig-source-text-2");
    dispatchMessage.sourceSignalSnapshot = {
      text: "@codex-e2e wake up",
      profileId: "usr-owner",
      profileKind: "human",
    };

    const snapshot = resolveDispatchQueueSourceSignalSnapshot.call(
      {
        ctx: { storage: { sql } },
      },
      dispatchMessage
    );

    expect(snapshot).toEqual(dispatchMessage.sourceSignalSnapshot);
    expect(sql.exec).not.toHaveBeenCalled();
  });

  it("strips outbox bookkeeping fields before enqueue to keep payload contract stable", async () => {
    const dispatchMessage = createDispatchMessageFixture("evt-outbox-payload");
    const sql = {
      databaseSize: 0,
      exec: vi.fn(() => {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify(dispatchMessage),
              status: "pending",
              created_at_ms: Date.now() - 5000,
              queued_at_ms: null,
            },
          ],
        };
      }),
    } as unknown as SqlStorage;
    const enqueueDispatchMessageWithRetry = vi
      .fn()
      .mockResolvedValue(undefined);

    await flushPendingDispatchOutbox.call({
      ...createOutboxRedriveMethodTarget(),
      ctx: { storage: { sql } },
      readDispatchLedgerEvidence: vi.fn().mockResolvedValue({
        kind: "missing",
      }),
      resolveHandedOffOutboxCandidateDecision,
      readPreAgentStoppedGuardForOutboxCandidate: vi
        .fn()
        .mockResolvedValue({ stopped: false }),
      resolveActiveAttemptWatchdogDecision: vi.fn().mockResolvedValue({
        kind: "skip",
        reason: "still_owned",
      }),
      writeDispatchOutboxWatchdogDecision: vi.fn().mockResolvedValue(undefined),
      buildDispatchMessageFromRecoveryCandidate,
      resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
      resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
      enqueueDispatchMessageWithRetry,
      syncDispatchOutboxAlarm: vi.fn().mockResolvedValue(undefined),
    });

    expect(enqueueDispatchMessageWithRetry).toHaveBeenCalledTimes(1);
    const enqueuedMessage = enqueueDispatchMessageWithRetry.mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(enqueuedMessage).toBeDefined();
    expect(enqueuedMessage).not.toHaveProperty("outboxStatus");
    expect(enqueuedMessage).not.toHaveProperty("createdAtMs");
    expect(enqueuedMessage).not.toHaveProperty("queuedAtMs");
    expect(enqueuedMessage).toHaveProperty("organizationId", "org-space-1");
  });

  it("skips a poison outbox candidate without blocking later candidates", async () => {
    const nowMs = Date.UTC(2026, 6, 3, 12, 58, 0);
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const poisonMessage = {
      ...createDispatchMessageFixture("evt-outbox-poison"),
      dispatchId: "dispatch-poison",
      idempotencyKey: "idem-poison",
      taskId: "task-poison",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000001",
    };
    const healthyMessage = {
      ...createDispatchMessageFixture("evt-outbox-healthy"),
      dispatchId: "dispatch-healthy",
      idempotencyKey: "idem-healthy",
      taskId: "task-healthy",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000002",
    };
    const poisonState = {
      failureCount: 0,
      poisonedAtMs: null as number | null,
    };
    const finalClaimByDispatchAndProfile = new Map<string, string>();
    const signalRows = new Map<string, SignalEnvelope>();
    const terminalSignals: SignalEnvelope[] = [];
    const sql = {
      databaseSize: 0,
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (
          query.includes(
            "SELECT payload_json, status, created_at_ms, queued_at_ms"
          )
        ) {
          return {
            toArray: () =>
              [
                poisonState.poisonedAtMs === null
                  ? {
                      payload_json: JSON.stringify(poisonMessage),
                      status: "pending",
                      created_at_ms: nowMs - 60_000,
                      queued_at_ms: null,
                    }
                  : null,
                {
                  payload_json: JSON.stringify(healthyMessage),
                  status: "pending",
                  created_at_ms: nowMs - 50_000,
                  queued_at_ms: null,
                },
              ].filter(Boolean),
          };
        }
        if (
          query.includes(
            "poison_failure_count = COALESCE(poison_failure_count, 0) + 1"
          )
        ) {
          const dispatchId = String(params[0] ?? "");
          if (dispatchId === poisonMessage.dispatchId) {
            poisonState.failureCount += 1;
          }
          return { rowsWritten: 1, toArray: () => [] };
        }
        if (query.includes("poisoned_at_ms = COALESCE(poisoned_at_ms")) {
          const dispatchId = String(params[2] ?? "");
          if (
            dispatchId === poisonMessage.dispatchId &&
            poisonState.failureCount >= Number(params[3] ?? 0)
          ) {
            poisonState.poisonedAtMs = Number(params[0] ?? nowMs);
          }
          return { rowsWritten: 1, toArray: () => [] };
        }
        if (query.includes("SELECT poison_failure_count, poisoned_at_ms")) {
          return {
            toArray: () => [
              {
                poison_failure_count: poisonState.failureCount,
                poisoned_at_ms: poisonState.poisonedAtMs,
              },
            ],
          };
        }
        if (query.includes("FROM space_final_reply_claims")) {
          const signalId =
            finalClaimByDispatchAndProfile.get(
              `${String(params[0] ?? "")}:${String(params[1] ?? "")}`
            ) ?? null;
          return {
            toArray: () => (signalId ? [{ signal_id: signalId }] : []),
          };
        }
        return { rowsWritten: 0, toArray: () => [] };
      }),
    } as unknown as SqlStorage;
    const enqueueDispatchMessageWithRetry = vi.fn().mockResolvedValue(true);
    const broadcastSignal = vi.fn();
    let terminalSignalCount = 0;
    const buildSystemNoticeSignal = vi.fn(
      (
        profile: SignalEnvelope["profile"],
        data: Extract<SignalEnvelope, { type: "signal.system_notice" }>["data"]
      ) =>
        ({
          v: 1,
          id: `sig-poison-terminal-${++terminalSignalCount}`,
          spaceId: "space-1",
          ts: nowMs + terminalSignalCount,
          profile,
          type: "signal.system_notice",
          data,
        }) satisfies SignalEnvelope
    );
    const persistSignalWithOptionalOutbox = vi.fn((signal: SignalEnvelope) => {
      if (signal.type === "signal.system_notice") {
        finalClaimByDispatchAndProfile.set(
          `${signal.data.dispatchId}:${signal.data.actorProfileId}`,
          signal.id
        );
        signalRows.set(signal.id, signal);
        terminalSignals.push(signal);
      }
      return {
        dispatchMessages: [],
        duplicateFinalReplyBlocked: false,
        persistedSignal: true,
      };
    });
    const readPreAgentStoppedGuardForOutboxCandidate = vi.fn(
      (candidate: OpenMeldDaemonDispatchOutboxRecoveryCandidate) => {
        if (candidate.dispatchId === poisonMessage.dispatchId) {
          return Promise.reject(
            new Error("target_wake_lifecycle.identity_invalid")
          );
        }
        return Promise.resolve({ stopped: false as const });
      }
    );

    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await flushPendingDispatchOutbox.call({
          ...createOutboxRedriveMethodTarget(),
          ctx: { storage: { sql } },
          readDispatchLedgerEvidence: vi.fn().mockResolvedValue({
            kind: "missing",
          }),
          resolveHandedOffOutboxCandidateDecision,
          readPreAgentStoppedGuardForOutboxCandidate,
          resolveActiveAttemptWatchdogDecision: vi.fn().mockResolvedValue({
            kind: "skip",
            reason: "still_owned",
          }),
          writeDispatchOutboxWatchdogDecision: vi
            .fn()
            .mockResolvedValue(undefined),
          buildDispatchMessageFromRecoveryCandidate,
          resolveDispatchQueueSourceSignalSnapshot: vi
            .fn()
            .mockReturnValue(null),
          resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
          enqueueDispatchMessageWithRetry,
          buildSystemNoticeSignal,
          persistSignalWithOptionalOutbox,
          readSignalById: vi.fn(
            (signalId: string) => signalRows.get(signalId) ?? null
          ),
          resolveThreadContextForSignal: vi.fn().mockReturnValue(null),
          broadcastSignal,
          syncDispatchOutboxAlarm: vi.fn().mockResolvedValue(undefined),
        });
      }
    } finally {
      dateNowSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(
      readPreAgentStoppedGuardForOutboxCandidate.mock.calls.filter(
        ([candidate]) => candidate.dispatchId === poisonMessage.dispatchId
      )
    ).toHaveLength(3);
    expect(poisonState).toEqual({
      failureCount: 3,
      poisonedAtMs: nowMs,
    });
    expect(terminalSignals).toHaveLength(1);
    expect(terminalSignals[0]).toMatchObject({
      data: {
        actorProfileId: poisonMessage.targetProfileId,
        dispatchId: poisonMessage.dispatchId,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "dispatch.target_profile_owner_unresolved",
      },
      type: "signal.system_notice",
    });
    expect(broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminalSignals[0]?.id }),
      { finalOutcomeAuthority: "runtime_coordinator_failure_publication" },
      { persisted: true }
    );
    expect(enqueueDispatchMessageWithRetry).toHaveBeenCalledTimes(4);
    expect(
      enqueueDispatchMessageWithRetry.mock.calls.every(
        ([message]) => message.dispatchId === healthyMessage.dispatchId
      )
    ).toBe(true);
  });

  it("continues later alarm recovery steps when dispatch outbox recovery fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const flushPendingSpaceIndexProjectionOutbox = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushPendingDispatchOutbox = vi
      .fn()
      .mockRejectedValue(new Error("dispatch poison"));
    const reconcileDeletedAgentProfileMemberLiveness = vi
      .fn()
      .mockResolvedValue(undefined);
    const flushDirtyMemberProjection = vi.fn().mockResolvedValue(undefined);
    const syncSpaceBackgroundAlarm = vi.fn().mockResolvedValue(undefined);

    try {
      await runSpaceAlarm.call({
        flushDirtyMemberProjection,
        flushPendingDispatchOutbox,
        flushPendingSpaceIndexProjectionOutbox,
        reconcileDeletedAgentProfileMemberLiveness,
        runIsolatedAlarmStep,
        spaceId: "space-1",
        syncSpaceBackgroundAlarm,
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(flushPendingSpaceIndexProjectionOutbox).toHaveBeenCalledTimes(1);
    expect(flushPendingDispatchOutbox).toHaveBeenCalledTimes(1);
    expect(reconcileDeletedAgentProfileMemberLiveness).toHaveBeenCalledTimes(1);
    expect(flushDirtyMemberProjection).toHaveBeenCalledTimes(1);
    expect(syncSpaceBackgroundAlarm).toHaveBeenCalledTimes(1);
  });

  it("rebuilds redrive messages with the latest handoff timestamp", () => {
    const dispatchMessage = createDispatchMessageFixture(
      "evt-outbox-refresh-enqueued-at"
    );

    const rebuilt = buildDispatchMessageFromRecoveryCandidate.call(
      {
        resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
        resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
      },
      {
        ...dispatchMessage,
        outboxStatus: "handed_off",
        createdAtMs: 1_700_000_000_000,
        enqueuedAtMs: 1_700_000_000_000,
        handedOffAtMs: 1_700_000_015_000,
      }
    );

    expect(rebuilt.enqueuedAtMs).toBe(1_700_000_015_000);
  });

  it("qualifies ledger idempotency key when reading joined dispatch status", async () => {
    let capturedQuery = "";
    const db = {
      prepare: vi.fn((query: string) => {
        capturedQuery = query;
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue({
              status: "queued",
              lastAttemptAtMs: 1_700_000_000_000,
              latestAttemptStatus: "dispatching",
              latestAttemptErrorCode: null,
              daemonSessionId: "daemon-session-1",
              connectionGeneration: 1,
              leaseEpoch: 2,
            }),
          })),
        };
      }),
    };

    const result = await readDispatchLedgerEvidence.call(
      {
        bindings: { OPENMELD_DB: db },
        spaceId: "space-1",
      },
      "idem-1"
    );

    expect(capturedQuery).toContain("WHERE ledger.idempotency_key = ?");
    expect(result).toEqual({
      kind: "found",
      row: {
        status: "queued",
        lastAttemptAtMs: 1_700_000_000_000,
        latestAttemptStatus: "dispatching",
        latestAttemptErrorCode: null,
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 2,
      },
    });
  });

  it("does not redrive a handed-off outbox record while the latest attempt is still waiting for result", async () => {
    const dispatchMessage = createDispatchMessageFixture(
      "evt-outbox-active-wait"
    );
    const sql = {
      databaseSize: 0,
      exec: vi.fn(() => {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify(dispatchMessage),
              status: "queued",
              created_at_ms: Date.now() - 60_000,
              queued_at_ms: Date.now() - 60_000,
            },
          ],
        };
      }),
    } as unknown as SqlStorage;
    const enqueueDispatchMessageWithRetry = vi
      .fn()
      .mockResolvedValue(undefined);

    await flushPendingDispatchOutbox.call({
      ...createOutboxRedriveMethodTarget(),
      ctx: { storage: { sql } },
      readDispatchLedgerEvidence: vi.fn().mockResolvedValue({
        kind: "found",
        row: {
          status: "dispatching",
          lastAttemptAtMs: Date.now() - 60_000,
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 5,
        },
      }),
      resolveHandedOffOutboxCandidateDecision,
      readPreAgentStoppedGuardForOutboxCandidate: vi
        .fn()
        .mockResolvedValue({ stopped: false }),
      resolveActiveAttemptWatchdogDecision: vi.fn().mockResolvedValue({
        kind: "skip",
        reason: "still_owned",
      }),
      writeDispatchOutboxWatchdogDecision: vi.fn().mockResolvedValue(undefined),
      buildDispatchMessageFromRecoveryCandidate,
      resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
      resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
      enqueueDispatchMessageWithRetry,
      syncDispatchOutboxAlarm: vi.fn().mockResolvedValue(undefined),
    });

    expect(enqueueDispatchMessageWithRetry).not.toHaveBeenCalled();
  });

  it("leaves handed-off outbox recovery to RuntimeCoordinator when the wait route is connection-replaced", async () => {
    const dispatchMessage = createDispatchMessageFixture(
      "evt-outbox-connection-replaced"
    );
    const sql = {
      databaseSize: 0,
      exec: vi.fn(() => {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify(dispatchMessage),
              status: "queued",
              created_at_ms: Date.now() - 60_000,
              queued_at_ms: Date.now() - 60_000,
            },
          ],
        };
      }),
    } as unknown as SqlStorage;
    const enqueueDispatchMessageWithRetry = vi
      .fn()
      .mockResolvedValue(undefined);
    const writeDispatchOutboxWatchdogDecision = vi
      .fn()
      .mockResolvedValue(undefined);

    await flushPendingDispatchOutbox.call({
      ...createOutboxRedriveMethodTarget(),
      ctx: { storage: { sql } },
      readDispatchLedgerEvidence: vi.fn().mockResolvedValue({
        kind: "found",
        row: {
          status: "dispatching",
          lastAttemptAtMs: Date.now() - 60_000,
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 5,
        },
      }),
      resolveHandedOffOutboxCandidateDecision,
      readPreAgentStoppedGuardForOutboxCandidate: vi
        .fn()
        .mockResolvedValue({ stopped: false }),
      resolveActiveAttemptWatchdogDecision: vi.fn().mockResolvedValue({
        kind: "submit",
        reason: "connection_replaced",
      }),
      writeDispatchOutboxWatchdogDecision,
      buildDispatchMessageFromRecoveryCandidate,
      resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
      resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
      enqueueDispatchMessageWithRetry,
      syncDispatchOutboxAlarm: vi.fn().mockResolvedValue(undefined),
    });

    expect(writeDispatchOutboxWatchdogDecision).not.toHaveBeenCalled();
    expect(enqueueDispatchMessageWithRetry).not.toHaveBeenCalled();
  });

  it("leaves handed-off outbox recovery to RuntimeCoordinator when the latest attempt error implies recovery", async () => {
    const dispatchMessage = createDispatchMessageFixture(
      "evt-outbox-queued-recovery"
    );
    const sql = {
      databaseSize: 0,
      exec: vi.fn(() => {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify(dispatchMessage),
              status: "queued",
              created_at_ms: Date.now() - 60_000,
              queued_at_ms: Date.now() - 60_000,
            },
          ],
        };
      }),
    } as unknown as SqlStorage;
    const enqueueDispatchMessageWithRetry = vi
      .fn()
      .mockResolvedValue(undefined);
    const writeDispatchOutboxWatchdogDecision = vi
      .fn()
      .mockResolvedValue(undefined);

    await flushPendingDispatchOutbox.call({
      ...createOutboxRedriveMethodTarget(),
      ctx: { storage: { sql } },
      readDispatchLedgerEvidence: vi.fn().mockResolvedValue({
        kind: "found",
        row: {
          status: "failed_retryable",
          lastAttemptAtMs: Date.now() - 60_000,
          latestAttemptStatus: "failed_retryable",
          latestAttemptErrorCode: "daemon.session.connection_replaced",
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 2,
          leaseEpoch: 5,
        },
      }),
      resolveHandedOffOutboxCandidateDecision,
      readPreAgentStoppedGuardForOutboxCandidate: vi
        .fn()
        .mockResolvedValue({ stopped: false }),
      resolveActiveAttemptWatchdogDecision: vi.fn(),
      writeDispatchOutboxWatchdogDecision,
      buildDispatchMessageFromRecoveryCandidate,
      resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
      resolveDispatchQueueReplyToSnapshot: vi.fn().mockReturnValue(null),
      enqueueDispatchMessageWithRetry,
      syncDispatchOutboxAlarm: vi.fn().mockResolvedValue(undefined),
    });

    expect(writeDispatchOutboxWatchdogDecision).not.toHaveBeenCalled();
    expect(enqueueDispatchMessageWithRetry).not.toHaveBeenCalled();
  });

  it("does not dispatch body-only legacy text even when persisted alias history exists", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-name-offline-resolve",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "wake @codex-e2e-profile",
      },
    };

    const legacyFriendlyAliasSignal = JSON.stringify({
      v: 1,
      id: "sig-presence-codex",
      spaceId: "space-1",
      ts: Date.now() - 10_000,
      profile: {
        kind: "agent",
        profileId: "agt_77777777-7777-4777-8777-777777777777",
        profileName: "codex-e2e-profile",
      },
      type: "presence.join",
      data: {},
    } satisfies SignalEnvelope);
    const newerIdAliasSignal = JSON.stringify({
      v: 1,
      id: "sig-runtime-reply",
      spaceId: "space-1",
      ts: Date.now() - 5000,
      profile: {
        kind: "agent",
        profileId: "agt_77777777-7777-4777-8777-777777777777",
        profileName: "agt_77777777-7777-4777-8777-777777777777",
      },
      type: "signal.text",
      data: {
        text: "runtime ack",
      },
    } satisfies SignalEnvelope);

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              mentionAliasRows: [
                {
                  profile_id: "agt_77777777-7777-4777-8777-777777777777",
                  payload_json: newerIdAliasSignal,
                },
                {
                  profile_id: "agt_77777777-7777-4777-8777-777777777777",
                  payload_json: legacyFriendlyAliasSignal,
                },
              ],
            }),
          },
        },
      },
      signal
    );

    expect(decisions).toEqual([]);
  });

  it("blocks all mention dispatch when space rule allow=0", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-deny",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "ping @agt_22222222-2222-4222-8222-222222222222 @agt_33333333-3333-4333-8333-333333333333",
        messageEnvelope: createMessageEnvelope({
          text: "ping @agt_22222222-2222-4222-8222-222222222222 @agt_33333333-3333-4333-8333-333333333333",
          activationTargets: [
            "agt_22222222-2222-4222-8222-222222222222",
            "agt_33333333-3333-4333-8333-333333333333",
          ],
        }),
      },
    };

    const decisions = resolveDispatchReadyDecisionsFromSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(0, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_22222222-2222-4222-8222-222222222222",
                  profileName: "Agent A",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_33333333-3333-4333-8333-333333333333",
                  profileName: "Agent B",
                }),
              ],
            }),
          },
        },
      },
      signal
    );

    expect(decisions).toEqual([]);
  });

  it("removes canonical target mention before writing sourceSignalSnapshot for dispatch", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-strip-target-mention",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@auto-reply-test-codex(wake) wake up, who are you",
        messageEnvelope: createMessageEnvelope({
          text: "@auto-reply-test-codex(wake) wake up, who are you",
          activationTargets: ["agt_77777777-7777-4777-8777-777777777777"],
        }),
      },
    };

    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_77777777-7777-4777-8777-777777777777",
                  profileName: "auto-reply-test-codex",
                }),
              ],
            }),
          },
        },
        sessions: new Map([
          [
            {},
            {
              profile: {
                kind: "agent",
                profileId: "agt_77777777-7777-4777-8777-777777777777",
                profileName: "auto-reply-test-codex",
                profileHandle: "auto-reply-test-codex",
              },
            },
          ],
        ]),
        resolveDispatchReadyDecisionsFromSignal,
      },
      signal
    );

    expect(records).toHaveLength(1);
    const [firstRecord] = records;
    expect(firstRecord).toBeDefined();
    expect(firstRecord?.sourceSignalSnapshot?.text).toBe(
      "wake up, who are you"
    );
    expect(firstRecord?.organizationId).toBe("org-space-1");
    expect(firstRecord?.replyToSnapshot).toEqual({
      signalId: "sig-strip-target-mention",
      profileId: "usr-owner",
      profileKind: "human",
      profileName: "owner",
      previewText: "@auto-reply-test-codex(wake) wake up, who are you",
    });
  });

  it("preserves image attachment metadata for Wake delivery", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-image-wake",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@auto-reply-test-codex(wake) review this diagram",
        attachments: [
          {
            id: "attachment-1",
            mimeType: "image/png",
            sizeBytes: 1024,
            width: 800,
            height: 600,
            fileName: "diagram.png",
          },
        ],
        messageEnvelope: createMessageEnvelope({
          text: "@auto-reply-test-codex(wake) review this diagram",
          activationTargets: ["agt_77777777-7777-4777-8777-777777777777"],
        }),
      },
    };

    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_77777777-7777-4777-8777-777777777777",
                  profileName: "auto-reply-test-codex",
                }),
              ],
            }),
          },
        },
        sessions: new Map(),
        resolveDispatchReadyDecisionsFromSignal,
      },
      signal
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.sourceSignalSnapshot).toEqual({
      attachments: [
        {
          id: "attachment-1",
          mimeType: "image/png",
          sizeBytes: 1024,
          width: 800,
          height: 600,
          fileName: "diagram.png",
        },
      ],
      profileId: "usr-owner",
      profileKind: "human",
      text: "review this diagram",
    });
    expect(records[0]?.payloadJson).toContain("attachment-1");
    expect(records[0]?.payloadJson).toContain("diagram.png");
  });

  it("reuses the same replyToSnapshot for every dispatch from one source signal", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-multi-target-reply-to",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@alpha-agent please sync with @beta-agent today",
        messageEnvelope: createMessageEnvelope({
          text: "@alpha-agent please sync with @beta-agent today",
          activationTargets: [
            "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "agt_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          ],
        }),
      },
    };

    const records = prepareDispatchOutboxRecordsForSignal.call(
      {
        ctx: {
          storage: {
            sql: createDispatchRulesSqlStub(1, {
              spaceMemberRows: [
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                  profileName: "alpha-agent",
                }),
                createDispatchRulesSpaceMemberRow({
                  profileId: "agt_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  profileName: "beta-agent",
                }),
              ],
            }),
          },
        },
        sessions: new Map([
          [
            {},
            {
              profile: {
                kind: "agent",
                profileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                profileName: "alpha-agent",
                profileHandle: "alpha-agent",
              },
            },
          ],
          [
            {},
            {
              profile: {
                kind: "agent",
                profileId: "agt_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                profileName: "beta-agent",
                profileHandle: "beta-agent",
              },
            },
          ],
        ]),
        resolveDispatchReadyDecisionsFromSignal,
      },
      signal
    );

    expect(records).toHaveLength(2);
    const [alphaRecord, betaRecord] = records;
    expect(alphaRecord?.replyToSnapshot).toEqual(betaRecord?.replyToSnapshot);
    expect(alphaRecord?.replyToSnapshot).toEqual({
      signalId: "sig-multi-target-reply-to",
      profileId: "usr-owner",
      profileKind: "human",
      profileName: "owner",
      previewText: "@alpha-agent please sync with @beta-agent today",
    });
  });

  it("best-effort backfills replyToSnapshot from the original source signal during redrive", () => {
    const dispatchMessage = createDispatchMessageFixture(
      "sig-redrive-reply-to"
    );
    dispatchMessage.sourceProfileNameSnapshot = "Snapshot Owner";
    const sql = {
      exec: vi.fn(() => {
        return {
          toArray: () => [
            {
              payload_json: JSON.stringify({
                v: 1,
                id: "sig-redrive-reply-to",
                spaceId: "space-1",
                ts: Date.now(),
                profile: {
                  kind: "human",
                  profileId: "usr-owner",
                  profileName: "Owner From Signal",
                },
                type: "signal.text",
                data: {
                  text: "  @codex ping\nwith   extra spaces  ",
                },
              } satisfies SignalEnvelope),
            },
          ],
        };
      }),
    } as unknown as SqlStorage;

    const rebuilt = buildDispatchMessageFromRecoveryCandidate.call(
      {
        ctx: { storage: { sql } },
        resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
        resolveDispatchQueueReplyToSnapshot,
      },
      {
        ...dispatchMessage,
        outboxStatus: "handed_off",
        createdAtMs: 1_700_000_000_000,
        handedOffAtMs: 1_700_000_015_000,
      }
    );

    expect(rebuilt.replyToSnapshot).toEqual({
      signalId: "sig-redrive-reply-to",
      profileId: "usr-owner",
      profileKind: "human",
      profileName: "Snapshot Owner",
      previewText: "@codex ping with extra spaces",
    });
  });

  it("keeps redrive moving when replyToSnapshot backfill cannot read the source signal", () => {
    const dispatchMessage = createDispatchMessageFixture(
      "sig-redrive-reply-to-missing"
    );
    const sql = {
      exec: vi.fn(() => {
        return {
          toArray: () => [],
        };
      }),
    } as unknown as SqlStorage;

    const rebuilt = buildDispatchMessageFromRecoveryCandidate.call(
      {
        ctx: { storage: { sql } },
        resolveDispatchQueueSourceSignalSnapshot: vi.fn().mockReturnValue(null),
        resolveDispatchQueueReplyToSnapshot,
      },
      {
        ...dispatchMessage,
        outboxStatus: "handed_off",
        createdAtMs: 1_700_000_000_000,
        handedOffAtMs: 1_700_000_015_000,
      }
    );

    expect(rebuilt.replyToSnapshot).toBeUndefined();
    expect(rebuilt.dispatchId).toBe(dispatchMessage.dispatchId);
  });

  it("publishes signal.text as persist success -> broadcast", async () => {
    const order: string[] = [];
    const recordOrganizationMemberHumanActivity = vi
      .fn()
      .mockResolvedValue(undefined);
    const target: SignalPublisherTarget = {
      assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
      persistSignal: () => {
        order.push("persist");
        return Promise.resolve();
      },
      persistSignalWithOptionalOutbox: () => {
        order.push("persist");
        return createPersistSignalWithOptionalOutboxResult();
      },
      enqueueDispatchMessageWithRetry: vi.fn().mockResolvedValue(undefined),
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      recordOrganizationMemberHumanActivity,
      broadcastSignal: () => {
        order.push("broadcast");
      },
      ctx: {
        waitUntil: vi.fn(),
      },
      spaceId: "space-1",
      durableObjectId: "do-1",
    };

    await publishTextSignal.call(target, makeSignal("signal.text"));
    expect(order).toEqual(["persist", "broadcast"]);
    expect(recordOrganizationMemberHumanActivity).toHaveBeenCalledOnce();
  });

  it("emits retention warning only on main signal.text path and applies debounce", () => {
    const emitRetentionWarning = vi.fn();
    const target = {
      lastRetentionWarningAtMs: 0,
      spaceId: "space-1",
      durableObjectId: "do-1",
      emitRetentionWarningSignal: emitRetentionWarning,
    };

    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("presence.join"),
      createOutboxRecord: true,
      finalDatabaseSizeBytes: TARGET_BYTES,
      nowMs: 10_000_000,
    });
    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("signal.text"),
      createOutboxRecord: false,
      finalDatabaseSizeBytes: TARGET_BYTES,
      nowMs: 10_000_000,
    });
    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("signal.text"),
      createOutboxRecord: true,
      finalDatabaseSizeBytes: TARGET_BYTES - 1,
      nowMs: 10_000_000,
    });
    expect(emitRetentionWarning).not.toHaveBeenCalled();

    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("signal.text"),
      createOutboxRecord: true,
      finalDatabaseSizeBytes: TARGET_BYTES,
      nowMs: 11_000_000,
    });
    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("signal.text"),
      createOutboxRecord: true,
      finalDatabaseSizeBytes: TARGET_BYTES,
      nowMs: 11_000_500,
    });
    maybeEmitRetentionWarningSignal.call(target, {
      signal: makeSignal("signal.text"),
      createOutboxRecord: true,
      finalDatabaseSizeBytes: TARGET_BYTES,
      nowMs: 11_000_000 + 3_600_000,
    });

    expect(emitRetentionWarning).toHaveBeenCalledTimes(2);
  });

  it("persists retention warning as signal.text without outbox dispatch", () => {
    const persistedSignals: SignalEnvelope[] = [];
    const target = {
      buildTextSignal: (
        profile: SignalEnvelope["profile"],
        text: string
      ): SignalEnvelope => ({
        ...makeSignal("signal.text"),
        id: "retention-warning-signal",
        profile,
        data: {
          text,
        },
      }),
      persistSignalWithOptionalOutbox: (
        signal: SignalEnvelope,
        createOutboxRecord: boolean
      ) => {
        if (createOutboxRecord) {
          throw new Error("retention warning should not enter outbox");
        }
        persistedSignals.push(signal);
        return createPersistSignalWithOptionalOutboxResult();
      },
      broadcastSignal: vi.fn(),
    };

    emitRetentionWarningSignal.call(target);

    expect(persistedSignals).toHaveLength(1);
    expect(persistedSignals[0]?.type).toBe("signal.text");
    expect(readSignalText(persistedSignals[0] as SignalEnvelope)).toBe(
      RETENTION_WARNING_TEXT
    );
    expect(persistedSignals[0]?.profile).toEqual({
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    });
    expect(target.broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.text",
        data: {
          text: RETENTION_WARNING_TEXT,
        },
      }),
      undefined,
      { persisted: true }
    );
  });

  it("does not broadcast signal.text when persist fails", async () => {
    const target: SignalPublisherTarget = {
      assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
      persistSignal: () => Promise.reject(new Error("persist failed")),
      persistSignalWithOptionalOutbox: () => {
        throw new Error("persist failed");
      },
      enqueueDispatchMessageWithRetry: vi.fn().mockResolvedValue(undefined),
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      recordOrganizationMemberHumanActivity: vi
        .fn()
        .mockResolvedValue(undefined),
      broadcastSignal: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
      spaceId: "space-1",
      durableObjectId: "do-1",
    };

    await expect(
      publishTextSignal.call(target, makeSignal("signal.text"))
    ).rejects.toThrow("persist failed");
    expect(target.broadcastSignal).not.toHaveBeenCalled();
  });

  it("broadcasts presence live without persisting it to the durable stream", () => {
    const waitUntil = vi.fn();
    const persistSignalWithOptionalOutbox = vi
      .fn()
      .mockReturnValue(createPersistSignalWithOptionalOutboxResult());
    const target: SignalPublisherTarget = {
      persistSignal: vi.fn().mockResolvedValue(undefined),
      persistSignalWithOptionalOutbox,
      enqueueDispatchMessageWithRetry: vi.fn().mockResolvedValue(undefined),
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      recordOrganizationMemberHumanActivity: vi
        .fn()
        .mockResolvedValue(undefined),
      broadcastSignal: vi.fn(),
      ctx: {
        waitUntil,
      },
      spaceId: "space-1",
      durableObjectId: "do-1",
    };

    publishPresenceSignal.call(target, makeSignal("presence.join"));
    expect(target.broadcastSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "presence.join",
      }),
      undefined,
      { persisted: false }
    );
    expect(waitUntil).not.toHaveBeenCalled();
    // Presence is ephemeral "who is here now": broadcast live, never written to
    // the durable signal stream (it would only bloat it and bury real messages).
    expect(persistSignalWithOptionalOutbox).not.toHaveBeenCalled();
    expect(target.persistSignal).not.toHaveBeenCalled();
  });

  it("keeps persisted presence rows in history pages", () => {
    const page = resolveSignalsPageFromEntries({
      entries: [
        [
          `${new Date(100).toISOString()}|presence-1`,
          JSON.stringify(makeSignal("presence.join")),
        ],
        [
          `${new Date(101).toISOString()}|text-1`,
          JSON.stringify(makeSignal("signal.text")),
        ],
      ],
      afterTs: null,
      limit: 10,
      readWindowFull: false,
    });

    expect(page.signals).toHaveLength(2);
    expect(page.signals[0]?.type).toBe("presence.join");
    expect(page.signals[1]?.type).toBe("signal.text");
    expect(page.nextCursor).toBeNull();
  });

  it("uses the outbox flush sender as the only queue writer when outbox message exists", async () => {
    const waitUntil = vi.fn();
    const pending: Promise<void>[] = [];
    const recordOrganizationMemberHumanActivity = vi
      .fn()
      .mockResolvedValue(undefined);
    const target: SignalPublisherTarget = {
      assertRemoteAgentFinalReplyWasNotStopped: vi.fn(),
      persistSignal: vi.fn(),
      persistSignalWithOptionalOutbox: () =>
        createPersistSignalWithOptionalOutboxResult({
          dispatchMessages: [
            {
              v: 2,
              dispatchId: "dispatch-1",
              spaceId: "space-1",
              sourceEventId: "evt-1",
              targetProfileId: "profile-1",
              dispatchChainId: "dispatch-1",
              autoRelayDepth: 0,
              visitedProfileIds: [],
              visitedProfileIdsHash: "stable32:11111111",
              dispatchContractVersion: 2,
              dispatchPolicy: "mention_only",
              ruleSource: "registry",
              ruleId: "registry.default.all_members.v1",
              ruleReason: "default allow all members mention",
              taskId: "task-1",
              transportMode: null,
              controllerSnapshot: {
                targetBindingState: "bound",
                targetBindingEnabled: true,
                agentControllerRef: null,
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
                profileId: "profile-1",
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
              idempotencyKey: "5:evt-1|9:profile-1",
              enqueuedAtMs: Date.now(),
            },
          ],
        }),
      enqueueDispatchMessageWithRetry: vi.fn().mockResolvedValue(undefined),
      flushPendingDispatchOutbox: vi.fn().mockResolvedValue(undefined),
      recordOrganizationMemberHumanActivity,
      broadcastSignal: vi.fn(),
      ctx: {
        waitUntil: (promise) => {
          pending.push(promise);
          waitUntil(promise);
        },
      },
      spaceId: "space-1",
      durableObjectId: "do-1",
    };

    await publishTextSignal.call(target, makeSignal("signal.text"));
    expect(target.broadcastSignal).toHaveBeenCalledTimes(1);
    expect(recordOrganizationMemberHumanActivity).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await Promise.all(pending);
    expect(target.enqueueDispatchMessageWithRetry).not.toHaveBeenCalled();
    expect(target.flushPendingDispatchOutbox).toHaveBeenCalledTimes(1);
  });

  it("reschedules a fired alarm at the next owner deadline", async () => {
    const nowMs = Date.UTC(2026, 2, 10, 8, 0, 0);
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const sql = {
      exec: vi.fn(() => ({
        toArray: () => [],
      })),
    } as unknown as SqlStorage;
    const getAlarm = vi.fn().mockResolvedValue(nowMs - 60_000);
    const setAlarm = vi.fn().mockResolvedValue(undefined);
    const deleteAlarm = vi.fn().mockResolvedValue(undefined);

    await syncSpaceBackgroundAlarm.call({
      ctx: {
        storage: {
          sql,
          getAlarm,
          setAlarm,
          deleteAlarm,
        },
      },
      agentStreamProjectionStorage: {
        list: <T>() => Promise.resolve(new Map<string, T>()),
      },
      resolveNextDispatchOutboxAlarmAtMs: vi.fn(() => nowMs + 30_000),
      spaceId: "space-1",
    });

    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm).toHaveBeenCalledWith(nowMs + 30_000);
    expect(deleteAlarm).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });

  it("fails fast on oversize snapshot before signal persistence side effects", () => {
    const observedSql: string[] = [];
    const sql = {
      databaseSize: 0,
      exec: vi.fn((query: string) => {
        observedSql.push(query);
        if (
          query.includes("SELECT") &&
          query.includes("space_dispatch_rules")
        ) {
          return {
            toArray: () => [
              {
                mode: "all_members",
                allow: 1,
                rule_id: "space.default.all_members.v1",
                rule_reason: "x".repeat(40_000),
                rule_set_version: 1,
                updated_by: "system",
                updated_at_ms: Date.UTC(2026, 1, 26, 10, 0, 0),
              },
            ],
          };
        }
        if (
          query.includes("FROM space_members") &&
          query.includes("profile_kind_snapshot")
        ) {
          return {
            toArray: () => [
              createDispatchRulesSpaceMemberRow({
                profileId: "agt_22222222-2222-4222-8222-222222222222",
                profileName: "Agent A",
              }),
            ],
          };
        }
        return {
          rowsWritten: 1,
          toArray: () => [],
        };
      }),
    } as unknown as SqlStorage;

    const target = {
      ctx: { storage: { sql } },
      spaceId: "space-1",
      durableObjectId: "do-1",
      lastPostCleanupAtMs: 0,
      prepareDispatchOutboxPlanForSignal(signal: SignalEnvelope) {
        return prepareDispatchOutboxPlanForSignal.call(this, signal);
      },
      collectInsertedDispatchMessages(
        preparedOutboxRecords: DispatchOutboxRecord[],
        dispatchMessages: Array<{ dispatchId: string }>
      ) {
        collectInsertedDispatchMessages.call(
          this,
          preparedOutboxRecords,
          dispatchMessages
        );
      },
      readSpaceMetaRecord: vi.fn(() => ({ organizationId: "org-space-1" })),
    };

    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-oversize",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@agt_22222222-2222-4222-8222-222222222222 run this",
        messageEnvelope: createMessageEnvelope({
          text: "@agt_22222222-2222-4222-8222-222222222222 run this",
          activationTargets: ["agt_22222222-2222-4222-8222-222222222222"],
        }),
      },
    };

    expect(() =>
      persistSignalWithOptionalOutbox.call(target, signal, true)
    ).toThrowError(DISPATCH_SNAPSHOT_OVERSIZE_PATTERN);

    expect(
      observedSql.some((query) =>
        query.includes("INSERT OR IGNORE INTO space_signals")
      )
    ).toBe(false);
    expect(
      observedSql.some((query) =>
        query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")
      )
    ).toBe(false);
  });

  it("fails closed before signal persistence when a user-authored Wake target is not in the Space", () => {
    const observedSql: string[] = [];
    const sql = {
      databaseSize: 0,
      exec: vi.fn((query: string) => {
        observedSql.push(query);
        if (
          query.includes("SELECT") &&
          query.includes("space_dispatch_rules")
        ) {
          return {
            toArray: () => [
              {
                mode: "all_members",
                allow: 1,
                rule_id: "space.default.all_members.v1",
                rule_reason: "default allow all members mention",
                rule_set_version: 1,
                updated_by: "system",
                updated_at_ms: Date.UTC(2026, 1, 26, 10, 0, 0),
              },
            ],
          };
        }
        if (
          query.includes("FROM space_members") &&
          query.includes("profile_kind_snapshot")
        ) {
          return {
            toArray: () => [],
          };
        }
        return {
          rowsWritten: 1,
          toArray: () => [],
        };
      }),
    } as unknown as SqlStorage;

    const target = {
      ctx: { storage: { sql } },
      spaceId: "space-1",
      durableObjectId: "do-1",
      lastPostCleanupAtMs: 0,
      prepareDispatchOutboxPlanForSignal(signal: SignalEnvelope) {
        return prepareDispatchOutboxPlanForSignal.call(this, signal, {
          authoringPolicy: "user_authored",
        });
      },
      collectInsertedDispatchMessages(
        preparedOutboxRecords: DispatchOutboxRecord[],
        dispatchMessages: Array<{ dispatchId: string }>
      ) {
        collectInsertedDispatchMessages.call(
          this,
          preparedOutboxRecords,
          dispatchMessages
        );
      },
      readSpaceMetaRecord: vi.fn(() => null),
    };

    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-invalid-target",
      spaceId: "space-1",
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: "usr-owner",
        profileName: "owner",
      },
      type: "signal.text",
      data: {
        text: "@agt_missing run this",
        meta: {
          clientMessageId: "client-message-invalid-target",
        },
        messageEnvelope: createMessageEnvelope({
          text: "@agt_missing run this",
          activationTargets: ["agt_missing"],
        }),
      },
    };

    let caughtInvalidTargetError: unknown;
    try {
      persistSignalWithOptionalOutbox.call(target, signal, true, {
        authoringPolicy: "user_authored",
      });
    } catch (error) {
      caughtInvalidTargetError = error;
    }
    expect(caughtInvalidTargetError).toMatchObject({
      code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
      targetProfileId: "agt_missing",
    });
    expect((caughtInvalidTargetError as Error).message).toBe(
      "OpenMeld could not start this Wake for agt_missing. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again."
    );

    expect(
      observedSql.some((query) =>
        query.includes("INSERT OR IGNORE INTO space_signals")
      )
    ).toBe(false);
    expect(
      observedSql.some((query) =>
        query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")
      )
    ).toBe(false);
  });

  it("fails closed when handoff seed insertion is ignored without an idempotent existing seed", () => {
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "evt-handoff-seed",
      sourceClientMessageId: "client-message-handoff-seed",
      senderProfileId: "usr-owner",
      sourceSignalSnapshot: {
        text: "@agt_target run this",
        profileId: "usr-owner",
        profileKind: "human",
      },
      targetProfileId: "agt_target",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      nowMs: Date.UTC(2026, 1, 26, 10, 0, 0),
    });
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("INSERT OR IGNORE INTO openMeldDaemon_outbox")) {
          return { rowsWritten: 0 };
        }
        return {
          rowsWritten: 0,
          toArray: () => [],
        };
      }),
    } as unknown as SqlStorage;
    const dispatchMessages: OpenMeldDaemonDispatchQueueMessage[] = [];

    let caughtHandoffSeedError: unknown;
    try {
      collectInsertedDispatchMessages.call(
        { ctx: { storage: { sql } } },
        [record],
        dispatchMessages
      );
    } catch (error) {
      caughtHandoffSeedError = error;
    }
    expect(caughtHandoffSeedError).toMatchObject({
      code: SPACE_WAKE_HANDOFF_SEED_FAILED_ERROR_CODE,
      targetProfileId: "agt_target",
    });
    expect((caughtHandoffSeedError as Error).message).toBe(
      "OpenMeld could not prepare this Wake for agt_target. The message was not sent. Try again."
    );
    expect(dispatchMessages).toEqual([]);
  });

  it("rejects a thread Wake authoring failure through the same user-authored publish path", async () => {
    const missingTargetProfileId = "agt_99999999-9999-4999-8999-999999999999";
    const message = `OpenMeld could not start this Wake for ${missingTargetProfileId}. That agent is not in this Space. The message was not sent. Choose an agent in this Space and try again.`;
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.includes("FROM space_threads")) {
          return {
            toArray: () => [
              {
                thread_id: "thr-thread-1",
                space_id: "space-1",
                root_signal_id: "sig-root-1",
                created_by_profile_id: "hum-thread-author",
                created_at_ms: Date.UTC(2026, 1, 26, 10, 0, 0),
                updated_at_ms: Date.UTC(2026, 1, 26, 10, 0, 0),
              },
            ],
          };
        }
        return {
          rowsWritten: 1,
          toArray: () => [],
        };
      }),
    } as unknown as SqlStorage;
    const publishTextSignal = vi.fn(
      (
        _signal: SignalEnvelope,
        signalContext?: SignalPublishContext
      ): Promise<void> => {
        expect(signalContext).toMatchObject({
          authoringPolicy: "user_authored",
          threadContext: {
            threadId: "thr-thread-1",
            rootSignalId: "sig-root-1",
          },
          threadPlacement: "thread",
        });
        return Promise.reject(
          new SpaceSignalAuthoringError({
            code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
            message,
            targetProfileId: missingTargetProfileId,
          })
        );
      }
    );
    const buildTextSignal = vi.fn(
      (
        profile: SignalEnvelope["profile"],
        text: string,
        options?: SignalTextBuildOptions
      ): SignalEnvelope => ({
        v: 1,
        id: "sig-thread-invalid-target",
        spaceId: "space-1",
        ts: Date.UTC(2026, 1, 26, 10, 1, 0),
        profile,
        type: "signal.text",
        data: {
          text,
          ...(options?.messageEnvelope
            ? { messageEnvelope: options.messageEnvelope }
            : {}),
          ...(options?.meta ? { meta: options.meta } : {}),
        },
      })
    );
    const text = "@Missing Agent(wake) please continue";
    const response = await handlePostThreadSignal.call(
      {
        buildTextSignal,
        ctx: {
          blockConcurrencyWhile: async <T>(
            callback: () => Promise<T>
          ): Promise<T> => await callback(),
          storage: { sql },
        },
        publishTextSignal,
        readSourceTextSignalByClientMessageId: vi.fn(() => null),
      },
      {
        context: {
          actorContext: {
            requestId: "req-thread-wake-1",
            openMeldProfileId: "hum-thread-author",
            profileKind: "human",
            profileName: "Thread Author",
          },
        },
        request: new Request("http://local/thread/signals", {
          method: "POST",
          body: JSON.stringify({
            clientMessageId: "client-thread-invalid-target",
            text,
            messageEnvelope: createMessageEnvelope({
              text,
              activationTargets: [missingTargetProfileId],
            }),
          }),
        }),
        threadId: "thr-thread-1",
      }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: SPACE_WAKE_TARGET_INVALID_ERROR_CODE,
        message,
        requestId: "req-thread-wake-1",
      },
    });
    expect(buildTextSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "hum-thread-author",
      }),
      text,
      expect.objectContaining({
        messageEnvelope: expect.objectContaining({
          activationTargets: [missingTargetProfileId],
        }),
        meta: {
          clientMessageId: "client-thread-invalid-target",
        },
      })
    );
    expect(publishTextSignal).toHaveBeenCalledTimes(1);
  });

  it("keeps dispatch chain headers when building direct rpc request", () => {
    const request = buildDirectRpcRequest.call(
      {},
      {
        path: "/signals",
        method: "POST",
        context: {
          actorContext: {
            requestId: "req-1",
            openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
            profileKind: "agent",
            dispatchChainId: "chain-1",
            autoRelayDepth: 2,
            visitedProfileIdsHash: "stable32:abc12345",
            visitedProfileIds: [
              "agt_11111111-1111-4111-8111-111111111111",
              "agt_22222222-2222-4222-8222-222222222222",
            ],
          },
        },
      }
    );

    expect(request.headers.get(OPENMELD_HEADER_DISPATCH_CHAIN_ID)).toBe(
      "chain-1"
    );
    expect(request.headers.get(OPENMELD_HEADER_AUTO_RELAY_DEPTH)).toBe("2");
    expect(request.headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH)).toBe(
      "stable32:abc12345"
    );
    expect(request.headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS)).toBe(
      "agt_11111111-1111-4111-8111-111111111111,agt_22222222-2222-4222-8222-222222222222"
    );
  });

  it("forwards protected-space password from websocket session into publishTextSignal", async () => {
    const publishTextSignalSpy = vi.fn();
    const buildTextSignalSpy = vi.fn(
      (profile: SignalEnvelope["profile"], text: string): SignalEnvelope => ({
        v: 1,
        id: "sig-protected-ws",
        spaceId: "space-protected-1",
        ts: Date.now(),
        profile,
        type: "signal.text",
        data: { text },
      })
    );
    const webSocket = {
      close: vi.fn(),
      send: vi.fn(),
    };
    const profile: SignalEnvelope["profile"] = {
      kind: "human" as const,
      profileId: "hum-protected-1",
      profileName: "Protected User",
    };
    const session = createAcceptedWebSocketSession({
      profile,
      spacePassword: "secret-123",
    });
    const sessions = new Map([[webSocket, session]]);

    await webSocketMessage.call(
      {
        sessions,
        buildTextSignal: buildTextSignalSpy,
        publishTextSignal: publishTextSignalSpy,
      },
      webSocket,
      JSON.stringify({
        type: "signal.text",
        data: { text: "@agt_f1111111-1111-4111-8111-111111111111 hello" },
      })
    );

    expect(buildTextSignalSpy).toHaveBeenCalledWith(
      profile,
      "@agt_f1111111-1111-4111-8111-111111111111 hello"
    );
    expect(publishTextSignalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "signal.text",
      }),
      {
        authoringPolicy: "user_authored",
        spacePassword: "secret-123",
      }
    );
    expect(webSocket.send).not.toHaveBeenCalled();
    expect(webSocket.close).not.toHaveBeenCalled();
  });

  it("keeps websocket signal context limited to authoring policy without protected-space password", async () => {
    const publishTextSignalSpy = vi.fn();
    const webSocket = {
      close: vi.fn(),
      send: vi.fn(),
    };
    const session = createAcceptedWebSocketSession({
      profile: {
        kind: "human" as const,
        profileId: "hum-open-1",
        profileName: "Open User",
      },
    });
    const sessions = new Map([[webSocket, session]]);

    await webSocketMessage.call(
      {
        sessions,
        buildTextSignal: (
          profile: SignalEnvelope["profile"],
          text: string
        ): SignalEnvelope => ({
          v: 1,
          id: "sig-open-ws",
          spaceId: "space-open-1",
          ts: Date.now(),
          profile,
          type: "signal.text",
          data: { text },
        }),
        publishTextSignal: publishTextSignalSpy,
      },
      webSocket,
      JSON.stringify({
        type: "signal.text",
        data: { text: "@agt_f2222222-2222-4222-8222-222222222222 hello" },
      })
    );

    expect(publishTextSignalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "signal.text",
      }),
      {
        authoringPolicy: "user_authored",
      }
    );
  });
});
