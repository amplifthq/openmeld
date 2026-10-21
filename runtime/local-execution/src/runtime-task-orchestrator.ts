import type {
  AdapterAgentContextResolution,
  AdapterComputerFileAccessBoundary,
  AdapterContextIdMappingSpec,
  AdapterDispatchExecutionMode,
  AdapterDispatchRequest,
  AdapterDispatchSpaceTools,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterStreamingMode,
  AdapterTransportMode,
  RuntimeAdapter,
} from "@openmeld/adapter-core";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas";
import type {
  AgentControllerPermissionMode,
  ConversationPolicy,
  OpenCodePermissionConfig,
  OpenMeldDaemonDispatchDeliveryRecoveryReason,
  OpenMeldDaemonProviderAccessEvidence,
  ProviderDispatchRuntimeContext,
} from "@openmeld/schemas/types";
import type { AdapterRouteTarget } from "./adapter-routing.js";
import {
  type AgentContextLifecycleReason,
  type AgentContextResolutionResult,
  resolveAgentContextForDispatch,
} from "./agent-context-policy.js";
import {
  buildIdempotencyKey,
  shouldBypassDedupeForDeliveryRecoveryReason,
  shouldDedupeWithinWindow,
} from "./data-plane-contract.js";
import { HEARTBEAT_POLICY_DEFAULTS } from "./heartbeat-policy.js";
import {
  appendAgentContextRotationRecord,
  appendLedgerHistoryEntry,
  bumpAgentContextLifecycleCounters,
  type LedgerFileIo,
  type LedgerPaths,
  type OpenMeldDaemonAgentContextLifecycleCounters,
  type OpenMeldDaemonAgentContextRotationRecord,
  type OpenMeldDaemonHistoryEntry,
  type OpenMeldDaemonLedgerState,
  recordDedupeFirstSeenAt,
  removeAgentContext,
  resolveDedupeFirstSeenAt,
  upsertAgentContext,
  upsertInflightTask,
  withLedgerStateTransaction,
} from "./ledger-store.js";
import {
  dispatchMentionOnlyTask,
  dispatchMentionOnlyTaskWithRouting,
  type MentionOnlyDispatchWithRoutingResult,
} from "./mention-dispatch-integration.js";
import {
  buildTaskResultPayloadFromOutcome,
  planRecoveryReplay,
  type RecoveryRuntimeState,
  settleRecoveredTask,
  type TaskResultErrorType,
} from "./recovery-policy.js";
import {
  resolveRuntimeReplayStuckHealthFinding,
  resolveRuntimeResultMappingViolation,
  resolveRuntimeTaskResultTransitionContractViolation,
  resolveRuntimeTrackingTransitionContractViolation,
} from "./runtime-health-invariant-policy.js";
import { emitRuntimeHealthFinding } from "./runtime-health-view.js";
import { buildRuntimeWorkspaceFingerprint } from "./runtime-workspace-fingerprint.js";
import type { TriggerMode } from "./trigger-policy.js";

export type RuntimeTask = {
  agentId: string;
  newSessionTitle?: AdapterDispatchRequest["newSessionTitle"];
  attemptId: string;
  bindingKey: string;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  executionContext?: AdapterDispatchRequest["executionContext"];
  /**
   * A ledger scope of this Wake's own, so its conversation is neither
   * resumed from nor recorded into the Profile's shared one. A UUID.
   */
  agentContextScopeId?: string;
  dispatchId?: string;
  deliveryRecoveryReason?: OpenMeldDaemonDispatchDeliveryRecoveryReason;
  executionMode?: AdapterDispatchExecutionMode;
  mentioned: boolean;
  instructionPrompt?: AdapterInstructionPrompt;
  prompt: string;
  runtimeContext: ProviderDispatchRuntimeContext;
  sequence: number;
  sourceEventId: string;
  spaceId: string;
  taskId: string;
  triggerMode?: TriggerMode;
};

export type RuntimeTaskRoute = {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  contextIdMappingSpec: AdapterContextIdMappingSpec;
  agentControllerRef: string;
  controllerRuntimeAvailable?: boolean;
  env?: Record<string, string | undefined>;
  openCodePermission?: OpenCodePermissionConfig;
  runtimeWorkspaceFingerprint?: string;
  serviceHealthy?: boolean;
  serviceInstalled?: boolean;
  targets: AdapterRouteTarget[];
  transportMode: AdapterTransportMode;
  streamingMode?: AdapterStreamingMode;
  view?: "agent" | "human";
};

export type RuntimeTaskInput = {
  spaceActionTools?: AdapterDispatchSpaceTools;
  adapter?: RuntimeAdapter;
  // Explicit continuation decision, including null for a fresh conversation.
  // Replacements are retained by the caller's native observation/result path.
  agentContextOverride?: {
    agentControllerConversationId: string | null;
    sourceFieldOverride?: string;
    agentControllerConversationOverride?: AdapterDispatchRequest["agentControllerConversation"];
  };
  io: LedgerFileIo;
  nowMs?: number;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  paths: LedgerPaths;
  route?: RuntimeTaskRoute;
  task: RuntimeTask;
};

export type RuntimeTaskResult = {
  contextResolution?: AdapterAgentContextResolution;
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  resultPayload: OpenMeldDaemonTaskResultPayload;
  runtimeState: RecoveryRuntimeState;
  agentContextLifecycle?: RuntimeAgentContextLifecycle;
  agentContextRotationAudit?: RuntimeAgentContextRotationAudit;
  agentContextLifecycleCounters: OpenMeldDaemonAgentContextLifecycleCounters;
  state: OpenMeldDaemonLedgerState;
};

export type RuntimeAgentContextLifecycle = {
  lifecycleReason: AgentContextLifecycleReason;
  resolvedAgentControllerConversationId: string | null;
  agentContextLookupKey: string;
};

export type RuntimeAgentContextRotationAudit =
  OpenMeldDaemonAgentContextRotationRecord;

export type RuntimeDispatchResult =
  | MentionOnlyDispatchWithRoutingResult
  | {
      dispatched: false;
      reason: "deduped";
    };

type RuntimeTaskHealthContext = {
  agentId: string;
  idempotencyKey: string;
  sourceEventId: string;
  spaceId: string;
  taskId: string;
};

type RuntimeTaskExecutionPreparation = {
  agentContextResolution?: AgentContextResolutionResult;
  deduped: boolean;
  hadInflightTaskBeforeTracking: boolean;
  oldestReplayAgeMs: number | null;
  replayCandidateCount: number;
  runtimeState: RecoveryRuntimeState;
};

type RuntimeTaskOutcomeResolution = {
  outcome: ReturnType<typeof resolveTaskOutcome>;
  resultPayload: OpenMeldDaemonTaskResultPayload;
};

type PostDispatchAgentContextInput = {
  nowMs: number;
  providerContextId: string;
  route: RuntimeTaskRoute;
  task: RuntimeTask;
};

const mapAdapterErrorType = (
  errorType: AdapterErrorType
): TaskResultErrorType => {
  if (errorType === "adapter") {
    return "adapter";
  }
  if (errorType === "auth") {
    return "auth";
  }
  if (errorType === "config") {
    return "config";
  }
  if (errorType === "network") {
    return "network";
  }
  if (errorType === "timeout") {
    return "timeout";
  }
  return "internal";
};

const buildDispatchRequest = (input: {
  spaceActionTools?: AdapterDispatchSpaceTools;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  openCodePermission?: OpenCodePermissionConfig;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  task: RuntimeTask;
  streamingMode?: AdapterStreamingMode;
}): AdapterDispatchRequest => ({
  ...(input.spaceActionTools
    ? { spaceActionTools: input.spaceActionTools }
    : {}),
  agentId: input.task.agentId,
  executionContext: input.task.executionContext,
  ...(input.agentControllerPermissionMode
    ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
    : {}),
  ...(input.conversationPolicy
    ? { conversationPolicy: input.conversationPolicy }
    : {}),
  ...(input.task.computerFileAccessBoundary
    ? { computerFileAccessBoundary: input.task.computerFileAccessBoundary }
    : {}),
  ...(input.task.dispatchId ? { dispatchId: input.task.dispatchId } : {}),
  ...(input.env ? { env: input.env } : {}),
  executionMode: input.task.executionMode ?? "normal",
  ...(input.openCodePermission
    ? { openCodePermission: input.openCodePermission }
    : {}),
  ...(input.onInteractionRequest
    ? { onInteractionRequest: input.onInteractionRequest }
    : {}),
  ...(input.onPreview ? { onPreview: input.onPreview } : {}),
  ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
  ...(input.task.instructionPrompt
    ? { instructionPrompt: input.task.instructionPrompt }
    : {}),
  prompt: input.task.prompt,
  newSessionTitle: input.task.newSessionTitle,
  runtimeContext: input.task.runtimeContext,
  sourceEventId: input.task.sourceEventId,
  spaceId: input.task.spaceId,
  taskId: input.task.taskId,
  streamingMode: input.streamingMode ?? "final",
});

const buildHistoryReasonCode = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  resultPayload: OpenMeldDaemonTaskResultPayload;
}): string => {
  if (input.deduped) {
    return "task.deduped";
  }

  if (!input.dispatchResult.dispatched) {
    return "task.mention_skipped";
  }

  if (input.resultPayload.status === "success") {
    return "task.dispatched";
  }

  if (input.resultPayload.status === "partial_success") {
    return "task.emit_failed";
  }

  return "task.dispatch_failed";
};

const buildHistoryMessage = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  resultPayload: OpenMeldDaemonTaskResultPayload;
}): string => {
  if (input.deduped) {
    return "deduped duplicate task within 24h window";
  }

  if (!input.dispatchResult.dispatched) {
    return "mention_only skipped because agent was not mentioned";
  }

  if (input.resultPayload.status === "success") {
    return "task dispatched through runtime adapter";
  }

  if (input.resultPayload.status === "partial_success") {
    return "task produced output but emit path failed";
  }

  return "task dispatch failed";
};

const buildHistoryEntry = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  resultPayload: OpenMeldDaemonTaskResultPayload;
  taskId: string;
}): OpenMeldDaemonHistoryEntry => ({
  message: buildHistoryMessage(input),
  reasonCode: buildHistoryReasonCode(input),
  status: input.resultPayload.status,
  taskId: input.taskId,
  ts: new Date().toISOString(),
});

const isRepairExecutionMode = (value: RuntimeTask["executionMode"]): boolean =>
  value === "repair";

const resolveTaskOutcome = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
}): {
  emitFailed: boolean;
  errorCode?: string;
  errorMessage?: string;
  errorType?: TaskResultErrorType;
  output?: string;
  originalError?: string;
  providerAccessEvidence?: OpenMeldDaemonProviderAccessEvidence;
  telemetry?: AdapterDispatchTelemetry;
} => {
  if (input.deduped) {
    const dedupedErrorCode = "runtime.task.deduped";
    return {
      emitFailed: false,
      errorCode: dedupedErrorCode,
      errorMessage: `${dedupedErrorCode}: task deduped within 24h window`,
      errorType: "policy",
    };
  }

  if (!input.dispatchResult.dispatched) {
    return {
      emitFailed: false,
      errorMessage: "mention_only skipped because agent was not mentioned",
      errorType: "policy",
    };
  }

  if (input.dispatchResult.adapterResult.status === "success") {
    return {
      emitFailed: false,
      output: input.dispatchResult.adapterResult.output,
      ...(input.dispatchResult.adapterResult.telemetry
        ? { telemetry: input.dispatchResult.adapterResult.telemetry }
        : {}),
    };
  }

  return {
    emitFailed: true,
    ...(input.dispatchResult.adapterResult.errorCode
      ? { errorCode: input.dispatchResult.adapterResult.errorCode }
      : {}),
    errorMessage: input.dispatchResult.adapterResult.errorMessage,
    errorType: mapAdapterErrorType(
      input.dispatchResult.adapterResult.errorType
    ),
    ...(input.dispatchResult.adapterResult.originalError
      ? { originalError: input.dispatchResult.adapterResult.originalError }
      : {}),
    ...(input.dispatchResult.adapterResult.providerAccessEvidence
      ? {
          providerAccessEvidence:
            input.dispatchResult.adapterResult.providerAccessEvidence,
        }
      : {}),
    ...(input.dispatchResult.adapterResult.telemetry
      ? { telemetry: input.dispatchResult.adapterResult.telemetry }
      : {}),
  };
};

const resolveMissingRuntimeAdapterDispatchResult =
  (): MentionOnlyDispatchWithRoutingResult => ({
    adapterResult: {
      errorCode: "controller.runtime.missing",
      errorMessage:
        "controller.runtime.missing: runtime adapter is unavailable for dispatch",
      errorType: "config",
      status: "failed",
    },
    dispatched: true,
    reason: "dispatched",
  });

const dispatchRuntimeTask = async (input: {
  spaceActionTools?: AdapterDispatchSpaceTools;
  adapter?: RuntimeAdapter;
  deduped: boolean;
  route?: RuntimeTaskRoute;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  agentContextOverride?: {
    agentControllerConversationId: string | null;
    sourceFieldOverride?: string;
    agentControllerConversationOverride?: AdapterDispatchRequest["agentControllerConversation"];
  };
  task: RuntimeTask;
}): Promise<RuntimeDispatchResult> => {
  if (input.deduped) {
    return { dispatched: false, reason: "deduped" };
  }

  if (input.route) {
    return await dispatchMentionOnlyTaskWithRouting({
      ...(input.agentContextOverride
        ? {
            agentControllerConversationIdOverride:
              input.agentContextOverride.agentControllerConversationId,
            sourceFieldOverride: input.agentContextOverride.sourceFieldOverride,
            agentControllerConversationOverride:
              input.agentContextOverride.agentControllerConversationOverride,
          }
        : {}),
      contextIdMappingSpec: input.route.contextIdMappingSpec,
      agentControllerRef: input.route.agentControllerRef,
      controllerRuntimeAvailable: input.route.controllerRuntimeAvailable,
      env: input.route.env,
      mentioned: input.task.mentioned,
      request: buildDispatchRequest({
        spaceActionTools: input.spaceActionTools,
        agentControllerPermissionMode:
          input.route.agentControllerPermissionMode,
        conversationPolicy: input.route.conversationPolicy,
        env: input.route.env,
        openCodePermission: input.route.openCodePermission,
        onInteractionRequest: input.onInteractionRequest,
        onPreview: input.onPreview,
        onRuntimeEvent: input.onRuntimeEvent,
        task: input.task,
        streamingMode: input.route.streamingMode ?? "final",
      }),
      serviceHealthy: input.route.serviceHealthy,
      serviceInstalled: input.route.serviceInstalled,
      targets: input.route.targets,
      transportMode: input.route.transportMode,
      triggerMode: input.task.triggerMode,
      view: input.route.view,
    });
  }

  if (!input.adapter) {
    return resolveMissingRuntimeAdapterDispatchResult();
  }

  return await dispatchMentionOnlyTask({
    adapter: input.adapter,
    mentioned: input.task.mentioned,
    request: buildDispatchRequest({
      spaceActionTools: input.spaceActionTools,
      onInteractionRequest: input.onInteractionRequest,
      onPreview: input.onPreview,
      onRuntimeEvent: input.onRuntimeEvent,
      task: input.task,
      streamingMode: "final",
    }),
    ...(input.task.triggerMode ? { triggerMode: input.task.triggerMode } : {}),
  });
};

const shouldCommitAgentContextLifecycle = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
}): boolean => {
  if (input.deduped || !input.dispatchResult.dispatched) {
    return false;
  }
  if ("routeFailure" in input.dispatchResult) {
    return input.dispatchResult.routeFailure === undefined;
  }
  return true;
};

const shouldRetainResolvedLedgerContext = (input: {
  executionMode: RuntimeTask["executionMode"];
  agentContextOverride: RuntimeTaskInput["agentContextOverride"];
  agentContextResolution: AgentContextResolutionResult | undefined;
}): boolean => {
  if (isRepairExecutionMode(input.executionMode)) {
    return false;
  }
  // The caller's observation/result handler owns an explicit replacement.
  // Never write back (or rediscover) a ledger conversation that was not used.
  return (
    input.agentContextOverride === undefined ||
    input.agentContextOverride.agentControllerConversationId ===
      (input.agentContextResolution?.resolvedAgentControllerConversationId ??
        null)
  );
};

const resolveCommittedAgentContextResolution = (input: {
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  agentContextResolution: AgentContextResolutionResult | undefined;
}): AgentContextResolutionResult | null => {
  if (!input.agentContextResolution) {
    return null;
  }
  if (
    !shouldCommitAgentContextLifecycle({
      deduped: input.deduped,
      dispatchResult: input.dispatchResult,
    })
  ) {
    return null;
  }
  return input.agentContextResolution;
};

const resolveProviderContextId = (route: RuntimeTaskRoute): string | null => {
  const raw = route.env?.[route.contextIdMappingSpec.sourceField];
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeContextDeltaConversationId = (
  value: string | null | undefined
): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveDispatchResultContextDeltaConversationId = (
  dispatchResult: RuntimeDispatchResult
): string | null => {
  if (!(dispatchResult.dispatched && "adapterResult" in dispatchResult)) {
    return null;
  }
  if (dispatchResult.adapterResult.status !== "success") {
    return null;
  }
  return normalizeContextDeltaConversationId(
    dispatchResult.adapterResult.contextDelta?.agentControllerConversationId
  );
};

const resolvePostDispatchAgentContextInput = (input: {
  committedAgentContextResolution: AgentContextResolutionResult | null;
  dispatchResult: RuntimeDispatchResult;
  nowMs: number;
  route?: RuntimeTaskRoute;
  task: RuntimeTask;
}): PostDispatchAgentContextInput | null => {
  if (!input.route || input.committedAgentContextResolution?.agentContext) {
    return null;
  }
  const providerContextId = resolveDispatchResultContextDeltaConversationId(
    input.dispatchResult
  );
  if (!providerContextId) {
    return null;
  }
  return {
    nowMs: input.nowMs,
    providerContextId,
    route: input.route,
    task: input.task,
  };
};

const resolvePostDispatchAgentContextResolution = (input: {
  postDispatchAgentContext: PostDispatchAgentContextInput;
  state: OpenMeldDaemonLedgerState;
}): AgentContextResolutionResult =>
  resolveAgentContextForDispatch({
    key: {
      agentControllerRef:
        input.postDispatchAgentContext.route.agentControllerRef,
      executionContextId:
        input.postDispatchAgentContext.task.executionContext?.id ??
        input.postDispatchAgentContext.task.agentContextScopeId,
      runtimeWorkspaceFingerprint:
        input.postDispatchAgentContext.route.runtimeWorkspaceFingerprint ??
        buildRuntimeWorkspaceFingerprint(
          input.postDispatchAgentContext.task.runtimeContext
            .providerRuntimeWorkingDirectory
        ),
      spaceId: input.postDispatchAgentContext.task.spaceId,
      targetProfileId: input.postDispatchAgentContext.task.agentId,
      transportMode: input.postDispatchAgentContext.route.transportMode,
    },
    nowMs: input.postDispatchAgentContext.nowMs,
    providerContextId: input.postDispatchAgentContext.providerContextId,
    state: input.state,
    taskId: input.postDispatchAgentContext.task.taskId,
  });

const commitAgentContextResolutionToState = (input: {
  state: OpenMeldDaemonLedgerState;
  committedAgentContextResolution: AgentContextResolutionResult | null;
}): OpenMeldDaemonLedgerState => {
  if (!input.committedAgentContextResolution) {
    return input.state;
  }

  let nextState = input.state;
  if (input.committedAgentContextResolution.agentContext) {
    if (
      input.committedAgentContextResolution.replacedAgentContextLookupKey &&
      input.committedAgentContextResolution.replacedAgentContextLookupKey !==
        input.committedAgentContextResolution.agentContext.agentContextLookupKey
    ) {
      nextState = removeAgentContext({
        agentContextLookupKey:
          input.committedAgentContextResolution.replacedAgentContextLookupKey,
        state: nextState,
      });
    }
    nextState = upsertAgentContext({
      agentContext: input.committedAgentContextResolution.agentContext,
      state: nextState,
    });
  }
  if (input.committedAgentContextResolution.rotationRecord) {
    nextState = appendAgentContextRotationRecord({
      record: input.committedAgentContextResolution.rotationRecord,
      state: nextState,
    });
  }

  return bumpAgentContextLifecycleCounters({
    delta: input.committedAgentContextResolution.counterDelta,
    state: nextState,
  });
};

const resolveRuntimeContextResolution = (
  dispatchResult: RuntimeDispatchResult
): AdapterAgentContextResolution | undefined =>
  dispatchResult.dispatched && "contextResolution" in dispatchResult
    ? dispatchResult.contextResolution
    : undefined;

const resolveRuntimeLifecycleMetadata = (
  committedAgentContextResolution: AgentContextResolutionResult | null
): Pick<
  RuntimeTaskResult,
  "agentContextLifecycle" | "agentContextRotationAudit"
> => {
  if (!committedAgentContextResolution) {
    return {};
  }

  const lifecycle: RuntimeAgentContextLifecycle = {
    lifecycleReason: committedAgentContextResolution.lifecycleReason,
    resolvedAgentControllerConversationId:
      committedAgentContextResolution.resolvedAgentControllerConversationId,
    agentContextLookupKey:
      committedAgentContextResolution.agentContextLookupKey,
  };
  return {
    agentContextLifecycle: lifecycle,
    ...(committedAgentContextResolution.rotationRecord
      ? {
          agentContextRotationAudit:
            committedAgentContextResolution.rotationRecord,
        }
      : {}),
  };
};

const prepareRuntimeTaskExecution = async (input: {
  idempotencyKey: string;
  io: LedgerFileIo;
  nowMs: number;
  paths: LedgerPaths;
  route?: RuntimeTaskRoute;
  shouldBypassDedupe: boolean;
  task: RuntimeTask;
}): Promise<RuntimeTaskExecutionPreparation> =>
  withLedgerStateTransaction({
    invalidStateStrategy: input.task.executionContext
      ? "throw"
      : "backup_and_reset",
    io: input.io,
    mutate: (state) => {
      const repairExecution = isRepairExecutionMode(input.task.executionMode);
      const replayPlan = planRecoveryReplay({ state });
      const oldestReplayAgeMs =
        replayPlan.replayCandidates.length > 0
          ? Math.max(
              0,
              input.nowMs -
                Math.min(
                  ...replayPlan.replayCandidates.map(
                    (candidate) => candidate.firstSeenAtMs
                  )
                )
            )
          : null;
      const firstSeenAtMs = repairExecution
        ? undefined
        : resolveDedupeFirstSeenAt({
            idempotencyKey: input.idempotencyKey,
            state,
          });
      const deduped =
        !(repairExecution || input.shouldBypassDedupe) &&
        firstSeenAtMs !== undefined &&
        shouldDedupeWithinWindow({
          firstSeenAtMs,
          nowMs: input.nowMs,
        });
      const firstSeenAt = firstSeenAtMs ?? input.nowMs;

      let nextState = state;
      if (!repairExecution) {
        nextState = recordDedupeFirstSeenAt({
          firstSeenAtMs: firstSeenAt,
          idempotencyKey: input.idempotencyKey,
          state: nextState,
        });

        nextState = upsertInflightTask({
          state: nextState,
          task: {
            bindingKey: input.task.bindingKey,
            firstSeenAtMs: firstSeenAt,
            idempotencyKey: input.idempotencyKey,
            sequence: input.task.sequence,
            taskId: input.task.taskId,
          },
        });
      }

      const agentContextResolution = input.route
        ? resolveAgentContextForDispatch({
            key: {
              agentControllerRef: input.route.agentControllerRef,
              executionContextId:
                input.task.executionContext?.id ??
                input.task.agentContextScopeId,
              runtimeWorkspaceFingerprint:
                input.route.runtimeWorkspaceFingerprint ??
                buildRuntimeWorkspaceFingerprint(
                  input.task.runtimeContext.providerRuntimeWorkingDirectory
                ),
              spaceId: input.task.spaceId,
              targetProfileId: input.task.agentId,
              transportMode: input.route.transportMode,
            },
            nowMs: input.nowMs,
            providerContextId: resolveProviderContextId(input.route),
            state: nextState,
            taskId: input.task.taskId,
          })
        : undefined;

      return {
        nextState,
        value: {
          agentContextResolution,
          deduped,
          hadInflightTaskBeforeTracking:
            input.task.taskId in state.inflightByTaskId,
          oldestReplayAgeMs,
          replayCandidateCount: replayPlan.replayCandidates.length,
          runtimeState: replayPlan.runtimeState,
        },
      };
    },
    paths: input.paths,
  });

const emitRuntimeTaskPreparationHealthFindings = (input: {
  hadInflightTaskBeforeTracking: boolean;
  humanContext: RuntimeTaskHealthContext;
  oldestReplayAgeMs: number | null;
  replayCandidateCount: number;
  runtimeState: RecoveryRuntimeState;
}): void => {
  const replayStuckFinding = resolveRuntimeReplayStuckHealthFinding({
    hasReplayCandidates: input.replayCandidateCount > 0,
    humanContext: input.humanContext,
    oldestReplayAgeMs: input.oldestReplayAgeMs,
    staleAfterMs: HEARTBEAT_POLICY_DEFAULTS.watchdogTimeoutMs,
  });
  if (replayStuckFinding) {
    emitRuntimeHealthFinding({
      eventName: "[runtime.openMeldDaemon.health.replay_stuck]",
      fields: {
        oldestReplayAgeMs: input.oldestReplayAgeMs,
        replayCandidateCount: input.replayCandidateCount,
        runtimeState: input.runtimeState,
        staleAfterMs: HEARTBEAT_POLICY_DEFAULTS.watchdogTimeoutMs,
      },
      finding: replayStuckFinding,
    });
  }

  const trackingTransitionViolation =
    resolveRuntimeTrackingTransitionContractViolation({
      hasInflightTask: input.hadInflightTaskBeforeTracking,
      humanContext: input.humanContext,
    });
  if (trackingTransitionViolation) {
    emitRuntimeHealthFinding({
      eventName:
        "[runtime.openMeldDaemon.health.transition_contract_violation]",
      fields: {
        lifecycleKind: "tracking",
        runtimeState: input.runtimeState,
      },
      finding: trackingTransitionViolation,
    });
  }
};

const resolveRuntimeTaskOutcomeResult = (input: {
  agentId: string;
  attemptId: string;
  deduped: boolean;
  dispatchResult: RuntimeDispatchResult;
  sourceEventId: string;
  taskId: string;
  transportMode?: AdapterTransportMode | null;
}): RuntimeTaskOutcomeResolution => {
  const outcome = resolveTaskOutcome({
    deduped: input.deduped,
    dispatchResult: input.dispatchResult,
  });

  const resultPayload = buildTaskResultPayloadFromOutcome({
    agentId: input.agentId,
    attemptId: input.attemptId,
    deduped: input.deduped,
    emitFailed: outcome.emitFailed,
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
    ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
    ...(outcome.errorType ? { errorType: outcome.errorType } : {}),
    ...(outcome.output ? { output: outcome.output } : {}),
    ...(outcome.originalError ? { originalError: outcome.originalError } : {}),
    ...(outcome.providerAccessEvidence
      ? { providerAccessEvidence: outcome.providerAccessEvidence }
      : {}),
    ...(outcome.telemetry ? { telemetry: outcome.telemetry } : {}),
    sourceEventId: input.sourceEventId,
    taskId: input.taskId,
    ...(input.transportMode ? { transportMode: input.transportMode } : {}),
  });

  return {
    outcome,
    resultPayload,
  };
};

const emitRuntimeTaskOutcomeHealthFindings = (input: {
  humanContext: RuntimeTaskHealthContext;
  outcome: RuntimeTaskOutcomeResolution["outcome"];
  resultPayload: RuntimeTaskOutcomeResolution["resultPayload"];
  runtimeState: RecoveryRuntimeState;
}): void => {
  const emittedOutput =
    typeof input.outcome.output === "string" &&
    input.outcome.output.trim().length > 0;
  const resultTransitionViolation =
    resolveRuntimeTaskResultTransitionContractViolation({
      humanContext: input.humanContext,
      payloadStatus: input.resultPayload.status,
    });
  if (resultTransitionViolation) {
    emitRuntimeHealthFinding({
      eventName:
        "[runtime.openMeldDaemon.health.transition_contract_violation]",
      fields: {
        lifecycleKind: "result_payload",
        payloadStatus: input.resultPayload.status,
        runtimeState: input.runtimeState,
      },
      finding: resultTransitionViolation,
    });
  }

  const resultMappingViolation = resolveRuntimeResultMappingViolation({
    expectedSuccessLike: emittedOutput,
    humanContext: input.humanContext,
    payloadStatus: input.resultPayload.status,
  });
  if (resultMappingViolation) {
    emitRuntimeHealthFinding({
      eventName: "[runtime.openMeldDaemon.health.result_mapping_violation]",
      fields: {
        emittedOutput,
        payloadStatus: input.resultPayload.status,
        runtimeState: input.runtimeState,
      },
      finding: resultMappingViolation,
    });
  }
};

const settleRuntimeTaskState = async (input: {
  committedAgentContextResolution: AgentContextResolutionResult | null;
  io: LedgerFileIo;
  paths: LedgerPaths;
  persistExecutionState?: boolean;
  postDispatchAgentContext: PostDispatchAgentContextInput | null;
  taskId: string;
}): Promise<{
  committedAgentContextResolution: AgentContextResolutionResult | null;
  state: OpenMeldDaemonLedgerState;
}> =>
  withLedgerStateTransaction({
    invalidStateStrategy:
      input.committedAgentContextResolution?.agentContextLookupKey.startsWith(
        "execution-context|"
      ) ||
      input.postDispatchAgentContext?.task.executionContext ||
      input.postDispatchAgentContext?.task.agentContextScopeId
        ? "throw"
        : "backup_and_reset",
    io: input.io,
    mutate: (state) => {
      let committedAgentContextResolution =
        input.committedAgentContextResolution;
      if (
        !committedAgentContextResolution?.agentContext &&
        input.postDispatchAgentContext
      ) {
        committedAgentContextResolution =
          resolvePostDispatchAgentContextResolution({
            postDispatchAgentContext: input.postDispatchAgentContext,
            state,
          });
      }

      if (input.persistExecutionState === false) {
        return {
          nextState: state,
          value: {
            committedAgentContextResolution,
            state,
          },
        };
      }
      let nextState = commitAgentContextResolutionToState({
        committedAgentContextResolution,
        state,
      });

      nextState = settleRecoveredTask({
        state: nextState,
        taskId: input.taskId,
      });

      return {
        nextState,
        value: {
          committedAgentContextResolution,
          state: nextState,
        },
      };
    },
    paths: input.paths,
  });

export const runRuntimeTask = async (
  input: RuntimeTaskInput
): Promise<RuntimeTaskResult> => {
  const nowMs = input.nowMs ?? Date.now();
  const idempotencyKey = buildIdempotencyKey({
    sourceEventId: input.task.sourceEventId,
    targetProfileId: input.task.agentId,
  });
  const shouldBypassDedupe = shouldBypassDedupeForDeliveryRecoveryReason(
    input.task.deliveryRecoveryReason
  );
  const {
    agentContextResolution,
    deduped,
    hadInflightTaskBeforeTracking,
    oldestReplayAgeMs,
    replayCandidateCount,
    runtimeState,
  } = await prepareRuntimeTaskExecution({
    idempotencyKey,
    io: input.io,
    nowMs,
    paths: input.paths,
    route: input.route,
    shouldBypassDedupe,
    task: input.task,
  });
  const runtimeHealthContext: RuntimeTaskHealthContext = {
    agentId: input.task.agentId,
    idempotencyKey,
    sourceEventId: input.task.sourceEventId,
    spaceId: input.task.spaceId,
    taskId: input.task.taskId,
  };
  emitRuntimeTaskPreparationHealthFindings({
    hadInflightTaskBeforeTracking,
    humanContext: runtimeHealthContext,
    oldestReplayAgeMs,
    replayCandidateCount,
    runtimeState,
  });

  const dispatchResult = await dispatchRuntimeTask({
    spaceActionTools: input.spaceActionTools,
    adapter: input.adapter,
    deduped,
    onInteractionRequest: input.onInteractionRequest,
    ...(input.onPreview ? { onPreview: input.onPreview } : {}),
    ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
    ...(input.route ? { route: input.route } : {}),
    ...(agentContextResolution || input.agentContextOverride
      ? {
          agentContextOverride: {
            agentControllerConversationId: input.agentContextOverride
              ? input.agentContextOverride.agentControllerConversationId
              : (agentContextResolution?.resolvedAgentControllerConversationId ??
                null),
            ...(agentContextResolution?.sourceFieldOverride
              ? {
                  sourceFieldOverride:
                    agentContextResolution.sourceFieldOverride,
                }
              : {}),
            ...(input.agentContextOverride?.sourceFieldOverride
              ? {
                  sourceFieldOverride:
                    input.agentContextOverride.sourceFieldOverride,
                }
              : {}),
            ...(input.agentContextOverride?.agentControllerConversationOverride
              ? {
                  agentControllerConversationOverride:
                    input.agentContextOverride
                      .agentControllerConversationOverride,
                }
              : {}),
          },
        }
      : {}),
    task: input.task,
  });

  const retainResolvedLedgerContext = shouldRetainResolvedLedgerContext({
    executionMode: input.task.executionMode,
    agentContextOverride: input.agentContextOverride,
    agentContextResolution,
  });
  const committedAgentContextResolution = retainResolvedLedgerContext
    ? resolveCommittedAgentContextResolution({
        deduped,
        dispatchResult,
        agentContextResolution,
      })
    : null;
  const postDispatchAgentContext = retainResolvedLedgerContext
    ? resolvePostDispatchAgentContextInput({
        committedAgentContextResolution,
        dispatchResult,
        nowMs,
        route: input.route,
        task: input.task,
      })
    : null;

  const runtimeTaskOutcome = resolveRuntimeTaskOutcomeResult({
    agentId: input.task.agentId,
    attemptId: input.task.attemptId,
    deduped,
    dispatchResult,
    sourceEventId: input.task.sourceEventId,
    taskId: input.task.taskId,
    transportMode: input.route?.transportMode ?? null,
  });
  emitRuntimeTaskOutcomeHealthFindings({
    humanContext: runtimeHealthContext,
    outcome: runtimeTaskOutcome.outcome,
    resultPayload: runtimeTaskOutcome.resultPayload,
    runtimeState,
  });
  const { resultPayload } = runtimeTaskOutcome;
  const settledRuntimeTaskState = await settleRuntimeTaskState({
    committedAgentContextResolution,
    io: input.io,
    paths: input.paths,
    persistExecutionState: !isRepairExecutionMode(input.task.executionMode),
    postDispatchAgentContext,
    taskId: input.task.taskId,
  });
  const finalCommittedAgentContextResolution =
    settledRuntimeTaskState.committedAgentContextResolution;
  const state = settledRuntimeTaskState.state;

  if (!isRepairExecutionMode(input.task.executionMode)) {
    await appendLedgerHistoryEntry({
      entry: buildHistoryEntry({
        deduped,
        dispatchResult,
        resultPayload,
        taskId: input.task.taskId,
      }),
      io: input.io,
      paths: input.paths,
    });
  }

  const contextResolution = resolveRuntimeContextResolution(dispatchResult);
  const lifecycleMetadata = resolveRuntimeLifecycleMetadata(
    finalCommittedAgentContextResolution
  );

  return {
    ...(contextResolution ? { contextResolution } : {}),
    deduped,
    dispatchResult,
    resultPayload,
    runtimeState,
    ...lifecycleMetadata,
    agentContextLifecycleCounters: state.agentContextLifecycleCounters,
    state,
  };
};
