import { createHash } from "node:crypto";
import {
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
} from "@openmeld/agent-runtime";
import {
  type PostgreSQLBinding,
  PostgresDatabase,
} from "@openmeld/db/postgresql";
import { MAX_TEXT_LENGTH } from "@openmeld/protocol";
import {
  buildRuntimeCoordinatorExecutionId,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
  RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  DispatchExecution,
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldDaemonTaskResultEnvelope,
  RuntimeTransportDispatchLifecycleSnapshot,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionPostgresBinding } from "../../test-support/postgresql-query.test-support";
import { createPublishedCliReleasesBucket } from "../../test-support/published-local-components-release";
import type { CoreAgentExecutionReadiness } from "../agent-execution/application/agent-execution-readiness-service";
// biome-ignore lint/performance/noNamespaceImport: Needed to verify dispatch admission consumes the canonical Core readiness owner.
import * as agentExecutionReadinessService from "../agent-execution/application/agent-execution-readiness-service";
import { buildAcceptedDispatchSnapshot } from "../dispatch/application/accepted-dispatch-snapshot";
import {
  applyEffectiveTargetBindingSnapshotToMessage,
  type EffectiveTargetBindingSnapshot,
  runDispatchExecutionPreflightGate,
} from "../dispatch/application/dispatch-execution-service";
import {
  dispatchOutboxMessageDirectly,
  retryPendingPreHeadFailurePublications,
} from "../dispatch/application/dispatch-queue-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchResultService from "../dispatch/application/dispatch-result-service";
import { writeDispatchResult } from "../dispatch/application/dispatch-result-service";
// biome-ignore lint/performance/noNamespaceImport: The Space authority RPC is independently covered with real SQL storage.
import * as deviceWaitAccess from "../dispatch/application/wake-device-wait";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchLedgerPostgres from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  claimDispatchAttempt,
  claimFinalReplyEmission,
  claimReplyingHintEmission,
  correlateDuplicateDispatchDeliveryAttempt,
  markDispatchAttemptWaitingForResult,
  markDispatchStatus,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  recordDispatchAttemptExecutionOwnership,
  rollbackFinalReplyEmissionClaim,
  rollbackReplyingHintEmissionClaim,
  writeDispatchDlq,
  writeInvalidDispatchPayloadDlq,
  writeOpenMeldDaemonOpsDecision,
} from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as preHeadFailurePublicationOutboxRepository from "../dispatch/infrastructure/postgresql/pre-head-failure-publication-outbox-repository";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeCoordinatorClient from "../dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as daemonTransportClient from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import {
  computeDispatchRetryDelaySeconds,
  DISPATCH_DEDUPE_WINDOW_RISK_CODE,
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_MAX_ATTEMPTS,
  DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS,
  DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS,
  DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS,
} from "../dispatch/rules/dispatch-runtime-constants";
import { handleDispatchQueueBatch } from "../dispatch/transport/queue/dispatch-queue-consumer";
import type { CoreBindings } from "../lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as remoteAgentNativeDeliveryService from "../remote-agent/application/native-delivery-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as rpcMethods from "../rpc/methods";
import {
  rpcPostSignal,
  rpcPostStatusSignal,
  rpcPostSystemNoticeSignal,
  rpcPostTransientSignal,
} from "../rpc/methods";
import { resolveRuntimeCoordinatorHeadWaitingDecision } from "../runtime-transport/application/runtime-coordinator-authority";
import { CORE_LOG_EVENTS } from "../shared/observability/log-events";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as spaceFinalOutcomeClaimReader from "../space/application/space-final-outcome-claim-reader";
import { EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS } from "../strategy-constants";

const COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY = {
  status: "compatible",
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
} as const;

const buildClaimedAttempt = (input?: {
  attempt?: number;
  dispatchId?: string;
}) => ({
  status: "claimed" as const,
  attemptId: `attempt-${input?.dispatchId ?? "dispatch"}-${input?.attempt ?? 1}`,
  attemptNo: input?.attempt ?? 1,
  replyingHintActive: false,
});

const TEST_AGENT_PROFILE_ID_PATTERN =
  /^agt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const buildStableUuidFromSeed = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex");
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `4${hex.slice(13, 16)}`;
  const variantSource = Number.parseInt(hex.slice(16, 17), 16);
  const variantNibble = ["8", "9", "a", "b"][variantSource % 4] ?? "8";
  const part4 = `${variantNibble}${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
};

function isRuntimeEvidenceEvent(
  value: unknown,
  event: string
): value is { event: string; reasonCode?: unknown } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { event?: unknown }).event === event
  );
}

const normalizeAgentProfileIdForTest = (value: string): string => {
  const normalized = value.trim();
  if (TEST_AGENT_PROFILE_ID_PATTERN.test(normalized)) {
    return normalized;
  }
  return `agt_${buildStableUuidFromSeed(normalized || "dispatch-agent")}`;
};

const buildAvailableCodexInterfaceJson = (nowMs: number): string => {
  const observedAt = new Date(nowMs).toISOString();
  return JSON.stringify({
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/opt/openmeld/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    usageLimitsSupportMatrixVersion: 1,
    usageLimits: [
      {
        key: "five_hour",
        label: "5-hour Usage Limit",
        observedAt,
        resetsAt: new Date(nowMs + 60 * 60_000).toISOString(),
        status: "available",
        usedPercent: 42,
      },
    ],
    version: "1.0.0",
  });
};

const TEST_REPLY_TO_SNAPSHOT: OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] =
  {
    signalId: "sig-reply-source-1",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human",
    profileName: "Mira",
    previewText: "Original prompt preview",
  };
const TEST_THREAD_CONTEXT = {
  threadId: "thr_11111111-1111-4111-8111-111111111111",
  rootSignalId: "sig-root-1",
} as const;

function buildDispatchExecutionForTest(input: {
  agentControllerConversationResume?: Pick<
    DispatchExecution["agentControllerConversationResume"],
    "status"
  >;
  localRuntimeContext?: Partial<DispatchExecution["localRuntimeContext"]>;
  bootstrap?: Partial<DispatchExecution["bootstrap"]>;
}): DispatchExecution {
  const bootstrapStatus = input.bootstrap?.status ?? "applied";
  const bootstrap =
    bootstrapStatus === "pending"
      ? {
          status: "pending" as const,
          reason: input.bootstrap?.reason ?? "missing_bootstrap_state",
        }
      : {
          status: "applied" as const,
          reason: null,
        };

  return {
    agentControllerConversationResume: {
      status: input.agentControllerConversationResume?.status ?? "continued",
    },
    localRuntimeContext: {
      status: input.localRuntimeContext?.status ?? "reused",
      reason: input.localRuntimeContext?.reason ?? null,
    },
    bootstrap,
  };
}

const buildRuntimeTransportTaskResult = (input: {
  attemptId?: string;
  dispatchId: string;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
  output?: string;
  dispatchExecution?: {
    agentControllerConversationResume?: Pick<
      DispatchExecution["agentControllerConversationResume"],
      "status"
    >;
    localRuntimeContext?: Partial<DispatchExecution["localRuntimeContext"]>;
    bootstrap?: Partial<DispatchExecution["bootstrap"]>;
  };
  spaceAction?:
    | {
        type: "post_message";
        messageEnvelope: {
          activationTargets: string[];
          referenceTargets: string[];
          replyToSignalId?: string;
          text: string;
        };
      }
    | {
        type: "post_status";
        status: "done" | "working" | "blocked" | "needs_input" | "handoff";
        text: string;
        targetProfileId?: string;
      };
  agentControllerRef?: string;
  agentControllerConversationId?: string;
  agentControllerConversation?: AgentControllerConversationRef;
  bootstrapTemplateFacts?: {
    templateVersion: string;
    contentFingerprint: string;
  };
}) => {
  const targetProfileId = normalizeAgentProfileIdForTest(input.targetProfileId);
  return {
    v: 4 as const,
    code: "service.task_result" as const,
    payload: {
      attemptId: input.attemptId ?? `attempt-${input.dispatchId}-1`,
      status: "success" as const,
      taskId: input.taskId,
      sourceEventId: input.sourceEventId,
      agentId: targetProfileId,
      deduped: false,
      agentControllerRef: input.agentControllerRef ?? "builtin:codex",
      agentControllerConversationId:
        input.agentControllerConversationId ?? `thread-${input.dispatchId}`,
      ...(input.agentControllerConversation
        ? { agentControllerConversation: input.agentControllerConversation }
        : {}),
      ...(input.dispatchExecution
        ? {
            dispatchExecution: buildDispatchExecutionForTest(
              input.dispatchExecution
            ),
          }
        : {}),
      ...(input.bootstrapTemplateFacts
        ? { bootstrapTemplateFacts: input.bootstrapTemplateFacts }
        : {}),
      spaceAction: input.spaceAction ?? {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: input.output ?? `daemon-output:${input.dispatchId}`,
        },
      },
      output: input.output ?? `daemon-output:${input.dispatchId}`,
    },
  };
};

type MockWaitDispatchResult = Awaited<
  ReturnType<typeof runtimeCoordinatorClient.waitRuntimeTransportDispatchResult>
>;

type FailedTaskResultEnvelopeV3 = {
  v: 3;
  code: "service.task_result";
  payload: Extract<
    Extract<
      OpenMeldDaemonTaskResultEnvelope,
      { v: 3; code: "service.task_result" }
    >["payload"],
    { status: "failed" }
  >;
};

type FailedTaskResultEnvelopeV4 = {
  v: 4;
  code: "service.task_result";
  payload: Extract<
    Extract<
      OpenMeldDaemonTaskResultEnvelope,
      { v: 4; code: "service.task_result" }
    >["payload"],
    { status: "failed" }
  >;
};

type FailedTaskResultBaseInput = {
  attemptId?: string;
  dispatchId: string;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
  deduped?: boolean;
  errorCode?: string;
  errorType?: FailedTaskResultEnvelopeV4["payload"]["errorType"];
  errorMessage?: string;
};

type FailedTaskResultV4Diagnostics = NonNullable<
  FailedTaskResultEnvelopeV4["payload"]["spaceActionFailureDiagnostics"]
>;

const buildWaitLifecycleSnapshot = (
  overrides: Partial<RuntimeTransportDispatchLifecycleSnapshot> = {}
): RuntimeTransportDispatchLifecycleSnapshot => {
  const createdAtMs = overrides.createdAtMs ?? 1_700_000_000_000;
  const acceptedLocalAtMs = overrides.acceptedLocalAtMs ?? createdAtMs + 1000;
  const runningAtMs = overrides.runningAtMs ?? acceptedLocalAtMs + 1000;
  return {
    acceptedLocalAtMs,
    completedLocalAtMs: overrides.completedLocalAtMs ?? null,
    createdAtMs,
    lastLifecycleAtMs: overrides.lastLifecycleAtMs ?? runningAtMs,
    phase: overrides.phase ?? "running",
    runningAtMs,
  };
};

const buildWaitCompleted = (
  taskResult: Extract<
    MockWaitDispatchResult,
    { state: "completed" }
  >["taskResult"],
  lifecycle?: RuntimeTransportDispatchLifecycleSnapshot
): MockWaitDispatchResult => {
  return {
    ...(lifecycle ? { lifecycle } : {}),
    state: "completed",
    taskResult,
  };
};

const buildWaitFailed = (
  reasonCode: Extract<
    MockWaitDispatchResult,
    { state: "failed" }
  >["reasonCode"],
  lifecycle?: RuntimeTransportDispatchLifecycleSnapshot
): MockWaitDispatchResult => {
  return {
    ...(lifecycle ? { lifecycle } : {}),
    reasonCode,
    state: "failed",
  };
};

const buildWaitPending = (
  lifecycle: Partial<RuntimeTransportDispatchLifecycleSnapshot> = {}
): MockWaitDispatchResult => {
  return {
    lifecycle: buildWaitLifecycleSnapshot(lifecycle),
    state: "pending",
  };
};

function buildRuntimeTransportFailedTaskResult(
  input: FailedTaskResultBaseInput & {
    v?: 3;
    spaceActionFailureDiagnostics?: never;
  }
): FailedTaskResultEnvelopeV3;
function buildRuntimeTransportFailedTaskResult(
  input: FailedTaskResultBaseInput & {
    v: 4;
    spaceActionFailureDiagnostics?: FailedTaskResultV4Diagnostics;
  }
): FailedTaskResultEnvelopeV4;
function buildRuntimeTransportFailedTaskResult(
  input: FailedTaskResultBaseInput & {
    v?: 3 | 4;
    spaceActionFailureDiagnostics?: FailedTaskResultV4Diagnostics;
  }
) {
  const targetProfileId = normalizeAgentProfileIdForTest(input.targetProfileId);
  const payloadBase = {
    attemptId: input.attemptId ?? `attempt-${input.dispatchId}-1`,
    status: "failed" as const,
    taskId: input.taskId,
    sourceEventId: input.sourceEventId,
    agentId: targetProfileId,
    deduped: input.deduped ?? false,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    errorType: input.errorType ?? "internal",
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };

  if (input.v === 4) {
    const envelope: FailedTaskResultEnvelopeV4 = {
      v: 4,
      code: "service.task_result",
      payload: {
        ...payloadBase,
        ...(input.spaceActionFailureDiagnostics
          ? {
              spaceActionFailureDiagnostics:
                input.spaceActionFailureDiagnostics,
            }
          : {}),
      },
    };
    return envelope;
  }

  const envelope: FailedTaskResultEnvelopeV3 = {
    v: 3,
    code: "service.task_result",
    payload: payloadBase,
  };
  return envelope;
}

const readMessageBody = (message: { body: unknown }) => {
  return message.body as {
    sourceEventId: string;
    targetProfileId: string;
  };
};

const createQueueMessage = (body: unknown, attempts = 1) => {
  return {
    attempts,
    body: normalizeDispatchQueueBodyForTest(body),
    ack: vi.fn(),
    retry: vi.fn(),
  };
};

const createRawQueueMessage = (body: unknown, attempts = 1) => {
  return {
    attempts,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
};

const normalizeDispatchQueueBodyForTest = (body: unknown): unknown => {
  if (!(body && typeof body === "object")) {
    return body;
  }
  const queueBody = body as {
    v?: unknown;
    dispatchId?: unknown;
    targetProfileId?: unknown;
    visitedProfileIds?: unknown;
    dispatchPolicy?: unknown;
    ruleSource?: unknown;
    ruleId?: unknown;
    ruleReason?: unknown;
    dispatchSnapshot?: {
      targetBindingEnabled?: unknown;
      targetBindingState?: unknown;
    };
    taskId?: unknown;
    transportMode?: unknown;
    controllerSnapshot?: unknown;
    contextIdMappingSpec?: unknown;
    dispatchRulesSnapshot?: unknown;
  };
  if (queueBody.v !== 2) {
    return body;
  }
  const dispatchId = String(queueBody.dispatchId ?? "").trim();
  const targetProfileId =
    typeof queueBody.targetProfileId === "string" &&
    queueBody.targetProfileId.trim().length > 0
      ? normalizeAgentProfileIdForTest(queueBody.targetProfileId)
      : queueBody.targetProfileId;
  const dispatchPolicy = queueBody.dispatchPolicy;
  const ruleSource = queueBody.ruleSource;
  const ruleId = queueBody.ruleId;
  const ruleReason = queueBody.ruleReason;
  const bindingState = queueBody.dispatchSnapshot?.targetBindingState;
  const bindingEnabled = queueBody.dispatchSnapshot?.targetBindingEnabled;

  return {
    ...queueBody,
    ...(typeof targetProfileId === "string" ? { targetProfileId } : {}),
    visitedProfileIds: Array.isArray(queueBody.visitedProfileIds)
      ? queueBody.visitedProfileIds.map((profileId: unknown) =>
          normalizeAgentProfileIdForTest(String(profileId))
        )
      : [],
    taskId:
      typeof queueBody.taskId === "string" && queueBody.taskId.length > 0
        ? queueBody.taskId
        : `task-${dispatchId || "unknown"}`,
    transportMode:
      queueBody.transportMode === "local-cli" ? queueBody.transportMode : null,
    controllerSnapshot:
      queueBody.controllerSnapshot &&
      typeof queueBody.controllerSnapshot === "object"
        ? queueBody.controllerSnapshot
        : {
            targetBindingState:
              bindingState === "bound" || bindingState === "missing"
                ? bindingState
                : "bound",
            targetBindingEnabled: bindingEnabled !== false,
            agentControllerRef: null,
          },
    contextIdMappingSpec: queueBody.contextIdMappingSpec ?? null,
    dispatchRulesSnapshot:
      queueBody.dispatchRulesSnapshot &&
      typeof queueBody.dispatchRulesSnapshot === "object"
        ? queueBody.dispatchRulesSnapshot
        : {
            dispatchPolicy:
              dispatchPolicy === "mention_only"
                ? dispatchPolicy
                : "mention_only",
            ruleSource:
              ruleSource === "system" ||
              ruleSource === "space" ||
              ruleSource === "profile" ||
              ruleSource === "registry"
                ? ruleSource
                : "system",
            ruleId: typeof ruleId === "string" ? ruleId : "rule-id",
            ruleReason:
              typeof ruleReason === "string" ? ruleReason : "rule-reason",
          },
  };
};

const sleepForTest = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const expectEventually = async (
  assertion: () => void,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
  }
) => {
  const timeoutMs = options?.timeoutMs ?? 500;
  const intervalMs = options?.intervalMs ?? 10;
  const deadlineMs = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() <= deadlineMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleepForTest(intervalMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("expectEventually timed out");
};

describe("handleDispatchQueueBatch", () => {
  let preHeadFailurePublicationCompleted = new Set<string>();
  let preHeadFailurePublicationIntents = new Map<
    string,
    preHeadFailurePublicationOutboxRepository.PreHeadFailurePublicationIntent
  >();

  const makeEnvWithBindings = (
    db?: PostgreSQLBinding,
    authRpc?: {
      resolveProfileById: (input: {
        openMeldProfileId?: string | null;
      }) => Promise<
        | {
            ok: true;
            profile: {
              ownerUserId: string | null;
              managedRole?: "center_agent";
              organizationId?: string;
              profileHandle: string;
              profileId: string;
              profileKind: "agent";
              profileName: string;
              status: "active" | "disabled";
            };
          }
        | {
            ok: false;
            code: string;
            message: string;
          }
      >;
    } | null
  ) => {
    const resolvedDb =
      db ??
      createOpenMeldDbWithProfileRow({
        profileKind: "agent",
        profileStatus: "active",
        agentControllerRef: "builtin:codex",
        controllerEnabled: 1,
      });
    return {
      OPENMELD_POSTGRESQL: resolvedDb,
      OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
      OPENMELD_SPACES: {} as DurableObjectNamespace<any>,
      ...(authRpc === null
        ? {}
        : {
            OPENMELD_AUTH_WORKER:
              authRpc ??
              createAuthRpcWithBindingSnapshot({
                bindingState: "bound",
                bindingEnabled: true,
                agentControllerRef: "builtin:codex",
                profileName: null,
                ownerUserId: "owner-default",
              }),
          }),
    } as const;
  };

  const createCanonicalWorkstationReadiness = (input: {
    agentControllerRef?: string;
    providerAccountReasonCode?: "usage_exhausted";
    runtimeDisplayState?: "unknown";
    runtimeReasonCode?:
      | "controller.registry.disabled"
      | "local_service.not_accepting_wakes"
      | "service.update_required"
      | "usage_checking"
      | "usage_exhausted"
      | "working_folder.report_stale"
      | "working_folder.observation_coverage_invalid"
      | "workspace.missing";
    targetProfileId: string;
  }): CoreAgentExecutionReadiness => {
    const agentControllerRef = input.agentControllerRef ?? "builtin:codex";
    const binding = createAgentProfileBindingDisplayProjection({
      agentProfileId: input.targetProfileId,
      bindingId: `binding-${input.targetProfileId}`,
      bindingState: "enabled_primary",
      executionTarget: {
        agentControllerRef,
        openMeldServiceRuntimeId: `runtime-${input.targetProfileId}`,
      },
    });
    const agentExecutionReadiness = resolveAgentExecutionStatus({
      agentProfileId: input.targetProfileId,
      binding,
      ...(input.providerAccountReasonCode
        ? {
            providerAccount: {
              blocked: true,
              expiresAtMs: Date.now() + 60_000,
              observedAtMs: Date.now(),
              provider: "codex" as const,
              reasonCodes: [input.providerAccountReasonCode],
              source: "wake_failure" as const,
            },
          }
        : {}),
      route: {
        deviceId: "daemon-device-1",
        lane: "dev-local",
        observedAt: new Date().toISOString(),
        status: "online",
      },
      localService: {
        reachable: true,
        reasonCodes: [],
        refreshable: true,
        source: "runtime_transport",
      },
      runtimeReadiness: input.runtimeReasonCode
        ? {
            displayState:
              input.runtimeDisplayState === "unknown"
                ? "unknown"
                : "needs_prepare",
            ready: false,
            reasonCodes: [input.runtimeReasonCode],
          }
        : {
            displayState:
              input.runtimeDisplayState === "unknown" ? "unknown" : "ready",
            ready: input.runtimeDisplayState !== "unknown",
            reasonCodes:
              input.runtimeDisplayState === "unknown" ? [] : ["runtime.ready"],
          },
    });

    return {
      agentControllerRef,
      agentExecutionReadiness,
      agentWakeRouteRegistration:
        input.runtimeReasonCode &&
        input.runtimeReasonCode !== "workspace.missing"
          ? {
              daemonSessionId: "daemon-session-1",
              deviceId: "daemon-device-1",
              lane: "dev-local",
              reasonCode: input.runtimeReasonCode,
              reportedAtMs: Date.now(),
              serviceVersion: "999.0.0",
              status: "skipped",
            }
          : {
              daemonSessionId: "daemon-session-1",
              deviceId: "daemon-device-1",
              lane: "dev-local",
              reasonCode: null,
              reportedAtMs: Date.now(),
              serviceVersion: "999.0.0",
              status: "registered",
            },
      daemonRouteObservation: {
        observedAt: new Date().toISOString(),
        reasonCode: "online",
        status: "online",
      },
      ownerUserId: "owner-default",
      primaryBinding: binding,
      profileName: "Codex",
      routeDeviceId: "daemon-device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Test Mac",
      spaceMemberAgentExecutionReadiness:
        agentExecutionReadiness as CoreAgentExecutionReadiness["spaceMemberAgentExecutionReadiness"],
      wakeRouteStatus: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        deviceId: "daemon-device-1",
        lane: "dev-local",
        lastHeartbeatMs: Date.now(),
        leaseEpoch: 1,
        status: "ready",
      },
    };
  };

  it("redelivers a durable Agent Task observation through the owner Runtime Transport shard", async () => {
    const rpcRedriveAgentTaskObservation = vi.fn(async () => ({
      status: "projected" as const,
    }));
    const message = createRawQueueMessage({
      deliveryId: "agent-task-observation:execution-1:interaction-event-1",
      enqueuedAtMs: 1000,
      idempotencyKey: "agent-task-observation:execution-1:interaction-event-1",
      kind: "agent_task_observation_redrive",
      observation: {
        attentionCode: "runtime_coordinator.interaction.permission",
        eventId: "interaction-event-1",
        occurredAtMs: 900,
        status: "needs_attention",
      },
      ownerUserId: "owner-1",
      runtimeCoordinatorExecutionId: "execution-1",
      task: {
        kind: "space_wake",
        sourceClientMessageId: "client-message-1",
        spaceId: "space-1",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        v: 1,
      },
      v: 5,
    });
    const env = {
      ...makeEnvWithBindings(),
      OPENMELD_RUNTIME_TRANSPORT: {
        get: vi.fn(() => ({ rpcRedriveAgentTaskObservation })),
        idFromName: vi.fn((ownerUserId: string) => ownerUserId),
      },
    } as unknown as CoreBindings;

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env,
    });

    expect(rpcRedriveAgentTaskObservation).toHaveBeenCalledOnce();
    expect(rpcRedriveAgentTaskObservation).toHaveBeenCalledWith(message.body);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  const createOpenMeldDbWithProfileRow = (
    row: {
      profileKind?: unknown;
      profileStatus?: unknown;
      agentControllerRef?: unknown;
      controllerEnabled?: unknown;
      bindingId?: unknown;
      configurationRevision?: unknown;
      hostedRuntimeIdentityJson?: unknown;
      modelId?: unknown;
      organizationBindingAuthorized?: unknown;
      profileOrganizationId?: unknown;
      runtimeKind?: unknown;
      spaceOrganizationId?: unknown;
      openMeldServiceRuntimeId?: unknown;
      runtimeAgentControllerInterfaceJson?: unknown;
    } | null
  ) =>
    createProjectionPostgresBinding((query) => {
      const result = resolveNativeProjectionRow({
        args: query.values ?? [],
        normalizedSql: query.text.toLowerCase(),
        row,
      });
      return result ? [result] : [];
    });

  const createOpenMeldDbWithRuntimeDeviceDisplayName = (displayName: string) =>
    createProjectionPostgresBinding((query) => {
      const normalizedSql = query.text.toLowerCase();
      const args = query.values ?? [];
      const result = (() => {
        if (
          normalizedSql.includes(
            "openmelddaemon_runtime_coordinator_executions"
          )
        ) {
          return {
            agent_controller_ref: "builtin:codex",
            openmeld_service_runtime_id: "runtime-1",
            openmeld_service_runtime_id_source: "runtime_registry_authority",
            attempt_id: "attempt-1",
            binding_id: "binding-1",
            claim_lease_id: null,
            connection_generation: 1,
            created_at_ms: 1,
            daemon_session_id: "daemon-session-1",
            dispatch_id: "dispatch-replying-hint-computer-name",
            lease_epoch: 1,
            model_version: "openmeld.runtime_coordinator.execution.v1",
            runtime_coordinator_execution_id: "rce-1",
            source_client_message_id: "client-replying-hint-computer-name",
            space_id: HEX_SPACE_ID,
            status: "running",
            target_profile_id: normalizeAgentProfileIdForTest(
              "agt-replying-hint-computer-name"
            ),
            terminal_outcome_json: null,
            updated_at_ms: 1,
          };
        }

        if (
          normalizedSql.includes("openmelddaemon_runtime_registry_records") &&
          normalizedSql.includes("openmelddaemon_owned_devices")
        ) {
          return {
            observed_display_name: "Felix's MacBook Pro",
            user_display_name: displayName,
          };
        }

        return resolveNativeProjectionRow({
          args,
          normalizedSql,
          row: {
            profileKind: "agent",
            profileStatus: "active",
            agentControllerRef: "builtin:codex",
            controllerEnabled: 1,
          },
        });
      })();
      return result ? [result] : [];
    });

  const createOpenMeldDbWithRuntimeDisplayNameReadError = (message: string) =>
    createProjectionPostgresBinding((query) => {
      const normalizedSql = query.text.toLowerCase();
      if (
        normalizedSql.includes("openmelddaemon_runtime_registry_records") &&
        normalizedSql.includes("openmelddaemon_owned_devices")
      ) {
        throw new Error(message);
      }
      const result = resolveNativeProjectionRow({
        args: query.values ?? [],
        normalizedSql,
        row: {
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
        },
      });
      return result ? [result] : [];
    });

  const resolveNativeProjectionRow = (input: {
    args: unknown[];
    normalizedSql: string;
    row: {
      profileKind?: unknown;
      profileStatus?: unknown;
      agentControllerRef?: unknown;
      controllerEnabled?: unknown;
      bindingId?: unknown;
      configurationRevision?: unknown;
      hostedRuntimeIdentityJson?: unknown;
      modelId?: unknown;
      organizationBindingAuthorized?: unknown;
      profileOrganizationId?: unknown;
      runtimeKind?: unknown;
      spaceOrganizationId?: unknown;
      openMeldServiceRuntimeId?: unknown;
      runtimeAgentControllerInterfaceJson?: unknown;
    } | null;
  }) => {
    if (input.normalizedSql.includes("openmelddaemon_forgotten_devices")) {
      return null;
    }
    if (
      input.normalizedSql.includes(
        "openmelddaemon_runtime_coordinator_executions"
      )
    ) {
      return null;
    }
    if (
      input.normalizedSql.includes(
        "openmelddaemon_runtime_agent_controller_reports"
      )
    ) {
      if (
        !input.row ||
        input.row.runtimeAgentControllerInterfaceJson === null
      ) {
        return null;
      }
      const nowMs = Date.now();
      const agentControllerInterfaceJson =
        typeof input.row.runtimeAgentControllerInterfaceJson === "string"
          ? input.row.runtimeAgentControllerInterfaceJson
          : buildAvailableCodexInterfaceJson(nowMs);
      return {
        accepted_at_ms: nowMs,
        agent_controller_interface_json: agentControllerInterfaceJson,
        agent_controller_ref: "builtin:codex",
        expires_at_ms: nowMs + 60_000,
        observed_at_ms: nowMs,
        openmeld_service_runtime_id: "runtime-usage-wakeability",
        report_status: "ready",
        reported_reason_codes_json: "[]",
        updated_at_ms: nowMs,
      };
    }
    if (
      input.normalizedSql.includes("openmelddaemon_runtime_registry_records")
    ) {
      const openMeldServiceRuntimeId =
        typeof input.args[0] === "string" &&
        input.args[0].startsWith("runtime-")
          ? input.args[0]
          : "runtime-default";
      return {
        created_at_ms: 1,
        device_id: "daemon-device-1",
        lane: "dev-local",
        last_registered_at_ms: 1,
        owner_id: "owner-default",
        owner_kind: "owner_account",
        openmeld_service_runtime_id: openMeldServiceRuntimeId,
        updated_at_ms: 1,
      };
    }
    if (
      input.normalizedSql.includes("profile_organization_id") &&
      input.normalizedSql.includes("openmeld_profiles")
    ) {
      const organizationId =
        typeof input.row?.spaceOrganizationId === "string"
          ? input.row.spaceOrganizationId
          : "org-default";
      let profileOrganizationId = organizationId;
      if (typeof input.row?.profileOrganizationId === "string") {
        profileOrganizationId = input.row.profileOrganizationId;
      } else if (input.row?.organizationBindingAuthorized === false) {
        profileOrganizationId = "org-other";
      }
      return {
        organization_id: organizationId,
        profile_organization_id: profileOrganizationId,
      };
    }
    if (input.normalizedSql.includes("openmelddaemon_agent_profile_bindings")) {
      if (!input.row) {
        return null;
      }
      const ownerKind =
        typeof input.args[0] === "string" ? input.args[0] : "owner_account";
      const ownerId =
        typeof input.args[1] === "string" ? input.args[1] : "owner-default";
      const agentProfileId =
        typeof input.args[2] === "string" ? input.args[2] : "agt-default";
      const agentControllerRef =
        typeof input.row.agentControllerRef === "string"
          ? input.row.agentControllerRef
          : "builtin:codex";
      const bindingId =
        typeof input.row.bindingId === "string"
          ? input.row.bindingId
          : `binding-${agentProfileId}`;
      const hostedRuntimeIdentityJson =
        typeof input.row.hostedRuntimeIdentityJson === "string"
          ? input.row.hostedRuntimeIdentityJson
          : null;
      const runtimeKind =
        input.row.runtimeKind === "hosted_center_agent"
          ? "hosted_center_agent"
          : "openmeld_service";
      const openMeldServiceRuntimeId =
        typeof input.row.openMeldServiceRuntimeId === "string"
          ? input.row.openMeldServiceRuntimeId
          : `runtime-${agentProfileId}`;
      const enabled = input.row.controllerEnabled !== 0;
      return {
        agent_profile_id: agentProfileId,
        binding_id: bindingId,
        binding_state: enabled ? "enabled_primary" : "disabled_historical",
        configuration_revision:
          typeof input.row.configurationRevision === "number"
            ? input.row.configurationRevision
            : 1,
        agent_controller_ref: agentControllerRef,
        created_at_ms: 1,
        created_by_profile_id: null,
        disabled_at_ms: enabled ? null : 2,
        hosted_runtime_identity_json: hostedRuntimeIdentityJson,
        model_id:
          typeof input.row.modelId === "string" ? input.row.modelId : null,
        owner_id: ownerId,
        owner_kind: ownerKind,
        reason_code: enabled ? "agent_profile_binding.enabled_primary" : null,
        runtime_kind: runtimeKind,
        openmeld_service_runtime_id: openMeldServiceRuntimeId,
        updated_at_ms: enabled ? 1 : 2,
      };
    }
    return input.row;
  };

  const createOpenMeldDbWithPrepareError = (message: string) =>
    createProjectionPostgresBinding((query) => {
      if (
        query.text.toLowerCase().includes("openmelddaemon_forgotten_devices")
      ) {
        return [];
      }
      throw new Error(message);
    });

  const createAuthRpcWithBindingSnapshot = (snapshot: {
    bindingState: "bound" | "missing";
    bindingEnabled: boolean;
    agentControllerRef: string | null;
    profileHandle?: string | null;
    profileName?: string | null;
    profileStatus?: "active" | "disabled";
    ownerUserId?: string | null;
  }) => ({
    resolveProfileById: vi.fn(
      async (input: { openMeldProfileId?: string | null }) => ({
        ok: true as const,
        profile: {
          ownerUserId: snapshot.ownerUserId ?? "owner-default",
          profileHandle: snapshot.profileHandle ?? "codex",
          profileId: input.openMeldProfileId ?? "agt-default",
          profileKind: "agent" as const,
          profileName: snapshot.profileName ?? "Codex",
          status: snapshot.profileStatus ?? "active",
        },
      })
    ),
  });

  const createDispatchBody = (input: {
    dispatchId: string;
    sourceEventId: string;
    sourceClientMessageId?: string;
    targetProfileId: string;
    visitedProfileIdsHash: string;
    enqueuedAtMs?: number;
    outboxCreatedAtMs?: number;
    sourceProfileNameSnapshot?: string;
    sourceProfileId?: string;
    sourceProfileKind?: "agent" | "human";
    sourceText?: string;
    spacePassword?: string;
    spaceNameSnapshot?: string;
    targetProfileNameSnapshot?: string;
    targetProfileMentionLabel?: string;
    dispatchOwner?: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"];
    replyToSnapshot?: OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"];
    threadContext?: OpenMeldDaemonDispatchQueueMessage["threadContext"];
  }): OpenMeldDaemonDispatchQueueMessage => {
    const targetProfileId = normalizeAgentProfileIdForTest(
      input.targetProfileId
    );
    return {
      v: 2,
      dispatchId: input.dispatchId,
      spaceId: "space-1",
      sourceEventId: input.sourceEventId,
      ...(input.sourceClientMessageId
        ? { sourceClientMessageId: input.sourceClientMessageId }
        : {}),
      targetProfileId,
      ...(input.dispatchOwner ? { dispatchOwner: input.dispatchOwner } : {}),
      ...(input.targetProfileMentionLabel
        ? { targetProfileMentionLabel: input.targetProfileMentionLabel }
        : {}),
      dispatchChainId: input.dispatchId,
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: input.visitedProfileIdsHash,
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only" as const,
      ruleSource: "registry" as const,
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      taskId: `task-${input.dispatchId}`,
      transportMode: null,
      ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
      controllerSnapshot: {
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only" as const,
        ruleSource: "registry" as const,
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only" as const,
        ruleSource: "registry" as const,
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
      },
      ...(input.spaceNameSnapshot
        ? { spaceNameSnapshot: input.spaceNameSnapshot }
        : {}),
      ...(input.sourceProfileNameSnapshot
        ? { sourceProfileNameSnapshot: input.sourceProfileNameSnapshot }
        : {}),
      ...(input.targetProfileNameSnapshot
        ? { targetProfileNameSnapshot: input.targetProfileNameSnapshot }
        : {}),
      ...(input.sourceText
        ? {
            sourceSignalSnapshot: {
              text: input.sourceText,
              profileId: input.sourceProfileId ?? "human-source-1",
              profileKind: input.sourceProfileKind ?? ("human" as const),
            },
          }
        : {}),
      ...(input.replyToSnapshot
        ? { replyToSnapshot: input.replyToSnapshot }
        : {}),
      ...(input.threadContext ? { threadContext: input.threadContext } : {}),
      idempotencyKey: `5:${input.sourceEventId}|5:${targetProfileId}`,
      ...(input.outboxCreatedAtMs !== undefined
        ? { outboxCreatedAtMs: input.outboxCreatedAtMs }
        : {}),
      enqueuedAtMs: input.enqueuedAtMs ?? Date.now(),
    };
  };

  type DispatchBodyInput = Parameters<typeof createDispatchBody>[0];
  type QueueMessage = ReturnType<typeof createQueueMessage>;

  const createDispatchQueueMessage = (
    input: DispatchBodyInput & {
      attempts?: number;
      idempotencyKey?: string;
      spaceId?: string;
    }
  ): QueueMessage => {
    const {
      attempts = 1,
      idempotencyKey,
      spaceId,
      ...dispatchBodyInput
    } = input;
    return createQueueMessage(
      {
        ...createDispatchBody(dispatchBodyInput),
        ...(spaceId ? { spaceId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
      attempts
    );
  };

  const runDispatchQueueMessage = async (message: QueueMessage) => {
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });
  };

  const readTransientSignalPurposes = () =>
    vi.mocked(rpcPostTransientSignal).mock.calls.map((call) => {
      const signal = call.at(1);
      const meta =
        signal && typeof signal === "object" && "meta" in signal
          ? (signal.meta as Record<string, unknown> | undefined)
          : undefined;
      return String(meta?.purpose ?? "");
    });

  const hasTransientSignalPurpose = (purpose: string) =>
    readTransientSignalPurposes().includes(purpose);

  const readQueueMessageDeliveryCalls = (message: QueueMessage) => ({
    ack: message.ack.mock.calls.length,
    retry: message.retry.mock.calls.length,
  });

  const expectQueueHandedAcceptedResultToRuntimeCoordinator = (
    assert: typeof expect,
    message: QueueMessage,
    input?: {
      idempotencyKey?: string;
    }
  ) => {
    assert(message.ack).toHaveBeenCalledTimes(1);
    assert(message.retry).not.toHaveBeenCalled();
    assert(rpcPostSignal).not.toHaveBeenCalled();
    assert(rpcPostStatusSignal).not.toHaveBeenCalled();
    assert(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    assert(writeDispatchResult).not.toHaveBeenCalled();
    assert(writeDispatchDlq).not.toHaveBeenCalled();
    if (input?.idempotencyKey) {
      assert(markDispatchStatus).toHaveBeenCalledWith(
        assert.objectContaining({
          idempotencyKey: input.idempotencyKey,
          status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        })
      );
      assert(markDispatchStatus).not.toHaveBeenCalledWith(
        assert.objectContaining({
          idempotencyKey: input.idempotencyKey,
          status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
        })
      );
      assert(markDispatchStatus).not.toHaveBeenCalledWith(
        assert.objectContaining({
          idempotencyKey: input.idempotencyKey,
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
      assert(markDispatchStatus).not.toHaveBeenCalledWith(
        assert.objectContaining({
          idempotencyKey: input.idempotencyKey,
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
    }
  };

  const readInvalidPayloadAuditCalls = () => ({
    claimDispatchAttempt: vi.mocked(claimDispatchAttempt).mock.calls.length,
    markDispatchStatus: vi.mocked(markDispatchStatus).mock.calls.length,
    rpcPostSignal: vi.mocked(rpcPostSignal).mock.calls.length,
    writeDispatchDlq: vi.mocked(writeDispatchDlq).mock.calls.length,
    writeInvalidDispatchPayloadDlq: vi.mocked(writeInvalidDispatchPayloadDlq)
      .mock.calls.length,
  });

  it("keeps Queue retryable when RuntimeCoordinator head accept is temporarily unavailable", async () => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-head-accept-unavailable-1",
      sourceEventId: "evt-head-accept-unavailable-1",
      targetProfileId: "agt-head-accept-unavailable-1",
      visitedProfileIdsHash: "hash-head-accept-unavailable-1",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_unavailable",
      status: "retry_later",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|29:evt-head-accept-unavailable-1|47:agt_head_accept_unavailable_1",
    });

    await runDispatchQueueMessage(message);

    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.not.objectContaining({
          executionTargetRevision: expect.anything(),
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        errorCode: "runtime_coordinator.head_accept_unavailable",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
  });

  it("acks coordinator queue waiting without delivery, Wake failure, or retry backoff", async () => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-profile-queue-waiting-1",
      sourceEventId: "evt-profile-queue-waiting-1",
      targetProfileId: "agt-profile-queue-waiting-1",
      visitedProfileIdsHash: "hash-profile-queue-waiting-1",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      action: "wait_in_queue",
      ok: true,
      primaryDispatchId: body.dispatchId,
      queuePosition: 2,
      reasonCode: "agent_profile_work_coordinator.queued",
      runtimeCoordinatorExecutionId: null,
      status: "queued",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|27:evt-profile-queue-waiting-1|45:agt_profile_queue_waiting_1",
      waitingCount: 1,
    });

    await runDispatchQueueMessage(message);

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: "profile_queue_waiting",
        errorCode: "agent_profile_work_coordinator.queued",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("publishes queue_full as a terminal visible failure without retrying or delivering", async () => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-profile-queue-full-1",
      sourceEventId: "evt-profile-queue-full-1",
      targetProfileId: "agt-profile-queue-full-1",
      targetProfileNameSnapshot: "Codex",
      visitedProfileIdsHash: "hash-profile-queue-full-1",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "agent_profile_work_coordinator.queue_full",
      status: "queue_full",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|24:evt-profile-queue-full-1|42:agt_profile_queue_full_1",
      waitingCount: 50,
    });

    await runDispatchQueueMessage(message);

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
        errorCode: "agent_profile_work_coordinator.queue_full",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode: "agent_profile_work_coordinator.queue_full",
          text: expect.stringContaining("queue is full"),
        }),
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("publishes an execution-target mismatch as one visible Needs attention failure", async () => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-continuation-needs-attention-1",
      sourceEventId: "evt-continuation-needs-attention-1",
      targetProfileId: "agt-continuation-needs-attention-1",
      targetProfileNameSnapshot: "Codex",
      visitedProfileIdsHash: "hash-continuation-needs-attention-1",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "agent_profile_work_coordinator.continuation_needs_attention",
      status: "conflict",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|34:evt-continuation-needs-attention-1|52:agt_continuation_needs_attention_1",
    });

    await runDispatchQueueMessage(message);

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
        errorCode:
          "agent_profile_work_coordinator.continuation_needs_attention",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode:
            "agent_profile_work_coordinator.continuation_needs_attention",
          text: expect.stringContaining("settings changed"),
        }),
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("submits a dispatch outbox message directly without Cloudflare Queue", async () => {
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-direct-submitted-1",
      sourceEventId: "evt-direct-submitted-1",
      targetProfileId: "agt-direct-submitted-1",
      visitedProfileIdsHash: "hash-direct-submitted-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome).toEqual({
      retryDelaySeconds: null,
      status: "submitted",
    });
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(1);
    expect(queueMessage.ack).not.toHaveBeenCalled();
    expect(queueMessage.retry).not.toHaveBeenCalled();
  });

  it("treats coordinator queue waiting as a successful durable direct handoff", async () => {
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-direct-profile-queue-waiting-1",
      sourceEventId: "evt-direct-profile-queue-waiting-1",
      targetProfileId: "agt-direct-profile-queue-waiting-1",
      visitedProfileIdsHash: "hash-direct-profile-queue-waiting-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      action: "wait_in_queue",
      ok: true,
      primaryDispatchId: body.dispatchId,
      queuePosition: 2,
      reasonCode: "agent_profile_work_coordinator.queued",
      runtimeCoordinatorExecutionId: null,
      status: "queued",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|34:evt-direct-profile-queue-waiting-1|52:agt_direct_profile_queue_waiting_1",
      waitingCount: 1,
    });

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome).toEqual({
      retryDelaySeconds: null,
      status: "submitted",
    });
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: "profile_queue_waiting",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
      })
    );
  });

  it("submits a production workstation dispatch directly after authoritative preflight", async () => {
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-production-direct-workstation-1",
      sourceEventId: "evt-production-direct-workstation-1",
      targetProfileId: "agt-production-direct-workstation-1",
      visitedProfileIdsHash: "hash-production-direct-workstation-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome).toEqual({
      retryDelaySeconds: null,
      status: "submitted",
    });
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(1);
  });

  it("submits a hosted Center Agent outbox message directly", async () => {
    const writeDataPoint = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-direct-center-agent-1"
    );
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-hosted-direct-center-agent-1",
      sourceEventId: "evt-hosted-direct-center-agent-1",
      sourceText: "Summarize this",
      targetProfileId,
      visitedProfileIdsHash: "hash-hosted-direct-center-agent-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: {
        ...makeEnvWithBindings(
          createOpenMeldDbWithProfileRow({
            agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            bindingId: "binding-hosted-center-agent",
            controllerEnabled: 1,
            hostedRuntimeIdentityJson: JSON.stringify(
              HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
            ),
            profileKind: "agent",
            profileStatus: "active",
            runtimeKind: "hosted_center_agent",
            openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          })
        ),
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      } as CoreBindings,
      message: body,
    });

    expect(outcome).toEqual({
      retryDelaySeconds: null,
      status: "submitted",
    });
    expect(submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          dispatchId: "dispatch-hosted-direct-center-agent-1",
          idempotencyKey: body.idempotencyKey,
          targetProfileId,
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(writeDataPoint).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: "core.openmeld.observability.runtime_evidence_projection_failed",
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "core.openmeld.dispatch.queue_server_timing",
        operation: "openMeldDaemon-dispatch-direct",
        runtimeKind: "durable_object",
      })
    );
  });

  it("routes an agent-authored structured Wake to the hosted Center Agent when the stored controller snapshot is stale", async () => {
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-agent-authored-recovery-1"
    );
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-hosted-agent-authored-recovery-1",
      sourceEventId: "evt-hosted-agent-authored-recovery-1",
      sourceProfileId: normalizeAgentProfileIdForTest(
        "agt-local-recovery-author-1"
      ),
      sourceProfileKind: "agent",
      sourceText: "Review the retained recovery result and continue.",
      targetProfileId,
      visitedProfileIdsHash: "hash-hosted-agent-authored-recovery-1",
    });
    const body = {
      ...(queueMessage.body as OpenMeldDaemonDispatchQueueMessage),
      transportMode: "local-cli" as const,
      controllerSnapshot: {
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    };

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: "builtin:codex",
          bindingId: "binding-hosted-agent-authored-recovery",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
      message: body,
    });

    expect(outcome).toEqual({
      retryDelaySeconds: null,
      status: "submitted",
    });
    expect(submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          dispatchId: "dispatch-hosted-agent-authored-recovery-1",
          targetProfileId,
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("normalizes a malformed hosted controller before route selection", async () => {
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-malformed-controller"
    );
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-hosted-malformed-controller",
      sourceEventId: "evt-hosted-malformed-controller",
      sourceProfileId: normalizeAgentProfileIdForTest(
        "agt-hosted-malformed-source"
      ),
      sourceProfileKind: "agent",
      sourceText: "Continue the exact hosted conversation.",
      targetProfileId,
      visitedProfileIdsHash: "hash-hosted-malformed-controller",
    });

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: "malformed::stale-controller",
          bindingId: "binding-hosted-malformed-controller",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
      message: queueMessage.body as OpenMeldDaemonDispatchQueueMessage,
    });

    expect(outcome.status).toBe("submitted");
    expect(submitNativeDelivery).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      daemonTransportClient.lookupRuntimeTransportRoute
    ).not.toHaveBeenCalled();
  });

  it.each(
    (["direct", "queue"] as const).flatMap((deliveryPath) =>
      (
        [
          {
            sourceKind: "human" as const,
            sourceLabel: "human",
            sourceProfileId: "human-hosted-matrix-source",
          },
          {
            sourceKind: "agent" as const,
            sourceLabel: "local-agent",
            sourceProfileId: normalizeAgentProfileIdForTest(
              "agt-local-hosted-matrix-source"
            ),
          },
          {
            sourceKind: "agent" as const,
            sourceLabel: "hosted-agent",
            sourceProfileId: normalizeAgentProfileIdForTest(
              "agt-hosted-hosted-matrix-source"
            ),
          },
        ] as const
      ).flatMap((source) =>
        (
          [
            {
              controllerLabel: "stale",
              storedAgentControllerRef: "builtin:codex",
            },
            {
              controllerLabel: "malformed",
              storedAgentControllerRef: "malformed::controller-ref",
            },
          ] as const
        ).map((controller) => ({
          ...controller,
          ...source,
          deliveryPath,
        }))
      )
    )
  )("routes $deliveryPath $sourceLabel Wake through hosted native delivery with $controllerLabel controller evidence", async ({
    controllerLabel,
    deliveryPath,
    sourceKind,
    sourceLabel,
    sourceProfileId,
    storedAgentControllerRef,
  }) => {
    const readRuntimeCoordinatorHeadLifecycleTrace = vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    );
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const caseId = `${deliveryPath}-${sourceLabel}-${controllerLabel}`;
    const targetProfileId = normalizeAgentProfileIdForTest(
      `agt-hosted-matrix-target-${caseId}`
    );
    const dispatchBody = createDispatchBody({
      dispatchId: `dispatch-hosted-matrix-${caseId}`,
      sourceEventId: `evt-hosted-matrix-${caseId}`,
      sourceProfileId,
      sourceProfileKind: sourceKind,
      sourceText: "Continue through the hosted Center Agent.",
      targetProfileId,
      visitedProfileIdsHash: `stable32:hosted-matrix-${caseId}`,
    });
    const env = makeEnvWithBindings(
      createOpenMeldDbWithProfileRow({
        agentControllerRef: storedAgentControllerRef,
        bindingId: `binding-hosted-matrix-${caseId}`,
        controllerEnabled: 1,
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        profileKind: "agent",
        profileStatus: "active",
        runtimeKind: "hosted_center_agent",
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      })
    );

    if (deliveryPath === "direct") {
      const outcome = await dispatchOutboxMessageDirectly({
        ctx: { waitUntil: vi.fn() },
        env,
        message: dispatchBody,
      });
      expect(outcome.status).toBe("submitted");
    } else {
      const message = createQueueMessage(dispatchBody, 1);
      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env,
      });
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.retry).not.toHaveBeenCalled();
    }

    expect(submitNativeDelivery).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(readRuntimeCoordinatorHeadLifecycleTrace).not.toHaveBeenCalled();
    expect(
      daemonTransportClient.lookupRuntimeTransportRoute
    ).not.toHaveBeenCalled();
  });

  it("preserves direct delivery failure context before an attempt is claimed", async () => {
    const claimError = new Error(
      "production direct claim failed before attempt creation"
    );
    vi.mocked(claimDispatchAttempt).mockRejectedValueOnce(claimError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-direct-claim-failure-1"
    );
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-hosted-direct-claim-failure-1",
      sourceEventId: "evt-hosted-direct-claim-failure-1",
      sourceText: "Summarize this",
      targetProfileId,
      visitedProfileIdsHash: "hash-hosted-direct-claim-failure-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
      message: body,
    });

    expect(outcome).toMatchObject({
      reasonCode: "dispatch_direct_retry_requested",
      recoveryTransport: "queue",
      status: "retry_scheduled",
    });
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.dispatch.failure_classified]",
      expect.objectContaining({
        attemptId: "missing-attempt:dispatch-hosted-direct-claim-failure-1",
        deliveryPath: "direct",
        dispatchId: "dispatch-hosted-direct-claim-failure-1",
        errorMessage: claimError.message,
        errorName: "Error",
      })
    );
  });

  it("keeps direct outbox delivery retryable when RuntimeCoordinator head accept is temporarily unavailable", async () => {
    const queueMessage = createDispatchQueueMessage({
      dispatchId: "dispatch-direct-head-accept-unavailable-1",
      sourceEventId: "evt-direct-head-accept-unavailable-1",
      targetProfileId: "agt-direct-head-accept-unavailable-1",
      visitedProfileIdsHash: "hash-direct-head-accept-unavailable-1",
    });
    const body = queueMessage.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_unavailable",
      status: "retry_later",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|36:evt-direct-head-accept-unavailable-1|54:agt_direct_head_accept_unavailable_1",
    });

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome).toMatchObject({
      reasonCode: "dispatch_direct_retry_requested",
      recoveryTransport: "outbox",
      status: "retry_scheduled",
    });
    expect(outcome.retryDelaySeconds).toEqual(expect.any(Number));
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        errorCode: "runtime_coordinator.head_accept_unavailable",
        idempotencyKey: body.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
  });

  it("delivers the Wake once when a mutation lease clears on outbox redrive", async () => {
    const body = createDispatchBody({
      dispatchId: "dispatch-mutation-release",
      sourceEventId: "evt-mutation-release",
      targetProfileId: "agt-mutation-release",
      visitedProfileIdsHash: "stable32:mutation-release",
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
      status: "retry_later",
      targetWakeLifecycleId: "wake-mutation-release",
    });
    const env = makeEnvWithBindings();
    const first = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env,
      message: body,
    });
    const second = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env,
      message: body,
    });

    expect(first.status).toBe("retry_scheduled");
    expect(second.status).toBe("submitted");
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledTimes(2);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(1);
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  it("publishes a visible failure when a mutation lease keeps rejecting head admission", async () => {
    const body = createDispatchBody({
      dispatchId: "dispatch-mutation-expired",
      enqueuedAtMs: Date.now(),
      outboxCreatedAtMs:
        Date.now() - EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS,
      sourceEventId: "evt-mutation-expired",
      targetProfileId: "agt-mutation-expired",
      visitedProfileIdsHash: "stable32:mutation-expired",
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
      status: "retry_later",
      targetWakeLifecycleId: "wake-mutation-expired",
    });

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome.status).toBe("submitted");
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          noticeType: "terminal_failure",
          reasonCode:
            "runtime_coordinator.execution_target_mutation_wait_expired",
          text: expect.stringContaining("send the Wake again"),
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.execution_target_mutation_wait_expired",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("keeps other head retry reasons retryable after the mutation wait limit", async () => {
    const body = createDispatchBody({
      dispatchId: "dispatch-other-head-retry",
      enqueuedAtMs: Date.now() - EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS,
      sourceEventId: "evt-other-head-retry",
      targetProfileId: "agt-other-head-retry",
      visitedProfileIdsHash: "stable32:other-head-retry",
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_unavailable",
      status: "retry_later",
      targetWakeLifecycleId: "wake-other-head-retry",
    });

    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: body,
    });

    expect(outcome.status).toBe("retry_scheduled");
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  it("honors a pre-agent Stop while a mutation-blocked Wake waits in the outbox", async () => {
    const body = createDispatchBody({
      dispatchId: "dispatch-mutation-stopped",
      sourceEventId: "evt-mutation-stopped",
      targetProfileId: "agt-mutation-stopped",
      visitedProfileIdsHash: "stable32:mutation-stopped",
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    )
      .mockResolvedValueOnce({
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
        status: "retry_later",
        targetWakeLifecycleId: "wake-mutation-stopped",
      })
      .mockResolvedValueOnce({
        action: "skip_duplicate",
        ok: true,
        primaryDispatchId: body.dispatchId,
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        runtimeCoordinatorExecutionId: null,
        status: "stopped_before_execution",
        targetWakeLifecycleId: "wake-mutation-stopped",
      });
    const env = makeEnvWithBindings();

    const first = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env,
      message: body,
    });
    const second = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env,
      message: body,
    });

    expect(first.status).toBe("retry_scheduled");
    expect(second.status).toBe("submitted");
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.pre_agent_stop_requested",
        status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  const mockCompletedFailedTaskResult = (
    input: FailedTaskResultBaseInput & {
      v?: 3 | 4;
      spaceActionFailureDiagnostics?: FailedTaskResultV4Diagnostics;
    }
  ) => {
    const { spaceActionFailureDiagnostics, v, ...baseInput } = input;
    const taskResult =
      v === 4 || spaceActionFailureDiagnostics
        ? buildRuntimeTransportFailedTaskResult({
            ...baseInput,
            v: 4,
            ...(spaceActionFailureDiagnostics
              ? { spaceActionFailureDiagnostics }
              : {}),
          })
        : buildRuntimeTransportFailedTaskResult({
            ...baseInput,
            v: 3,
          });

    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(buildWaitCompleted(taskResult));
  };

  const startPendingRuntimeTransportWaitBatch = (message: QueueMessage) => {
    let releaseSecondWait: () => void = () => undefined;
    const secondWait = new Promise<void>((resolve) => {
      releaseSecondWait = resolve;
    });
    const scheduledWaits: Promise<unknown>[] = [];
    const defaultWaitImplementation = vi
      .mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
      .getMockImplementation();
    if (!defaultWaitImplementation) {
      throw new Error(
        "missing default waitRuntimeTransportDispatchResult mock"
      );
    }
    let waitCallCount = 0;
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockImplementation(async (input) => {
      waitCallCount += 1;
      if (waitCallCount === 1) {
        return buildWaitPending();
      }
      await secondWait;
      return await defaultWaitImplementation(input);
    });

    let batchSettled = false;
    const batchPromise = handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    }).finally(() => {
      batchSettled = true;
    });

    return {
      get batchSettled() {
        return batchSettled;
      },
      get scheduledWaitCount() {
        return scheduledWaits.length;
      },
      get waitCallCount() {
        return waitCallCount;
      },
      settleScheduledWaits: async () => {
        await Promise.allSettled(scheduledWaits);
      },
      settle: async () => {
        releaseSecondWait();
        await batchPromise;
        await Promise.allSettled(scheduledWaits);
      },
    };
  };

  const rejectOpsDecisionWriteByCode = (
    decisionCode: string,
    errorMessage = `${decisionCode} write failed`
  ) => {
    vi.mocked(writeOpenMeldDaemonOpsDecision).mockImplementation(
      (input: Parameters<typeof writeOpenMeldDaemonOpsDecision>[0]) => {
        if (input.decisionCode === decisionCode) {
          return Promise.reject(new Error(errorMessage));
        }
        return Promise.resolve(undefined);
      }
    );
  };
  const HEX_SPACE_ID =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    preHeadFailurePublicationCompleted = new Set();
    preHeadFailurePublicationIntents = new Map();
    // vi.mock module factories do not reach the worker-entry module graph in
    // vitest-pool-workers (src/index.ts already loaded these modules in the
    // same isolate), so per-test spies on the shared module namespaces are the
    // only mocking mechanism that actually intercepts the dispatch pipeline.
    vi.spyOn(
      agentExecutionReadinessService,
      "resolveCoreAgentExecutionReadinessForProfile"
    ).mockImplementation(({ profileId }) =>
      Promise.resolve(
        createCanonicalWorkstationReadiness({ targetProfileId: profileId })
      )
    );
    vi.spyOn(dispatchLedgerPostgres, "claimDispatchAttempt").mockImplementation(
      ({ message, attempt }) =>
        Promise.resolve(
          buildClaimedAttempt({
            attempt,
            dispatchId: message.dispatchId,
          })
        )
    );
    vi.spyOn(
      dispatchLedgerPostgres,
      "claimFinalReplyEmission"
    ).mockResolvedValue("claimed");
    vi.spyOn(
      dispatchLedgerPostgres,
      "claimReplyingHintEmission"
    ).mockResolvedValue("claimed");
    vi.spyOn(
      dispatchLedgerPostgres,
      "correlateDuplicateDispatchDeliveryAttempt"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "readPreHeadFailurePublicationState"
    ).mockImplementation(({ dispatchId }) => {
      if (preHeadFailurePublicationCompleted.has(dispatchId)) {
        return Promise.resolve({ status: "completed" });
      }
      const intent = preHeadFailurePublicationIntents.get(dispatchId);
      return Promise.resolve(
        intent
          ? { intent, status: "pending" as const }
          : { status: "missing" as const }
      );
    });
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "ensurePreHeadFailurePublicationIntent"
    ).mockImplementation(({ intent }) => {
      const stored =
        preHeadFailurePublicationIntents.get(intent.dispatchId) ?? intent;
      preHeadFailurePublicationIntents.set(intent.dispatchId, stored);
      return Promise.resolve(stored);
    });
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "claimPreHeadFailurePublicationIntent"
    ).mockImplementation(({ claimId, dispatchId, nowMs }) => {
      if (preHeadFailurePublicationCompleted.has(dispatchId)) {
        return Promise.resolve({ outcome: "completed" });
      }
      const intent = preHeadFailurePublicationIntents.get(dispatchId);
      if (!intent) {
        return Promise.resolve({ outcome: "missing" });
      }
      if (intent.claimExpiresAtMs !== null && intent.claimExpiresAtMs > nowMs) {
        return Promise.resolve({ outcome: "busy" });
      }
      const claimed = {
        ...intent,
        claimExpiresAtMs:
          nowMs +
          preHeadFailurePublicationOutboxRepository.PRE_HEAD_FAILURE_PUBLICATION_CLAIM_LEASE_MS,
        claimId,
      };
      preHeadFailurePublicationIntents.set(dispatchId, claimed);
      return Promise.resolve({ intent: claimed, outcome: "claimed" });
    });
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "reschedulePreHeadFailurePublicationIntent"
    ).mockImplementation(({ intent, nextAttemptAtMs }) => {
      preHeadFailurePublicationIntents.set(intent.dispatchId, {
        ...intent,
        attemptCount: intent.attemptCount + 1,
        claimExpiresAtMs: null,
        claimId: null,
        nextAttemptAtMs,
      });
      return Promise.resolve();
    });
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "markPreHeadFailurePublicationCompleted"
    ).mockImplementation(({ intent }) => {
      preHeadFailurePublicationCompleted.add(intent.dispatchId);
      return Promise.resolve();
    });
    vi.spyOn(
      dispatchLedgerPostgres,
      "markDispatchAttemptWaitingForResult"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerPostgres,
      "readDispatchFirstSeenAtMs"
    ).mockResolvedValue(null);
    vi.spyOn(
      dispatchLedgerPostgres,
      "recordDispatchAttemptExecutionOwnership"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerPostgres,
      "rollbackFinalReplyEmissionClaim"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerPostgres,
      "rollbackReplyingHintEmissionClaim"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerPostgres,
      "writeOpenMeldDaemonOpsDecision"
    ).mockResolvedValue(undefined);
    vi.spyOn(dispatchLedgerPostgres, "markDispatchStatus").mockResolvedValue(
      undefined
    );
    vi.spyOn(dispatchLedgerPostgres, "writeDispatchDlq").mockResolvedValue(
      undefined
    );
    vi.spyOn(
      dispatchLedgerPostgres,
      "writeInvalidDispatchPayloadDlq"
    ).mockResolvedValue(undefined);
    vi.spyOn(rpcMethods, "rpcPostSignal").mockResolvedValue({
      v: 1,
      id: "signal-test",
      spaceId: "space-test",
      ts: Date.now(),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
      },
      type: "signal.text",
      data: {
        text: "ok",
      },
    });
    vi.spyOn(rpcMethods, "rpcPostStatusSignal").mockResolvedValue({
      v: 1,
      id: "signal-status-test",
      spaceId: "space-test",
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: normalizeAgentProfileIdForTest("status-agent"),
      },
      type: "signal.status",
      data: {
        actorProfileId: normalizeAgentProfileIdForTest("status-agent"),
        dispatchId: "dispatch-status-test",
        generatedBy: "openmeld",
        status: "done",
        text: "done",
      },
    });
    vi.spyOn(rpcMethods, "rpcPostSystemNoticeSignal").mockResolvedValue({
      v: 1,
      id: "sig-system-notice-1",
      spaceId: "space-test",
      ts: Date.now(),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: normalizeAgentProfileIdForTest("notice-agent"),
        dispatchId: "dispatch-notice-test",
        generatedBy: "openmeld",
        reason: "notice",
        text: "notice",
      },
    });
    vi.spyOn(dispatchResultService, "writeDispatchResult").mockResolvedValue(
      undefined
    );
    vi.spyOn(rpcMethods, "rpcPostTransientSignal").mockResolvedValue(undefined);

    const latestDispatchMetadata = new Map<
      string,
      {
        attemptId: string;
        taskId: string;
        sourceEventId: string;
        targetProfileId: string;
      }
    >();

    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockResolvedValue({
      online: true,
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      deviceId: "daemon-device-1",
      lane: "dev-local",
      serviceVersion: "999.0.0",
      leaseEpoch: 1,
      lastHeartbeatMs: Date.now(),
      capabilities: {
        runtimeAdapters: [
          {
            adapterId: "codex",
            capabilityDeclaration: {
              continuationCapability: "standard",
              preparationRequirement: "none",
              runtimeWorkingDirectoryMode: "spawn_cwd",
              streamingCapability: "final_only",
              workspaceResumeBehavior: "transparent",
            },
            transportModes: ["local-cli"],
          },
        ],
      },
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    });
    vi.spyOn(
      runtimeCoordinatorClient,
      "acceptRuntimeTransportRuntimeCoordinatorHead"
    ).mockImplementation(async (input) => ({
      ...(input.head.acceptedDispatchSnapshot
        ? { acceptedDispatchSnapshot: input.head.acceptedDispatchSnapshot }
        : {}),
      action: "create_execution",
      ok: true,
      primaryDispatchId: input.head.dispatchId,
      reasonCode: "runtime_coordinator.head_accepted",
      runtimeCoordinatorExecutionId: null,
      status: "accepted",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    vi.spyOn(
      runtimeCoordinatorClient,
      "recordRuntimeTransportRuntimeCoordinatorHeadNoExecution"
    ).mockImplementation(async (input) => ({
      ok: true,
      primaryDispatchId: input.noExecution.dispatchId,
      publicationIntentId: `rcpi:no_execution:${input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
      reasonCode: input.noExecution.reasonCode,
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetWakeLifecycleId:
        input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    vi.spyOn(
      runtimeCoordinatorClient,
      "recordRuntimeTransportRuntimeCoordinatorHeadWaiting"
    ).mockImplementation((input) => {
      const waitingDecision = resolveRuntimeCoordinatorHeadWaitingDecision(
        input.waiting.reasonCode
      );
      return Promise.resolve({
        deadlineAtMs: Date.now() + 300_000,
        nextTriggerAtMs: Date.now() + 30_000,
        ok: true,
        primaryDispatchId: input.waiting.dispatchId,
        runtimeCoordinatorExecutionId: null,
        softDeadlineAtMs: Date.now() + 30_000,
        status: "waiting",
        targetWakeLifecycleId:
          input.waiting.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        ...waitingDecision,
      });
    });
    vi.spyOn(
      runtimeCoordinatorClient,
      "deliverRuntimeTransportDispatch"
    ).mockImplementation(
      (
        input: Parameters<
          typeof runtimeCoordinatorClient.deliverRuntimeTransportDispatch
        >[0]
      ) => {
        const request = input as {
          dispatch: {
            attemptId: string;
            dispatchId: string;
            payload: Record<string, unknown>;
          };
        };
        const payload = request.dispatch.payload;
        latestDispatchMetadata.set(request.dispatch.dispatchId, {
          attemptId: request.dispatch.attemptId,
          taskId: typeof payload.taskId === "string" ? payload.taskId : "",
          sourceEventId:
            typeof payload.sourceEventId === "string"
              ? payload.sourceEventId
              : "",
          targetProfileId:
            typeof payload.targetProfileId === "string"
              ? normalizeAgentProfileIdForTest(payload.targetProfileId)
              : normalizeAgentProfileIdForTest("unknown-profile"),
        });
        return Promise.resolve({ accepted: true, status: "delivered" });
      }
    );
    vi.spyOn(
      runtimeCoordinatorClient,
      "waitRuntimeTransportDispatchResult"
    ).mockImplementation(
      (
        input: Parameters<
          typeof runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
        >[0]
      ) => {
        const metadata = latestDispatchMetadata.get(input.dispatchId) ?? {
          attemptId: input.attemptId,
          taskId: `task-${input.dispatchId}`,
          sourceEventId: `evt-${input.dispatchId}`,
          targetProfileId: normalizeAgentProfileIdForTest("unknown-profile"),
        };
        return Promise.resolve(
          buildWaitCompleted(
            buildRuntimeTransportTaskResult({
              attemptId: metadata.attemptId,
              dispatchId: input.dispatchId,
              taskId: metadata.taskId,
              sourceEventId: metadata.sourceEventId,
              targetProfileId: metadata.targetProfileId,
            })
          )
        );
      }
    );
    vi.spyOn(
      runtimeCoordinatorClient,
      "decideRuntimeTransportRuntimeCoordinatorExecution"
    ).mockResolvedValue({
      ok: true,
      action: "retry_blocked",
      reasonCode: "runtime_coordinator.retry_delivery_blocked",
      runtimeCoordinatorExecutionId: "rce-test",
      status: "recorded",
    });
  });

  it("acks a schema-fault dispatch as terminal even when the DLQ/status writes also fail", async () => {
    // Codex Blocker 2 / fail-loud: when the dispatch DB is missing its tables,
    // the dispatch op AND the terminal DLQ/status recording all raise
    // no-such-table. The message must still end terminal (acked) — never
    // silently retry, which is exactly the stuck loop that removing the
    // per-batch hot-path storage probe relies on never happening.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const schemaFaultError = Object.assign(
      new Error(
        'relation "openmeld.openMeldDaemon_dispatch_ledger" does not exist'
      ),
      { code: "42P01" }
    );
    vi.spyOn(dispatchLedgerPostgres, "claimDispatchAttempt").mockRejectedValue(
      schemaFaultError
    );
    vi.spyOn(dispatchLedgerPostgres, "writeDispatchDlq").mockRejectedValue(
      schemaFaultError
    );
    vi.spyOn(dispatchLedgerPostgres, "markDispatchStatus").mockRejectedValue(
      schemaFaultError
    );

    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-schema-fault-terminal-1",
      sourceEventId: "evt-schema-fault-terminal-1",
      targetProfileId: "agt-schema-fault-terminal-1",
      visitedProfileIdsHash: "hash-schema-fault-terminal-1",
    });
    await runDispatchQueueMessage(message);

    const delivery = readQueueMessageDeliveryCalls(message);
    expect(delivery.ack).toBe(1);
    expect(delivery.retry).toBe(0);
    errorSpy.mockRestore();
  });

  it("retries messages when OPENMELD_POSTGRESQL binding is missing", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const message = createQueueMessage({ any: "payload" });
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: { OPENMELD_SPACES: {} as DurableObjectNamespace<any> },
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(
      infoSpy.mock.calls.some(
        ([entry]) =>
          isRuntimeEvidenceEvent(
            entry,
            "core.openmeld.dispatch.queue_batch_failed"
          ) && entry.reasonCode === "missing_dispatch_runtime_binding"
      )
    ).toBe(true);
    expect(
      infoSpy.mock.calls.some(([entry]) =>
        isRuntimeEvidenceEvent(
          entry,
          "core.openmeld.dispatch.queue_batch_succeeded"
        )
      )
    ).toBe(false);
  });

  it("acks invalid payload after writing audit terminal record", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const message = createQueueMessage({ invalid: true });
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(claimDispatchAttempt).not.toHaveBeenCalled();
    expect(writeInvalidDispatchPayloadDlq).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.invalid_payload]",
      expect.objectContaining({
        event: CORE_LOG_EVENTS.dispatchQueueInvalidPayload,
      })
    );
    errorSpy.mockRestore();
  });

  it("retries invalid payload when audit write fails", async () => {
    vi.mocked(writeInvalidDispatchPayloadDlq).mockRejectedValueOnce(
      new Error("d1 write failed")
    );
    const message = createQueueMessage({ invalid: true });
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("claims and hands a completed result to RuntimeCoordinator finalization", async () => {
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111111",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      transportMode: "local-cli",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-1",
          sourceEventId: "evt-1",
          targetProfileId: "agt-1",
          taskId: "task-dispatch-1",
          agentControllerConversation: {
            agentControllerRef: "builtin:codex",
            agentControllerConversationKind: "thread",
            agentControllerConversationId: "thread-dispatch-1",
          },
          bootstrapTemplateFacts: {
            templateVersion: "compact-dispatch-bootstrap-v1",
            contentFingerprint: "sha256:test-binding-fingerprint",
          },
        })
      )
    );
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-1|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-1|5:agt-1",
    });
    expect(writeOpenMeldDaemonOpsDecision).not.toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "dispatch.reply.persisted",
      })
    );
  });

  it("hands an OpenClaw success result to RuntimeCoordinator finalization", async () => {
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-openclaw-session-split-1",
      spaceId: "space-openclaw-1",
      sourceEventId: "evt-openclaw-session-split-1",
      targetProfileId: "agt-openclaw-session-split-1",
      dispatchChainId: "dispatch-openclaw-session-split-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:openclawsplit01",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      transportMode: "local-cli",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey:
        "5:evt-openclaw-session-split-1|5:agt-openclaw-session-split-1",
      enqueuedAtMs: Date.now(),
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-openclaw-session-split-1",
          sourceEventId: "evt-openclaw-session-split-1",
          targetProfileId: "agt-openclaw-session-split-1",
          taskId: "task-dispatch-openclaw-session-split-1",
          bootstrapTemplateFacts: {
            templateVersion: "space-mesh-entry-brief-v1",
            contentFingerprint: "sha256:openclaw-session-split-1",
          },
          agentControllerRef: "builtin:openclaw",
          agentControllerConversationId: "session-openclaw-ctx-1",
          agentControllerConversation: {
            agentControllerRef: "builtin:openclaw",
            agentControllerConversationKind: "session",
            agentControllerConversationId:
              "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
          },
          output: "OPENCLAW-SPLIT-CONTEXT-OK",
        })
      )
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(writeDispatchDlq).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "schema.invalid.runtime_response",
      })
    );
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey:
        "5:evt-openclaw-session-split-1|5:agt-openclaw-session-split-1",
    });
  });

  it("leaves replyTo final reply publication to RuntimeCoordinator finalization", async () => {
    const dispatchId = "dispatch-reply-to-final-1";
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: "evt-reply-to-final-1",
        targetProfileId: "agt-reply-to-final-1",
        visitedProfileIdsHash: "stable32:reply-to-final-01",
        replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
      })
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId,
          sourceEventId: "evt-reply-to-final-1",
          targetProfileId: "agt-reply-to-final-1",
          taskId: `task-${dispatchId}`,
        })
      )
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-reply-to-final-1|5:${normalizeAgentProfileIdForTest("agt-reply-to-final-1")}`,
    });
  });

  it("acks without running duplicate final reply audit in Queue", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(claimFinalReplyEmission).mockResolvedValueOnce("already_claimed");
    rejectOpsDecisionWriteByCode(
      "dispatch.reply.duplicate_blocked",
      "duplicate blocked audit failed"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-reply-duplicate-audit-failed-1",
        sourceEventId: "evt-reply-duplicate-audit-failed-1",
        targetProfileId: "agt-reply-duplicate-audit-failed-1",
        visitedProfileIdsHash: "stable32:reply-duplicate-audit-01",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rollbackFinalReplyEmissionClaim).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(writeOpenMeldDaemonOpsDecision)
        .mock.calls.some(
          (call) => call.at(0)?.decisionCode === "dispatch.reply.emit_failed"
        )
    ).toBe(false);
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.reply_ops_decision_write_failed]",
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it("acks without running missing-ledger final reply audit in Queue", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(claimFinalReplyEmission).mockResolvedValueOnce(
      "missing_ledger_row"
    );
    rejectOpsDecisionWriteByCode(
      "dispatch.reply.claim_missing_ledger",
      "missing ledger audit failed"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-reply-missing-ledger-audit-failed-1",
        sourceEventId: "evt-reply-missing-ledger-audit-failed-1",
        targetProfileId: "agt-reply-missing-ledger-audit-failed-1",
        visitedProfileIdsHash: "stable32:reply-missing-ledger-audit-01",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rollbackFinalReplyEmissionClaim).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.reply_claim_missing_ledger]",
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it("acks without running persisted final reply audit in Queue", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(claimFinalReplyEmission).mockResolvedValueOnce("claimed");
    rejectOpsDecisionWriteByCode(
      "dispatch.reply.persisted",
      "persisted audit failed"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-reply-persisted-audit-failed-1",
        sourceEventId: "evt-reply-persisted-audit-failed-1",
        targetProfileId: "agt-reply-persisted-audit-failed-1",
        visitedProfileIdsHash: "stable32:reply-persisted-audit-01",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rollbackFinalReplyEmissionClaim).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(writeOpenMeldDaemonOpsDecision)
        .mock.calls.some(
          (call) => call.at(0)?.decisionCode === "dispatch.reply.emit_failed"
        )
    ).toBe(false);
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.reply_ops_decision_write_failed]",
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it("hands queue result observation to RuntimeCoordinator finalization", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-observation",
        sourceEventId: "evt-runtime-observation",
        targetProfileId: "agt-runtime-observation",
        visitedProfileIdsHash: "stable32:runtime-observation",
      })
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-runtime-observation",
          sourceEventId: "evt-runtime-observation",
          targetProfileId: "agt-runtime-observation",
          taskId: "task-dispatch-runtime-observation",
          agentControllerConversationId: "thread-runtime-observation",
          agentControllerConversation: {
            agentControllerRef: "builtin:codex",
            agentControllerConversationKind: "thread",
            agentControllerConversationId: "thread-runtime-observation",
          },
          bootstrapTemplateFacts: {
            templateVersion: "compact-dispatch-bootstrap-v1",
            contentFingerprint: "sha256:runtime-observation",
          },
        })
      )
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-runtime-observation|5:${normalizeAgentProfileIdForTest("agt-runtime-observation")}`,
    });
  });

  it("leaves explicit post_message publication to RuntimeCoordinator finalization", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-long-output",
        sourceEventId: "evt-long-output",
        targetProfileId: "agt-long-output",
        visitedProfileIdsHash: "stable32:11112239",
      })
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-long-output",
          output: "x".repeat(MAX_TEXT_LENGTH + 250),
          sourceEventId: "evt-long-output",
          targetProfileId: "agt-long-output",
          taskId: "task-dispatch-long-output",
        })
      )
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-long-output|5:${normalizeAgentProfileIdForTest("agt-long-output")}`,
    });
  });

  it("processes controller queues in parallel while preserving FIFO inside one controller", async () => {
    let releaseDispatchA!: () => void;
    const dispatchAWait = new Promise<void>((resolve) => {
      releaseDispatchA = () => {
        resolve();
      };
    });
    const startedDispatchIds: string[] = [];
    let resolveParallelObserved: (() => void) | null = null;
    const parallelObserved = new Promise<void>((resolve) => {
      resolveParallelObserved = resolve;
    });
    const defaultWaitImplementation = vi
      .mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
      .getMockImplementation();
    if (!defaultWaitImplementation) {
      throw new Error(
        "missing default waitRuntimeTransportDispatchResult mock"
      );
    }
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockImplementation(async (input) => {
      startedDispatchIds.push(input.dispatchId);
      if (
        startedDispatchIds.includes("dispatch-a") &&
        startedDispatchIds.includes("dispatch-c")
      ) {
        resolveParallelObserved?.();
      }
      if (input.dispatchId === "dispatch-a") {
        await dispatchAWait;
      }
      return await defaultWaitImplementation(input);
    });

    const messageA = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-a",
        sourceEventId: "evt-a",
        targetProfileId: "agt-a",
        visitedProfileIdsHash: "stable32:11112221",
      }),
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    });
    const messageB = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-b",
        sourceEventId: "evt-b",
        targetProfileId: "agt-b",
        visitedProfileIdsHash: "stable32:11112222",
      }),
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    });
    const messageC = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-c",
        sourceEventId: "evt-c",
        targetProfileId: "agt-c",
        visitedProfileIdsHash: "stable32:11112223",
      }),
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "claude-code",
      },
    });

    const batchPromise = handleDispatchQueueBatch({
      batch: {
        messages: [messageA, messageB, messageC],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });
    const parallelCheckResult = await Promise.race([
      parallelObserved.then(() => "parallel" as const),
      new Promise<"timeout">((resolve) => {
        setTimeout(() => {
          resolve("timeout");
        }, 50);
      }),
    ]);
    expect(parallelCheckResult).toBe("parallel");
    expect(startedDispatchIds).not.toContain("dispatch-b");

    releaseDispatchA();
    await batchPromise;

    expect(startedDispatchIds.indexOf("dispatch-b")).toBeGreaterThan(
      startedDispatchIds.indexOf("dispatch-a")
    );
    expect(messageA.ack).toHaveBeenCalledTimes(1);
    expect(messageB.ack).toHaveBeenCalledTimes(1);
    expect(messageC.ack).toHaveBeenCalledTimes(1);
    expect(messageA.retry).not.toHaveBeenCalled();
    expect(messageB.retry).not.toHaveBeenCalled();
    expect(messageC.retry).not.toHaveBeenCalled();
  });

  it("continues delivery for a later batch when an earlier batch is still waiting on another controller", async () => {
    let releaseDispatchA!: () => void;
    const dispatchAWait = new Promise<void>((resolve) => {
      releaseDispatchA = () => {
        resolve();
      };
    });
    const scheduledWaits: Promise<unknown>[] = [];
    const deliveredDispatchIds: string[] = [];
    const defaultWaitImplementation = vi
      .mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
      .getMockImplementation();
    if (!defaultWaitImplementation) {
      throw new Error(
        "missing default waitRuntimeTransportDispatchResult mock"
      );
    }
    const defaultDeliverImplementation = vi
      .mocked(runtimeCoordinatorClient.deliverRuntimeTransportDispatch)
      .getMockImplementation();
    if (!defaultDeliverImplementation) {
      throw new Error("missing default deliverRuntimeTransportDispatch mock");
    }

    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockImplementation(async (input) => {
      deliveredDispatchIds.push(input.dispatch.dispatchId);
      return await defaultDeliverImplementation(input);
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockImplementation(async (input) => {
      if (input.dispatchId === "dispatch-cross-batch-a") {
        await dispatchAWait;
      }
      return await defaultWaitImplementation(input);
    });

    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        scheduledWaits.push(Promise.resolve(promise));
      },
    };
    const messageA = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-cross-batch-a",
        sourceEventId: "evt-cross-batch-a",
        targetProfileId: "agt-cross-batch-a",
        visitedProfileIdsHash: "stable32:cross-batch-a",
      }),
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    });
    const messageB = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-cross-batch-b",
        sourceEventId: "evt-cross-batch-b",
        targetProfileId: "agt-cross-batch-b",
        visitedProfileIdsHash: "stable32:cross-batch-b",
      }),
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "claude-code",
      },
    });

    const batchAPromise = handleDispatchQueueBatch({
      batch: {
        messages: [messageA],
      } as unknown as MessageBatch<unknown>,
      ctx,
      env: makeEnvWithBindings(),
    });

    try {
      await expectEventually(() => {
        expect(messageA.ack).toHaveBeenCalledTimes(1);
        expect(deliveredDispatchIds).toEqual(["dispatch-cross-batch-a"]);
      });

      const batchBPromise = handleDispatchQueueBatch({
        batch: {
          messages: [messageB],
        } as unknown as MessageBatch<unknown>,
        ctx,
        env: makeEnvWithBindings(),
      });

      await batchBPromise;
      expect(messageB.ack).toHaveBeenCalledTimes(1);
      expect(deliveredDispatchIds).toEqual([
        "dispatch-cross-batch-a",
        "dispatch-cross-batch-b",
      ]);
      expect(scheduledWaits).toHaveLength(4);
    } finally {
      releaseDispatchA();
      await batchAPromise;
      await Promise.allSettled(scheduledWaits);
    }

    expect(messageA.retry).not.toHaveBeenCalled();
    expect(messageB.retry).not.toHaveBeenCalled();
  });

  it("adds binding identity when builtin refs already match", () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-controller-snapshot-1",
      sourceEventId: "evt-controller-snapshot-1",
      targetProfileId: "agt-controller-snapshot-1",
      visitedProfileIdsHash: "stable32:11112224",
    });
    message.controllerSnapshot = {
      ...message.controllerSnapshot,
      targetBindingState: "bound",
      targetBindingEnabled: true,
      agentControllerRef: "builtin:codex",
    };

    const updatedMessage = applyEffectiveTargetBindingSnapshotToMessage({
      message,
      snapshot: {
        bindingId: "binding-agt-controller-snapshot-1",
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        controllerNormalization: null,
        hostedRuntimeIdentity: null,
        openMeldServiceRuntimeId: "runtime-controller-snapshot-1",
        organizationId: "org-controller-snapshot-1",
        runtimeKind: "openmeld_service",
        ownerUserId: "owner-1",
      },
    });

    expect(updatedMessage).not.toBe(message);
    expect(updatedMessage.controllerSnapshot).toEqual({
      ...message.controllerSnapshot,
      bindingId: "binding-agt-controller-snapshot-1",
    });
  });

  it("freezes the effective binding configuration revision for delivery", () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-configuration-revision-1",
      sourceEventId: "evt-configuration-revision-1",
      targetProfileId: "agt-configuration-revision-1",
      visitedProfileIdsHash: "stable32:11112229",
    });
    const snapshot = {
      bindingId: "binding-configuration-revision-1",
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      configurationRevision: 7,
      controllerNormalization: null,
      hostedRuntimeIdentity: null,
      organizationId: "org-configuration-revision-1",
      runtimeKind: "openmeld_service",
      ownerUserId: "owner-1",
    } as EffectiveTargetBindingSnapshot;

    const updatedMessage = applyEffectiveTargetBindingSnapshotToMessage({
      message,
      snapshot,
    });

    expect(updatedMessage.controllerSnapshot).toMatchObject({
      bindingId: "binding-configuration-revision-1",
      configurationRevision: 7,
    });
  });

  it("delivers the RuntimeCoordinator accepted prompt and configuration after a later Binding revision", async () => {
    const message = createDispatchQueueMessage({
      attempts: 2,
      dispatchId: "dispatch-accepted-redrive-a",
      replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
      sourceClientMessageId: "client-accepted-redrive-a",
      sourceEventId: "evt-accepted-redrive-a",
      sourceText: "PROMPT_FINGERPRINT_A",
      targetProfileId: "agt-accepted-redrive-a",
      threadContext: TEST_THREAD_CONTEXT,
      visitedProfileIdsHash: "stable32:accepted-redrive-a",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    body.deliveryRecoveryReason = "route_lost";
    body.organizationId = "org-default";
    const bindingId = `binding-${body.targetProfileId}`;
    const openMeldServiceRuntimeId = `runtime-${body.targetProfileId}`;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce((input) => {
      const currentSnapshot = input.head.acceptedDispatchSnapshot;
      if (!currentSnapshot) {
        throw new Error("expected accepted dispatch snapshot");
      }
      expect(currentSnapshot.controllerSnapshot).toMatchObject({
        bindingId,
        configurationRevision: 8,
      });
      expect(currentSnapshot.openMeldServiceRuntimeId).toBe(
        openMeldServiceRuntimeId
      );
      return Promise.resolve({
        acceptedDispatchSnapshot: {
          ...currentSnapshot,
          controllerSnapshot: {
            ...currentSnapshot.controllerSnapshot,
            configurationRevision: 7,
          },
        },
        action: "create_execution",
        ok: true,
        primaryDispatchId: input.head.dispatchId,
        reasonCode: "runtime_coordinator.head_primary_reaccepted",
        runtimeCoordinatorExecutionId: null,
        status: "already_accepted",
        targetWakeLifecycleId:
          input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: "builtin:codex",
          bindingId,
          configurationRevision: 8,
          controllerEnabled: 1,
          openMeldServiceRuntimeId,
          profileKind: "agent",
          profileStatus: "active",
        })
      ),
    });

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          payload: expect.objectContaining({
            controllerSnapshot: expect.objectContaining({
              bindingId,
              configurationRevision: 7,
            }),
            deliveryRecoveryReason: "route_lost",
            executionIdentity: expect.objectContaining({
              core: expect.objectContaining({
                openMeldServiceRuntimeId: expect.objectContaining({
                  value: openMeldServiceRuntimeId,
                }),
              }),
            }),
            replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
            sourceSignalSnapshot: expect.objectContaining({
              text: "PROMPT_FINGERPRINT_A",
            }),
            threadContext: TEST_THREAD_CONTEXT,
          }),
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(1);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("fingerprints prompt, attachments, files, reply, and thread ownership as immutable Wake payload", async () => {
    const original = createDispatchBody({
      dispatchId: "dispatch-payload-fingerprint-a",
      replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
      sourceClientMessageId: "client-payload-fingerprint-a",
      sourceEventId: "evt-payload-fingerprint-a",
      sourceText: "PROMPT_FINGERPRINT_A",
      targetProfileId: "agt-payload-fingerprint-a",
      threadContext: TEST_THREAD_CONTEXT,
      visitedProfileIdsHash: "stable32:payload-fingerprint-a",
    });
    original.controllerSnapshot = {
      ...original.controllerSnapshot,
      agentControllerRef: "builtin:codex",
      bindingId: "binding-payload-fingerprint-a",
      configurationRevision: 7,
    };
    if (!original.sourceSignalSnapshot) {
      throw new Error("expected source signal snapshot");
    }
    original.sourceSignalSnapshot.attachments = [
      {
        id: "attachment-fingerprint-a",
        mimeType: "image/png",
        sizeBytes: 128,
      },
    ];
    original.sourceSignalSnapshot.files = [
      {
        fileId: "file-fingerprint-a",
        mimeType: "text/plain",
        name: "fingerprint-a.txt",
        revision: 1,
        sizeBytes: 64,
      },
    ];

    const promptChanged = structuredClone(original);
    const attachmentChanged = structuredClone(original);
    const fileChanged = structuredClone(original);
    const replyChanged = structuredClone(original);
    const threadChanged = structuredClone(original);
    if (
      !(
        promptChanged.sourceSignalSnapshot &&
        attachmentChanged.sourceSignalSnapshot?.attachments?.[0] &&
        fileChanged.sourceSignalSnapshot?.files?.[0] &&
        replyChanged.replyToSnapshot &&
        threadChanged.threadContext
      )
    ) {
      throw new Error("expected complete immutable payload fixtures");
    }
    promptChanged.sourceSignalSnapshot.text = "PROMPT_FINGERPRINT_B";
    attachmentChanged.sourceSignalSnapshot.attachments[0].id =
      "attachment-fingerprint-b";
    fileChanged.sourceSignalSnapshot.files[0].revision = 2;
    replyChanged.replyToSnapshot.signalId = "signal-fingerprint-b";
    threadChanged.threadContext.threadId = "thread-fingerprint-b";

    const snapshots = await Promise.all(
      [
        original,
        promptChanged,
        attachmentChanged,
        fileChanged,
        replyChanged,
        threadChanged,
      ].map((messageBody) =>
        buildAcceptedDispatchSnapshot({
          message: messageBody,
          openMeldServiceRuntimeId: "runtime-payload-fingerprint-a",
          runtimeKind: "openmeld_service",
        })
      )
    );

    expect(snapshots.every(Boolean)).toBe(true);
    expect(
      new Set(snapshots.map((snapshot) => snapshot?.payloadFingerprint)).size
    ).toBe(6);
  });

  it("acks same-idempotency messages once per batch across controller workers", async () => {
    let releaseDispatchA: (() => void) | undefined;
    const dispatchAWait = new Promise<void>((resolve) => {
      releaseDispatchA = () => {
        resolve();
      };
    });
    const startedDispatchIds: string[] = [];
    const defaultWaitImplementation = vi
      .mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
      .getMockImplementation();
    if (!defaultWaitImplementation) {
      throw new Error(
        "missing default waitRuntimeTransportDispatchResult mock"
      );
    }
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockImplementation(async (input) => {
      startedDispatchIds.push(input.dispatchId);
      if (input.dispatchId === "dispatch-batch-dupe-a") {
        await dispatchAWait;
      }
      return await defaultWaitImplementation(input);
    });

    const sharedIdempotencyKey = "5:evt-batch-dupe-1|5:agt-batch-dupe-1";
    const messageA = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-batch-dupe-a",
        sourceEventId: "evt-batch-dupe-a",
        targetProfileId: "agt-batch-dupe-a",
        visitedProfileIdsHash: "stable32:11112230",
      }),
      idempotencyKey: sharedIdempotencyKey,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    });
    const messageB = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-batch-dupe-b",
        sourceEventId: "evt-batch-dupe-b",
        targetProfileId: "agt-batch-dupe-b",
        visitedProfileIdsHash: "stable32:11112231",
      }),
      idempotencyKey: sharedIdempotencyKey,
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "claude-code",
      },
    });

    const batchPromise = handleDispatchQueueBatch({
      batch: {
        messages: [messageA, messageB],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    await expectEventually(() => {
      expect(startedDispatchIds).toContain("dispatch-batch-dupe-a");
    });
    await expectEventually(() => {
      expect(messageB.ack).toHaveBeenCalledTimes(1);
    });
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(startedDispatchIds).not.toContain("dispatch-batch-dupe-b");

    if (!releaseDispatchA) {
      throw new Error("missing releaseDispatchA");
    }
    releaseDispatchA();
    await batchPromise;
    expect(messageA.ack).toHaveBeenCalledTimes(1);
    expect(messageB.ack).toHaveBeenCalledTimes(1);
    expect(messageA.retry).not.toHaveBeenCalled();
    expect(messageB.retry).not.toHaveBeenCalled();
  });

  it("dedupes cross-batch concurrent dispatches that share one idempotency key", async () => {
    const claimState = new Set<string>();
    vi.mocked(claimDispatchAttempt).mockImplementation(
      ({ message, attempt }) => {
        if (claimState.has(message.idempotencyKey)) {
          return Promise.resolve({
            status: "deduped" as const,
          });
        }
        claimState.add(message.idempotencyKey);
        return Promise.resolve(
          buildClaimedAttempt({
            attempt,
            dispatchId: message.dispatchId,
          })
        );
      }
    );

    const sharedIdempotencyKey = "5:evt-batch-cross-1|5:agt-batch-cross-1";
    const messageA = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-batch-cross-a",
        sourceEventId: "evt-batch-cross-a",
        targetProfileId: "agt-batch-cross-a",
        visitedProfileIdsHash: "stable32:11112232",
      }),
      idempotencyKey: sharedIdempotencyKey,
    });
    const messageB = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-batch-cross-b",
        sourceEventId: "evt-batch-cross-b",
        targetProfileId: "agt-batch-cross-b",
        visitedProfileIdsHash: "stable32:11112233",
      }),
      idempotencyKey: sharedIdempotencyKey,
    });

    await Promise.all([
      handleDispatchQueueBatch({
        batch: {
          messages: [messageA],
        } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(),
      }),
      handleDispatchQueueBatch({
        batch: {
          messages: [messageB],
        } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(),
      }),
    ]);

    expect(claimDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
    ).toHaveBeenCalledTimes(1);
    expect(messageA.ack).toHaveBeenCalledTimes(1);
    expect(messageB.ack).toHaveBeenCalledTimes(1);
    expect(messageA.retry).not.toHaveBeenCalled();
    expect(messageB.retry).not.toHaveBeenCalled();
  });

  it("emits transient replying hint when claim succeeds", async () => {
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-1",
        sourceEventId: "evt-replying-hint-1",
        sourceClientMessageId: "client-replying-hint-1",
        targetProfileId: "agt-replying-hint-1",
        targetProfileMentionLabel: "replying-hint-1",
        visitedProfileIdsHash: "stable32:11111140",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey: "5:evt-replying-hint-1|5:agt-replying-hint-1",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(claimReplyingHintEmission).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-replying-hint-1|5:agt-replying-hint-1",
        nowMs: expect.any(Number),
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(3);
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        text: "Dispatching to @replying-hint-1...",
        meta: expect.objectContaining({
          transient: true,
          purpose: "dispatch_activity_dispatching",
          dispatchId: "dispatch-replying-hint-1",
          sourceEventId: "evt-replying-hint-1",
          sourceClientMessageId: "client-replying-hint-1",
          targetMentionLabel: "replying-hint-1",
          targetProfileId: normalizeAgentProfileIdForTest(
            "agt-replying-hint-1"
          ),
        }),
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        text: "@Codex is replying...",
        meta: expect.objectContaining({
          transient: true,
          purpose: "agent_replying",
          dispatchId: "dispatch-replying-hint-1",
        }),
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        text: "@Codex is replying...",
        meta: expect.objectContaining({
          transient: true,
          purpose: "agent_replying_end",
          dispatchId: "dispatch-replying-hint-1",
        }),
      })
    );
    expect(rollbackReplyingHintEmissionClaim).not.toHaveBeenCalled();
  });

  it("includes the runtime computer name in transient replying hints when execution evidence is available", async () => {
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-computer-name",
        sourceEventId: "evt-replying-hint-computer-name",
        sourceClientMessageId: "client-replying-hint-computer-name",
        targetProfileId: "agt-replying-hint-computer-name",
        visitedProfileIdsHash: "stable32:11111141",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-computer-name|5:agt-replying-hint-computer-name",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithRuntimeDeviceDisplayName("Studio MacBook")
      ),
    });

    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          dispatchId: "dispatch-replying-hint-computer-name",
          purpose: "agent_replying",
          runtimeDeviceDisplayName: "Studio MacBook",
          transient: true,
        }),
      })
    );
  });

  it("clears an already-claimed replying hint after the attempt finishes", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-2",
        sourceEventId: "evt-replying-hint-2",
        targetProfileId: "agt-replying-hint-2",
        visitedProfileIdsHash: "stable32:11111141",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey: "5:evt-replying-hint-2|5:agt-replying-hint-2",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(2);
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_dispatching",
          dispatchId: "dispatch-replying-hint-2",
        }),
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "agent_replying_end",
          dispatchId: "dispatch-replying-hint-2",
        }),
      })
    );
    expect(rollbackReplyingHintEmissionClaim).not.toHaveBeenCalled();
  });

  it("clears an already-active replying hint after RuntimeCoordinator result observation", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId: "dispatch-replying-hint-terminal-validation",
          sourceEventId: "evt-replying-hint-terminal-validation",
          targetProfileId: "agt-replying-hint-terminal-validation",
          taskId: "task-dispatch-replying-hint-terminal-validation",
          errorCode: "schema.invalid.runtime_response",
          errorMessage: "daemon runtime task failed",
        })
      )
    );
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-replying-hint-terminal-validation",
      sourceEventId: "evt-replying-hint-terminal-validation",
      targetProfileId: "agt-replying-hint-terminal-validation",
      visitedProfileIdsHash: "stable32:11111141-terminal",
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-terminal-validation|5:agt-replying-hint-terminal-validation",
    });

    await runDispatchQueueMessage(message);

    const transientPurposes = readTransientSignalPurposes();
    expect(transientPurposes).toContain("agent_replying_end");
    expect(transientPurposes).not.toContain("dispatch_activity_failed");
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  it("does not emit agent_replying_end when an already-active hint hits a wait transport error", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockRejectedValueOnce(
      Object.assign(new Error("network.transient"), {
        code: "network.transient",
      })
    );
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-replying-hint-transport-error",
      sourceEventId: "evt-replying-hint-transport-error",
      targetProfileId: "agt-replying-hint-transport-error",
      visitedProfileIdsHash: "stable32:11111141a",
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-transport-error|5:agt-replying-hint-transport-error",
    });

    await runDispatchQueueMessage(message);

    const transientPurposes = readTransientSignalPurposes();
    expect(transientPurposes).not.toContain("dispatch_activity_retrying");
    expect(transientPurposes).not.toContain("agent_replying");
    expect(transientPurposes).not.toContain("agent_replying_end");
    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          dispatchId: "dispatch-replying-hint-transport-error",
          eventKind: "retry",
          reasonCode: "network.transient",
          trigger: "alarm",
        }),
      })
    );
  });

  it("does not publish retrying activity from Queue for failed task results", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId: "dispatch-replying-hint-retry-replacement",
          sourceEventId: "evt-replying-hint-retry-replacement",
          targetProfileId: "agt-replying-hint-retry-replacement",
          taskId: "task-dispatch-replying-hint-retry-replacement",
          errorType: "network",
          errorMessage: "network.transient",
        })
      )
    );
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-replying-hint-retry-replacement",
      sourceEventId: "evt-replying-hint-retry-replacement",
      targetProfileId: "agt-replying-hint-retry-replacement",
      visitedProfileIdsHash: "stable32:11111141b",
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-retry-replacement|5:agt-replying-hint-retry-replacement",
    });

    await runDispatchQueueMessage(message);

    const transientPurposes = readTransientSignalPurposes();
    expect(transientPurposes).toContain("agent_replying_end");
    expect(transientPurposes).not.toContain("dispatch_activity_retrying");
  });

  it("does not publish failure activity from Queue for invalid completed task results", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-replying-hint-failure-replacement",
          sourceEventId: "evt-replying-hint-failure-replacement",
          targetProfileId: "agt-replying-hint-failure-replacement",
          taskId: "task-dispatch-replying-hint-failure-replacement",
          agentControllerRef: "",
        })
      )
    );
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-replying-hint-failure-replacement",
      sourceEventId: "evt-replying-hint-failure-replacement",
      targetProfileId: "agt-replying-hint-failure-replacement",
      visitedProfileIdsHash: "stable32:11111141c",
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-failure-replacement|5:agt-replying-hint-failure-replacement",
    });

    await runDispatchQueueMessage(message);

    const transientPurposes = readTransientSignalPurposes();
    expect(transientPurposes).toContain("agent_replying_end");
    expect(transientPurposes).not.toContain("dispatch_activity_failed");
  });

  it("does not emit transient replying hint when ledger row is missing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "missing_ledger_row"
    );
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-missing-ledger",
        sourceEventId: "evt-replying-hint-missing-ledger",
        targetProfileId: "agt-replying-hint-missing-ledger",
        visitedProfileIdsHash: "stable32:11111145",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-missing-ledger|5:agt-replying-hint-missing-ledger",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(1);
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_dispatching",
          dispatchId: "dispatch-replying-hint-missing-ledger",
        }),
      })
    );
    expect(rollbackReplyingHintEmissionClaim).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_missing_ledger]",
      expect.objectContaining({
        dispatchId: "dispatch-replying-hint-missing-ledger",
        idempotencyKey:
          "5:evt-replying-hint-missing-ledger|5:agt-replying-hint-missing-ledger",
      })
    );
    warnSpy.mockRestore();
  });

  it("retries transient replying hint once and keeps claim when retry succeeds", async () => {
    vi.mocked(rpcPostTransientSignal)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient emit failed first"))
      .mockResolvedValueOnce(undefined);
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-retry-success",
        sourceEventId: "evt-replying-hint-retry-success",
        targetProfileId: "agt-replying-hint-retry-success",
        visitedProfileIdsHash: "stable32:11111146",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey:
        "5:evt-replying-hint-retry-success|5:agt-replying-hint-retry-success",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(4);
    expect(rollbackReplyingHintEmissionClaim).not.toHaveBeenCalled();
  });

  it("rolls back replying hint claim when transient emit fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(rpcPostTransientSignal).mockRejectedValue(
      new Error("transient emit failed")
    );
    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-replying-hint-3",
        sourceEventId: "evt-replying-hint-3",
        targetProfileId: "agt-replying-hint-3",
        visitedProfileIdsHash: "stable32:11111142",
      }),
      spaceId: HEX_SPACE_ID,
      idempotencyKey: "5:evt-replying-hint-3|5:agt-replying-hint-3",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(3);
    expect(rollbackReplyingHintEmissionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-replying-hint-3|5:agt-replying-hint-3",
        claimedAtMs: expect.any(Number),
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_emit_retry_failed]",
      expect.objectContaining({
        dispatchId: "dispatch-replying-hint-3",
        idempotencyKey: "5:evt-replying-hint-3|5:agt-replying-hint-3",
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_emit_failed]",
      expect.objectContaining({
        dispatchId: "dispatch-replying-hint-3",
        idempotencyKey: "5:evt-replying-hint-3|5:agt-replying-hint-3",
      })
    );
    warnSpy.mockRestore();
  });

  it("resolves auth profile context before handing finalization to RuntimeCoordinator", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      profileName: "auto-reply-test-codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-name-1",
      spaceId: "space-1",
      sourceEventId: "evt-name-1",
      targetProfileId: "agt-name-1",
      dispatchChainId: "dispatch-name-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111112",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-name-1|5:agt-name-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
        }),
        authRpc
      ),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-name-1|5:agt-name-1",
    });
  });

  it("keeps auth profile context resolution separate from Queue finalization", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      profileName: "auto-reply-test-codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-name-auth-rpc-1",
        sourceEventId: "evt-name-auth-rpc-1",
        targetProfileId: "agt-name-auth-rpc-1",
        visitedProfileIdsHash: "stable32:11111112",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithRuntimeDisplayNameReadError(
          "runtime display name unavailable"
        ),
        authRpc
      ),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-name-auth-rpc-1|5:${normalizeAgentProfileIdForTest("agt-name-auth-rpc-1")}`,
    });
  });

  it("hands off finalization without synthesizing unresolved profile names", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-name-unresolved-1",
        sourceEventId: "evt-name-unresolved-1",
        targetProfileId: "agt-name-unresolved-1",
        visitedProfileIdsHash: "stable32:11111113",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithRuntimeDisplayNameReadError(
          "runtime display name unavailable"
        ),
        authRpc
      ),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-name-unresolved-1|5:${normalizeAgentProfileIdForTest("agt-name-unresolved-1")}`,
    });
  });

  it("does not transform runtime output inside Queue result observation", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-strip-prefix-1",
          taskId: "task-dispatch-strip-prefix-1",
          sourceEventId: "evt-strip-prefix-1",
          targetProfileId: "agt-strip-prefix-1",
          output:
            "reply-to:evt-strip-prefix-1 dispatch:dispatch-strip-prefix-1 task:task-strip-prefix-1\nhello from codex",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-strip-prefix-1",
      spaceId: "space-1",
      sourceEventId: "evt-strip-prefix-1",
      targetProfileId: "agt-strip-prefix-1",
      dispatchChainId: "dispatch-strip-prefix-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111113",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-strip-prefix-1|5:agt-strip-prefix-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-strip-prefix-1|5:agt-strip-prefix-1",
    });
  });

  it("does not synthesize final reply text inside Queue result observation", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-meta-ack-1",
          taskId: "task-dispatch-meta-ack-1",
          sourceEventId: "evt-meta-ack-1",
          targetProfileId: "agt-meta-ack-1",
          output: "Acknowledged source event evt-meta-ack-1 and sent a reply.",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-meta-ack-1",
      spaceId: "space-1",
      sourceEventId: "evt-meta-ack-1",
      targetProfileId: "agt-meta-ack-1",
      dispatchChainId: "dispatch-meta-ack-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111114",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-meta-ack-1|5:agt-meta-ack-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-meta-ack-1|5:agt-meta-ack-1",
    });
  });

  it("does not rewrite human-source runtime output inside Queue observation", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-mention-prefix-1",
          taskId: "task-dispatch-mention-prefix-1",
          sourceEventId: "evt-mention-prefix-1",
          targetProfileId: "agt-target-mention-prefix-1",
          output: "Here is the update you asked for.",
        })
      )
    );

    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-mention-prefix-1",
        sourceEventId: "evt-mention-prefix-1",
        targetProfileId: "agt-target-mention-prefix-1",
        visitedProfileIdsHash: "stable32:11111115",
      }),
      sourceSignalSnapshot: {
        text: "@agt-target-mention-prefix-1 please help",
        profileId: "human-source-mention-1",
        profileKind: "human",
      },
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-mention-prefix-1|5:${normalizeAgentProfileIdForTest("agt-target-mention-prefix-1")}`,
    });
  });

  it("does not rewrite agent-mention runtime output inside Queue observation", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-mention-prefix-2",
          taskId: "task-dispatch-mention-prefix-2",
          sourceEventId: "evt-mention-prefix-2",
          targetProfileId: "agt-target-mention-prefix-2",
          output: "@agt-source-mention-2 working on it now.",
        })
      )
    );

    const message = createQueueMessage({
      ...createDispatchBody({
        dispatchId: "dispatch-mention-prefix-2",
        sourceEventId: "evt-mention-prefix-2",
        targetProfileId: "agt-target-mention-prefix-2",
        visitedProfileIdsHash: "stable32:11111116",
      }),
      sourceSignalSnapshot: {
        text: "@agt-target-mention-prefix-2 please help",
        profileId: "agt-source-mention-2",
        profileKind: "agent",
      },
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: `5:evt-mention-prefix-2|5:${normalizeAgentProfileIdForTest("agt-target-mention-prefix-2")}`,
    });
  });

  it("leaves missing agentControllerConversationId result validation to RuntimeCoordinator finalization", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-missing-context-1",
          taskId: "task-dispatch-missing-context-1",
          sourceEventId: "evt-missing-context-1",
          targetProfileId: "agt-missing-context-1",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "",
          output: "hello from daemon",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-missing-context-1",
      spaceId: "space-1",
      sourceEventId: "evt-missing-context-1",
      targetProfileId: "agt-missing-context-1",
      dispatchChainId: "dispatch-missing-context-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111116",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-missing-context-1|5:agt-missing-context-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-missing-context-1|5:agt-missing-context-1",
    });
  });

  it("leaves typed conversation metadata validation to RuntimeCoordinator finalization", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-mismatched-conversation-1",
          taskId: "task-dispatch-mismatched-conversation-1",
          sourceEventId: "evt-mismatched-conversation-1",
          targetProfileId: "agt-mismatched-conversation-1",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "thread-match-1",
          agentControllerConversation: {
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: "thread-match-1",
            agentControllerConversationKind: "session",
          },
          output: "hello from daemon",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-mismatched-conversation-1",
      spaceId: "space-1",
      sourceEventId: "evt-mismatched-conversation-1",
      targetProfileId: "agt-mismatched-conversation-1",
      dispatchChainId: "dispatch-mismatched-conversation-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111116a",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey:
        "5:evt-mismatched-conversation-1|5:agt-mismatched-conversation-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey:
        "5:evt-mismatched-conversation-1|5:agt-mismatched-conversation-1",
    });
  });

  it("leaves provider mismatch validation to RuntimeCoordinator finalization", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-mismatched-provider-1",
          taskId: "task-dispatch-mismatched-provider-1",
          sourceEventId: "evt-mismatched-provider-1",
          targetProfileId: "agt-mismatched-provider-1",
          agentControllerRef: "builtin:openclaw",
          agentControllerConversationId: "session-match-1",
          agentControllerConversation: {
            agentControllerRef: "builtin:claude-code",
            agentControllerConversationId: "session-match-1",
            agentControllerConversationKind: "session",
          },
          output: "hello from daemon",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-mismatched-provider-1",
      spaceId: "space-1",
      sourceEventId: "evt-mismatched-provider-1",
      targetProfileId: "agt-mismatched-provider-1",
      dispatchChainId: "dispatch-mismatched-provider-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111117a",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-mismatched-provider-1|5:agt-mismatched-provider-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-mismatched-provider-1|5:agt-mismatched-provider-1",
    });
  });

  it("leaves missing agentControllerRef validation to RuntimeCoordinator finalization", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-missing-controller-1",
          taskId: "task-dispatch-missing-controller-1",
          sourceEventId: "evt-missing-controller-1",
          targetProfileId: "agt-missing-controller-1",
          agentControllerRef: "",
          agentControllerConversationId: "thread-missing-controller-1",
          output: "hello from daemon",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-missing-controller-1",
      spaceId: "space-1",
      sourceEventId: "evt-missing-controller-1",
      targetProfileId: "agt-missing-controller-1",
      dispatchChainId: "dispatch-missing-controller-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111117",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      controllerSnapshot: {
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: null,
      },
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-missing-controller-1|5:agt-missing-controller-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSignal).not.toHaveBeenCalled();
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-missing-controller-1|5:agt-missing-controller-1",
    });
  });

  it("does not classify legacy-looking runtime output inside Queue observation", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-empty-output-1",
          taskId: "task-dispatch-empty-output-1",
          sourceEventId: "evt-empty-output-1",
          targetProfileId: "agt-empty-output-1",
          output:
            "reply-to:evt-empty-output-1 dispatch:dispatch-empty-output-1 task:task-empty-output-1",
        })
      )
    );

    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-empty-output-1",
      spaceId: "space-1",
      sourceEventId: "evt-empty-output-1",
      targetProfileId: "agt-empty-output-1",
      dispatchChainId: "dispatch-empty-output-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111118",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-empty-output-1|5:agt-empty-output-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-empty-output-1|5:agt-empty-output-1",
    });
  });

  it("retains the workstation conveyor when a concurrent intake has not handed off execution", async () => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-concurrent-intake",
      sourceEventId: "evt-concurrent-intake",
      targetProfileId: "agt-concurrent-intake",
      visitedProfileIdsHash: "hash-concurrent-intake",
    });
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "deduped",
      admissionInFlight: true,
    });
    const outcome = await dispatchOutboxMessageDirectly({
      ctx: { waitUntil: vi.fn() },
      env: makeEnvWithBindings(),
      message: message.body as OpenMeldDaemonDispatchQueueMessage,
    });
    expect(outcome).toMatchObject({
      status: "retry_scheduled",
      recoveryTransport: "outbox",
    });
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  it("acks deduped message without dispatch status update", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "deduped",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-2",
        sourceEventId: "evt-1",
        targetProfileId: "agt-1",
        visitedProfileIdsHash: "stable32:11111112",
        enqueuedAtMs: 1000,
        spaceNameSnapshot: "ops-room",
        sourceProfileNameSnapshot: "Felix",
        targetProfileNameSnapshot: "Step6 Codex",
        targetProfileMentionLabel: "codex",
        sourceText: "hello from the human sender",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.claim_deduped]",
      expect.objectContaining({
        dispatchId: "dispatch-2",
        human: expect.objectContaining({
          spaceName: "ops-room",
          targetProfileName: "Step6 Codex",
          targetLabel: "codex",
          sourceProfileName: "Felix",
          sourceTextPreview: "hello from the human sender",
          lastAttemptAgeMs: null,
        }),
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it.each([
    "explicit_recovery",
    "stale_queued",
    "stale_dispatching",
    "expired_window",
  ] as const)("resumes a deduped hosted admission on its original dispatch attempt: %s", async (scenario) => {
    const nowMs = 1_700_000_100_000;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const executionAttemptId = "attempt-hosted-admission-recovery-1";
    vi.mocked(claimDispatchAttempt).mockRestore();
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-admission-recovery-1"
    );
    const message = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-hosted-admission-recovery-1",
          sourceEventId: "evt-hosted-admission-recovery-1",
          sourceText: "Continue the interrupted request",
          targetProfileId,
          visitedProfileIdsHash: "stable32:hosted-admission-recovery-1",
        }),
        ...(scenario === "explicit_recovery"
          ? { deliveryRecoveryReason: "hosted_admission_incomplete" as const }
          : {}),
      },
      2
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createProjectionPostgresBinding((query) => {
          const normalizedSql = query.text.toLowerCase();
          if (
            normalizedSql.includes(
              'from "openmeld"."openmelddaemon_dispatch_ledger"'
            )
          ) {
            return [
              {
                dispatch_id: "dispatch-hosted-admission-recovery-1",
                first_seen_at_ms:
                  scenario === "expired_window"
                    ? nowMs - 2 * 24 * 60 * 60_000
                    : nowMs - 60_000,
                last_attempt_at_ms: nowMs - 60_000,
                latest_attempt_id: executionAttemptId,
                attempt_count: 1,
                dispatch_owner_kind: null,
                dispatch_owner_id: null,
                status:
                  scenario === "stale_dispatching" ? "dispatching" : "queued",
              },
            ];
          }
          if (
            normalizedSql.includes(
              'from "openmeld"."openmelddaemon_dispatch_attempts"'
            )
          ) {
            return [
              {
                attemptId: executionAttemptId,
                attemptNo: 1,
                status: "dispatching",
                errorCode: null,
                connectionGeneration: null,
                daemonSessionId: null,
                leaseEpoch: null,
              },
            ];
          }
          const result = resolveNativeProjectionRow({
            args: query.values ?? [],
            normalizedSql,
            row: {
              agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
              bindingId: "binding-hosted-center-agent",
              controllerEnabled: 1,
              hostedRuntimeIdentityJson: JSON.stringify(
                HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
              ),
              modelId: "deepseek/deepseek-v4-flash",
              profileKind: "agent",
              profileStatus: "active",
              runtimeKind: "hosted_center_agent",
              openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
            },
          });
          return result ? [result] : [];
        }),
        {
          resolveProfileById: async () => ({
            ok: true,
            profile: {
              ownerUserId: null,
              managedRole: "center_agent",
              organizationId: "org-default",
              profileHandle: "center-agent",
              profileId: targetProfileId,
              profileKind: "agent",
              profileName: "Center Agent",
              status: "active",
            },
          }),
        }
      ),
    });

    expect(submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        executionAttemptId,
        message: expect.objectContaining({
          deliveryRecoveryReason: "hosted_admission_incomplete",
          dispatchId: "dispatch-hosted-admission-recovery-1",
          targetProfileId,
        }),
      })
    );
    expect(markDispatchAttemptWaitingForResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: executionAttemptId,
      })
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("keeps hosted admission recovery metadata off the workstation transport", async () => {
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      hostedAdmissionRecoveryAttemptId:
        "attempt-hosted-admission-binding-change-1",
      hostedAdmissionRecoveryAttemptNo: 1,
      status: "deduped",
    });
    const message = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-hosted-admission-binding-change-1",
          sourceEventId: "evt-hosted-admission-binding-change-1",
          targetProfileId: "agt-hosted-admission-binding-change-1",
          visitedProfileIdsHash: "stable32:hosted-admission-binding-change-1",
        }),
        deliveryRecoveryReason: "hosted_admission_incomplete",
      },
      2
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          payload: expect.not.objectContaining({
            deliveryRecoveryReason: "hosted_admission_incomplete",
          }),
        }),
      })
    );
  });

  it.each([
    "deleted",
    "lookup_unavailable",
    "owner_missing",
    "execution_linked",
    "publication_ready",
    "stop_unavailable",
  ] as const)("settles a legacy redelivery through cancellation authority: %s", async (scenario) => {
    const body = createDispatchBody({
      dispatchId: "dispatch-deleted-legacy",
      sourceEventId: "evt-deleted-legacy",
      targetProfileId: "agt-deleted-legacy",
      targetProfileNameSnapshot: "Former Agent",
      visitedProfileIdsHash: "stable32:deleted-legacy",
    });
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: body.dispatchId,
      spaceId: body.spaceId,
      targetProfileId: body.targetProfileId,
    });
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "deduped",
      runtimeCoordinatorDecisionRequest: {
        ownerUserId: scenario === "owner_missing" ? null : "owner-default",
        claimDecision: "claim_existing_inside_window",
        coordinatorDecision: {
          coordinatorAction: "decide_retry_timeout_or_reclaim",
          eventKind: "retry",
          kind: "runtime_coordinator_decision_required",
          mayPublishSpaceReply: false,
          mayReconstructTokenFromFingerprintOrHash: false,
          mayUseD1TokenProjection: false,
          ownerConflictTokenClass: null,
          queueOrAlarmRole: "trigger_only",
          reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
          runId: null,
          tokenStatus: null,
          usesFinalClaimAuthority: false,
          usesLegacyClaimLeaseAuthority: false,
        },
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId,
        runtimeCoordinatorStatus: null,
      },
    });
    const stop = vi
      .spyOn(
        runtimeCoordinatorClient,
        "recordRuntimeTransportRuntimeCoordinatorHeadPreAgentStop"
      )
      .mockImplementation(() => {
        if (scenario === "deleted") {
          return Promise.resolve({
            ok: true,
            primaryDispatchId: body.dispatchId,
            publicationIntentId: "rcpi:stopped:legacy-wake",
            runtimeCoordinatorExecutionId: null,
            reasonCode: "runtime_coordinator.pre_agent_stop_requested",
            status: "stopped_before_execution",
            targetWakeLifecycleId: "legacy-wake",
          } as const);
        }
        return Promise.resolve({
          ok: false,
          primaryDispatchId: body.dispatchId,
          publicationIntentId: null,
          runtimeCoordinatorExecutionId:
            scenario === "execution_linked"
              ? runtimeCoordinatorExecutionId
              : null,
          reasonCode:
            scenario === "publication_ready"
              ? "runtime_coordinator.pre_agent_stop_after_publication_intent"
              : "runtime_coordinator.pre_agent_stop_requested",
          status: (
            {
              lookup_unavailable: "retry_later",
              owner_missing: "retry_later",
              execution_linked: "execution_linked",
              publication_ready: "conflict",
              stop_unavailable: "retry_later",
            } as const
          )[scenario],
          targetWakeLifecycleId: "legacy-wake",
        } as const);
      });
    const stopExecution = vi
      .spyOn(
        runtimeCoordinatorClient,
        "requestRuntimeTransportRuntimeCoordinatorWakeStop"
      )
      .mockResolvedValue({
        ok: true,
        status: "cancellation_requested",
        runtimeCoordinatorExecutionId,
        targetProfileId: body.targetProfileId,
        cancellationState: {
          observedAtMs: Date.now(),
          reasonCode: null,
          status: "requested",
        },
      });
    const message = createQueueMessage(body, 20);
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(undefined, {
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: false,
          code:
            scenario === "lookup_unavailable"
              ? "profile.internal_error"
              : "profile.not_found",
          message: "Profile lookup result",
        }),
      }),
    });
    const shouldRetry = [
      "lookup_unavailable",
      "owner_missing",
      "stop_unavailable",
    ].includes(scenario);
    expect(message.ack).toHaveBeenCalledTimes(shouldRetry ? 0 : 1);
    expect(message.retry).toHaveBeenCalledTimes(shouldRetry ? 1 : 0);
    expect(stop).toHaveBeenCalledTimes(
      ["lookup_unavailable", "owner_missing"].includes(scenario) ? 0 : 1
    );
    if (scenario === "deleted") {
      expect(stop).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: "owner-default",
          preAgentStop: expect.objectContaining({
            dispatchId: body.dispatchId,
            reason: "The Agent Profile was deleted.",
          }),
        })
      );
    }
    expect(stopExecution).toHaveBeenCalledTimes(
      scenario === "execution_linked" ? 1 : 0
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
  });

  it("retries RuntimeCoordinator trigger when durable authority is missing without re-delivering", async () => {
    const messageBody = createDispatchBody({
      dispatchId: "dispatch-rc-authority-missing-1",
      sourceEventId: "evt-rc-authority-missing-1",
      targetProfileId: "agt-rc-authority-missing-1",
      visitedProfileIdsHash: "stable32:11111112a",
    });
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: messageBody.dispatchId,
      spaceId: messageBody.spaceId,
      targetProfileId: messageBody.targetProfileId,
    });
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      runtimeCoordinatorDecisionRequest: {
        claimDecision: "claim_existing_inside_window",
        coordinatorDecision: {
          coordinatorAction: "decide_retry_timeout_or_reclaim",
          eventKind: "retry",
          kind: "runtime_coordinator_decision_required",
          mayPublishSpaceReply: false,
          mayReconstructTokenFromFingerprintOrHash: false,
          mayUseD1TokenProjection: false,
          ownerConflictTokenClass: null,
          queueOrAlarmRole: "trigger_only",
          reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
          runId: null,
          tokenStatus: null,
          usesFinalClaimAuthority: false,
          usesLegacyClaimLeaseAuthority: false,
        },
        eventKind: "retry",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        runtimeCoordinatorExecutionId,
        runtimeCoordinatorStatus: null,
      },
      status: "deduped",
    });
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: false,
      reasonCode: "runtime_coordinator.execution_token_authority_missing",
      runtimeCoordinatorExecutionId,
      status: "retry_later",
    });
    const message = createQueueMessage(messageBody, 2);

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          claimDecision: "claim_existing_inside_window",
          eventKind: "retry",
          idempotencyKey: `queue:${messageBody.idempotencyKey}:retry:claim_existing_inside_window`,
          runtimeCoordinatorExecutionId,
          trigger: "queue",
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "dispatch-rc-authority-missing-1",
        decisionCode: "runtime_coordinator.queue_decision_retry_later",
        decisionPayload: expect.objectContaining({
          claimDecision: "claim_existing_inside_window",
          reasonCode: "runtime_coordinator.execution_token_authority_missing",
          runtimeCoordinatorExecutionId,
          status: "retry_later",
        }),
      })
    );
  });

  it("routes RuntimeCoordinator-backed queue failures to durable authority without D1 projection fallback", async () => {
    const messageBody = createDispatchBody({
      dispatchId: "dispatch-rc-backed-queue-failure-1",
      sourceEventId: "evt-rc-backed-queue-failure-1",
      targetProfileId: "agt-rc-backed-queue-failure-1",
      visitedProfileIdsHash: "stable32:11111112b",
    });
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: messageBody.dispatchId,
      spaceId: messageBody.spaceId,
      targetProfileId: messageBody.targetProfileId,
    });
    const queueFailure = Object.assign(new Error("runtime reply was invalid"), {
      code: "runtime.reply.empty_output",
    });
    vi.mocked(markDispatchAttemptWaitingForResult).mockRejectedValueOnce(
      queueFailure
    );
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: true,
      action: "keep_waiting",
      reasonCode: "runtime_coordinator.local_progress_active",
      runtimeCoordinatorExecutionId,
      status: "recorded",
    });
    const message = createQueueMessage(messageBody, DISPATCH_MAX_ATTEMPTS);

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          attemptId: "attempt-dispatch-rc-backed-queue-failure-1-3",
          dispatchId: "dispatch-rc-backed-queue-failure-1",
          eventKind: "retry",
          reasonCode: "runtime.reply.empty_output",
          runtimeCoordinatorExecutionId,
          trigger: "queue",
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
  });

  it("keeps RuntimeCoordinator-backed queue failures pending when handoff is unavailable", async () => {
    const messageBody = createDispatchBody({
      dispatchId: "dispatch-rc-handoff-pending-1",
      sourceEventId: "evt-rc-handoff-pending-1",
      targetProfileId: "agt-rc-handoff-pending-1",
      visitedProfileIdsHash: "stable32:11111112d",
    });
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: messageBody.dispatchId,
      spaceId: messageBody.spaceId,
      targetProfileId: messageBody.targetProfileId,
    });
    const queueFailure = Object.assign(new Error("runtime reply was invalid"), {
      code: "runtime.reply.empty_output",
    });
    vi.mocked(markDispatchAttemptWaitingForResult).mockRejectedValueOnce(
      queueFailure
    );
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: false,
      reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
      runtimeCoordinatorExecutionId,
      status: "retry_later",
    });
    const message = createQueueMessage(messageBody, DISPATCH_MAX_ATTEMPTS);

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          attemptId: "attempt-dispatch-rc-handoff-pending-1-3",
          dispatchId: "dispatch-rc-handoff-pending-1",
          eventKind: "retry",
          reasonCode: "runtime.reply.empty_output",
          runtimeCoordinatorExecutionId,
          trigger: "queue",
        }),
      })
    );
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "dispatch-rc-handoff-pending-1",
        decisionCode: "runtime_coordinator_handoff_pending_or_unavailable",
        decisionPayload: expect.objectContaining({
          reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
          runtimeCoordinatorExecutionId,
          source: "queue_failure",
          status: "retry_later",
          trigger: "queue",
        }),
      })
    );
  });

  it("records RuntimeCoordinator no-execution intent when the local service identity does not match the primary binding", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "missing",
      bindingEnabled: false,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-preflight-missing-1",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-preflight-not-rc-1",
        sourceEventId: "evt-preflight-not-rc-1",
        targetProfileId: "agt-preflight-not-rc-1",
        visitedProfileIdsHash: "stable32:11111112c",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(undefined, authRpc),
    });

    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.objectContaining({
          dispatchId: "dispatch-preflight-not-rc-1",
          ownerUserId: "owner-preflight-missing-1",
        }),
        ownerUserId: "owner-preflight-missing-1",
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          decisionSource: "dispatch_delivery_pre_execution",
          dispatchId: "dispatch-preflight-not-rc-1",
          ownerUserId: "owner-preflight-missing-1",
          publicationCategory: "local_connection_mismatch",
          reasonCode: "local_service.identity_mismatch",
          userRecoveryAction: "reconnect_agent_binding",
        }),
        ownerUserId: "owner-preflight-missing-1",
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(recordDispatchAttemptExecutionOwnership).not.toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "local_service.identity_mismatch",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("retries when target binding snapshot cannot be resolved from Core primary binding", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-missing-1",
        sourceEventId: "evt-runtime-missing-1",
        targetProfileId: "agt-runtime-missing-1",
        visitedProfileIdsHash: "stable32:11111113",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        null
      ),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "agent_profile_binding.lookup_failed",
        decisionPayload: expect.objectContaining({
          bindingSource: "core_primary_binding",
        }),
        correlationId: "dispatch-runtime-missing-1",
      })
    );
  });

  it("runs the queue hot path without any storage-readiness probe", async () => {
    // The per-batch storage probe was removed: the release flow migrates before
    // Core deploys (preflight), so the latency-critical Wake path no longer
    // re-checks tables. A genuinely missing table fails loud and terminal via
    // the D1 schema error policy instead (see dispatch-error-policy).
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-low-cost-storage-1",
      sourceEventId: "evt-low-cost-storage-1",
      targetProfileId: "agt-low-cost-storage-1",
      visitedProfileIdsHash: "hash-low-cost-storage-1",
    });

    await runDispatchQueueMessage(message);

    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(1);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("binds retry call to queue message context to avoid Illegal invocation", async () => {
    let retryThisContext: unknown = null;
    const message = {
      attempts: 1,
      body: { any: "payload" },
      ack: vi.fn(),
      retry: vi.fn(function (this: unknown) {
        retryThisContext = this;
      }),
    } as const;

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: { OPENMELD_SPACES: {} as DurableObjectNamespace<any> },
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(retryThisContext).toBe(message);
  });

  it("falls back to no-arg retry for message runtimes without options support", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
    });
    const queueRetryArgs: unknown[][] = [];
    const message = {
      attempts: 1,
      body: createDispatchBody({
        dispatchId: "dispatch-retry-compat-1",
        sourceEventId: "evt-retry-compat-1",
        targetProfileId: "agt-retry-compat-1",
        visitedProfileIdsHash: "stable32:11111130",
      }),
      ack: vi.fn(),
      retry: vi.fn(function (
        this: unknown,
        options?: { delaySeconds?: number }
      ) {
        queueRetryArgs.push([options ? "with-options" : "without-options"]);
        if (options && typeof options.delaySeconds === "number") {
          throw new TypeError("queue message retry does not support options");
        }
      }),
    } as const;

    try {
      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).toHaveBeenCalledTimes(2);
      expect(queueRetryArgs).toEqual([["with-options"], ["without-options"]]);
      expect(message.ack).not.toHaveBeenCalled();
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("writes terminal DLQ and acks when dispatch contract version is unsupported", async () => {
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-unsupported-1",
      spaceId: "space-1",
      sourceEventId: "evt-unsupported-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-unsupported-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111115",
      dispatchContractVersion: 999,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-unsupported-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "unsupported_version",
        errorMessage: expect.stringContaining(
          '"expectedDispatchContractVersion":2'
        ),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-unsupported-1|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("acks legacy v1 payload as invalid and writes invalid payload audit", async () => {
    const message = createQueueMessage({
      v: 1,
      dispatchId: "dispatch-legacy-1",
      spaceId: "space-1",
      sourceEventId: "evt-legacy-1",
      targetProfileId: "agt-legacy-1",
      idempotencyKey: "5:evt-legacy-1|12:agt-legacy-1",
      enqueuedAtMs: Date.now(),
    });

    await runDispatchQueueMessage(message);

    expect(readQueueMessageDeliveryCalls(message)).toEqual({
      ack: 1,
      retry: 0,
    });
    expect(readInvalidPayloadAuditCalls()).toEqual({
      claimDispatchAttempt: 0,
      markDispatchStatus: 0,
      rpcPostSignal: 0,
      writeDispatchDlq: 0,
      writeInvalidDispatchPayloadDlq: 1,
    });
  });

  it("acks legacy v2-compatible payload as invalid and writes invalid payload audit", async () => {
    const message = createRawQueueMessage({
      v: 2,
      dispatchId: "dispatch-legacy-v2-1",
      spaceId: "space-1",
      sourceEventId: "evt-legacy-v2-1",
      targetProfileId: "agt-legacy-v2-1",
      dispatchContractVersion: 1,
      idempotencyKey: "5:evt-legacy-v2-1|15:agt-legacy-v2-1",
      enqueuedAtMs: Date.now(),
    });

    await runDispatchQueueMessage(message);

    expect(readQueueMessageDeliveryCalls(message)).toEqual({
      ack: 1,
      retry: 0,
    });
    expect(readInvalidPayloadAuditCalls()).toEqual({
      claimDispatchAttempt: 0,
      markDispatchStatus: 0,
      rpcPostSignal: 0,
      writeDispatchDlq: 0,
      writeInvalidDispatchPayloadDlq: 1,
    });
  });

  it("finishes the queue invocation after ack without waiting for a pending runtime transport wait", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-retry-500-1",
        sourceEventId: "evt-runtime-retry-500-1",
        targetProfileId: "agt-runtime-retry-500-1",
        visitedProfileIdsHash: "stable32:11111120",
      }),
      1
    );

    const pendingBatch = startPendingRuntimeTransportWaitBatch(message);

    try {
      await expectEventually(() => {
        expect(pendingBatch.waitCallCount).toBe(2);
      });
      await expectEventually(() => {
        expect(pendingBatch.batchSettled).toBe(true);
      });

      expect(readQueueMessageDeliveryCalls(message)).toEqual({
        ack: 1,
        retry: 0,
      });
      expect(pendingBatch.scheduledWaitCount).toBe(2);
      expect(rpcPostSignal).not.toHaveBeenCalled();
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      await expectEventually(() => {
        const lifecycleDecisionCall = vi
          .mocked(writeOpenMeldDaemonOpsDecision)
          .mock.calls.find(
            (call) =>
              call.at(0)?.decisionCode === "dispatch.execution.lifecycle"
          );
        expect(lifecycleDecisionCall?.[0]).toMatchObject({
          decisionPayload: expect.objectContaining({
            phase: "running",
            progressEvidenceState: "active",
          }),
        });
      });
      expect(markDispatchStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
      expect(markDispatchStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
    } finally {
      await pendingBatch.settle();
    }

    expect(pendingBatch.batchSettled).toBe(true);
    expect(message.ack).toHaveBeenCalledTimes(1);
  });

  it("keeps the active attempt in background when runtime transport reports pending lifecycle", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-slow-wait-1",
        sourceEventId: "evt-runtime-slow-wait-1",
        targetProfileId: "agt-runtime-slow-wait-1",
        visitedProfileIdsHash: "stable32:11111120b",
      }),
      1
    );

    const pendingBatch = startPendingRuntimeTransportWaitBatch(message);

    try {
      await expectEventually(() => {
        expect(pendingBatch.waitCallCount).toBe(2);
      });
      await expectEventually(() => {
        expect(pendingBatch.batchSettled).toBe(true);
      });

      expect(readQueueMessageDeliveryCalls(message)).toEqual({
        ack: 1,
        retry: 0,
      });
      expect(pendingBatch.scheduledWaitCount).toBe(2);
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(rpcPostSignal).not.toHaveBeenCalled();
      await expectEventually(() => {
        expect(rpcPostTransientSignal).toHaveBeenCalledTimes(2);
        expect(claimReplyingHintEmission).toHaveBeenCalledTimes(1);
        expect(hasTransientSignalPurpose("agent_replying_end")).toBe(false);
      });
      expect(markDispatchStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
      expect(markDispatchStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
    } finally {
      await pendingBatch.settle();
    }

    expect(pendingBatch.batchSettled).toBe(true);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(claimReplyingHintEmission).toHaveBeenCalledTimes(1);
    expect(rpcPostTransientSignal).toHaveBeenCalledTimes(3);
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "agent_replying",
        }),
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "agent_replying_end",
        }),
      })
    );
  });

  it("records diagnostic evidence when an offloaded wait promise rejects after batch completion", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockRejectedValueOnce(new Error("background wait exploded"));
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockRejectedValueOnce(new Error("runtime coordinator decision crashed"));

    const scheduledWaits: Promise<unknown>[] = [];
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-offloaded-wait-rejected-1",
        sourceEventId: "evt-offloaded-wait-rejected-1",
        targetProfileId: "agt-offloaded-wait-rejected-1",
        visitedProfileIdsHash: "stable32:offloaded-wait-rejected",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(scheduledWaits).toHaveLength(2);
    expect(
      infoSpy.mock.calls.some(([entry]) =>
        isRuntimeEvidenceEvent(
          entry,
          "core.openmeld.dispatch.queue_batch_succeeded"
        )
      )
    ).toBe(true);

    await expect(Promise.all(scheduledWaits)).resolves.toEqual([
      undefined,
      undefined,
    ]);

    expect(errorSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.scheduled_wait_rejected]",
      expect.objectContaining({
        event: "core.openmeld.dispatch.queue_scheduled_wait_failed",
        error: "runtime coordinator decision crashed",
      })
    );
    expect(
      infoSpy.mock.calls.some(
        ([entry]) =>
          isRuntimeEvidenceEvent(
            entry,
            "core.openmeld.dispatch.queue_scheduled_wait_failed"
          ) && entry.reasonCode === "scheduled_wait_rejected"
      )
    ).toBe(true);

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not terminalize wait lifecycle timeouts when RuntimeCoordinator projection is unavailable", async () => {
    const scheduledWaits: Promise<unknown>[] = [];
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValue(buildWaitFailed("daemon.delivery.execution_stalled"));
    const messageBody = createDispatchBody({
      dispatchId: "dispatch-immediate-timeout-cap-1",
      sourceEventId: "evt-immediate-timeout-cap-1",
      targetProfileId: "agt-immediate-timeout-cap-1",
      visitedProfileIdsHash: "stable32:11111120c",
    });
    const message = createQueueMessage(messageBody, 1);
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: messageBody.dispatchId,
      spaceId: messageBody.spaceId,
      targetProfileId: messageBody.targetProfileId,
    });
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: true,
      action: "keep_waiting",
      reasonCode: "runtime_coordinator.local_progress_active",
      runtimeCoordinatorExecutionId,
      status: "recorded",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(
      vi.mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
    ).toHaveBeenCalledTimes(1);
    expect(markDispatchAttemptWaitingForResult).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "daemon.delivery.execution_stalled",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "daemon.delivery.execution_stalled",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      vi
        .mocked(writeOpenMeldDaemonOpsDecision)
        .mock.calls.filter(
          (call) => call.at(0)?.decisionCode === "dispatch.execution.lifecycle"
        )
    ).toHaveLength(0);
    expect(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          attemptId: "attempt-dispatch-immediate-timeout-cap-1-1",
          dispatchId: "dispatch-immediate-timeout-cap-1",
          eventKind: "timeout",
          reasonCode: "daemon.delivery.execution_stalled",
          runtimeCoordinatorExecutionId,
          trigger: "alarm",
          targetProfileId: normalizeAgentProfileIdForTest(
            "agt-immediate-timeout-cap-1"
          ),
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(rpcPostTransientSignal).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_retrying",
          dispatchId: "dispatch-immediate-timeout-cap-1",
        }),
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("does not turn unavailable RuntimeCoordinator offloaded wait handoff into retryable user-visible failure", async () => {
    const scheduledWaits: Promise<unknown>[] = [];
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValue(buildWaitFailed("daemon.delivery.timeout"));
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: false,
      reasonCode: "runtime_coordinator.unavailable",
      runtimeCoordinatorExecutionId: "rce-unavailable-offloaded-wait-1",
      status: "retry_later",
    });
    const messageBody = createDispatchBody({
      dispatchId: "dispatch-unavailable-offloaded-wait-1",
      sourceEventId: "evt-unavailable-offloaded-wait-1",
      targetProfileId: "agt-unavailable-offloaded-wait-1",
      visitedProfileIdsHash: "stable32:11111131d",
    });
    const message = createQueueMessage(messageBody, 1);

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.unavailable",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "runtime_coordinator_handoff_pending_or_unavailable",
        decisionPayload: expect.objectContaining({
          dispatchId: "dispatch-unavailable-offloaded-wait-1",
          reasonCode: "runtime_coordinator.unavailable",
          source: "offloaded_wait",
          status: "retry_later",
          trigger: "alarm",
        }),
      })
    );
  });

  it("keeps already_completed duplicate delivery out of the waiting-result state reset", async () => {
    const scheduledWaits: Promise<unknown>[] = [];
    const completedAttemptId =
      "attempt-dispatch-already-completed-delivery-1-completed";
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockResolvedValueOnce({
      accepted: true,
      completedAttemptId,
      status: "already_completed",
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          attemptId: completedAttemptId,
          dispatchId: "dispatch-already-completed-delivery-1",
          taskId: "task-dispatch-already-completed-delivery-1",
          sourceEventId: "evt-already-completed-delivery-1",
          targetProfileId: normalizeAgentProfileIdForTest(
            "agt-already-completed-delivery-1"
          ),
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-already-completed-delivery-1",
        sourceEventId: "evt-already-completed-delivery-1",
        targetProfileId: "agt-already-completed-delivery-1",
        visitedProfileIdsHash: "stable32:11111121c",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(correlateDuplicateDispatchDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        correlatedAttemptId: completedAttemptId,
        duplicateAttemptId: "attempt-dispatch-already-completed-delivery-1-1",
        reason: "already_completed",
      })
    );
    expect(markDispatchAttemptWaitingForResult).not.toHaveBeenCalled();
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(
      vi.mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: completedAttemptId,
        dispatchId: "dispatch-already-completed-delivery-1",
      })
    );
  });

  it("does not terminalize RuntimeCoordinator accepted duplicate delivery when duplicate correlation audit fails", async () => {
    const scheduledWaits: Promise<unknown>[] = [];
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const completedAttemptId =
      "attempt-dispatch-duplicate-correlation-audit-failed-1-completed";
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockResolvedValueOnce({
      accepted: true,
      completedAttemptId,
      status: "already_completed",
    });
    vi.mocked(correlateDuplicateDispatchDeliveryAttempt).mockRejectedValueOnce(
      new Error("duplicate correlation audit write failed")
    );
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          attemptId: completedAttemptId,
          dispatchId: "dispatch-duplicate-correlation-audit-failed-1",
          taskId: "task-dispatch-duplicate-correlation-audit-failed-1",
          sourceEventId: "evt-duplicate-correlation-audit-failed-1",
          targetProfileId: normalizeAgentProfileIdForTest(
            "agt-duplicate-correlation-audit-failed-1"
          ),
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-duplicate-correlation-audit-failed-1",
        sourceEventId: "evt-duplicate-correlation-audit-failed-1",
        targetProfileId: "agt-duplicate-correlation-audit-failed-1",
        visitedProfileIdsHash: "stable32:11111121d",
      }),
      DISPATCH_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.duplicate_delivery_correlation_audit_record_failed]",
      expect.objectContaining({
        correlatedAttemptId: completedAttemptId,
        deliveryStatus: "already_completed",
        dispatchId: "dispatch-duplicate-correlation-audit-failed-1",
        duplicateAttemptId: expect.any(String),
        outcome: "existing_runtime_coordinator_attempt_remains_authoritative",
      })
    );
    expect(infoSpy).not.toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.duplicate_delivery_correlated]",
      expect.anything()
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.duplicate_delivery_reused_existing_execution]",
      expect.objectContaining({
        correlatedAttemptId: completedAttemptId,
        correlationAuditStatus: "record_failed",
        deliveryStatus: "already_completed",
        dispatchId: "dispatch-duplicate-correlation-audit-failed-1",
      })
    );
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(
      vi.mocked(runtimeCoordinatorClient.waitRuntimeTransportDispatchResult)
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: completedAttemptId,
        dispatchId: "dispatch-duplicate-correlation-audit-failed-1",
      })
    );
  });

  it("does not classify retryable failed task results inside Queue", async () => {
    const dispatchId = "dispatch-retryable-task-result-failed-1";
    const scheduledWaits: Promise<unknown>[] = [];
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-retryable-task-result-failed-1",
          errorCode: "daemon.delivery.finalization_timeout",
          errorType: "timeout",
          errorMessage:
            "daemon.delivery.finalization_timeout: route did not finalize in time",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-retryable-task-result-failed-1",
        targetProfileNameSnapshot: "Codex",
        visitedProfileIdsHash: "stable32:retryable-task-result-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchResult).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-retryable-task-result-failed-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-retryable-task-result-failed-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
  });

  it("keeps offloaded wait RuntimeCoordinator retry_later out of old retryable recovery when audit write fails", async () => {
    const scheduledWaits: Promise<unknown>[] = [];
    rejectOpsDecisionWriteByCode(
      "runtime_coordinator_handoff_pending_or_unavailable",
      "failed to persist RuntimeCoordinator handoff audit"
    );
    vi.mocked(daemonTransportClient.lookupRuntimeTransportRoute)
      .mockResolvedValueOnce({
        online: true,
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        deviceId: "daemon-device-1",
        lane: "dev-local",
        serviceVersion: "999.0.0",
        leaseEpoch: 1,
        lastHeartbeatMs: Date.now(),
        capabilities: {
          runtimeAdapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                continuationCapability: "standard",
                preparationRequirement: "none",
                runtimeWorkingDirectoryMode: "spawn_cwd",
                streamingCapability: "final_only",
                workspaceResumeBehavior: "transparent",
              },
              transportModes: ["local-cli"],
            },
          ],
        },
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      })
      .mockResolvedValueOnce({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(buildWaitFailed("daemon.delivery.timeout"));
    vi.mocked(
      runtimeCoordinatorClient.decideRuntimeTransportRuntimeCoordinatorExecution
    ).mockResolvedValueOnce({
      ok: false,
      reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
      runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId({
        dispatchId: "dispatch-offloaded-wait-crash-1",
        spaceId: "space-1",
        targetProfileId: normalizeAgentProfileIdForTest(
          "agt-offloaded-wait-crash-1"
        ),
      }),
      status: "retry_later",
    });

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-offloaded-wait-crash-1",
        sourceEventId: "evt-offloaded-wait-crash-1",
        targetProfileId: "agt-offloaded-wait-crash-1",
        visitedProfileIdsHash: "stable32:11111120d",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(scheduledWaits).toHaveLength(2);

    await Promise.allSettled(scheduledWaits);

    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "runtime_coordinator_handoff_pending_or_unavailable",
        decisionPayload: expect.objectContaining({
          dispatchId: "dispatch-offloaded-wait-crash-1",
          reasonCode: "runtime_coordinator.handoff_pending_or_unavailable",
          source: "offloaded_wait",
          status: "retry_later",
        }),
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.handoff_pending_or_unavailable",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "dispatch.execution_failed",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("continues waiting on the same attempt without re-delivering to daemon", async () => {
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "continued",
      attemptId: "attempt-dispatch-runtime-continued-1",
      attemptNo: 1,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 1,
      replyingHintActive: true,
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          attemptId: "attempt-dispatch-runtime-continued-1",
          dispatchId: "dispatch-runtime-continued-1",
          sourceEventId: "evt-runtime-continued-1",
          targetProfileId: "agt-runtime-continued-1",
          taskId: "task-dispatch-runtime-continued-1",
        })
      )
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-continued-1",
        sourceEventId: "evt-runtime-continued-1",
        targetProfileId: "agt-runtime-continued-1",
        visitedProfileIdsHash: "stable32:11111120c",
      }),
      2
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(claimReplyingHintEmission).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-dispatch-runtime-continued-1",
        dispatchId: "dispatch-runtime-continued-1",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 1,
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "agent_replying_end",
          dispatchId: "dispatch-runtime-continued-1",
        }),
      })
    );
  });

  it("preserves a resumed active replying hint across pending lifecycle without re-emitting start", async () => {
    let releaseSecondWait!: () => void;
    const secondWait = new Promise<void>((resolve) => {
      releaseSecondWait = resolve;
    });
    const scheduledWaits: Promise<unknown>[] = [];
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "continued",
      attemptId: "attempt-dispatch-runtime-continued-slow-1",
      attemptNo: 1,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 1,
      replyingHintActive: true,
    });
    let waitCallCount = 0;
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockImplementation(async () => {
      waitCallCount += 1;
      if (waitCallCount === 1) {
        return buildWaitPending();
      }
      await secondWait;
      return buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          attemptId: "attempt-dispatch-runtime-continued-slow-1",
          dispatchId: "dispatch-runtime-continued-slow-1",
          sourceEventId: "evt-runtime-continued-slow-1",
          targetProfileId: "agt-runtime-continued-slow-1",
          taskId: "task-dispatch-runtime-continued-slow-1",
        })
      );
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-continued-slow-1",
        sourceEventId: "evt-runtime-continued-slow-1",
        targetProfileId: "agt-runtime-continued-slow-1",
        visitedProfileIdsHash: "stable32:11111120d",
      }),
      2
    );

    let batchSettled = false;
    const batchPromise = handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(Promise.resolve(promise));
        },
      },
      env: makeEnvWithBindings(),
    }).finally(() => {
      batchSettled = true;
    });

    try {
      await expectEventually(() => {
        expect(waitCallCount).toBe(2);
      });

      await expectEventually(() => {
        const transientPurposes = vi
          .mocked(rpcPostTransientSignal)
          .mock.calls.map((call) => {
            const signal = call.at(1);
            const meta =
              signal && typeof signal === "object" && "meta" in signal
                ? (signal.meta as Record<string, unknown> | undefined)
                : undefined;
            return String(meta?.purpose ?? "");
          });
        expect(claimReplyingHintEmission).not.toHaveBeenCalled();
        expect(transientPurposes).toEqual(["dispatch_activity_dispatching"]);
      });
      expect(message.ack).toHaveBeenCalledTimes(1);
      await expectEventually(() => {
        expect(batchSettled).toBe(true);
      });
    } finally {
      releaseSecondWait();
      await batchPromise;
      await Promise.allSettled(scheduledWaits);
    }

    expect(batchSettled).toBe(true);
    expect(message.ack).toHaveBeenCalledTimes(1);
    const transientPurposes = vi
      .mocked(rpcPostTransientSignal)
      .mock.calls.map((call) => {
        const signal = call.at(1);
        const meta =
          signal && typeof signal === "object" && "meta" in signal
            ? (signal.meta as Record<string, unknown> | undefined)
            : undefined;
        return String(meta?.purpose ?? "");
      });
    expect(transientPurposes).toEqual([
      "dispatch_activity_dispatching",
      "agent_replying_end",
    ]);
  });

  it("propagates delivery recovery reason to daemon delivery payload", async () => {
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "claimed",
      attemptId: "attempt-dispatch-runtime-recovery-2",
      attemptNo: 2,
      deliveryRecoveryReason: "connection_replaced",
      replyingHintActive: false,
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-recovery-2",
        sourceEventId: "evt-runtime-recovery-2",
        targetProfileId: "agt-runtime-recovery-2",
        visitedProfileIdsHash: "stable32:11111120ca",
      }),
      3
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          payload: expect.objectContaining({
            deliveryRecoveryReason: "connection_replaced",
          }),
        }),
      })
    );
  });

  it("delivers a waiting head again when route_lost redrive reaches Queue after reconnect", async () => {
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce({
      status: "claimed",
      attemptId: "attempt-dispatch-runtime-route-redrive-2",
      attemptNo: 2,
      deliveryRecoveryReason: "route_lost",
      replyingHintActive: false,
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      action: "create_execution",
      ok: true,
      primaryDispatchId: "dispatch-runtime-route-redrive-1",
      reasonCode: "runtime_coordinator.head_primary_reaccepted",
      runtimeCoordinatorExecutionId: null,
      status: "already_accepted",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|28:evt-runtime-route-redrive-1|44:agt_runtime_route_redrive_1",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-route-redrive-1",
        sourceEventId: "evt-runtime-route-redrive-1",
        targetProfileId: "agt-runtime-route-redrive-1",
        visitedProfileIdsHash: "stable32:11111120cb",
      }),
      2
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          payload: expect.objectContaining({
            deliveryRecoveryReason: "route_lost",
          }),
        }),
      })
    );
    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
  });

  it("acks offline route loss after RuntimeCoordinator head waiting deadline creates a publication intent", async () => {
    vi.spyOn(
      daemonTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockResolvedValueOnce({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
    vi.mocked(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).mockResolvedValueOnce({
      ok: true,
      primaryDispatchId: "dispatch-runtime-cold-start-1",
      publicationIntentId:
        "rcpi:no_execution:twl_v1|7:space-1|24:evt-runtime-cold-start-1|40:agt_80321e6c-8362-42dc-80db-c295dd6a54b1",
      reasonCode: "daemon.profile.offline",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|24:evt-runtime-cold-start-1|40:agt_80321e6c-8362-42dc-80db-c295dd6a54b1",
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(buildWaitFailed("daemon.delivery.timeout"));
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-cold-start-1",
        sourceEventId: "evt-runtime-cold-start-1",
        targetProfileId: "agt-runtime-cold-start-1",
        visitedProfileIdsHash: "stable32:1111112a",
      }),
      DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        waiting: expect.objectContaining({
          dispatchId: "dispatch-runtime-cold-start-1",
          reasonCode: "daemon.profile.offline",
          userRecoveryAction: "start_or_restart_openmeld_service",
          waitingCategory: "service_not_connected",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("does not classify local adapter timeout task results inside Queue", async () => {
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          attemptId: `attempt-dispatch-runtime-timeout-1-${DISPATCH_MAX_ATTEMPTS}`,
          dispatchId: "dispatch-runtime-timeout-1",
          sourceEventId: "evt-runtime-timeout-1",
          targetProfileId: "agt-runtime-timeout-1",
          taskId: "task-dispatch-runtime-timeout-1",
          errorCode: "timeout",
          errorType: "timeout",
          errorMessage: "timeout: codex invocation exceeded 300000ms",
        })
      )
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-runtime-timeout-1",
        sourceEventId: "evt-runtime-timeout-1",
        targetProfileId: "agt-runtime-timeout-1",
        visitedProfileIdsHash: "stable32:1111112a-timeout",
      }),
      DISPATCH_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-runtime-timeout-1|5:${normalizeAgentProfileIdForTest("agt-runtime-timeout-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("writes stale lease audit payload with fallback context and hands retryable recovery to watchdog", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: true,
        daemonSessionId: "",
        connectionGeneration: 1,
        leaseEpoch: 0,
        deviceId: "daemon-device-1",
        lane: "dev-local",
        serviceVersion: "999.0.0",
        lastHeartbeatMs: Date.now(),
        capabilities: {
          runtimeAdapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                continuationCapability: "standard",
                preparationRequirement: "none",
                runtimeWorkingDirectoryMode: "spawn_cwd",
                streamingCapability: "final_only",
                workspaceResumeBehavior: "transparent",
              },
              transportModes: ["local-cli"],
            },
          ],
        },
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(buildWaitFailed("daemon.session.stale_lease"));

    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-stale-lease-1",
          sourceEventId: "evt-stale-lease-1",
          targetProfileId: "agt-stale-lease-1",
          visitedProfileIdsHash: "stable32:1111112b",
        }),
        1
      );

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(),
      });

      expect(message.retry).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(rpcPostSignal).not.toHaveBeenCalled();
      const staleDecisionCall = vi
        .mocked(writeOpenMeldDaemonOpsDecision)
        .mock.calls.find(
          (call) =>
            call.at(0)?.decisionCode === "daemon.delivery.session_replaced"
        );
      expect(staleDecisionCall).toBeDefined();
      expect(staleDecisionCall?.[0]).toMatchObject({
        decisionPayload: {
          dispatchId: "dispatch-stale-lease-1",
          profileId: normalizeAgentProfileIdForTest("agt-stale-lease-1"),
          daemonSessionId: "unknown",
          leaseEpoch: -1,
          reasonCode: "stale_lease_result_rejected",
          retryCount: 1,
        },
      });
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("does not run watchdog recovery for RuntimeCoordinator-owned finalization failures", async () => {
    vi.mocked(rpcPostSignal).mockRejectedValueOnce(
      Object.assign(new Error("network.transient"), {
        code: "network.transient",
      })
    );
    const message = createQueueMessage(
      {
        v: 2,
        dispatchId: "dispatch-retryable-1",
        spaceId: "space-1",
        sourceEventId: "evt-retryable-1",
        targetProfileId: "agt-1",
        dispatchChainId: "dispatch-retryable-1",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:11111116",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        dispatchSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          targetBindingState: "bound",
          targetBindingEnabled: true,
        },
        idempotencyKey: "5:evt-retryable-1|5:agt-1",
        enqueuedAtMs: Date.now(),
      },
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-retryable-1|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("records offline route waiting boundary with RuntimeCoordinator head before retrying the Queue trigger", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-offline-retry-1",
          enqueuedAtMs: Date.now() - 20_000,
          sourceEventId: "evt-offline-retry-1",
          sourceClientMessageId: "client-offline-retry-1",
          targetProfileId: "agt-offline-retry-1",
          targetProfileNameSnapshot: "Codex",
          visitedProfileIdsHash: "stable32:11111120",
        }),
        1
      );

      const authRpc = createAuthRpcWithBindingSnapshot({
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        ownerUserId: "owner-offline-retry-1",
        profileName: "offline-retry-agent-1",
      });

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).toHaveBeenCalledTimes(1);
      expect(message.retry).toHaveBeenCalledWith({
        delaySeconds: computeDispatchRetryDelaySeconds({
          attempt: 1,
          backoffSeconds: DISPATCH_OFFLINE_RETRY_BACKOFF_SECONDS,
          random: () => 0.5,
        }),
      });
      expect(message.ack).not.toHaveBeenCalled();
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(rpcPostSignal).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: "owner-offline-retry-1",
          waiting: expect.objectContaining({
            dispatchId: "dispatch-offline-retry-1",
            observedAtMs: expect.any(Number),
            reasonCode: "daemon.profile.offline",
            userRecoveryAction: "start_or_restart_openmeld_service",
            waitingCategory: "service_not_connected",
          }),
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
      expect(rpcPostTransientSignal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          meta: expect.objectContaining({
            purpose: "dispatch_activity_retrying",
            dispatchId: "dispatch-offline-retry-1",
          }),
          text: "Waiting for @Codex to reconnect...",
        })
      );
    } finally {
      lookupRouteSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it("keeps a connected service pending its first route report inside the RuntimeCoordinator waiting boundary", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.profile.pending_first_report",
      });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-pending-first-report-1",
          enqueuedAtMs: Date.now() - 90_000,
          sourceEventId: "evt-pending-first-report-1",
          sourceClientMessageId: "client-pending-first-report-1",
          targetProfileId: "agt-pending-first-report-1",
          targetProfileNameSnapshot: "Codex",
          visitedProfileIdsHash: "stable32:pending-first-report-1",
        }),
        DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS
      );
      const authRpc = createAuthRpcWithBindingSnapshot({
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        ownerUserId: "owner-pending-first-report-1",
        profileName: "pending-first-report-agent-1",
      });

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).toHaveBeenCalledTimes(1);
      expect(message.ack).not.toHaveBeenCalled();
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: "owner-pending-first-report-1",
          waiting: expect.objectContaining({
            dispatchId: "dispatch-pending-first-report-1",
            reasonCode: "daemon.profile.pending_first_report",
            userRecoveryAction: "wait_for_wake_route_report",
            waitingCategory: "wake_route_registration_pending",
          }),
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "daemon.profile.pending_first_report",
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        })
      );
      expect(rpcPostTransientSignal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          meta: expect.objectContaining({
            purpose: "dispatch_activity_retrying",
            dispatchId: "dispatch-pending-first-report-1",
          }),
          text: "Preparing @Codex. Your message is saved; it will run when ready.",
        })
      );
    } finally {
      lookupRouteSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it("publishes a visible failure instead of DLQ when offline route owner resolution never recovers", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-offline-owner-unresolved-1"
    );
    const authRpc = {
      resolveProfileById: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          profile: {
            ownerUserId: "owner-offline-owner-unresolved-1",
            profileHandle: "codex",
            profileId: targetProfileId,
            profileKind: "agent" as const,
            profileName: "Codex",
            status: "active" as const,
          },
        })
        .mockRejectedValue(new Error("auth rpc timeout")),
    };

    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-offline-owner-unresolved-1",
          enqueuedAtMs: Date.now() - 20_000,
          sourceEventId: "evt-offline-owner-unresolved-1",
          sourceClientMessageId: "client-offline-owner-unresolved-1",
          targetProfileId,
          targetProfileNameSnapshot: "Codex",
          visitedProfileIdsHash: "stable32:1111112f",
        }),
        DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS
      );

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
      ).not.toHaveBeenCalled();
      expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            actorProfileId: targetProfileId,
            coreReadinessFactsChanged: {
              agentProfileId: targetProfileId,
              kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
            },
            dispatchId: "dispatch-offline-owner-unresolved-1",
            generatedBy: "openmeld",
            noticeType: "terminal_failure",
            reason: "dispatch.target_profile_owner_unresolved",
            text: "OpenMeld could not wake @Codex because OpenMeld could not confirm the agent's account right now. Try again in a moment.",
          }),
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "dispatch.target_profile_owner_unresolved",
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
      expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: "dispatch-offline-owner-unresolved-1",
          decisionCode:
            "runtime_coordinator.head_owner_unresolved_visible_failure",
        })
      );
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("does not let Queue attempt budget terminalize an offline route after RuntimeCoordinator head publication intent is ready", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    try {
      vi.mocked(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
      ).mockResolvedValueOnce({
        ok: true,
        primaryDispatchId: "dispatch-offline-retry-2",
        publicationIntentId:
          "rcpi:no_execution:twl_v1|7:space-1|19:evt-offline-retry-2|40:agt_ef675f03-394c-4d7e-8b06-ab7299ab24e4",
        reasonCode: "daemon.profile.offline",
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId:
          "twl_v1|7:space-1|19:evt-offline-retry-2|40:agt_ef675f03-394c-4d7e-8b06-ab7299ab24e4",
      });
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-offline-retry-2",
          sourceEventId: "evt-offline-retry-2",
          targetProfileId: "agt-offline-retry-2",
          visitedProfileIdsHash: "stable32:11111121",
        }),
        DISPATCH_OFFLINE_RETRY_MAX_ATTEMPTS
      );

      const authRpc = createAuthRpcWithBindingSnapshot({
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        ownerUserId: "owner-offline-retry-2",
        profileName: "offline-retry-agent-2",
      });
      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: "owner-offline-retry-2",
          waiting: expect.objectContaining({
            dispatchId: "dispatch-offline-retry-2",
            reasonCode: "daemon.profile.offline",
            userRecoveryAction: "start_or_restart_openmeld_service",
            waitingCategory: "service_not_connected",
          }),
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
      expect(rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("records service update required as RuntimeCoordinator head no-execution without direct Space failure publication", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: true,
        daemonSessionId: "daemon-session-update-required-1",
        connectionGeneration: 1,
        deviceId: "daemon-device-update-required-1",
        lane: "dev-local",
        serviceVersion: "999.0.0",
        leaseEpoch: 1,
        lastHeartbeatMs: Date.now(),
        capabilities: {
          runtimeAdapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                continuationCapability: "standard",
                preparationRequirement: "none",
                runtimeWorkingDirectoryMode: "spawn_cwd",
                streamingCapability: "final_only",
                workspaceResumeBehavior: "transparent",
              },
              transportModes: ["local-cli"],
            },
          ],
        },
        executionCompatibility: {
          status: "update_required",
          expectedEpoch:
            COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY.expectedEpoch,
          observedEpoch: null,
          reasonCode: "daemon.runtime_contract.missing",
        },
      });
    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-service-update-required-1",
          sourceEventId: "evt-service-update-required-1",
          targetProfileId: "agt-service-update-required-1",
          visitedProfileIdsHash: "stable32:11111125",
        }),
        1
      );
      const authRpc = createAuthRpcWithBindingSnapshot({
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        ownerUserId: "owner-service-update-required-1",
        profileName: "update-required-agent-1",
      });

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(writeDispatchDlq).not.toHaveBeenCalled();
      expect(rpcPostSignal).not.toHaveBeenCalled();
      expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.deliverRuntimeTransportDispatch
      ).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: "owner-service-update-required-1",
          noExecution: expect.objectContaining({
            decisionSource: "dispatch_delivery_pre_execution",
            dispatchId: "dispatch-service-update-required-1",
            ownerUserId: "owner-service-update-required-1",
            publicationCategory: "update_required",
            reasonCode: "service.update_required",
            userRecoveryAction: "update_openmeld_service",
          }),
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "service.update_required",
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("does not retry when route has session conflict and does not emit a shared durable hint", async () => {
    const lookupRouteSpy = vi
      .spyOn(daemonTransportClient, "lookupRuntimeTransportRoute")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.reject_conflict",
      });

    try {
      const message = createQueueMessage(
        createDispatchBody({
          dispatchId: "dispatch-reject-conflict-1",
          sourceEventId: "evt-reject-conflict-1",
          targetProfileId: "agt-reject-conflict-1",
          visitedProfileIdsHash: "stable32:11111122",
        }),
        1
      );

      const authRpc = createAuthRpcWithBindingSnapshot({
        bindingState: "bound",
        bindingEnabled: true,
        agentControllerRef: "builtin:codex",
        ownerUserId: "owner-reject-conflict-1",
        profileName: "reject-conflict-agent-1",
      });

      await handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(undefined, authRpc),
      });

      expect(message.retry).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(writeDispatchDlq).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "daemon.session.reject_conflict",
        })
      );
      expect(markDispatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        })
      );
      expect(rpcPostSignal).not.toHaveBeenCalled();
    } finally {
      lookupRouteSpy.mockRestore();
    }
  });

  it("does not run unknown-error recovery for RuntimeCoordinator-owned finalization failures", async () => {
    vi.mocked(rpcPostSignal).mockRejectedValueOnce(new Error("opaque failure"));
    const message = createQueueMessage(
      {
        v: 2,
        dispatchId: "dispatch-unknown-1",
        spaceId: "space-1",
        sourceEventId: "evt-unknown-1",
        targetProfileId: "agt-1",
        dispatchChainId: "dispatch-unknown-1",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:11111117",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        dispatchSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          targetBindingState: "bound",
          targetBindingEnabled: true,
        },
        idempotencyKey: "5:evt-unknown-1|5:agt-1",
        enqueuedAtMs: Date.now(),
      },
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-unknown-1|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("does not terminal unknown finalization errors from Queue", async () => {
    vi.mocked(rpcPostSignal).mockRejectedValueOnce(new Error("opaque failure"));
    const message = createQueueMessage(
      {
        v: 2,
        dispatchId: "dispatch-unknown-2",
        spaceId: "space-1",
        sourceEventId: "evt-unknown-2",
        targetProfileId: "agt-1",
        dispatchChainId: "dispatch-unknown-2",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:1111111a",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        dispatchSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          targetBindingState: "bound",
          targetBindingEnabled: true,
        },
        idempotencyKey: "5:evt-unknown-2|5:agt-1",
        enqueuedAtMs: Date.now(),
      },
      DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-unknown-2|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it.each([
    {
      errorType: "network" as const,
      expectedErrorCode: "network.transient",
      errorMessage: "network.transient: temporary network issue",
    },
    {
      errorType: "adapter" as const,
      expectedErrorCode: "upstream_unreachable",
      errorMessage: "adapter failed",
    },
  ] as const)("does not map retryable task result codes inside Queue: $expectedErrorCode", async ({
    errorType,
    expectedErrorCode,
    errorMessage,
  }) => {
    const dispatchId = `dispatch-task-result-retry-${errorType}`;
    const targetProfileId = `agt-${errorType}`;
    mockCompletedFailedTaskResult({
      dispatchId,
      taskId: `task-${dispatchId}`,
      sourceEventId: `evt-${dispatchId}`,
      targetProfileId,
      errorType,
      errorMessage,
    });

    const message = createDispatchQueueMessage({
      dispatchId,
      sourceEventId: `evt-${dispatchId}`,
      targetProfileId,
      visitedProfileIdsHash: `stable32:${dispatchId}`,
    });

    await runDispatchQueueMessage(message);

    expect(readQueueMessageDeliveryCalls(message)).toEqual({
      ack: 1,
      retry: 0,
    });
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        idempotencyKey: `5:${readMessageBody(message).sourceEventId}|5:${readMessageBody(message).targetProfileId}`,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: expectedErrorCode,
      })
    );
  });

  it.each([
    {
      errorType: "config",
      expectedErrorCode: "controller.runtime.missing",
      errorMessage: "controller.runtime.missing: function missing",
    },
    {
      errorType: "auth",
      expectedErrorCode: "permission.denied.runtime",
      errorMessage: "permission.denied.runtime: denied",
    },
    {
      errorType: "policy",
      expectedErrorCode: "dispatch.policy.unsupported",
      errorMessage: "dispatch.policy.unsupported: unsupported policy",
    },
    {
      errorType: "timeout",
      expectedErrorCode: "timeout",
      errorMessage: "timeout waiting for runtime",
    },
  ] as const)("does not map terminal task result codes to Queue DLQ: $expectedErrorCode", async ({
    errorType,
    expectedErrorCode,
    errorMessage,
  }) => {
    const dispatchId = `dispatch-task-result-terminal-${errorType}`;
    const targetProfileId = `agt-${errorType}`;
    mockCompletedFailedTaskResult({
      dispatchId,
      taskId: `task-${dispatchId}`,
      sourceEventId: `evt-${dispatchId}`,
      targetProfileId,
      errorType,
      errorMessage,
    });

    const message = createDispatchQueueMessage({
      dispatchId,
      sourceEventId: `evt-${dispatchId}`,
      targetProfileId,
      visitedProfileIdsHash: `stable32:${dispatchId}`,
    });

    await runDispatchQueueMessage(message);

    expect(readQueueMessageDeliveryCalls(message)).toEqual({
      ack: 1,
      retry: 0,
    });
    expect(writeDispatchDlq).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: expectedErrorCode,
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        idempotencyKey: `5:${readMessageBody(message).sourceEventId}|5:${readMessageBody(message).targetProfileId}`,
      })
    );
  });

  it("does not classify explicit config.invalid task results inside Queue", async () => {
    const dispatchId = "dispatch-task-result-config-invalid-1";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-config-invalid-1",
          errorCode: "config.invalid",
          errorType: "adapter",
          errorMessage:
            "config.invalid: The requested model 'gpt-5.3-codex-spark' does not exist.",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-config-invalid-1",
        visitedProfileIdsHash: "stable32:dispatch-task-result-config-invalid-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "config.invalid",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-config-invalid-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
  });

  it("does not parse explicit task-result error codes inside Queue", async () => {
    const dispatchId = "dispatch-task-result-explicit-code-1";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-explicit-code-1",
          errorCode: "rate_limited",
          errorType: "network",
          errorMessage: "temporary provider issue",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-explicit-code-1",
        visitedProfileIdsHash: "stable32:dispatch-task-result-explicit-code-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "rate_limited",
      })
    );
  });

  it("does not settle deduped failed task results inside Queue", async () => {
    const dispatchId = "dispatch-task-result-deduped-retry";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-deduped",
          deduped: true,
          errorType: "policy",
          errorMessage: "runtime.task.deduped: task deduped within 24h window",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-deduped",
        visitedProfileIdsHash: "stable32:dedupe-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime.task.deduped",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-deduped")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).not.toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "dispatch.result.correlation_lost",
      })
    );
  });

  it("leaves exhausted structured-action repair publication to RuntimeCoordinator finalization", async () => {
    const dispatchId = "dispatch-structured-action-repair-failed-1";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-structured-action-repair-failed-1",
          errorCode: "openmeld.space_action.repair_failed",
          errorType: "policy",
          errorMessage:
            "openmeld.space_action.repair_failed: A valid OpenMeld Space action is required in collaboration mode.",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-structured-action-repair-failed-1",
        targetProfileNameSnapshot: "hi-agent",
        visitedProfileIdsHash: "stable32:structured-action-repair-failed-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchResult).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-structured-action-repair-failed-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
  });

  it("leaves structured-action public failure copy to RuntimeCoordinator finalization", async () => {
    const dispatchId = "dispatch-structured-action-repair-detailed-1";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-structured-action-repair-failed-1",
          taskId: `task-${dispatchId}`,
          errorCode: "openmeld.space_action.repair_failed",
          errorType: "policy",
          errorMessage:
            "A valid OpenMeld Space action is required in collaboration mode.",
          spaceActionFailureDiagnostics: {
            carrierKind: "none",
            invalidOutputPreview: null,
            publicFailureReason:
              "The current Codex model is not available for this ChatGPT-backed account.",
            repairMode: "controller_roundtrip",
            spaceActionCandidatePresent: false,
            spaceActionParseError: null,
          },
          v: 4,
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-structured-action-repair-failed-1",
        targetProfileNameSnapshot: "hi-agent",
        visitedProfileIdsHash: "stable32:structured-action-repair-detailed-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-structured-action-repair-failed-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
  });

  it("leaves terminal status reply archival to RuntimeCoordinator finalization", async () => {
    vi.mocked(rpcPostStatusSignal).mockResolvedValueOnce({
      v: 1,
      id: "sig-status-archive-1",
      spaceId: HEX_SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: normalizeAgentProfileIdForTest("agt-status-archive-1"),
      },
      type: "signal.status",
      data: {
        actorProfileId: normalizeAgentProfileIdForTest("agt-status-archive-1"),
        dispatchId: "dispatch-status-archive-1",
        generatedBy: "openmeld",
        replyTo: TEST_REPLY_TO_SNAPSHOT,
        status: "done",
        text: "Status archive check",
      },
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-status-archive-1",
          sourceEventId: "evt-status-archive-1",
          targetProfileId: "agt-status-archive-1",
          taskId: "task-dispatch-status-archive-1",
          output: "runtime-output-status-archive-1",
          dispatchExecution: {
            agentControllerConversationResume: {
              status: "replaced_by_provider",
            },
            localRuntimeContext: {
              status: "reused",
              reason: null,
            },
            bootstrap: {
              status: "applied",
              reason: null,
            },
          },
          spaceAction: {
            type: "post_status",
            status: "done",
            text: "Status archive check",
          },
        })
      )
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-status-archive-1",
        replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
        sourceEventId: "evt-status-archive-1",
        targetProfileId: "agt-status-archive-1",
        targetProfileNameSnapshot: "status-agent",
        threadContext: TEST_THREAD_CONTEXT,
        visitedProfileIdsHash: "stable32:status-archive-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(writeDispatchResult).not.toHaveBeenCalled();
    expect(rpcPostStatusSignal).not.toHaveBeenCalled();
    const continuityWarningIndex = vi
      .mocked(rpcPostTransientSignal)
      .mock.calls.findIndex((call) => {
        const signal = call.at(1);
        const meta =
          signal && typeof signal === "object" && "meta" in signal
            ? (signal.meta as Record<string, unknown> | undefined)
            : undefined;
        return meta?.purpose === "conversation_continuity_warning";
      });
    expect(continuityWarningIndex).toBe(-1);
  });

  it("does not emit continuity warning or archive when terminal status publish was already claimed", async () => {
    vi.mocked(claimFinalReplyEmission).mockResolvedValueOnce("already_claimed");
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-status-already-claimed-1",
          sourceEventId: "evt-status-already-claimed-1",
          targetProfileId: "agt-status-already-claimed-1",
          taskId: "task-dispatch-status-already-claimed-1",
          output: "runtime-output-status-already-claimed-1",
          dispatchExecution: {
            agentControllerConversationResume: {
              status: "replaced_by_provider",
            },
            localRuntimeContext: {
              status: "reused",
              reason: null,
            },
            bootstrap: {
              status: "applied",
              reason: null,
            },
          },
          spaceAction: {
            type: "post_status",
            status: "done",
            text: "Status already claimed",
          },
        })
      )
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-status-already-claimed-1",
        sourceEventId: "evt-status-already-claimed-1",
        targetProfileId: "agt-status-already-claimed-1",
        targetProfileNameSnapshot: "status-agent",
        visitedProfileIdsHash: "stable32:status-already-claimed-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(rpcPostStatusSignal).not.toHaveBeenCalled();
    expect(writeDispatchResult).not.toHaveBeenCalled();
    const transientPurposes = vi
      .mocked(rpcPostTransientSignal)
      .mock.calls.map((call) => {
        const signal = call.at(1);
        const meta =
          signal && typeof signal === "object" && "meta" in signal
            ? (signal.meta as Record<string, unknown> | undefined)
            : undefined;
        return String(meta?.purpose ?? "");
      });
    expect(transientPurposes).not.toContain("conversation_continuity_warning");
  });

  it("does not record legacy dedupe text-only task failures inside Queue", async () => {
    const dispatchId = "dispatch-task-result-deduped-legacy";
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportFailedTaskResult({
          dispatchId,
          taskId: `task-${dispatchId}`,
          sourceEventId: `evt-${dispatchId}`,
          targetProfileId: "agt-deduped-legacy",
          deduped: true,
          errorType: "policy",
          errorMessage: "task deduped within 24h window",
        })
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId,
        sourceEventId: `evt-${dispatchId}`,
        targetProfileId: "agt-deduped-legacy",
        visitedProfileIdsHash: "stable32:dedupe-legacy-01",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime.task.deduped",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-${dispatchId}|5:${normalizeAgentProfileIdForTest("agt-deduped-legacy")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).not.toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "dispatch.result.correlation_lost",
      })
    );
  });

  it("error code categories are mutually exclusive in matrix inputs", () => {
    const retryableCodes = new Set([
      "daemon.profile.offline",
      "daemon.delivery.timeout",
      "daemon.delivery.execution_stalled",
      "daemon.delivery.finalization_timeout",
      "daemon.delivery.start_timeout",
      "daemon.session.not_found",
      "stale_lease_result_rejected",
      "timeout",
      "network.transient",
      "upstream_unreachable",
      "upstream.5xx",
      "agent_profile_binding.lookup_failed",
      "agent_profile_binding.profile_owner_unavailable",
      "organization_binding_authorization.lookup_failed",
      "organization_binding_authorization.space_org_unavailable",
      "dispatch.target_profile_identity.auth_rpc_unavailable",
      "dispatch.target_profile_identity.auth_rpc_failed",
    ]);
    const nonRetryableCodes = new Set([
      "auth.required",
      "quota.exceeded",
      "rate_limited",
      "permission.denied.runtime",
      "context.rebuild_failed",
      "daemon.session.stale_lease",
      "daemon.session.reject_conflict",
      "controller.binding.missing",
      "controller.binding.disabled",
      "agent_profile_binding.missing",
      "agent_profile_binding.disabled",
      "agent_profile_binding.profile_owner_invalid",
      "agent_profile_binding.owner_mismatch",
      "organization_binding_authorization.required",
      "controller.runtime.missing",
      "dispatch.policy.unsupported",
      "permission.denied",
      "schema.invalid",
      "schema.invalid.runtime_response",
      "runtime.reply.empty_output",
      "runtime.reply.metadata_missing.agent_controller_ref",
      "dispatch.snapshot.oversize",
      "config.invalid",
      "unsupported_version",
      "space.not_found",
      "controller.binding.lookup_failed",
      "controller.kind.unsupported",
      "controller.ref.invalid",
      "dispatch.target_profile_identity.lookup_failed",
    ]);
    const offlineRetryCodes = new Set([
      "daemon.profile.offline",
      "daemon.delivery.timeout",
      "daemon.session.not_found",
      "stale_lease_result_rejected",
    ]);
    const offlineHintEligibleCodes = new Set<string>();
    const hintEligibleCodes = new Set<string>();

    for (const code of offlineRetryCodes) {
      expect(retryableCodes.has(code)).toBe(true);
      expect(nonRetryableCodes.has(code)).toBe(false);
      if (offlineHintEligibleCodes.has(code)) {
        expect(hintEligibleCodes.has(code)).toBe(true);
      }
    }

    for (const code of retryableCodes) {
      expect(nonRetryableCodes.has(code)).toBe(false);
    }

    for (const code of nonRetryableCodes) {
      expect(retryableCodes.has(code)).toBe(false);
    }

    const hintCodeWithoutCategory = [...hintEligibleCodes].filter(
      (code) => !(retryableCodes.has(code) || nonRetryableCodes.has(code))
    );
    expect(hintCodeWithoutCategory).toEqual([]);

    const expectedNoHintRetryableCodes: string[] = [];
    for (const code of expectedNoHintRetryableCodes) {
      expect(hintEligibleCodes.has(code)).toBe(false);
    }

    const overlap = [...retryableCodes].filter((code) =>
      nonRetryableCodes.has(code)
    );
    expect(overlap).toHaveLength(0);
  });

  it("does not classify finalization-time retryable errors at the Queue boundary", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-retryable-boundary-online-1",
        sourceEventId: "evt-retryable-boundary-online-1",
        targetProfileId: "agt-retryable-boundary-online-1",
        visitedProfileIdsHash: "stable32:11111125",
      }),
      DISPATCH_MAX_ATTEMPTS - 1
    );
    vi.mocked(rpcPostSignal).mockRejectedValueOnce(
      Object.assign(new Error("network.transient"), {
        code: "network.transient",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-retryable-boundary-online-1|5:${normalizeAgentProfileIdForTest("agt-retryable-boundary-online-1")}`,
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
  });

  it("terminal on known non-retryable error code immediately", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), {
        code: "permission.denied.runtime",
      })
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-non-retryable-code-1",
        sourceEventId: "evt-non-retryable-code-1",
        targetProfileId: "agt-non-retryable-code-1",
        visitedProfileIdsHash: "stable32:11111126",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "permission.denied.runtime",
      })
    );
  });

  it("retries dispatch target profile auth rpc failures instead of classifying them as unknown", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "dispatch.target_profile_identity.auth_rpc_failed: OpenMeld auth RPC threw while resolving dispatch target profile identity."
        ),
        {
          code: "dispatch.target_profile_identity.auth_rpc_failed",
        }
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-target-profile-auth-rpc-failed-1",
        sourceEventId: "evt-target-profile-auth-rpc-failed-1",
        targetProfileId: "agt-target-profile-auth-rpc-failed-1",
        visitedProfileIdsHash:
          "stable32:dispatch-target-profile-auth-rpc-failed-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_retrying",
          dispatchId: "dispatch-target-profile-auth-rpc-failed-1",
        }),
        text: `Retrying @${normalizeAgentProfileIdForTest("agt-target-profile-auth-rpc-failed-1")}...`,
      })
    );
  });

  it("fails terminal on dispatch target profile lookup failures with explicit activity copy", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "dispatch.target_profile_identity.lookup_failed: resolveProfileById failed (auth.profile_lookup_failed): profile lookup failed"
        ),
        {
          code: "dispatch.target_profile_identity.lookup_failed",
        }
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-target-profile-lookup-failed-1",
        sourceEventId: "evt-target-profile-lookup-failed-1",
        targetProfileId: "agt-target-profile-lookup-failed-1",
        visitedProfileIdsHash:
          "stable32:dispatch-target-profile-lookup-failed-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "dispatch.target_profile_identity.lookup_failed",
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_failed",
          dispatchId: "dispatch-target-profile-lookup-failed-1",
        }),
        text: `Couldn't resolve @${normalizeAgentProfileIdForTest("agt-target-profile-lookup-failed-1")} right now`,
      })
    );
  });

  it("does not retry auth.required and does not emit a shared durable hint", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "unexpected status 401 Unauthorized: Missing bearer token (request id: req_auth_1)"
        ),
        {
          code: "auth.required",
        }
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-auth-required-1",
        sourceEventId: "evt-auth-required-1",
        targetProfileId: "agt-auth-required-1",
        visitedProfileIdsHash: "stable32:dispatch-auth-required-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "auth.required",
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
  });

  it("keeps protected-space private failures out of shared durable hints", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(new Error("protected auth required"), {
        code: "auth.required",
      })
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-protected-hint-1",
        sourceEventId: "evt-protected-hint-1",
        targetProfileId: "agt-protected-hint-1",
        visitedProfileIdsHash: "stable32:dispatch-protected-hint-1",
        spacePassword: "secret-123",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "auth.required",
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
  });

  it("does not retry quota.exceeded and does not emit a shared durable hint", async () => {
    vi.mocked(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "insufficient_quota: You exceeded your current quota, please check your plan and billing details."
        ),
        {
          code: "quota.exceeded",
        }
      )
    );

    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-quota-exceeded-1",
        sourceEventId: "evt-quota-exceeded-1",
        targetProfileId: "agt-quota-exceeded-1",
        visitedProfileIdsHash: "stable32:dispatch-quota-exceeded-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "quota.exceeded",
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
  });

  it("dispatches a revisit target in an auto-relay chain instead of blocking it", async () => {
    // Auto-relay loop policy: a chain may wake a profile that already spoke
    // in the same chain (A -> B -> A -> ...). The retired preflight cycle
    // gate used to block this with dispatch.cycle.detected.
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-cycle-1",
      spaceId: "space-1",
      sourceEventId: "evt-cycle-1",
      targetProfileId: "agt-1",
      dispatchChainId: "chain-1",
      autoRelayDepth: 2,
      visitedProfileIds: ["agt-1", "agt-2"],
      visitedProfileIdsHash: "stable32:1111111b",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      transportMode: "local-cli",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-cycle-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });
    vi.mocked(
      runtimeCoordinatorClient.waitRuntimeTransportDispatchResult
    ).mockResolvedValueOnce(
      buildWaitCompleted(
        buildRuntimeTransportTaskResult({
          dispatchId: "dispatch-cycle-1",
          sourceEventId: "evt-cycle-1",
          targetProfileId: "agt-1",
          taskId: "task-dispatch-cycle-1",
          agentControllerConversation: {
            agentControllerRef: "builtin:codex",
            agentControllerConversationKind: "thread",
            agentControllerConversationId: "thread-dispatch-cycle-1",
          },
          bootstrapTemplateFacts: {
            templateVersion: "compact-dispatch-bootstrap-v1",
            contentFingerprint: "sha256:test-binding-fingerprint",
          },
        })
      )
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-cycle-1|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      })
    );
    expectQueueHandedAcceptedResultToRuntimeCoordinator(expect, message, {
      idempotencyKey: "5:evt-cycle-1|5:agt-1",
    });
  });

  it("publishes an exact failure instead of deduping an accepted Wake payload conflict", async () => {
    const reasonCode =
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce(async (input) => ({
      ok: false,
      primaryDispatchId: input.head.dispatchId,
      reasonCode,
      status: "conflict",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-accepted-payload-conflict-1",
        sourceEventId: "evt-accepted-payload-conflict-1",
        targetProfileId: "agt-accepted-payload-conflict-1",
        visitedProfileIdsHash: "stable32:dispatch-accepted-payload-conflict-1",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          decisionSource: "dispatch_delivery_pre_execution",
          dispatchId: "dispatch-accepted-payload-conflict-1",
          publicationCategory: "agent_profile_unavailable",
          reasonCode,
          userRecoveryAction: "check_status",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: reasonCode,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.deduped,
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("acks a changed-payload redrive after its terminal lifecycle head was retired", async () => {
    const reasonCode =
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce(async (input) => ({
      ok: false,
      primaryDispatchId: input.head.dispatchId,
      reasonCode,
      status: "conflict",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    vi.mocked(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).mockImplementationOnce(async (input) => ({
      ok: true,
      primaryDispatchId: input.noExecution.dispatchId,
      publicationIntentId: `rcpi:no_execution:${input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
      reasonCode: RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
      runtimeCoordinatorExecutionId: null,
      status: "already_recorded",
      targetWakeLifecycleId:
        input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-retired-head-payload-conflict-1",
        sourceEventId: "evt-retired-head-payload-conflict-1",
        targetProfileId: "agt-retired-head-payload-conflict-1",
        visitedProfileIdsHash: "stable32:retired-head-payload-conflict-1",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).not.toHaveBeenCalled();
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "dispatch-retired-head-payload-conflict-1",
        decisionCode: "runtime_coordinator.retired_terminal_head_redrive_acked",
        decisionPayload: expect.objectContaining({
          reasonCode,
          runtimeCoordinatorReasonCode:
            RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("preserves an existing non-conflict publication when a changed payload is redriven", async () => {
    const conflictReasonCode =
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE;
    const existingReasonCode = "agent_profile_binding.missing";
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce(async (input) => ({
      ok: false,
      primaryDispatchId: input.head.dispatchId,
      reasonCode: conflictReasonCode,
      status: "conflict",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    vi.mocked(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).mockImplementationOnce(async (input) => ({
      ok: true,
      primaryDispatchId: input.noExecution.dispatchId,
      publicationIntentId: `rcpi:no_execution:${input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
      reasonCode: existingReasonCode,
      runtimeCoordinatorExecutionId: null,
      status: "already_recorded",
      targetWakeLifecycleId:
        input.noExecution.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-existing-publication-payload-conflict-1",
        sourceEventId: "evt-existing-publication-payload-conflict-1",
        targetProfileId: "agt-existing-publication-payload-conflict-1",
        visitedProfileIdsHash:
          "stable32:existing-publication-payload-conflict-1",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: existingReasonCode,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: conflictReasonCode,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "dispatch-existing-publication-payload-conflict-1",
        decisionCode: "runtime_coordinator.head_existing_publication_preserved",
        decisionPayload: expect.objectContaining({
          reasonCode: existingReasonCode,
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("does not overwrite an accepted payload conflict with a second preflight failure", async () => {
    const reasonCode =
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE;
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce(async (input) => ({
      ok: false,
      primaryDispatchId: input.head.dispatchId,
      reasonCode,
      status: "conflict",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const dispatchBody = createDispatchBody({
      dispatchId: "dispatch-preflight-payload-conflict-1",
      sourceEventId: "evt-preflight-payload-conflict-1",
      targetProfileId: "agt-preflight-payload-conflict-1",
      visitedProfileIdsHash: "stable32:preflight-payload-conflict-1",
    });
    const message = createQueueMessage(dispatchBody);
    const authRpc = createAuthRpcWithBindingSnapshot({
      agentControllerRef: null,
      bindingEnabled: false,
      bindingState: "missing",
      ownerUserId: "owner-default",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(createOpenMeldDbWithProfileRow(null), authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({ reasonCode }),
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          reasonCode: "agent_profile_binding.missing",
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("retries an unsafe RuntimeCoordinator head authority conflict without deduping it", async () => {
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockImplementationOnce(async (input) => ({
      ok: false,
      primaryDispatchId: "dispatch-other-authority",
      reasonCode: "runtime_coordinator.head_authority_conflict",
      status: "conflict",
      targetWakeLifecycleId:
        input.head.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-head-authority-conflict-1",
        sourceEventId: "evt-head-authority-conflict-1",
        targetProfileId: "agt-head-authority-conflict-1",
        visitedProfileIdsHash: "stable32:dispatch-head-authority-conflict-1",
      })
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.head_authority_conflict",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.deduped,
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("records RuntimeCoordinator no-execution publication intent when runtime target binding is missing", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "missing",
      bindingEnabled: false,
      agentControllerRef: null,
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-binding-missing-1",
      spaceId: "space-1",
      sourceEventId: "evt-binding-missing-1",
      targetProfileMentionLabel: "Codex Agent",
      targetProfileId: "agt-1",
      targetProfileNameSnapshot: "Codex Agent",
      dispatchChainId: "dispatch-binding-missing-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:1111111c",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-binding-missing-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(createOpenMeldDbWithProfileRow(null), authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.objectContaining({
          dispatchId: "dispatch-binding-missing-1",
          ownerUserId: "owner-default",
          targetProfileMentionLabel: "Codex Agent",
          targetProfileName: "Codex Agent",
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: "dispatch-binding-missing-1",
          ownerUserId: "owner-default",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.missing",
          userRecoveryAction: "set_up_agent_binding",
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.missing",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    // The RuntimeCoordinator head no-execution channel owns this receipt; the
    // queue layer must not publish a second persistent notice for it.
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("records RuntimeCoordinator no-execution publication intent when runtime target binding is disabled", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: false,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-binding-disabled-1",
      spaceId: "space-1",
      sourceEventId: "evt-binding-disabled-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-binding-disabled-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:1111111d",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-binding-disabled-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 0,
        }),
        authRpc
      ),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: "dispatch-binding-disabled-1",
          ownerUserId: "owner-default",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.disabled",
          userRecoveryAction: "enable_agent_binding",
        }),
        ownerUserId: "owner-default",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.disabled",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("rejects a cross-workspace Agent Profile before local delivery", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-binding-org-unauthorized-1",
      spaceId: "space-1",
      sourceEventId: "evt-binding-org-unauthorized-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-binding-org-unauthorized-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:1111111e",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-binding-org-unauthorized-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
          profileOrganizationId: "org-other",
        }),
        authRpc
      ),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile.organization_mismatch",
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile.organization_mismatch",
        errorMessage:
          "This Agent Profile belongs to a different workspace than the Space.",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("reconciles an already-ready RuntimeCoordinator no-execution publication intent on Queue retry", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "missing",
      bindingEnabled: false,
      agentControllerRef: null,
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-binding-missing-retry-1",
      spaceId: "space-1",
      sourceEventId: "evt-binding-missing-retry-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-binding-missing-retry-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:1111111r",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-binding-missing-retry-1|5:agt-1",
      enqueuedAtMs: Date.now(),
    });
    vi.mocked(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).mockResolvedValueOnce({
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: "dispatch-binding-missing-retry-1",
      reasonCode: "runtime_coordinator.head_publication_intent_already_ready",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|27:evt-binding-missing-retry-1|40:agt_5e96d209-ac36-409e-8c52-8b245e46202f",
    });
    vi.mocked(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).mockResolvedValueOnce({
      ok: true,
      primaryDispatchId: "dispatch-binding-missing-retry-1",
      publicationIntentId:
        "rcpi:no_execution:twl_v1|7:space-1|27:evt-binding-missing-retry-1|40:agt_5e96d209-ac36-409e-8c52-8b245e46202f",
      reasonCode: "agent_profile_binding.missing",
      runtimeCoordinatorExecutionId: null,
      status: "already_recorded",
      targetWakeLifecycleId:
        "twl_v1|7:space-1|27:evt-binding-missing-retry-1|40:agt_5e96d209-ac36-409e-8c52-8b245e46202f",
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(createOpenMeldDbWithProfileRow(null), authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: "dispatch-binding-missing-retry-1",
          reasonCode: "agent_profile_binding.missing",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.head_no_execution_pending",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.missing",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode:
          "runtime_coordinator.head_no_execution_publication_intent_ready",
      })
    );
    const readyIntentDecisionIndex = vi
      .mocked(writeOpenMeldDaemonOpsDecision)
      .mock.calls.findIndex(
        ([input]) =>
          input.decisionCode ===
          "runtime_coordinator.head_no_execution_publication_intent_ready"
      );
    const terminalProjectionIndex = vi
      .mocked(markDispatchStatus)
      .mock.calls.findIndex(
        ([input]) =>
          input.errorCode === "agent_profile_binding.missing" &&
          input.status === OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal
      );
    expect(readyIntentDecisionIndex).toBeGreaterThanOrEqual(0);
    expect(terminalProjectionIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(writeOpenMeldDaemonOpsDecision).mock.invocationCallOrder[
        readyIntentDecisionIndex
      ] ?? Number.POSITIVE_INFINITY
    ).toBeLessThan(
      vi.mocked(markDispatchStatus).mock.invocationCallOrder[
        terminalProjectionIndex
      ] ?? -1
    );
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
  });

  it("rejects a fresh Wake while its local agent is turned off and never starts it after re-enable", async () => {
    const dispatchBody = createDispatchBody({
      dispatchId: "dispatch-controller-disabled-fresh-1",
      sourceEventId: "evt-controller-disabled-fresh-1",
      targetProfileId: "agt-controller-disabled-fresh-1",
      visitedProfileIdsHash: "stable32:controller-disabled-fresh-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "controller.registry.disabled",
        targetProfileId: dispatchBody.targetProfileId,
      })
    );
    vi.mocked(claimDispatchAttempt)
      .mockResolvedValueOnce(
        buildClaimedAttempt({
          attempt: 1,
          dispatchId: dispatchBody.dispatchId,
        })
      )
      .mockResolvedValueOnce({ status: "deduped" });
    vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    ).mockImplementation(async ({ request }) => ({
      ok: true,
      readStatus: "missing",
      reasonCode: "runtime_coordinator.head_lifecycle_not_found",
      targetWakeLifecycleId:
        request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));

    const disabledDelivery = createQueueMessage(dispatchBody, 1);
    await handleDispatchQueueBatch({
      batch: {
        messages: [disabledDelivery],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "controller.registry.disabled",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(disabledDelivery.ack).toHaveBeenCalledOnce();
    expect(disabledDelivery.retry).not.toHaveBeenCalled();

    const redeliveryAfterReEnable = createQueueMessage(dispatchBody, 2);
    await handleDispatchQueueBatch({
      batch: {
        messages: [redeliveryAfterReEnable],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(redeliveryAfterReEnable.ack).toHaveBeenCalledOnce();
    expect(redeliveryAfterReEnable.retry).not.toHaveBeenCalled();
  });

  it("terminalizes an accepted head when its local agent is turned off and never revives it after re-enable", async () => {
    const dispatchBody = createDispatchBody({
      dispatchId: "dispatch-controller-disabled-accepted-head-1",
      sourceEventId: "evt-controller-disabled-accepted-head-1",
      targetProfileId: "agt-controller-disabled-accepted-head-1",
      visitedProfileIdsHash: "stable32:controller-disabled-accepted-head-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "controller.registry.disabled",
        targetProfileId: dispatchBody.targetProfileId,
      })
    );
    vi.mocked(claimDispatchAttempt)
      .mockResolvedValueOnce(
        buildClaimedAttempt({
          attempt: 1,
          dispatchId: dispatchBody.dispatchId,
        })
      )
      .mockResolvedValueOnce({ status: "deduped" });
    vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    ).mockImplementation(async ({ request }) => ({
      lifecycle: {
        createdAtMs: 1_700_000_000_000,
        duplicateDispatchCount: 0,
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: null,
        ownerUserId: "owner-default",
        primaryDispatchId: dispatchBody.dispatchId,
        publicationIntent: null,
        runtimeCoordinatorExecutionId: null,
        status: "accepted",
        targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
        targetWakeLifecycleId:
          request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: 1_700_000_000_000,
        waitingBoundary: null,
      },
      ok: true,
      readStatus: "found",
    }));

    const disabledDelivery = createQueueMessage(dispatchBody, 1);
    await handleDispatchQueueBatch({
      batch: {
        messages: [disabledDelivery],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: dispatchBody.dispatchId,
          reasonCode: "controller.registry.disabled",
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(disabledDelivery.ack).toHaveBeenCalledOnce();
    expect(disabledDelivery.retry).not.toHaveBeenCalled();

    const redeliveryAfterReEnable = createQueueMessage(dispatchBody, 2);
    await handleDispatchQueueBatch({
      batch: {
        messages: [redeliveryAfterReEnable],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(redeliveryAfterReEnable.ack).toHaveBeenCalledOnce();
    expect(redeliveryAfterReEnable.retry).not.toHaveBeenCalled();
  });

  it("terminalizes an accepted head for every canonical unavailable blocker", async () => {
    const dispatchBody = createDispatchBody({
      dispatchId: "dispatch-canonical-service-update-accepted-head-1",
      sourceEventId: "evt-canonical-service-update-accepted-head-1",
      targetProfileId: "agt-canonical-service-update-accepted-head-1",
      visitedProfileIdsHash: "stable32:canonical-service-update-head-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "service.update_required",
        targetProfileId: dispatchBody.targetProfileId,
      })
    );
    vi.mocked(claimDispatchAttempt).mockResolvedValueOnce(
      buildClaimedAttempt({
        attempt: 1,
        dispatchId: dispatchBody.dispatchId,
      })
    );
    vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    ).mockImplementation(async ({ request }) => ({
      lifecycle: {
        createdAtMs: 1_700_000_000_000,
        duplicateDispatchCount: 0,
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: null,
        ownerUserId: "owner-default",
        primaryDispatchId: dispatchBody.dispatchId,
        publicationIntent: null,
        runtimeCoordinatorExecutionId: null,
        status: "accepted",
        targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
        targetWakeLifecycleId:
          request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: 1_700_000_000_000,
        waitingBoundary: null,
      },
      ok: true,
      readStatus: "found",
    }));

    const message = createQueueMessage(dispatchBody, 1);
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: dispatchBody.dispatchId,
          publicationCategory: "update_required",
          reasonCode: "service.update_required",
          userRecoveryAction: "update_openmeld_service",
        }),
      })
    );
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("accepts and delivers one normal available Wake exactly once", async () => {
    const dispatchBody = createDispatchBody({
      dispatchId: "dispatch-canonical-ready-once-1",
      sourceEventId: "evt-canonical-ready-once-1",
      targetProfileId: "agt-canonical-ready-once-1",
      visitedProfileIdsHash: "stable32:canonical-ready-once-1",
    });
    vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    ).mockImplementation(async ({ request }) => ({
      ok: true,
      readStatus: "missing",
      reasonCode: "runtime_coordinator.head_lifecycle_not_found",
      targetWakeLifecycleId:
        request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
    const message = createQueueMessage(dispatchBody, 1);

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledOnce();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("hydrates controller snapshot from OPENMELD_POSTGRESQL before runtime execution", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-controller-hydration-1",
        sourceEventId: "evt-controller-hydration-1",
        targetProfileId: "agt-controller-hydration-1",
        visitedProfileIdsHash: "stable32:1111111e",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
        })
      ),
    });

    const deliverDispatchArgs = vi
      .mocked(runtimeCoordinatorClient.deliverRuntimeTransportDispatch)
      .mock.calls.at(-1);
    const deliveredPayload = deliverDispatchArgs?.[0]?.dispatch.payload;

    expect(deliveredPayload?.controllerSnapshot).toEqual(
      expect.objectContaining({
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.binding_source]",
      expect.objectContaining({
        dispatchId: "dispatch-controller-hydration-1",
        targetProfileId: normalizeAgentProfileIdForTest(
          "agt-controller-hydration-1"
        ),
        source: "core_primary_binding",
        status: "resolved",
      })
    );
    infoSpy.mockRestore();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("forks hosted Center Agent dispatch to native delivery without local runtime execution", async () => {
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-1"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-1",
        sourceEventId: "evt-hosted-native-delivery-1",
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-native-delivery-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          modelId: "deepseek/deepseek-v4-flash",
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          bindingId: "binding-hosted-center-agent",
          controllerNormalization: {
            bindingUpdatedAtMs: 1,
            canonicalAgentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            reasonCode: "hosted_runtime_family_controller_canonicalized",
            storedAgentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            storedAgentControllerRefStatus: "canonical",
          },
          organizationId: "org-default",
          ownerUserId: "owner-default",
          modelRoute: expect.objectContaining({
            automaticModelFallback: false,
            displayName: "DeepSeek V4 Flash",
            imageUnderstandingModel: expect.objectContaining({
              inputModalities: expect.arrayContaining(["image"]),
              modelId: "openai/gpt-6-luna",
            }),
            modelId: "deepseek/deepseek-v4-flash",
            preference: {
              kind: "selected_model",
              modelId: "deepseek/deepseek-v4-flash",
            },
          }),
        }),
        message: expect.objectContaining({
          dispatchId: "dispatch-hosted-native-delivery-1",
          sourceEventId: "evt-hosted-native-delivery-1",
          targetProfileId,
        }),
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(markDispatchAttemptWaitingForResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-dispatch-hosted-native-delivery-1-1",
        idempotencyKey: `5:evt-hosted-native-delivery-1|5:${targetProfileId}`,
        targetProfileId,
        taskId: "task-dispatch-hosted-native-delivery-1",
      })
    );
    expect(claimReplyingHintEmission).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-hosted-native-delivery-1|5:${targetProfileId}`,
        nowMs: expect.any(Number),
      })
    );
    expect(readTransientSignalPurposes()).toContain("agent_replying");
    expect(readTransientSignalPurposes()).not.toContain("agent_replying_end");
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      daemonTransportClient.lookupRuntimeTransportRoute
    ).not.toHaveBeenCalled();
  });

  it("does not emit a duplicate hosted Center Agent replying hint when the ledger claim already exists", async () => {
    vi.mocked(claimReplyingHintEmission).mockResolvedValueOnce(
      "already_claimed"
    );
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockResolvedValue({
      shouldAck: true,
      status: "submitted",
    });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-replayed"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-replayed",
        sourceEventId: "evt-hosted-native-delivery-replayed",
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-native-delivery-replayed",
      }),
      2
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(claimReplyingHintEmission).toHaveBeenCalledTimes(1);
    expect(readTransientSignalPurposes()).not.toContain("agent_replying");
    expect(rollbackReplyingHintEmissionClaim).not.toHaveBeenCalled();
  });

  it("keeps hosted Center Agent delivery accepted when replying hint emission fails", async () => {
    vi.mocked(rpcPostTransientSignal).mockImplementation((_env, signal) => {
      if (signal.meta?.purpose === "agent_replying") {
        return Promise.reject(new Error("replying hint unavailable"));
      }
      return Promise.resolve(undefined);
    });
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockResolvedValue({
      shouldAck: true,
      status: "submitted",
    });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-hint-failure"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-hint-failure",
        sourceEventId: "evt-hosted-native-delivery-hint-failure",
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-native-delivery-hint-failure",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(rollbackReplyingHintEmissionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `5:evt-hosted-native-delivery-hint-failure|5:${targetProfileId}`,
      })
    );
  });

  it("acks hosted Center Agent delivery before replying hint emission settles", async () => {
    let resolveReplyingHint!: () => void;
    const replyingHint = new Promise<void>((resolve) => {
      resolveReplyingHint = resolve;
    });
    vi.mocked(rpcPostTransientSignal).mockImplementation((_env, signal) =>
      signal.meta?.purpose === "agent_replying"
        ? replyingHint
        : Promise.resolve(undefined)
    );
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockResolvedValue({
      shouldAck: true,
      status: "submitted",
    });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-hint-pending"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-hint-pending",
        sourceEventId: "evt-hosted-native-delivery-hint-pending",
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-native-delivery-hint-pending",
      }),
      1
    );
    const scheduledWaits: Promise<unknown>[] = [];

    const batchPromise = handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledWaits.push(promise);
        },
      },
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    await vi.waitFor(() => {
      expect(readTransientSignalPurposes()).toContain("agent_replying");
    });
    const ackCallsBeforeReplyingHintSettled = message.ack.mock.calls.length;
    resolveReplyingHint();
    await batchPromise;
    await Promise.allSettled(scheduledWaits);

    expect(ackCallsBeforeReplyingHintSettled).toBe(1);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("terminalizes an unavailable Center Agent model without retrying lookup", async () => {
    const submitNativeDelivery = vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-model-unavailable-1",
        sourceEventId: "evt-hosted-model-unavailable-1",
        targetProfileId: "agt-hosted-model-unavailable-1",
        visitedProfileIdsHash: "stable32:hosted-model-unavailable-1",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-model-unavailable",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          modelId: "retired/provider-model",
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(submitNativeDelivery).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "center_agent_model_unknown",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("does not hold hosted admission behind the dispatching activity signal", async () => {
    let resolveDispatchingSignal!: () => void;
    const dispatchingSignal = new Promise<void>((resolve) => {
      resolveDispatchingSignal = resolve;
    });
    vi.mocked(rpcPostTransientSignal).mockImplementationOnce(
      async () => await dispatchingSignal
    );
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-background-dispatching-1"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-background-dispatching-1",
        sourceEventId: "evt-hosted-background-dispatching-1",
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-background-dispatching-1",
      }),
      1
    );
    const scheduledTasks: Promise<unknown>[] = [];
    const processing = handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      ctx: {
        waitUntil(promise) {
          scheduledTasks.push(promise);
        },
      },
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    try {
      await vi.waitFor(
        () => expect(submitNativeDelivery).toHaveBeenCalledOnce(),
        { timeout: 100 }
      );
      expect(scheduledTasks).toHaveLength(2);
    } finally {
      resolveDispatchingSignal();
      await processing;
      await Promise.allSettled(scheduledTasks);
    }
  });

  it("does not submit hosted Center Agent delivery after a pre-agent stop", async () => {
    const readRuntimeCoordinatorHeadLifecycleTrace = vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    );
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: true,
        status: "submitted",
      });
    vi.spyOn(
      spaceFinalOutcomeClaimReader,
      "readSpaceFinalOutcomeClaim"
    ).mockResolvedValue({
      outcome: "stopped",
      signalId: "signal-hosted-stopped-before-delivery",
    });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-stopped-before-delivery"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-stopped-before-delivery",
        sourceEventId: "evt-hosted-stopped-before-delivery",
        sourceText: "This Wake was stopped",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-stopped-before-delivery",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(submitNativeDelivery).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(markDispatchAttemptWaitingForResult).not.toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          "evt-hosted-stopped-before-delivery"
        ),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "space.wake_stopped_before_native_delivery",
        status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode:
          "remote_agent.native_delivery_final_outcome_claim_blocked",
      })
    );
    expect(readRuntimeCoordinatorHeadLifecycleTrace).not.toHaveBeenCalled();
  });

  it("persists a terminal system failure when hosted native delivery fails before its ledger record exists", async () => {
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockRejectedValue(
      Object.assign(
        new Error('column "retired_deadline_failure_code" does not exist'),
        { code: "42703" }
      )
    );
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-schema-failure"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-schema-failure",
        replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
        sourceClientMessageId: "client-hosted-native-delivery-schema-failure",
        sourceEventId: "evt-hosted-native-delivery-schema-failure",
        sourceText: "Wake up test",
        targetProfileId,
        targetProfileNameSnapshot: "Center Agent",
        visitedProfileIdsHash: "stable32:hosted-native-delivery-schema-failure",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          actorName: "Center Agent",
          actorProfileId: targetProfileId,
          dispatchId: "dispatch-hosted-native-delivery-schema-failure",
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reasonCode: "dispatch.storage.schema_missing",
          replyTo: TEST_REPLY_TO_SNAPSHOT,
          text: "OpenMeld ran into a system problem before Center Agent could reply. Try again. If it keeps happening, open diagnostics.",
        }),
        finalOutcomeAuthority: "remote_agent_native_delivery",
        spaceId: "space-1",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "dispatch.storage.schema_missing",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("leaves an early hosted native delivery failure unacknowledged when its visible failure cannot be persisted", async () => {
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockRejectedValue(
      Object.assign(
        new Error('column "retired_deadline_failure_code" does not exist'),
        { code: "42703" }
      )
    );
    vi.mocked(rpcPostSystemNoticeSignal).mockRejectedValueOnce(
      new Error("Space system notice write failed")
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-publication-failure",
        sourceEventId: "evt-hosted-native-delivery-publication-failure",
        sourceText: "Wake up test",
        targetProfileId: "agt-hosted-native-delivery-publication-failure",
        targetProfileNameSnapshot: "Center Agent",
        visitedProfileIdsHash:
          "stable32:hosted-native-delivery-publication-failure",
      }),
      1
    );

    await expect(
      handleDispatchQueueBatch({
        batch: { messages: [message] } as unknown as MessageBatch<unknown>,
        env: makeEnvWithBindings(
          createOpenMeldDbWithProfileRow({
            agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            bindingId: "binding-hosted-center-agent",
            controllerEnabled: 1,
            hostedRuntimeIdentityJson: JSON.stringify(
              HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
            ),
            profileKind: "agent",
            profileStatus: "active",
            runtimeKind: "hosted_center_agent",
            openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          })
        ),
      })
    ).rejects.toThrow(
      "Could not persist the hosted Center Agent failure for dispatch dispatch-hosted-native-delivery-publication-failure"
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(markDispatchStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: "dispatch-hosted-native-delivery-publication-failure",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("retries the same hosted Center Agent dispatch when worker admission is outcome-ambiguous", async () => {
    const submitNativeDelivery = vi
      .spyOn(
        remoteAgentNativeDeliveryService,
        "submitRemoteAgentNativeDelivery"
      )
      .mockResolvedValue({
        shouldAck: false,
        status: "submitted",
      });
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-hosted-native-delivery-retry"
    );
    const sourceEventId = "evt-hosted-native-delivery-retry";
    const idempotencyKey = `5:${sourceEventId}|5:${targetProfileId}`;
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-native-delivery-retry",
        sourceEventId,
        sourceText: "Summarize this",
        targetProfileId,
        visitedProfileIdsHash: "stable32:hosted-native-delivery-retry",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-center-agent",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    expect(submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ idempotencyKey }),
      })
    );
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(markDispatchAttemptWaitingForResult).not.toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey })
    );
  });

  it("emits split dispatch timing evidence for auth and delivery", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-split-timing-1",
        sourceEventId: "evt-split-timing-1",
        targetProfileId: "agt-split-timing-1",
        visitedProfileIdsHash: "stable32:1111111e",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    const emittedTimingReasonCodes = infoSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry): entry is { reasonCode: unknown } =>
        isRuntimeEvidenceEvent(
          entry,
          "core.openmeld.dispatch.queue_server_timing"
        )
      )
      .map((entry) => entry.reasonCode);

    expect(emittedTimingReasonCodes).toEqual(
      expect.arrayContaining([
        "openmeld_dispatch_pre_head_recovery",
        "openmeld_dispatch_claim",
        "openmeld_dispatch_preflight",
        "openmeld_dispatch_auth",
        "openmeld_dispatch_auth_profile_owner",
        "openmeld_dispatch_auth_binding_snapshot",
        "openmeld_dispatch_deliver_source_signal",
        "openmeld_dispatch_deliver_profile_identity",
        "openmeld_dispatch_route",
        "openmeld_dispatch_deliver_route_guards",
        "openmeld_dispatch_deliver_forgotten_device",
        "openmeld_dispatch_deliver_binding_match",
        "openmeld_dispatch_deliver_request_build",
        "openmeld_dispatch_deliver_ownership_record",
        "openmeld_dispatch_deliver",
      ])
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it("emits hosted Center Agent admission boundary timing evidence", async () => {
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    vi.spyOn(
      remoteAgentNativeDeliveryService,
      "submitRemoteAgentNativeDelivery"
    ).mockResolvedValue({
      shouldAck: true,
      status: "submitted",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-hosted-admission-timing-1",
        sourceEventId: "evt-hosted-admission-timing-1",
        targetProfileId: normalizeAgentProfileIdForTest(
          "agt-hosted-admission-timing-1"
        ),
        visitedProfileIdsHash: "stable32:hostedadmissiontiming",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding-hosted-admission-timing",
          controllerEnabled: 1,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          profileKind: "agent",
          profileStatus: "active",
          runtimeKind: "hosted_center_agent",
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        })
      ),
    });

    const emittedTimingReasonCodes = infoSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry): entry is { reasonCode: unknown } =>
        isRuntimeEvidenceEvent(
          entry,
          "core.openmeld.dispatch.queue_server_timing"
        )
      )
      .map((entry) => entry.reasonCode);

    expect(emittedTimingReasonCodes).toEqual(
      expect.arrayContaining([
        "openmeld_dispatch_pre_head_recovery",
        "openmeld_dispatch_claim",
        "openmeld_dispatch_preflight",
        "openmeld_dispatch_hosted_final_outcome_claim",
        "openmeld_dispatch_hosted_native_delivery",
        "openmeld_dispatch_hosted_waiting",
      ])
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it("starts the owner-qualified Binding read while Auth resolves the current owner", async () => {
    let resolveProfile!: (value: {
      ok: true;
      profile: {
        ownerUserId: string;
        profileHandle: string;
        profileId: string;
        profileKind: "agent";
        profileName: string;
        status: "active";
      };
    }) => void;
    const authRpc = {
      resolveProfileById: vi.fn(
        (_input: { openMeldProfileId?: string | null }) =>
          new Promise<{
            ok: true;
            profile: {
              ownerUserId: string;
              profileHandle: string;
              profileId: string;
              profileKind: "agent";
              profileName: string;
              status: "active";
            };
          }>((resolve) => {
            resolveProfile = resolve;
          })
      ),
    };
    const db = createOpenMeldDbWithProfileRow({
      agentControllerRef: "builtin:codex",
      controllerEnabled: 1,
      profileKind: "agent",
      profileStatus: "active",
    });
    const message = createDispatchBody({
      dispatchId: "dispatch-preflight-parallel-1",
      dispatchOwner: { id: "owner-default", kind: "owner_account" },
      sourceEventId: "evt-preflight-parallel-1",
      targetProfileId: "agt-preflight-parallel-1",
      visitedProfileIdsHash: "stable32:preflight-parallel-1",
    });

    const preflight = runDispatchExecutionPreflightGate({
      env: makeEnvWithBindings(db, authRpc),
      message,
    });

    expect(authRpc.resolveProfileById).toHaveBeenCalledOnce();
    expect(PostgresDatabase.prototype.query).toHaveBeenCalled();

    resolveProfile({
      ok: true,
      profile: {
        ownerUserId: "owner-default",
        profileHandle: "codex",
        profileId: message.targetProfileId,
        profileKind: "agent",
        profileName: "Codex",
        status: "active",
      },
    });
    await expect(preflight).resolves.toMatchObject({ ok: true });
  });

  it.each([
    false,
    true,
  ])("admits only the explicitly pinned device while offline (reconnecting: %s) and rechecks its current readiness", async (reconnecting) => {
    const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deviceWait = {
      targetProfileId,
      bindingId: `binding-${targetProfileId}`,
      openMeldServiceRuntimeId: `runtime-${targetProfileId}`,
      deadlineAtMs: Date.now() + 60_000,
    };
    const message = {
      ...createDispatchBody({
        targetProfileId,
        dispatchId: "device-wait",
        sourceEventId: "device-wait-source",
        visitedProfileIdsHash: "stable32:device-wait",
      }),
      deviceWait,
    };
    const ready = createCanonicalWorkstationReadiness({ targetProfileId });
    const offline = {
      ...ready,
      agentExecutionReadiness: resolveAgentExecutionStatus({
        agentProfileId: targetProfileId,
        binding: ready.primaryBinding,
        route: {
          status: "offline",
          reasonCodes: ["daemon.profile.offline"],
          observedAt: new Date().toISOString(),
        },
        localService: {
          reachable: false,
          reasonCodes: [
            reconnecting
              ? "local_service.reconnecting"
              : "local_service.not_connected_for_account",
          ],
          refreshable: reconnecting,
          source: "runtime_transport",
        },
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      }),
      wakeRouteStatus: { status: "offline" as const },
    };
    const read = vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    );
    read.mockResolvedValueOnce(offline);
    await expect(
      runDispatchExecutionPreflightGate({ env: makeEnvWithBindings(), message })
    ).resolves.toMatchObject({
      ok: true,
      deviceWaitReason: "daemon.profile.offline",
    });
    read.mockResolvedValueOnce(offline);
    vi.spyOn(
      deviceWaitAccess,
      "checkDeviceWaitingWakeAccess"
    ).mockResolvedValue(true);
    const offlineDelivery = createQueueMessage(message, 1);
    await handleDispatchQueueBatch({
      batch: {
        messages: [offlineDelivery],
      } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });
    expect(offlineDelivery.ack).toHaveBeenCalledOnce();
    expect(offlineDelivery.retry).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        waiting: expect.objectContaining({
          reasonCode: "daemon.profile.offline",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.device_waiting",
      })
    );
    for (const runtimeReasonCode of [
      "usage_checking",
      "working_folder.observation_coverage_invalid",
      "working_folder.report_stale",
    ] as const) {
      read.mockResolvedValueOnce(
        createCanonicalWorkstationReadiness({
          targetProfileId,
          runtimeReasonCode,
        })
      );
      await expect(
        runDispatchExecutionPreflightGate({
          env: makeEnvWithBindings(),
          message,
        })
      ).resolves.toMatchObject({
        ok: true,
        deviceWaitReason: "wake.device_wait.readiness_checking",
      });
    }
    read.mockResolvedValueOnce(ready);
    const online = await runDispatchExecutionPreflightGate({
      env: makeEnvWithBindings(),
      message,
    });
    expect(online.ok).toBe(true);
    expect(online).not.toHaveProperty("deviceWaitReason");
    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message: {
          ...message,
          deviceWait: { ...deviceWait, bindingId: "different-binding" },
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "local_service.identity_mismatch",
    });
    read.mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        targetProfileId,
        runtimeReasonCode: "controller.registry.disabled",
      })
    );
    await expect(
      runDispatchExecutionPreflightGate({ env: makeEnvWithBindings(), message })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "controller.registry.disabled",
    });
  });

  it.each([
    "project",
    "space",
  ])("admits explicit %s work with a missing Default Project folder while preserving other Wake blockers", async (work) => {
    const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const message = createDispatchBody({
      dispatchId: "selected-project-missing-default",
      sourceEventId: "selected-project-missing-default-source",
      targetProfileId,
      visitedProfileIdsHash: "stable32:selected-project-missing-default",
    });
    const selectedMessage = {
      ...message,
      contextSelection: {
        mode: "new" as const,
        ...(work === "space"
          ? { access: "space_context" as const }
          : {
              access: "read_only" as const,
              projectWork: {
                projectId: "project-selected",
                repositoryFingerprint: `sha256:${"a".repeat(64)}`,
              },
            }),
        workspace: "isolated" as const,
      },
    };
    const baseReadiness = createCanonicalWorkstationReadiness({
      runtimeReasonCode: "workspace.missing",
      targetProfileId,
    });
    const readiness = {
      ...baseReadiness,
      agentExecutionReadiness: {
        ...baseReadiness.agentExecutionReadiness,
        facts: {
          ...baseReadiness.agentExecutionReadiness.facts,
          binding: {
            ...baseReadiness.agentExecutionReadiness.facts.binding,
            reasonCodes: ["agent_profile_binding.command_eligible"],
          },
          runtime: {
            ...baseReadiness.agentExecutionReadiness.facts.runtime,
            reasonCodes: [
              "runtime.ready",
              "capability.ready",
              "service.ready",
              "project.local_connection.missing",
            ],
          },
        },
        reasonCodes: [
          "agent_profile_binding.command_eligible",
          "runtime.ready",
          "capability.ready",
          "service.ready",
          "project.local_connection.missing",
        ],
      },
    };
    const read = vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    );

    read.mockResolvedValueOnce(readiness);
    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "project.local_connection.missing",
    });
    read.mockResolvedValueOnce(readiness);
    const selectedResult = await runDispatchExecutionPreflightGate({
      env: makeEnvWithBindings(),
      message: selectedMessage,
    });
    expect(selectedResult).toMatchObject({ ok: true });

    for (const mode of ["resume", "fork"] as const) {
      read.mockResolvedValueOnce(readiness);
      await expect(
        runDispatchExecutionPreflightGate({
          env: makeEnvWithBindings(),
          message: {
            ...message,
            contextSelection: {
              mode,
              sourceWakeId: "twl_v1:previous-selected-project-wake",
            },
          },
        })
      ).resolves.toMatchObject({ ok: true });
    }

    read.mockResolvedValueOnce({
      ...readiness,
      agentExecutionReadiness: {
        ...readiness.agentExecutionReadiness,
        facts: {
          ...readiness.agentExecutionReadiness.facts,
          runtime: {
            ...readiness.agentExecutionReadiness.facts.runtime,
            reasonCodes: [
              "runtime.ready",
              "capability.ready",
              "service.ready",
              "project.local_connection.missing",
              "service.update_required",
            ],
          },
        },
        reasonCodes: [
          "agent_profile_binding.command_eligible",
          "runtime.ready",
          "capability.ready",
          "service.ready",
          "project.local_connection.missing",
          "service.update_required",
        ],
      },
    });
    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message: selectedMessage,
      })
    ).resolves.toMatchObject({ ok: false });
  });

  it("does not admit execution when an offline refreshing projection falls through device waiting", async () => {
    const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const readiness = createCanonicalWorkstationReadiness({
      targetProfileId,
      runtimeReasonCode: "controller.registry.disabled",
    });
    const runtime = await import("@openmeld/agent-runtime");
    const availability = runtime.resolveAgentWakeAvailability({
      agentControllerRef: readiness.agentControllerRef,
      agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
      readiness: readiness.agentExecutionReadiness,
      wakeRouteStatus: readiness.wakeRouteStatus,
    });
    const projection = vi
      .spyOn(runtime, "resolveAgentWakeAvailability")
      .mockReturnValueOnce({
        ...availability,
        category: "offline",
        isRefreshing: true,
      });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(readiness);
    try {
      const message = createDispatchBody({
        dispatchId: "refreshing-offline",
        sourceEventId: "refreshing-offline-source",
        targetProfileId,
        visitedProfileIdsHash: "stable32:refreshing-offline",
      });
      const result = await runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message: {
          ...message,
          deviceWait: {
            bindingId: `binding-${targetProfileId}`,
            openMeldServiceRuntimeId: `runtime-${targetProfileId}`,
            targetProfileId,
            deadlineAtMs: Date.now() + 60_000,
          },
        },
      });
      expect(projection).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        ok: false,
        canonicalAdmissionBlock: true,
        errorCode: "controller.registry.disabled",
      });
      expect(result).not.toHaveProperty("deviceWaitReason");
    } finally {
      projection.mockRestore();
    }
  });

  it.each([
    true,
    false,
  ])("retains access-check outages in the Coordinator wait and rechecks access on redrive (allowed: %s)", async (allowed) => {
    const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const body = {
      ...createDispatchBody({
        dispatchId: "device-wait-access-outage",
        sourceEventId: "device-wait-access-source",
        targetProfileId,
        visitedProfileIdsHash: "stable32:device-wait-access",
      }),
      deviceWait: {
        bindingId: `binding-${targetProfileId}`,
        openMeldServiceRuntimeId: `runtime-${targetProfileId}`,
        targetProfileId,
        deadlineAtMs: Date.now() + 60_000,
      },
    };
    const access = vi
      .spyOn(deviceWaitAccess, "checkDeviceWaitingWakeAccess")
      .mockRejectedValueOnce(new Error("Space access temporarily unavailable"))
      .mockResolvedValueOnce(allowed);
    const first = createQueueMessage(body, 1);
    const env = makeEnvWithBindings();
    await handleDispatchQueueBatch({
      batch: { messages: [first] } as unknown as MessageBatch<unknown>,
      env,
    });
    expect(first.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        waiting: expect.objectContaining({
          dispatchId: body.dispatchId,
          reasonCode: "wake.device_wait.access_check_unavailable",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.device_waiting",
      })
    );
    vi.spyOn(
      runtimeCoordinatorClient,
      "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
    ).mockImplementation(async ({ request }) => ({
      ok: true,
      readStatus: "found",
      lifecycle: {
        createdAtMs: Date.now(),
        duplicateDispatchCount: 0,
        executionLinkedAtMs: null,
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: null,
        ownerUserId: "owner-default",
        primaryDispatchId: body.dispatchId,
        publicationIntent: null,
        runtimeCoordinatorExecutionId: null,
        status: "waiting",
        targetWakeLifecycleIdentity: request.targetWakeLifecycleIdentity,
        targetWakeLifecycleId:
          request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: Date.now(),
        waitingBoundary: {
          reasonCode: "wake.device_wait.access_check_unavailable",
          trigger: "space_access_rechecked",
          userRecoveryAction: "check_status",
          userVisibleState: "waiting_for_space_access",
          waitingCategory: "space_access_unavailable",
          waitingFor: "space_access_check",
          deadlineAtMs: body.deviceWait.deadlineAtMs,
          deadlineOutcome: "publication_intent_ready",
          observedAtMs: Date.now(),
          softDeadlineAtMs: Date.now() + 30_000,
          triggerOwner: "runtime_coordinator",
          waitingSinceMs: Date.now(),
        },
      },
    }));
    const redrive = createQueueMessage(
      { ...body, deliveryRecoveryReason: "route_lost" },
      2
    );
    await handleDispatchQueueBatch({
      batch: { messages: [redrive] } as unknown as MessageBatch<unknown>,
      env,
    });
    expect(access).toHaveBeenCalledTimes(2);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(redrive.ack).toHaveBeenCalledOnce();
    if (!allowed) {
      expect(
        runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          noExecution: expect.objectContaining({
            reasonCode: "wake.device_wait.access_revoked",
          }),
        })
      );
    }
  });

  it("keeps an explicit wait parked when a connected Service has not opened dispatch admission", async () => {
    const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const route = vi.mocked(daemonTransportClient.lookupRuntimeTransportRoute);
    const original = route.getMockImplementation();
    if (!original) {
      throw new Error("Expected captured route fixture");
    }
    route.mockImplementation(async (...args) => ({
      ...(await original(...args)),
      acceptingDispatches: false,
    }));
    vi.spyOn(
      deviceWaitAccess,
      "checkDeviceWaitingWakeAccess"
    ).mockResolvedValue(true);
    const body = createDispatchBody({
      dispatchId: "wait-draining",
      sourceEventId: "wait-draining-source",
      targetProfileId,
      visitedProfileIdsHash: "stable32:wait-draining",
    });
    const message = createQueueMessage(
      {
        ...body,
        deviceWait: {
          targetProfileId,
          bindingId: `binding-${targetProfileId}`,
          openMeldServiceRuntimeId: `runtime-${targetProfileId}`,
          deadlineAtMs: Date.now() + 60_000,
        },
      },
      1
    );
    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadWaiting
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        waiting: expect.objectContaining({
          reasonCode: "daemon.service.draining",
        }),
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "runtime_coordinator.device_waiting",
      })
    );
  });

  it("blocks workstation Wake when reliable fresh Usage is exhausted", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-usage-exhausted-1",
      sourceEventId: "evt-usage-exhausted-1",
      targetProfileId: "agt-usage-exhausted-1",
      visitedProfileIdsHash: "stable32:usage-exhausted-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "usage_exhausted",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      errorCode: "usage_exhausted",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      ok: false,
    });
  });

  it("does not let historical accepted-Wake Usage evidence block current ready facts", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-canonical-usage-exhausted-1",
      sourceEventId: "evt-canonical-usage-exhausted-1",
      targetProfileId: "agt-canonical-usage-exhausted-1",
      visitedProfileIdsHash: "stable32:canonical-usage-exhausted-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        providerAccountReasonCode: "usage_exhausted",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({ ok: true });
    expect(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).toHaveBeenCalledOnce();
    expect(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).toHaveBeenCalledWith(
      expect.objectContaining({ includeRuntimeDeviceDisplayName: false })
    );
  });

  it("rejects fresh Wake admission when canonical readiness says the local agent is turned off", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-canonical-controller-disabled-1",
      sourceEventId: "evt-canonical-controller-disabled-1",
      targetProfileId: "agt-canonical-controller-disabled-1",
      visitedProfileIdsHash: "stable32:canonical-controller-disabled-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "controller.registry.disabled",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      errorCode: "controller.registry.disabled",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      ok: false,
    });
  });

  it("does not reject fresh Wake admission when canonical readiness excludes unsupported Usage", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-canonical-usage-unsupported-1",
      sourceEventId: "evt-canonical-usage-unsupported-1",
      targetProfileId: "agt-canonical-usage-unsupported-1",
      visitedProfileIdsHash: "stable32:canonical-usage-unsupported-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        agentControllerRef: "builtin:opencode",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(
          createOpenMeldDbWithProfileRow({
            agentControllerRef: "builtin:opencode",
            controllerEnabled: 1,
            profileKind: "agent",
            profileStatus: "active",
          })
        ),
        message,
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it("retains the request without executing while supported Usage is unavailable", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-usage-checking-1",
      sourceEventId: "evt-usage-checking-1",
      targetProfileId: "agt-usage-checking-1",
      visitedProfileIdsHash: "stable32:usage-checking-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "usage_checking",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      errorCode: "usage_checking",
      canonicalAdmissionBlock: false,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      ok: false,
    });
  });

  it("does not accept workstation Wake before a native Usage provider has reported", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-usage-report-missing-1",
      sourceEventId: "evt-usage-report-missing-1",
      targetProfileId: "agt-usage-report-missing-1",
      visitedProfileIdsHash: "stable32:usage-report-missing-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "usage_checking",
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      errorCode: "usage_checking",
      canonicalAdmissionBlock: false,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      ok: false,
    });
  });

  it("keeps Wake admission closed when a parsed legacy Usage report is checking", async () => {
    const message = createDispatchBody({
      dispatchId: "dispatch-legacy-usage-contract-1",
      sourceEventId: "evt-legacy-usage-contract-1",
      targetProfileId: "agt-legacy-usage-contract-1",
      visitedProfileIdsHash: "stable32:legacy-usage-contract-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeReasonCode: "usage_checking",
        targetProfileId: message.targetProfileId,
      })
    );

    const preflight = await runDispatchExecutionPreflightGate({
      env: makeEnvWithBindings(),
      message,
    });

    expect(preflight).toMatchObject({
      errorCode: "usage_checking",
      canonicalAdmissionBlock: false,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      ok: false,
    });
  });

  it.each([
    undefined,
    "usage_checking",
    "local_service.not_accepting_wakes",
    "working_folder.observation_coverage_invalid",
  ] as const)("retains a first Wake while readiness is unconfirmed (%s) without authorizing execution", async (runtimeReasonCode) => {
    const message = createDispatchBody({
      dispatchId: "dispatch-readiness-unconfirmed-1",
      sourceEventId: "evt-readiness-unconfirmed-1",
      targetProfileId: "agt-readiness-unconfirmed-1",
      visitedProfileIdsHash: "stable32:readiness-unconfirmed-1",
    });
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeDisplayState: "unknown",
        runtimeReasonCode,
        targetProfileId: message.targetProfileId,
      })
    );

    await expect(
      runDispatchExecutionPreflightGate({
        env: makeEnvWithBindings(),
        message,
      })
    ).resolves.toMatchObject({
      errorCode: runtimeReasonCode ?? "agent_execution.readiness_unconfirmed",
      canonicalAdmissionBlock: false,
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      ok: false,
    });
  });

  it.each([
    ["ready", "working_folder.observation_coverage_invalid"],
    ["disabled", "working_folder.observation_coverage_invalid"],
    ["ready", "usage_checking"],
    ["disabled", "usage_checking"],
    ["ready", "local_service.not_accepting_wakes"],
    ["disabled", "local_service.not_accepting_wakes"],
  ] as const)("redrives the same first Wake after preparation (%s, %s) without publishing an early failure", async (nextState, preparationReason) => {
    const message = createDispatchQueueMessage({
      dispatchId: "dispatch-first-preparing",
      sourceEventId: "evt-first-preparing",
      targetProfileId: "agt-first-preparing",
      visitedProfileIdsHash: "hash-first-preparing",
    });
    const body = message.body as OpenMeldDaemonDispatchQueueMessage;
    vi.mocked(
      agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
    ).mockResolvedValueOnce(
      createCanonicalWorkstationReadiness({
        runtimeDisplayState: "unknown",
        runtimeReasonCode: preparationReason,
        targetProfileId: body.targetProfileId,
      })
    );
    await runDispatchQueueMessage(message);
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).not.toHaveBeenCalled();

    if (nextState === "disabled") {
      vi.spyOn(
        runtimeCoordinatorClient,
        "readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace"
      ).mockImplementation(async ({ request }) => ({
        ok: true,
        readStatus: "missing",
        reasonCode: "runtime_coordinator.head_lifecycle_not_found",
        targetWakeLifecycleId:
          request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      }));
      vi.mocked(
        agentExecutionReadinessService.resolveCoreAgentExecutionReadinessForProfile
      ).mockResolvedValueOnce(
        createCanonicalWorkstationReadiness({
          runtimeReasonCode: "controller.registry.disabled",
          targetProfileId: body.targetProfileId,
        })
      );
    }
    await runDispatchQueueMessage(message);
    if (nextState === "ready") {
      expect(
        runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
      ).toHaveBeenCalledTimes(1);
      expect(
        runtimeCoordinatorClient.deliverRuntimeTransportDispatch
      ).toHaveBeenCalledTimes(1);
    } else {
      expect(
        runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
      ).not.toHaveBeenCalled();
      expect(
        runtimeCoordinatorClient.deliverRuntimeTransportDispatch
      ).not.toHaveBeenCalled();
      expect(rpcPostSystemNoticeSignal).toHaveBeenCalled();
    }
  });

  it("retries when Core primary binding storage is unavailable", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-controller-auth-rpc-1",
        sourceEventId: "evt-controller-auth-rpc-1",
        targetProfileId: "agt-controller-auth-rpc-1",
        visitedProfileIdsHash: "stable32:1111111e",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        authRpc
      ),
    });

    expect(authRpc.resolveProfileById).toHaveBeenCalledWith({
      openMeldProfileId: normalizeAgentProfileIdForTest(
        "agt-controller-auth-rpc-1"
      ),
    });
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("retries lookup failure when target profile identity lookup throws", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const authRpc = {
      resolveProfileById: vi
        .fn()
        .mockRejectedValue(new Error("auth rpc timeout")),
    };
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-lookup-failed-auth-1",
        sourceEventId: "evt-binding-lookup-failed-auth-1",
        targetProfileId: "agt-binding-lookup-failed-auth-1",
        visitedProfileIdsHash: "stable32:1111111f",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        authRpc
      ),
    });

    expect(authRpc.resolveProfileById).toHaveBeenCalledWith({
      openMeldProfileId: normalizeAgentProfileIdForTest(
        "agt-binding-lookup-failed-auth-1"
      ),
    });
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "agent_profile_binding.lookup_failed",
        correlationId: "dispatch-binding-lookup-failed-auth-1",
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_retrying",
          dispatchId: "dispatch-binding-lookup-failed-auth-1",
        }),
        text: `Retrying @${normalizeAgentProfileIdForTest("agt-binding-lookup-failed-auth-1")}...`,
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.binding_source]",
      expect.objectContaining({
        dispatchId: "dispatch-binding-lookup-failed-auth-1",
        targetProfileId: normalizeAgentProfileIdForTest(
          "agt-binding-lookup-failed-auth-1"
        ),
        source: "core_primary_binding",
        status: "failed",
        errorCode: "agent_profile_binding.lookup_failed",
        errorMessage: expect.stringContaining("auth rpc timeout"),
      })
    );
    warnSpy.mockRestore();
  });

  it("retries lookup failure when target profile identity lookup returns a transient failure", async () => {
    const authRpc = {
      resolveProfileById: vi.fn().mockResolvedValue({
        ok: false as const,
        code: "profile.internal_error",
        message: "target profile lookup failed",
      }),
    };
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-lookup-failed-auth-result-1",
        sourceEventId: "evt-binding-lookup-failed-auth-result-1",
        targetProfileId: "agt-binding-lookup-failed-auth-result-1",
        visitedProfileIdsHash: "stable32:11111120",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        authRpc
      ),
    });

    expect(authRpc.resolveProfileById).toHaveBeenCalledWith({
      openMeldProfileId: normalizeAgentProfileIdForTest(
        "agt-binding-lookup-failed-auth-result-1"
      ),
    });
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
  });

  it("retries lookup failure when auth rpc binding resolution is unavailable", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-lookup-failed-runtime-1",
        sourceEventId: "evt-binding-lookup-failed-runtime-1",
        targetProfileId: "agt-binding-lookup-failed-runtime-1",
        visitedProfileIdsHash: "stable32:11111120",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        null
      ),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
  });

  it("records RuntimeCoordinator no-execution publication intent when dispatch owner evidence mismatches the current target profile owner", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-current",
    });
    const message = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-binding-owner-mismatch-1",
          sourceEventId: "evt-binding-owner-mismatch-1",
          targetProfileId: "agt-binding-owner-mismatch-1",
          visitedProfileIdsHash: "stable32:11111123",
        }),
        dispatchOwner: {
          id: "owner-stale",
          kind: "owner_account" as const,
        },
      },
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(undefined, authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(writeDispatchDlq).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.objectContaining({
          dispatchId: "dispatch-binding-owner-mismatch-1",
          ownerUserId: "owner-current",
        }),
        ownerUserId: "owner-current",
      })
    );
    expect(
      runtimeCoordinatorClient.recordRuntimeTransportRuntimeCoordinatorHeadNoExecution
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        noExecution: expect.objectContaining({
          dispatchId: "dispatch-binding-owner-mismatch-1",
          ownerUserId: "owner-current",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.owner_mismatch",
          userRecoveryAction: "repair_agent_binding",
        }),
        ownerUserId: "owner-current",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.owner_mismatch",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("fails terminal when the current target profile is not an active agent", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "owner-default",
      profileStatus: "disabled",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-profile-disabled-1",
        sourceEventId: "evt-binding-profile-disabled-1",
        targetProfileId: "agt-binding-profile-disabled-1",
        targetProfileNameSnapshot: "Retired Agent",
        visitedProfileIdsHash: "stable32:11111124",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(undefined, authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    // Soft-retired profiles share the identity verdict copy with hard-deleted
    // ones: same terminal receipt, no repair-flavored action.
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          failureStage: "execution",
          noticeType: "terminal_failure",
          reasonCode: "agent_profile_binding.profile_owner_invalid",
          text: 'Agent "Retired Agent" no longer exists or was retired, so this Wake cannot be delivered.',
        }),
        spaceId: "space-1",
      })
    );
  });

  it("publishes a terminal Space receipt when the target profile was deleted from Auth", async () => {
    const authRpc = {
      resolveProfileById: vi.fn(async () => ({
        ok: false as const,
        code: "profile.not_found",
        message: "profile not found",
      })),
    };
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-profile-deleted-receipt-1"
    );
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-profile-deleted-receipt-1",
        replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
        sourceEventId: "evt-profile-deleted-receipt-1",
        targetProfileId,
        targetProfileNameSnapshot: "Center Agent",
        visitedProfileIdsHash: "stable32:11111125",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(undefined, authRpc),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          actorName: "Center Agent",
          actorProfileId: targetProfileId,
          dispatchId: "dispatch-profile-deleted-receipt-1",
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reasonCode: "agent_profile_binding.profile_owner_invalid",
          replyTo: {
            ...TEST_REPLY_TO_SNAPSHOT,
            previewText: "Original message",
          },
          text: 'Agent "Center Agent" no longer exists or was retired, so this Wake cannot be delivered.',
        }),
        spaceId: "space-1",
      })
    );
    expect(
      JSON.stringify(vi.mocked(rpcPostSystemNoticeSignal).mock.calls[0]?.[1])
    ).not.toContain(TEST_REPLY_TO_SNAPSHOT.previewText);
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_failed",
          dispatchId: "dispatch-profile-deleted-receipt-1",
        }),
        text: "@Center Agent no longer exists",
      })
    );
  });

  it("publishes a generic terminal Space receipt for preflight codes outside the copy allowlist", async () => {
    const organizationLookupDb = createProjectionPostgresBinding((query) => {
      const normalizedSql = query.text.toLowerCase();
      if (
        normalizedSql.includes("space_index_spaces") &&
        normalizedSql.includes("openmeld_profiles")
      ) {
        return [];
      }
      const row = resolveNativeProjectionRow({
        args: query.values ?? [],
        normalizedSql,
        row: {
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
        },
      });
      return row ? [row] : [];
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-preflight-generic-receipt-1",
        sourceEventId: "evt-preflight-generic-receipt-1",
        targetProfileId: "agt-preflight-generic-receipt-1",
        targetProfileNameSnapshot: "ops-bot",
        visitedProfileIdsHash: "stable32:11111126",
      }),
      DISPATCH_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(organizationLookupDb),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile.space_organization_unavailable",
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile.space_organization_unavailable",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    // Codes outside the copy allowlist must still leave a visible receipt:
    // generic copy, never silence.
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          failureStage: "execution",
          noticeType: "terminal_failure",
          reasonCode: "agent_profile.space_organization_unavailable",
          text: 'Agent "ops-bot" couldn\'t reply. This Wake failed and will not retry automatically.',
        }),
        spaceId: "space-1",
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_failed",
          dispatchId: "dispatch-preflight-generic-receipt-1",
        }),
        text: "@ops-bot couldn't reply right now",
      })
    );
  });

  it("feeds the deleted-profile verdict into Space membership liveness evidence", async () => {
    const rpcRecordMemberProfileNotFoundObservation = vi
      .fn()
      .mockResolvedValue({ recorded: true });
    const spacesNamespace = {
      idFromString: vi.fn(() => ({})),
      get: vi.fn(() => ({ rpcRecordMemberProfileNotFoundObservation })),
    } as unknown as DurableObjectNamespace<any>;
    const authRpc = {
      resolveProfileById: vi.fn(async () => ({
        ok: false as const,
        code: "profile.not_found",
        message: "profile not found",
      })),
    };
    const targetProfileId = normalizeAgentProfileIdForTest(
      "agt-profile-deleted-liveness-1"
    );
    const message = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-profile-deleted-liveness-1",
          sourceEventId: "evt-profile-deleted-liveness-1",
          targetProfileId,
          targetProfileNameSnapshot: "Center Agent",
          visitedProfileIdsHash: "stable32:11111128",
        }),
        spaceId: HEX_SPACE_ID,
      },
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: {
        ...makeEnvWithBindings(undefined, authRpc),
        OPENMELD_SPACES: spacesNamespace,
      },
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(spacesNamespace.idFromString).toHaveBeenCalledWith(HEX_SPACE_ID);
    expect(rpcRecordMemberProfileNotFoundObservation).toHaveBeenCalledWith({
      profileId: targetProfileId,
      spaceId: HEX_SPACE_ID,
    });
  });

  it("does not feed liveness evidence for transient identity failures or soft-retired profiles", async () => {
    const rpcRecordMemberProfileNotFoundObservation = vi
      .fn()
      .mockResolvedValue({ recorded: true });
    const spacesNamespace = {
      idFromString: vi.fn(() => ({})),
      get: vi.fn(() => ({ rpcRecordMemberProfileNotFoundObservation })),
    } as unknown as DurableObjectNamespace<any>;

    // Transient lookup failure exhausted into a terminal state: no
    // authoritative not_found verdict, so no evidence write.
    const lookupFailureMessage = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-lookup-failed-liveness-1",
          sourceEventId: "evt-lookup-failed-liveness-1",
          targetProfileId: "agt-lookup-failed-liveness-1",
          visitedProfileIdsHash: "stable32:11111129",
        }),
        spaceId: HEX_SPACE_ID,
      },
      DISPATCH_MAX_ATTEMPTS
    );
    await handleDispatchQueueBatch({
      batch: {
        messages: [lookupFailureMessage],
      } as unknown as MessageBatch<unknown>,
      env: {
        ...makeEnvWithBindings(undefined, {
          resolveProfileById: vi
            .fn()
            .mockRejectedValue(new Error("auth rpc timeout")),
        }),
        OPENMELD_SPACES: spacesNamespace,
      },
    });
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.lookup_failed",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );

    // Soft-retired profile: the liveness alarm would re-verify it as found
    // and clear the evidence, so the verdict marker must stay unset.
    const softRetiredMessage = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-soft-retired-liveness-1",
          sourceEventId: "evt-soft-retired-liveness-1",
          targetProfileId: "agt-soft-retired-liveness-1",
          visitedProfileIdsHash: "stable32:1111112a",
        }),
        spaceId: HEX_SPACE_ID,
      },
      1
    );
    await handleDispatchQueueBatch({
      batch: {
        messages: [softRetiredMessage],
      } as unknown as MessageBatch<unknown>,
      env: {
        ...makeEnvWithBindings(
          undefined,
          createAuthRpcWithBindingSnapshot({
            bindingState: "bound",
            bindingEnabled: true,
            agentControllerRef: "builtin:codex",
            ownerUserId: "owner-default",
            profileStatus: "disabled",
          })
        ),
        OPENMELD_SPACES: spacesNamespace,
      },
    });
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );

    expect(rpcRecordMemberProfileNotFoundObservation).not.toHaveBeenCalled();
  });

  it("still terminalizes and acks when the liveness evidence write fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const rpcRecordMemberProfileNotFoundObservation = vi
      .fn()
      .mockRejectedValue(new Error("space DO unavailable"));
    const spacesNamespace = {
      idFromString: vi.fn(() => ({})),
      get: vi.fn(() => ({ rpcRecordMemberProfileNotFoundObservation })),
    } as unknown as DurableObjectNamespace<any>;
    const authRpc = {
      resolveProfileById: vi.fn(async () => ({
        ok: false as const,
        code: "profile.not_found",
        message: "profile not found",
      })),
    };
    const message = createQueueMessage(
      {
        ...createDispatchBody({
          dispatchId: "dispatch-profile-deleted-liveness-emit-failed-1",
          sourceEventId: "evt-profile-deleted-liveness-emit-failed-1",
          targetProfileId: "agt-profile-deleted-liveness-emit-failed-1",
          visitedProfileIdsHash: "stable32:1111112b",
        }),
        spaceId: HEX_SPACE_ID,
      },
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: {
        ...makeEnvWithBindings(undefined, authRpc),
        OPENMELD_SPACES: spacesNamespace,
      },
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(rpcRecordMemberProfileNotFoundObservation).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.member_liveness_observation_failed]",
      expect.objectContaining({
        dispatchId: "dispatch-profile-deleted-liveness-emit-failed-1",
      })
    );
  });

  it("retries a preflight terminal failure until its visible receipt is durable", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.mocked(rpcPostSystemNoticeSignal)
      .mockRejectedValueOnce(new Error("Space system notice write failed 1"))
      .mockRejectedValueOnce(new Error("Space system notice write failed 2"))
      .mockRejectedValueOnce(new Error("Space system notice write failed 3"))
      .mockRejectedValueOnce(new Error("Space system notice write failed 4"));
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const authRpc = {
      resolveProfileById: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false as const,
          code: "profile.not_found",
          message: "profile not found",
        })
        .mockResolvedValue({
          ok: true as const,
          profile: {
            ownerUserId: "owner-default",
            profileHandle: "center-agent",
            profileId: normalizeAgentProfileIdForTest(
              "agt-profile-deleted-receipt-emit-failed-1"
            ),
            profileKind: "agent" as const,
            profileName: "Center Agent",
            status: "active" as const,
          },
        }),
    };
    const body = createDispatchBody({
      dispatchId: "dispatch-profile-deleted-receipt-emit-failed-1",
      sourceEventId: "evt-profile-deleted-receipt-emit-failed-1",
      targetProfileId: "agt-profile-deleted-receipt-emit-failed-1",
      targetProfileNameSnapshot: "Center Agent",
      visitedProfileIdsHash: "stable32:11111127",
    });
    const env = {
      ...makeEnvWithBindings(undefined, authRpc),
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
    } as unknown as CoreBindings;
    const deliveries = Array.from({ length: 5 }, () =>
      createQueueMessage(body, 1)
    );
    for (const delivery of deliveries) {
      await handleDispatchQueueBatch({
        batch: { messages: [delivery] } as unknown as MessageBatch<unknown>,
        env,
      });
    }

    expect(
      deliveries.every((delivery) => delivery.retry.mock.calls.length === 0)
    ).toBe(true);
    expect(
      deliveries.every((delivery) => delivery.ack.mock.calls.length === 1)
    ).toBe(true);
    expect(queueSend).toHaveBeenCalledTimes(4);
    expect(queueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: body.dispatchId,
        idempotencyKey: body.idempotencyKey,
      }),
      {
        delaySeconds: expect.any(Number),
      }
    );
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledTimes(5);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.hint_emit_failed]",
      expect.objectContaining({
        dispatchId: "dispatch-profile-deleted-receipt-emit-failed-1",
        errorCode: "agent_profile_binding.profile_owner_invalid",
      })
    );
    const publicationRequestIds = vi
      .mocked(rpcPostSystemNoticeSignal)
      .mock.calls.map((call) => call[1]?.context?.actorContext.requestId);
    expect(new Set(publicationRequestIds).size).toBe(1);
    const [firstPublicationCommand] = vi.mocked(rpcPostSystemNoticeSignal).mock
      .calls;
    expect(
      vi
        .mocked(rpcPostSystemNoticeSignal)
        .mock.calls.every(
          (call) =>
            JSON.stringify(call[1]) ===
            JSON.stringify(firstPublicationCommand?.[1])
        )
    ).toBe(true);
    expect(authRpc.resolveProfileById).toHaveBeenCalledTimes(1);
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(writeDispatchDlq).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
      })
    );
    expect(markDispatchStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      preHeadFailurePublicationOutboxRepository.markPreHeadFailurePublicationCompleted
    ).toHaveBeenCalledTimes(1);
  });

  it("redrives a pre-head failure from the minute scheduler after Queue enqueue fails beyond the original delivery budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(rpcPostSystemNoticeSignal).mockRejectedValueOnce(
      new Error("Space system notice unavailable")
    );
    const queueSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("Queue enqueue unavailable"))
      .mockResolvedValue(undefined);
    const authRpc = {
      resolveProfileById: vi.fn(async () => ({
        code: "profile.not_found",
        message: "profile not found",
        ok: false as const,
      })),
    };
    const body = createDispatchBody({
      dispatchId: "dispatch-pre-head-scheduled-redrive-1",
      replyToSnapshot: TEST_REPLY_TO_SNAPSHOT,
      sourceEventId: "evt-pre-head-scheduled-redrive-1",
      sourceText: "Do not persist this source message.",
      spacePassword: "do-not-persist-this-password",
      targetProfileId: "agt-pre-head-scheduled-redrive-1",
      visitedProfileIdsHash: "stable32:pre-head-scheduled-redrive-1",
    });
    const recoveryDb = makeEnvWithBindings(
      undefined,
      authRpc
    ).OPENMELD_POSTGRESQL;
    const env = {
      ...makeEnvWithBindings(recoveryDb, authRpc),
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
    } as unknown as CoreBindings;
    const exhaustedDelivery = createQueueMessage(body, DISPATCH_MAX_ATTEMPTS);

    await handleDispatchQueueBatch({
      batch: {
        messages: [exhaustedDelivery],
      } as unknown as MessageBatch<unknown>,
      env,
    });

    expect(exhaustedDelivery.retry).not.toHaveBeenCalled();
    expect(exhaustedDelivery.ack).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(
      preHeadFailurePublicationOutboxRepository.ensurePreHeadFailurePublicationIntent
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        db: expect.any(PostgresDatabase),
      })
    );
    const pendingIntent = preHeadFailurePublicationIntents.get(body.dispatchId);
    if (!pendingIntent) {
      throw new Error("expected durable pre-head failure publication intent");
    }
    expect(pendingIntent.redriveMessage.spacePassword).toBeUndefined();
    expect(pendingIntent.redriveMessage.sourceSignalSnapshot).toBeUndefined();
    expect(pendingIntent.redriveMessage.replyToSnapshot?.previewText).toBe(
      "Original message"
    );
    expect(pendingIntent.publicationCommand.data.replyTo?.previewText).toBe(
      "Original message"
    );
    expect(pendingIntent.publicationCommand.spaceAccess.proof).toEqual({
      kind: "none",
    });
    vi.spyOn(
      preHeadFailurePublicationOutboxRepository,
      "listDuePreHeadFailurePublicationIntents"
    ).mockResolvedValue([pendingIntent]);

    await expect(
      retryPendingPreHeadFailurePublications({
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        env,
        nowMs: Date.now() + 60_000,
      })
    ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });

    const scheduledMessage = queueSend.mock.calls[1]?.[0];
    const redriveDelivery = createQueueMessage(scheduledMessage, 1);
    await handleDispatchQueueBatch({
      batch: {
        messages: [redriveDelivery],
      } as unknown as MessageBatch<unknown>,
      env,
    });

    expect(redriveDelivery.retry).not.toHaveBeenCalled();
    expect(redriveDelivery.ack).toHaveBeenCalledTimes(1);
    expect(authRpc.resolveProfileById).toHaveBeenCalledTimes(1);
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rpcPostSystemNoticeSignal).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      })
    );
    expect(vi.mocked(rpcPostSystemNoticeSignal).mock.calls[1]?.[1]).toEqual(
      vi.mocked(rpcPostSystemNoticeSignal).mock.calls[0]?.[1]
    );
    expect(writeDispatchDlq).toHaveBeenCalledTimes(1);
    expect(
      preHeadFailurePublicationOutboxRepository.markPreHeadFailurePublicationCompleted
    ).toHaveBeenCalledTimes(1);
  });

  it("replays only the frozen failure receipt when terminal ledger persistence fails after publication", async () => {
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const authRpc = {
      resolveProfileById: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false as const,
          code: "profile.not_found",
          message: "profile not found",
        })
        .mockResolvedValue({
          ok: true as const,
          profile: {
            ownerUserId: "owner-default",
            profileHandle: "center-agent",
            profileId: normalizeAgentProfileIdForTest(
              "agt-terminal-write-failed"
            ),
            profileKind: "agent" as const,
            profileName: "Center Agent",
            status: "active" as const,
          },
        }),
    };
    const body = createDispatchBody({
      dispatchId: "dispatch-terminal-write-failed",
      sourceEventId: "evt-terminal-write-failed",
      targetProfileId: "agt-terminal-write-failed",
      visitedProfileIdsHash: "stable32:terminal-write-failed",
    });
    vi.mocked(markDispatchStatus)
      .mockRejectedValueOnce(new Error("terminal ledger unavailable"))
      .mockResolvedValue(undefined);
    const env = {
      ...makeEnvWithBindings(undefined, authRpc),
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
    } as unknown as CoreBindings;
    const first = createQueueMessage(body, 1);
    await handleDispatchQueueBatch({
      batch: { messages: [first] } as unknown as MessageBatch<unknown>,
      env,
    });
    const profileResolutionCallsAfterFirstDelivery =
      authRpc.resolveProfileById.mock.calls.length;
    const replay = createQueueMessage(body, 1);
    await handleDispatchQueueBatch({
      batch: { messages: [replay] } as unknown as MessageBatch<unknown>,
      env,
    });

    expect(first.ack).toHaveBeenCalledTimes(1);
    expect(replay.ack).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledTimes(2);
    expect(authRpc.resolveProfileById).toHaveBeenCalledTimes(
      profileResolutionCallsAfterFirstDelivery
    );
    expect(vi.mocked(rpcPostSystemNoticeSignal).mock.calls[1]?.[1]).toEqual(
      vi.mocked(rpcPostSystemNoticeSignal).mock.calls[0]?.[1]
    );
    expect(claimDispatchAttempt).toHaveBeenCalledTimes(1);
    expect(
      runtimeCoordinatorClient.acceptRuntimeTransportRuntimeCoordinatorHead
    ).not.toHaveBeenCalled();
    expect(
      runtimeCoordinatorClient.deliverRuntimeTransportDispatch
    ).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(
      preHeadFailurePublicationOutboxRepository.markPreHeadFailurePublicationCompleted
    ).toHaveBeenCalledTimes(1);
  });

  it("retries when bound target binding omits owner user id", async () => {
    const authRpc = createAuthRpcWithBindingSnapshot({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "builtin:codex",
      ownerUserId: "",
    });
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-owner-missing-1",
        sourceEventId: "evt-binding-owner-missing-1",
        targetProfileId: "agt-binding-owner-missing-1",
        visitedProfileIdsHash: "stable32:11111121",
      }),
      1
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithProfileRow({
          profileKind: "agent",
          profileStatus: "active",
          agentControllerRef: "builtin:codex",
          controllerEnabled: 1,
        }),
        authRpc
      ),
    });

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "agent_profile_binding.profile_owner_unavailable",
        correlationId: "dispatch-binding-owner-missing-1",
      })
    );
  });

  it("fails terminal after lookup failure retries are exhausted", async () => {
    const authRpc = {
      resolveProfileById: vi
        .fn()
        .mockRejectedValue(new Error("auth rpc timeout")),
    };
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-lookup-retries-exhausted-1",
        sourceEventId: "evt-binding-lookup-retries-exhausted-1",
        targetProfileId: "agt-binding-lookup-retries-exhausted-1",
        visitedProfileIdsHash: "stable32:11111120",
      }),
      DISPATCH_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        authRpc
      ),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.lookup_failed",
        errorMessage: expect.stringContaining(
          "target profile identity lookup failed"
        ),
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    // Preflight terminal failures persist a Space-visible receipt from the
    // queue layer: no RuntimeCoordinator head exists to publish one.
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          failureStage: "execution",
          noticeType: "terminal_failure",
          reasonCode: "agent_profile_binding.lookup_failed",
        }),
        spaceId: "space-1",
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_failed",
          dispatchId: "dispatch-binding-lookup-retries-exhausted-1",
        }),
        text: `Couldn't route @${normalizeAgentProfileIdForTest("agt-binding-lookup-retries-exhausted-1")} right now`,
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
  });

  it("fails terminal after auth rpc lookup failure retries are exhausted", async () => {
    const message = createQueueMessage(
      createDispatchBody({
        dispatchId: "dispatch-binding-lookup-retries-exhausted-runtime-1",
        sourceEventId: "evt-binding-lookup-retries-exhausted-runtime-1",
        targetProfileId: "agt-binding-lookup-retries-exhausted-runtime-1",
        visitedProfileIdsHash: "stable32:11111120",
      }),
      DISPATCH_MAX_ATTEMPTS
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(
        createOpenMeldDbWithPrepareError("openmeld_profiles unavailable"),
        null
      ),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(writeDispatchDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "agent_profile_binding.lookup_failed",
        errorMessage: expect.stringContaining(
          "target profile identity lookup is unavailable"
        ),
      })
    );
    expect(rpcPostSignal).not.toHaveBeenCalled();
    expect(rpcPostSystemNoticeSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          failureStage: "execution",
          noticeType: "terminal_failure",
          reasonCode: "agent_profile_binding.lookup_failed",
        }),
        spaceId: "space-1",
      })
    );
    expect(rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({
          purpose: "dispatch_activity_failed",
          dispatchId: "dispatch-binding-lookup-retries-exhausted-runtime-1",
        }),
        text: `Couldn't route @${normalizeAgentProfileIdForTest("agt-binding-lookup-retries-exhausted-runtime-1")} right now`,
      })
    );
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: "agent_profile_binding.lookup_failed",
        decisionPayload: expect.objectContaining({
          bindingSource: "core_primary_binding",
        }),
        correlationId: "dispatch-binding-lookup-retries-exhausted-runtime-1",
      })
    );
  });

  it("does not terminal finalization-time retryable errors from Queue", async () => {
    vi.mocked(rpcPostSignal).mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { code: "timeout" })
    );
    const message = createQueueMessage(
      {
        v: 2,
        dispatchId: "dispatch-retryable-2",
        spaceId: "space-1",
        sourceEventId: "evt-retryable-2",
        targetProfileId: "agt-1",
        dispatchChainId: "dispatch-retryable-2",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:11111118",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        dispatchSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          targetBindingState: "bound",
          targetBindingEnabled: true,
        },
        idempotencyKey: "5:evt-retryable-2|5:agt-1",
        enqueuedAtMs: Date.now(),
      },
      7
    );

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(markDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "5:evt-retryable-2|5:agt-1",
        status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      })
    );
    expect(writeDispatchDlq).not.toHaveBeenCalled();
  });

  it("emits dedupe window risk signal when queue lag approaches window", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const nearWindowLagMs = Math.floor(DISPATCH_IDEMPOTENCY_WINDOW_MS * 0.9);
    const message = createQueueMessage({
      v: 2,
      dispatchId: "dispatch-window-risk-1",
      spaceId: "space-1",
      sourceEventId: "evt-window-risk-1",
      targetProfileId: "agt-1",
      dispatchChainId: "dispatch-window-risk-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "stable32:11111119",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      dispatchSnapshot: {
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        targetBindingState: "bound",
        targetBindingEnabled: true,
      },
      idempotencyKey: "5:evt-window-risk-1|5:agt-1",
      enqueuedAtMs: Date.now() - nearWindowLagMs,
    });

    await handleDispatchQueueBatch({
      batch: { messages: [message] } as unknown as MessageBatch<unknown>,
      env: makeEnvWithBindings(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_queue.risk]",
      expect.objectContaining({
        code: DISPATCH_DEDUPE_WINDOW_RISK_CODE,
      })
    );
    expect(writeOpenMeldDaemonOpsDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionCode: DISPATCH_DEDUPE_WINDOW_RISK_CODE,
        correlationId: "dispatch-window-risk-1",
      })
    );
    warnSpy.mockRestore();
  });
});
