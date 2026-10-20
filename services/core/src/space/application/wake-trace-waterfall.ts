import {
  projectObservabilityWakeCorrelation,
  projectSpaceDispatchTraceFinalVisibleOutcome,
  projectSpaceDispatchTraceRootCause,
  WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
} from "@openmeld/schemas";
import type {
  GetSpaceDispatchLookupResponse,
  GetSpaceWakeTraceWaterfallResponse,
  ObservabilityWakeCorrelation,
  SpaceDispatchLookupMatch,
  SpaceDispatchTraceFinalVisibleOutcome,
  SpaceDispatchTraceResponse,
  SpaceDispatchTraceSnapshot,
  WakeProgressWaitReasonCode,
  WakeTargetExecutionContext,
  WakeTraceWaterfallFactSource,
  WakeTraceWaterfallItem,
  WakeTraceWaterfallStep,
  WakeTraceWaterfallStepIds,
  WakeTraceWaterfallStepName,
  WakeTraceWaterfallStepStatus,
  WakeTraceWaterfallSummaryStatus,
} from "@openmeld/schemas/types";
import { resolveWakeProgressLocalQueueWaitReasonCode } from "../../runtime-transport/application/local-queue-wait-reason";
import type { OpenMeldDaemonDispatchOutboxRecoveryCandidate } from "../infrastructure/outbox/dispatch-outbox-repo";
import {
  type AgentOriginLineageScope,
  canViewAgentLocalOriginFacts,
} from "../rules/privacy/agent-profile-visibility";

const WATERFALL_STEP_NAMES = [
  "source_signal",
  "planner",
  "dispatch",
  "head_lifecycle",
  "attempt",
  "result_inbox",
  "result",
  "reply_signal",
] as const satisfies readonly WakeTraceWaterfallStepName[];

const RUNTIME_COORDINATOR_PROGRESS_STALE_POLICY_REASON_CODE =
  "runtime_coordinator.progress_stale_policy_pending";

export type WakeTraceWaterfallSourceSignalFact = {
  factSource:
    | "space_signal_by_client_message_id"
    | "space_signal_by_source_signal_id";
  signalId: string;
  observedAtMs: number;
  targetProfileIds: readonly string[];
};

export type ProjectWakeTraceWaterfallInput = {
  agentLocalOriginFactsViewer?: AgentOriginLineageScope;
  clientMessageId: string | null;
  lookup: GetSpaceDispatchLookupResponse | null;
  lookupError: unknown | null;
  outboxRecords: readonly OpenMeldDaemonDispatchOutboxRecoveryCandidate[];
  sourceSignal: WakeTraceWaterfallSourceSignalFact | null;
  sourceSignalId?: string | null;
  spaceId: string;
  targetLabelByProfileId: ReadonlyMap<string, string>;
  targetOwnerUserIdByProfileId?: ReadonlyMap<string, string | null>;
  targetProfileId: string | null;
  traceErrorsByDispatchId?: ReadonlySet<string>;
  tracesByDispatchId: ReadonlyMap<string, SpaceDispatchTraceResponse | null>;
};

export function projectWakeTraceWaterfall(
  input: ProjectWakeTraceWaterfallInput
): GetSpaceWakeTraceWaterfallResponse {
  const items = collectWakeTraceWaterfallTargetProfileIds(input).map(
    (targetProfileId) => projectWakeTraceWaterfallItem(input, targetProfileId)
  );

  return {
    query: {
      spaceId: input.spaceId,
      clientMessageId: input.clientMessageId,
      sourceSignalId: input.clientMessageId
        ? null
        : (input.sourceSignalId ?? input.sourceSignal?.signalId ?? null),
      targetProfileId: input.targetProfileId,
    },
    items,
  };
}

function projectWakeTraceWaterfallItem(
  input: ProjectWakeTraceWaterfallInput,
  targetProfileId: string
): WakeTraceWaterfallItem {
  const outboxRecord =
    input.outboxRecords.find(
      (record) => record.targetProfileId === targetProfileId
    ) ?? null;
  const lookupMatch =
    input.lookup?.matches.find(
      (match) => match.targetProfileId === targetProfileId
    ) ?? null;
  const dispatchId =
    lookupMatch?.dispatchId ?? outboxRecord?.dispatchId ?? null;
  const traceResponse = dispatchId
    ? (input.tracesByDispatchId.get(dispatchId) ?? null)
    : null;
  const trace = traceResponse?.trace ?? null;
  const traceReadFailed = dispatchId
    ? input.traceErrorsByDispatchId?.has(dispatchId) === true
    : false;
  const sourceSignalId =
    input.sourceSignal?.signalId ??
    input.sourceSignalId ??
    trace?.dispatch.sourceEventId ??
    lookupMatch?.sourceSignalId ??
    outboxRecord?.sourceEventId ??
    null;
  const targetLabel = resolveWakeTraceTargetLabel({
    outboxRecord,
    targetLabelByProfileId: input.targetLabelByProfileId,
    targetProfileId,
  });
  const baseIds = buildWakeTraceStepIds({
    clientMessageId: input.clientMessageId,
    sourceSignalId,
    targetProfileId,
    dispatchId,
    trace,
    lookupMatch,
  });
  const steps = buildWakeTraceWaterfallSteps({
    baseIds,
    lookupError: input.lookupError,
    lookupMatch,
    outboxRecord,
    sourceSignal: input.sourceSignal,
    trace,
    traceReadFailed,
  });
  const summary = summarizeWakeTraceWaterfall({
    lookupMatch,
    outboxRecord,
    sourceSignal: input.sourceSignal,
    steps,
    trace,
  });
  const canViewLocalOriginFacts = canViewWakeTargetLocalOriginFacts({
    input,
    outboxRecord,
    targetProfileId,
    trace,
  });
  const correlation = projectWakeTraceWaterfallCorrelation({
    dispatchId,
    input,
    lookupMatch,
    outboxRecord,
    sourceSignalId,
    targetProfileId,
    trace,
  });
  const executionContext = projectWakeTargetExecutionContext({
    lookupMatch,
    outboxRecord,
    trace,
  });
  const shouldRedactLocalOriginFacts =
    !canViewLocalOriginFacts &&
    hasWakeTargetSensitiveLocalFacts({ correlation, executionContext });

  return {
    targetProfileId,
    targetLabel,
    correlation: shouldRedactLocalOriginFacts
      ? redactWakeCorrelationLocalOriginFacts(correlation)
      : correlation,
    executionContext: shouldRedactLocalOriginFacts
      ? redactWakeExecutionContextLocalOriginFacts(executionContext)
      : executionContext,
    summary,
    steps,
  };
}

function canViewWakeTargetLocalOriginFacts(input: {
  input: ProjectWakeTraceWaterfallInput;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  targetProfileId: string;
  trace: SpaceDispatchTraceSnapshot | null;
}): boolean {
  return canViewAgentLocalOriginFacts({
    ...input.input.agentLocalOriginFactsViewer,
    targetProfileId: input.targetProfileId,
    targetOwnerUserId: resolveWakeTargetOwnerUserId({
      input: input.input,
      outboxRecord: input.outboxRecord,
      targetProfileId: input.targetProfileId,
      trace: input.trace,
    }),
  });
}

function resolveWakeTargetOwnerUserId(input: {
  input: ProjectWakeTraceWaterfallInput;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  targetProfileId: string;
  trace: SpaceDispatchTraceSnapshot | null;
}): string | null {
  if (input.trace?.dispatch.owner?.kind === "owner_account") {
    return input.trace.dispatch.owner.id;
  }
  if (input.outboxRecord?.dispatchOwner?.kind === "owner_account") {
    return input.outboxRecord.dispatchOwner.id;
  }
  return (
    input.input.targetOwnerUserIdByProfileId?.get(input.targetProfileId) ?? null
  );
}

function projectWakeTraceWaterfallCorrelation(input: {
  dispatchId: string | null;
  input: ProjectWakeTraceWaterfallInput;
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  sourceSignalId: string | null;
  targetProfileId: string;
  trace: SpaceDispatchTraceSnapshot | null;
}): ObservabilityWakeCorrelation {
  return projectObservabilityWakeCorrelation({
    selector: buildWakeTraceWaterfallSelector({
      clientMessageId: input.input.clientMessageId,
      sourceSignalId: input.sourceSignalId,
      spaceId: input.input.spaceId,
      targetProfileId: input.targetProfileId,
    }),
    spaceId: input.input.spaceId,
    clientMessageId: input.input.clientMessageId,
    sourceSignalId: input.sourceSignalId,
    targetProfileId: input.targetProfileId,
    dispatchId: input.dispatchId,
    facts: {
      dispatch:
        input.trace?.dispatch ??
        buildDispatchCorrelationFact({
          clientMessageId: input.input.clientMessageId,
          lookupMatch: input.lookupMatch,
          outboxRecord: input.outboxRecord,
        }),
      latestAttempt:
        input.trace?.latestAttempt ??
        buildLatestAttemptCorrelationFact(input.lookupMatch),
      coordinatorExecution: input.trace?.runtimeCoordinatorExecution
        ? {
            bindingId: input.trace.runtimeCoordinatorExecution.bindingId,
            agentControllerRef:
              input.trace.runtimeCoordinatorExecution.agentControllerRef,
            dispatchId: input.trace.runtimeCoordinatorExecution.dispatchId,
            runtimeCoordinatorExecutionId:
              input.trace.runtimeCoordinatorExecution
                .runtimeCoordinatorExecutionId,
            openMeldServiceRuntimeId:
              input.trace.runtimeCoordinatorExecution.openMeldServiceRuntimeId
                .value,
            sourceClientMessageId:
              input.trace.runtimeCoordinatorExecution.sourceClientMessageId,
            targetProfileId:
              input.trace.runtimeCoordinatorExecution.targetProfileId,
          }
        : null,
      result: input.trace?.result ?? null,
      replySignal: input.trace?.replySignal ?? null,
    },
    claimLeaseId: null,
    bindingId:
      input.trace?.runtimeCoordinatorExecution?.bindingId ??
      input.trace?.executionIdentity?.core.bindingId ??
      null,
    openMeldServiceRuntimeId:
      input.trace?.runtimeCoordinatorExecution?.openMeldServiceRuntimeId
        .value ??
      input.trace?.executionIdentity?.core.openMeldServiceRuntimeId.value ??
      null,
    agentControllerRef:
      input.trace?.runtimeCoordinatorExecution?.agentControllerRef ??
      input.trace?.executionIdentity?.core.agentControllerRef ??
      null,
  });
}

function redactWakeCorrelationLocalOriginFacts(
  correlation: ObservabilityWakeCorrelation
): ObservabilityWakeCorrelation {
  return {
    ...correlation,
    bindingId: null,
    openMeldServiceRuntimeId: null,
  };
}

function redactWakeExecutionContextLocalOriginFacts(
  context: WakeTargetExecutionContext
): WakeTargetExecutionContext {
  return {
    ...context,
    ...(context.taskContext
      ? {
          taskContext: {
            ...context.taskContext,
            assignment:
              context.taskContext.assignment.readStatus === "found"
                ? { ...context.taskContext.assignment, contextId: null }
                : context.taskContext.assignment,
          },
        }
      : {}),
    resolutionStatus: "redacted",
    reasonCode: "wake_execution_context.local_origin_facts_redacted",
    bindingId: null,
    openMeldServiceRuntimeId: null,
    agentControllerConversationId: null,
    agentControllerConversationKind: null,
    runtimeWorkspacePath: null,
    runtimeWorkspaceFingerprint: null,
  };
}

function hasWakeTargetSensitiveLocalFacts(input: {
  correlation: ObservabilityWakeCorrelation;
  executionContext: WakeTargetExecutionContext;
}): boolean {
  return Boolean(
    (input.executionContext.taskContext?.assignment.readStatus === "found" &&
      input.executionContext.taskContext.assignment.contextId) ||
      input.correlation.bindingId ||
      input.correlation.openMeldServiceRuntimeId ||
      input.executionContext.bindingId ||
      input.executionContext.openMeldServiceRuntimeId ||
      input.executionContext.agentControllerConversationId ||
      input.executionContext.agentControllerConversationKind ||
      input.executionContext.runtimeWorkspacePath ||
      input.executionContext.runtimeWorkspaceFingerprint
  );
}

function buildWakeTraceWaterfallSelector(input: {
  clientMessageId: string | null;
  sourceSignalId: string | null;
  spaceId: string;
  targetProfileId: string;
}):
  | {
      kind: "client_message";
      spaceId: string;
      clientMessageId: string;
      targetProfileId: string;
    }
  | {
      kind: "source_signal";
      spaceId: string;
      sourceSignalId: string;
      targetProfileId: string;
    } {
  if (input.clientMessageId) {
    return {
      kind: "client_message",
      spaceId: input.spaceId,
      clientMessageId: input.clientMessageId,
      targetProfileId: input.targetProfileId,
    };
  }
  if (input.sourceSignalId) {
    return {
      kind: "source_signal",
      spaceId: input.spaceId,
      sourceSignalId: input.sourceSignalId,
      targetProfileId: input.targetProfileId,
    };
  }
  throw new Error("Wake trace waterfall selector is required");
}

function projectWakeTargetExecutionContext(input: {
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  trace: SpaceDispatchTraceSnapshot | null;
}): WakeTargetExecutionContext {
  const origin = input.trace?.origin ?? null;
  const agentControllerConversationId =
    origin?.resolvedAgentControllerConversationId ??
    origin?.agentControllerConversationId ??
    null;
  const runtimeWorkspacePath = origin?.effectiveRuntimeWorkingDirectory ?? null;
  const runtimeWorkspaceFingerprint =
    origin?.runtimeWorkspaceFingerprint ?? null;
  const bindingId =
    input.trace?.runtimeCoordinatorExecution?.bindingId ??
    input.trace?.executionIdentity?.core.bindingId ??
    null;
  const openMeldServiceRuntimeId =
    input.trace?.runtimeCoordinatorExecution?.openMeldServiceRuntimeId.value ??
    input.trace?.executionIdentity?.core.openMeldServiceRuntimeId.value ??
    null;
  const agentControllerRef =
    origin?.agentControllerRef ??
    input.trace?.runtimeCoordinatorExecution?.agentControllerRef ??
    input.trace?.executionIdentity?.core.agentControllerRef ??
    null;
  const factSource = resolveWakeTargetExecutionContextFactSource(input);
  const hasObservedRuntimeContext = Boolean(
    agentControllerConversationId ||
      runtimeWorkspacePath ||
      runtimeWorkspaceFingerprint
  );
  let resolutionStatus: WakeTargetExecutionContext["resolutionStatus"];
  if (hasObservedRuntimeContext) {
    resolutionStatus = "resolved";
  } else if (hasWakeTargetLocalExecutionEvidence(input.trace)) {
    resolutionStatus = "not_resolved";
  } else {
    resolutionStatus = "not_started";
  }

  return {
    ...(input.trace?.runtimeCoordinatorHeadLifecycle?.executionContext
      ? {
          taskContext: {
            assignment:
              input.trace.runtimeCoordinatorHeadLifecycle.executionContext,
            conversationResume:
              input.trace.dispatchExecution
                ?.agentControllerConversationResume ?? null,
          },
        }
      : {}),
    resolutionStatus,
    factSource,
    reasonCode: resolveWakeTargetExecutionContextReasonCode({
      factSource,
      resolutionStatus,
    }),
    bindingId,
    openMeldServiceRuntimeId,
    agentControllerRef,
    agentControllerConversationId,
    agentControllerConversationKind:
      origin?.agentControllerConversationKind ?? null,
    runtimeWorkspacePath,
    runtimeWorkspaceFingerprint,
  };
}

function resolveWakeTargetExecutionContextFactSource(input: {
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  trace: SpaceDispatchTraceSnapshot | null;
}): WakeTargetExecutionContext["factSource"] {
  if (input.trace?.origin) {
    return "dispatch_trace_origin";
  }
  if (input.trace?.runtimeCoordinatorExecution) {
    return "runtime_coordinator_execution";
  }
  if (input.trace?.executionIdentity) {
    return "dispatch_attempt_execution_identity";
  }
  if (input.trace?.dispatch || input.lookupMatch || input.outboxRecord) {
    return "dispatch_record";
  }
  return "none";
}

function hasWakeTargetLocalExecutionEvidence(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  return Boolean(
    trace?.origin ||
      trace?.runtimeCoordinatorExecution ||
      trace?.executionIdentity
  );
}

function resolveWakeTargetExecutionContextReasonCode(input: {
  factSource: WakeTargetExecutionContext["factSource"];
  resolutionStatus: WakeTargetExecutionContext["resolutionStatus"];
}): string | null {
  switch (input.resolutionStatus) {
    case "resolved":
    case "redacted":
      return null;
    case "not_resolved":
      return "wake_execution_context.local_runtime_context_not_observed";
    case "not_started":
      return input.factSource === "none"
        ? "wake_execution_context.dispatch_not_found"
        : "wake_execution_context.local_execution_not_started";
    default:
      return assertNever(input.resolutionStatus);
  }
}

function buildWakeTraceWaterfallSteps(input: {
  baseIds: WakeTraceWaterfallStepIds;
  lookupError: unknown | null;
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  sourceSignal: WakeTraceWaterfallSourceSignalFact | null;
  trace: SpaceDispatchTraceSnapshot | null;
  traceReadFailed: boolean;
}): WakeTraceWaterfallStep[] {
  return WATERFALL_STEP_NAMES.map((name, order) => {
    switch (name) {
      case "source_signal":
        return buildSourceSignalStep(input, order);
      case "planner":
        return buildPlannerStep(input, order);
      case "dispatch":
        return buildDispatchStep(input, order);
      case "head_lifecycle":
        return buildHeadLifecycleStep(input, order);
      case "attempt":
        return buildAttemptStep(input, order);
      case "result_inbox":
        return buildResultInboxStep(input, order);
      case "result":
        return buildResultStep(input, order);
      case "reply_signal":
        return buildReplySignalStep(input, order);
      default:
        return assertNever(name);
    }
  });
}

function buildSourceSignalStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    sourceSignal: WakeTraceWaterfallSourceSignalFact | null;
  },
  order: number
): WakeTraceWaterfallStep {
  if (!input.sourceSignal) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "source_signal",
      order,
      status: "missing",
      reasonCode: "wake_trace.source_signal_not_found",
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "source_signal",
    order,
    status: "found",
    factSource: input.sourceSignal.factSource,
    observedAt: timestampMsToIso(input.sourceSignal.observedAtMs),
    ids: { sourceSignalId: input.sourceSignal.signalId },
  });
}

function buildPlannerStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    lookupError: unknown | null;
    lookupMatch: SpaceDispatchLookupMatch | null;
    outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
    sourceSignal: WakeTraceWaterfallSourceSignalFact | null;
  },
  order: number
): WakeTraceWaterfallStep {
  if (input.outboxRecord) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "planner",
      order,
      status: "found",
      factSource: "dispatch_outbox",
      observedAt: timestampMsToIso(
        input.outboxRecord.handedOffAtMs ?? input.outboxRecord.createdAtMs
      ),
      ids: {
        dispatchId: input.outboxRecord.dispatchId,
        sourceSignalId: input.outboxRecord.sourceEventId,
      },
    });
  }

  if (input.lookupMatch) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "planner",
      order,
      status: "found",
      factSource: "dispatch_lookup",
      ids: {
        dispatchId: input.lookupMatch.dispatchId,
        sourceSignalId: input.lookupMatch.sourceSignalId,
      },
    });
  }

  if (input.lookupError) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "planner",
      order,
      status: "failed",
      factSource: "lookup_error",
      reasonCode: "dispatch.storage_unavailable",
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "planner",
    order,
    status: input.sourceSignal ? "missing" : "not_applicable",
    reasonCode: input.sourceSignal
      ? "wake_trace.planner_output_not_found"
      : "wake_trace.source_signal_not_found",
  });
}

function buildDispatchStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    lookupError: unknown | null;
    lookupMatch: SpaceDispatchLookupMatch | null;
    outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
    trace: SpaceDispatchTraceSnapshot | null;
    traceReadFailed: boolean;
  },
  order: number
): WakeTraceWaterfallStep {
  if (input.trace?.dispatch) {
    const runtimeCoordinatorHasExecutionAuthority =
      hasRuntimeCoordinatorExecutionAuthority(input.trace);
    const legacyTerminalDiagnostic =
      runtimeCoordinatorHasExecutionAuthority &&
      isTerminalFailedDispatchStatus(input.trace.dispatch.status);
    const dispatchStepStatus = legacyTerminalDiagnostic
      ? "found"
      : resolveDispatchWaterfallStepStatus(input.trace.dispatch.status);
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "dispatch",
      order,
      status: dispatchStepStatus,
      factSource: "dispatch_ledger",
      observedAt: input.trace.dispatch.firstSeenAt,
      reasonCode: legacyTerminalDiagnostic
        ? "dispatch.legacy_transport_terminal_diagnostic_only"
        : resolveDispatchStatusReasonCode(
            input.trace.dispatch.status,
            dispatchStepStatus
          ),
      ids: {
        dispatchId: input.trace.dispatch.dispatchId,
        sourceSignalId: input.trace.dispatch.sourceEventId,
      },
    });
  }

  if (input.lookupMatch) {
    const lookupDispatchStepStatus = resolveDispatchWaterfallStepStatus(
      input.lookupMatch.status
    );
    const lookupDispatchReasonCode = input.traceReadFailed
      ? "wake_trace.dispatch_trace_unavailable"
      : resolveDispatchStatusReasonCode(
          input.lookupMatch.status,
          lookupDispatchStepStatus
        );
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "dispatch",
      order,
      status: input.traceReadFailed ? "degraded" : lookupDispatchStepStatus,
      factSource: "dispatch_lookup",
      reasonCode: lookupDispatchReasonCode,
      ids: {
        dispatchId: input.lookupMatch.dispatchId,
        sourceSignalId: input.lookupMatch.sourceSignalId,
      },
    });
  }

  if (input.lookupError) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "dispatch",
      order,
      status: "degraded",
      factSource: "lookup_error",
      observedAt: timestampMsToIso(
        input.outboxRecord?.handedOffAtMs ?? input.outboxRecord?.createdAtMs
      ),
      reasonCode: "dispatch.storage_unavailable",
      ids: {
        dispatchId: input.outboxRecord?.dispatchId ?? null,
        sourceSignalId: input.outboxRecord?.sourceEventId ?? null,
      },
    });
  }

  if (input.outboxRecord) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "dispatch",
      order,
      status: "pending",
      factSource: "dispatch_outbox",
      observedAt: timestampMsToIso(
        input.outboxRecord.handedOffAtMs ?? input.outboxRecord.createdAtMs
      ),
      reasonCode: "dispatch.not_persisted_yet",
      ids: {
        dispatchId: input.outboxRecord.dispatchId,
        sourceSignalId: input.outboxRecord.sourceEventId,
      },
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "dispatch",
    order,
    status: input.lookupError ? "failed" : "missing",
    factSource: input.lookupError ? "lookup_error" : null,
    reasonCode: input.lookupError
      ? "dispatch.storage_unavailable"
      : "wake_trace.dispatch_not_found",
  });
}

function buildHeadLifecycleStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    lookupMatch: SpaceDispatchLookupMatch | null;
    trace: SpaceDispatchTraceSnapshot | null;
    traceReadFailed: boolean;
  },
  order: number
): WakeTraceWaterfallStep {
  const headLifecycle = input.trace?.runtimeCoordinatorHeadLifecycle ?? null;
  if (headLifecycle?.readStatus === "found") {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "head_lifecycle",
      order,
      status: "found",
      factSource: "runtime_coordinator_head_lifecycle",
      observedAt: headLifecycle.updatedAt,
      reasonCode: resolveHeadLifecycleReasonCode(headLifecycle),
      ids: {
        dispatchId: headLifecycle.primaryDispatchId,
        targetWakeLifecycleId: headLifecycle.targetWakeLifecycleId,
      },
    });
  }

  if (headLifecycle?.readStatus === "authority_unavailable") {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "head_lifecycle",
      order,
      status: "degraded",
      factSource: "runtime_coordinator_head_lifecycle",
      reasonCode: headLifecycle.reasonCode,
      ids: {
        targetWakeLifecycleId: headLifecycle.targetWakeLifecycleId,
      },
    });
  }

  if (headLifecycle?.readStatus === "missing") {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "head_lifecycle",
      order,
      status: "missing",
      factSource: "runtime_coordinator_head_lifecycle",
      reasonCode: headLifecycle.reasonCode,
      ids: {
        targetWakeLifecycleId: headLifecycle.targetWakeLifecycleId,
      },
    });
  }

  if (input.traceReadFailed) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "head_lifecycle",
      order,
      status: "degraded",
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    });
  }

  if (input.lookupMatch) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "head_lifecycle",
      order,
      status: "missing",
      reasonCode: "runtime_coordinator.head_lifecycle_not_found",
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "head_lifecycle",
    order,
    status: "not_applicable",
    reasonCode: "dispatch.not_available",
  });
}

function resolveHeadLifecycleReasonCode(
  headLifecycle: Extract<
    NonNullable<SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]>,
    { readStatus: "found" }
  >
): string | null {
  if (headLifecycle.publicationIntent) {
    return "runtime_coordinator.head_publication_intent_ready";
  }
  if (headLifecycle.noExecutionDecision) {
    return headLifecycle.noExecutionDecision.reasonCode;
  }
  if (headLifecycle.waitingBoundary) {
    return headLifecycle.waitingBoundary.reasonCode;
  }
  if (headLifecycle.status === "execution_linked") {
    return "runtime_coordinator.head_execution_linked";
  }
  if (headLifecycle.status === "accepted") {
    return "runtime_coordinator.head_accepted";
  }
  return null;
}

function buildAttemptStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    lookupMatch: SpaceDispatchLookupMatch | null;
    trace: SpaceDispatchTraceSnapshot | null;
  },
  order: number
): WakeTraceWaterfallStep {
  if (input.trace?.latestAttempt) {
    const runtimeCoordinatorHasExecutionAuthority =
      hasRuntimeCoordinatorExecutionAuthority(input.trace);
    const legacyTerminalDiagnostic =
      runtimeCoordinatorHasExecutionAuthority &&
      isTerminalFailedAttemptStatus(input.trace.latestAttempt.status);
    const attemptStepStatus = legacyTerminalDiagnostic
      ? "found"
      : resolveAttemptWaterfallStepStatus(input.trace.latestAttempt.status);
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "attempt",
      order,
      status: attemptStepStatus,
      factSource: "dispatch_attempt",
      observedAt:
        input.trace.latestAttempt.finishedAt ??
        input.trace.latestAttempt.startedAt ??
        input.trace.latestAttempt.createdAt,
      reasonCode: legacyTerminalDiagnostic
        ? "attempt.legacy_transport_terminal_diagnostic_only"
        : (input.trace.latestAttempt.errorCode ??
          (input.trace.latestAttempt.status === "failed_retryable" ||
          attemptStepStatus === "failed"
            ? `attempt.${input.trace.latestAttempt.status}`
            : null)),
      ids: { attemptId: input.trace.latestAttempt.attemptId },
    });
  }

  if (input.lookupMatch?.latestAttemptId) {
    const status = resolveAttemptWaterfallStepStatus(
      input.lookupMatch.latestAttemptStatus
    );
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "attempt",
      order,
      status,
      factSource: "dispatch_lookup",
      reasonCode:
        input.lookupMatch.latestAttemptErrorCode ??
        (input.lookupMatch.latestAttemptStatus === "failed_retryable" ||
        status === "failed"
          ? `attempt.${input.lookupMatch.latestAttemptStatus}`
          : null),
      ids: { attemptId: input.lookupMatch.latestAttemptId },
    });
  }

  if (input.lookupMatch) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "attempt",
      order,
      status: "pending",
      factSource: "dispatch_lookup",
      reasonCode: "attempt.not_started_yet",
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "attempt",
    order,
    status: "not_applicable",
    reasonCode: "dispatch.not_available",
  });
}

function resolveAttemptWaterfallStepStatus(
  status: string | null | undefined
): WakeTraceWaterfallStepStatus {
  if (status === "failed_retryable") {
    return "pending";
  }
  return isTerminalFailedAttemptStatus(status) ? "failed" : "found";
}

function resolveDispatchWaterfallStepStatus(
  status: string
): WakeTraceWaterfallStepStatus {
  if (status === "failed_retryable") {
    return "pending";
  }
  return isTerminalFailedDispatchStatus(status) ? "failed" : "found";
}

function resolveDispatchStatusReasonCode(
  status: string,
  waterfallStatus: WakeTraceWaterfallStepStatus
): string | null {
  if (status === "failed_retryable" || waterfallStatus === "failed") {
    return `dispatch.${status}`;
  }
  return null;
}

function buildResultInboxStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    lookupMatch: SpaceDispatchLookupMatch | null;
    trace: SpaceDispatchTraceSnapshot | null;
  },
  order: number
): WakeTraceWaterfallStep {
  if (input.trace?.resultInbox) {
    const failed = isTerminalResultInboxPublishState(
      input.trace.resultInbox.publishState
    );
    const legacyTerminalDiagnostic =
      failed && hasRuntimeCoordinatorPreResultAuthority(input.trace);
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result_inbox",
      order,
      status: legacyTerminalDiagnostic || !failed ? "found" : "failed",
      factSource: "dispatch_result_inbox",
      observedAt: input.trace.resultInbox.updatedAt,
      reasonCode: resolveResultInboxStepReasonCode({
        failed,
        legacyTerminalDiagnostic,
        resultInbox: input.trace.resultInbox,
      }),
      ids: {
        attemptId: input.trace.resultInbox.attemptId,
        resultKey: input.trace.resultInbox.resultKey,
        publishedSignalId: input.trace.resultInbox.publishedSignalId,
      },
    });
  }

  if (hasRuntimeCoordinatorHeadNoExecution(input.trace)) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result_inbox",
      order,
      status: "not_applicable",
      reasonCode: "runtime_coordinator.head_no_execution",
    });
  }

  if (isExecutionInProgress(input.trace)) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result_inbox",
      order,
      status: "pending",
      reasonCode: "result_inbox.waiting_for_runtime_result",
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "result_inbox",
    order,
    status: terminalFailureBeforeResult(input.lookupMatch, input.trace)
      ? "not_applicable"
      : "pending",
    reasonCode: terminalFailureBeforeResult(input.lookupMatch, input.trace)
      ? "attempt.failed_before_result"
      : "result_inbox.not_observed_yet",
  });
}

function buildResultStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    trace: SpaceDispatchTraceSnapshot | null;
  },
  order: number
): WakeTraceWaterfallStep {
  if (input.trace?.result) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result",
      order,
      status: "found",
      factSource: "dispatch_result",
      observedAt: input.trace.result.createdAt,
      ids: {
        resultRef: input.trace.result.resultRef,
        publishedSignalId: input.trace.result.publishedSignalId,
      },
    });
  }

  if (hasRuntimeCoordinatorHeadNoExecution(input.trace)) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result",
      order,
      status: "not_applicable",
      reasonCode: "runtime_coordinator.head_no_execution",
    });
  }

  const resultInbox = input.trace?.resultInbox ?? null;
  if (resultInbox?.publishState === "late_result_available") {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result",
      order,
      status: "found",
      factSource: "dispatch_result_inbox",
      observedAt: resultInbox.updatedAt,
      reasonCode: "result_inbox.late_result_available",
      ids: {
        attemptId: resultInbox.attemptId,
        resultKey: resultInbox.resultKey,
      },
    });
  }
  if (
    resultInbox &&
    isTerminalResultInboxPublishState(resultInbox.publishState) &&
    hasRuntimeCoordinatorPreResultAuthority(input.trace)
  ) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result",
      order,
      status: "not_applicable",
      reasonCode: "result_inbox.legacy_terminal_diagnostic_only",
    });
  }
  if (
    resultInbox &&
    isTerminalResultInboxPublishState(resultInbox.publishState)
  ) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "result",
      order,
      status: "not_applicable",
      reasonCode: `result_inbox.${resultInbox.publishState}`,
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "result",
    order,
    status: input.trace?.resultInbox ? "pending" : "not_applicable",
    reasonCode: input.trace?.resultInbox
      ? "result.not_observed_yet"
      : "result_inbox.not_available",
  });
}

function buildReplySignalStep(
  input: {
    baseIds: WakeTraceWaterfallStepIds;
    trace: SpaceDispatchTraceSnapshot | null;
  },
  order: number
): WakeTraceWaterfallStep {
  const lateResultStep = buildLateResultReplySignalStep({
    baseIds: input.baseIds,
    order,
    resultInbox: input.trace?.resultInbox ?? null,
  });
  if (lateResultStep) {
    return lateResultStep;
  }

  if (input.trace?.finalVisibleMessage) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "found",
      factSource: input.trace.finalVisibleMessage.factSource,
      observedAt: input.trace.finalVisibleMessage.createdAt,
      reasonCode: formatFinalVisibleMessageWaterfallReasonCode(
        input.trace.finalVisibleMessage
      ),
      ids: {
        publishedSignalId: input.trace.finalVisibleMessage.signalId,
        replySignalId:
          input.trace.finalVisibleMessage.signalType === "signal.text"
            ? input.trace.finalVisibleMessage.signalId
            : null,
      },
    });
  }

  const finalVisibleOutcome = input.trace
    ? projectSpaceDispatchTraceFinalVisibleOutcome(input.trace)
    : null;
  if (finalVisibleOutcome) {
    const step = buildFinalVisibleOutcomeReplySignalStep({
      baseIds: input.baseIds,
      finalVisibleOutcome,
      order,
      trace: input.trace,
    });
    if (step) {
      return step;
    }
  }

  if (input.trace?.replySignal) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "degraded",
      factSource: input.trace.replySignal.factSource,
      observedAt: input.trace.replySignal.createdAt,
      reasonCode: "final_visible_outcome.not_claimed",
      ids: { replySignalId: input.trace.replySignal.signalId },
    });
  }

  const headPublicationIntentReasonCode =
    resolveRuntimeCoordinatorHeadPublicationIntentReasonCode(input.trace);
  if (headPublicationIntentReasonCode) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "pending",
      factSource: "runtime_coordinator_head_lifecycle",
      reasonCode: "runtime_coordinator.head_publication_intent_ready",
    });
  }

  const resultInbox = input.trace?.resultInbox ?? null;
  if (
    resultInbox &&
    isTerminalResultInboxPublishState(resultInbox.publishState) &&
    hasRuntimeCoordinatorPreResultAuthority(input.trace)
  ) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "pending",
      reasonCode: "result_inbox.waiting_for_runtime_result",
    });
  }
  if (
    resultInbox &&
    isTerminalResultInboxPublishState(resultInbox.publishState)
  ) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "failed",
      factSource: "dispatch_result_inbox",
      observedAt: resultInbox.updatedAt,
      reasonCode:
        resultInbox.publicationErrorCode ??
        `reply_signal.${resultInbox.publishState}`,
      ids: {
        publishedSignalId: resultInbox.publishedSignalId,
      },
    });
  }

  if (input.trace?.result?.publishedSignalId) {
    return createWakeTraceWaterfallStep({
      baseIds: input.baseIds,
      name: "reply_signal",
      order,
      status: "degraded",
      factSource: "dispatch_result",
      observedAt: input.trace.result.createdAt,
      reasonCode: "reply_signal.not_found",
      ids: {
        publishedSignalId: input.trace.result.publishedSignalId,
      },
    });
  }

  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "reply_signal",
    order,
    status: input.trace?.result ? "pending" : "not_applicable",
    reasonCode: input.trace?.result
      ? "reply_signal.not_published_yet"
      : "result.not_available",
  });
}

function resolveResultInboxStepReasonCode(input: {
  failed: boolean;
  legacyTerminalDiagnostic: boolean;
  resultInbox: NonNullable<SpaceDispatchTraceSnapshot["resultInbox"]>;
}): string | null {
  if (input.legacyTerminalDiagnostic) {
    return "result_inbox.legacy_terminal_diagnostic_only";
  }
  if (input.resultInbox.publishState === "late_result_available") {
    return "result_inbox.late_result_available";
  }
  if (input.resultInbox.publicationErrorCode) {
    return input.resultInbox.publicationErrorCode;
  }
  return input.failed ? `result_inbox.${input.resultInbox.publishState}` : null;
}

function buildLateResultReplySignalStep(input: {
  baseIds: WakeTraceWaterfallStepIds;
  order: number;
  resultInbox: SpaceDispatchTraceSnapshot["resultInbox"];
}): WakeTraceWaterfallStep | null {
  if (input.resultInbox?.publishState !== "late_result_available") {
    return null;
  }
  return createWakeTraceWaterfallStep({
    baseIds: input.baseIds,
    name: "reply_signal",
    order: input.order,
    status: input.resultInbox.publishedSignalId ? "found" : "pending",
    factSource: "dispatch_result_inbox",
    observedAt: input.resultInbox.updatedAt,
    reasonCode: input.resultInbox.publishedSignalId
      ? "reply_signal.late_result_recovery_notice"
      : "reply_signal.late_result_recovery_notice_pending",
    ids: {
      publishedSignalId: input.resultInbox.publishedSignalId,
    },
  });
}

function buildFinalVisibleOutcomeReplySignalStep(input: {
  baseIds: WakeTraceWaterfallStepIds;
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome;
  order: number;
  trace: SpaceDispatchTraceSnapshot | null;
}): WakeTraceWaterfallStep | null {
  switch (input.finalVisibleOutcome.status) {
    case "visible_reply":
    case "visible_failure":
    case "visible_stopped":
    case "not_applicable":
      return null;
    case "publication_pending":
    case "publication_retrying":
      return createWakeTraceWaterfallStep({
        baseIds: input.baseIds,
        name: "reply_signal",
        order: input.order,
        status: "pending",
        factSource: resolveFinalVisibleOutcomeWaterfallFactSource(
          input.finalVisibleOutcome
        ),
        reasonCode: input.finalVisibleOutcome.reasonCode,
        ids: buildFinalVisibleOutcomeWaterfallIds(input),
      });
    case "publication_unresolved":
      return createWakeTraceWaterfallStep({
        baseIds: input.baseIds,
        name: "reply_signal",
        order: input.order,
        status: "failed",
        factSource: resolveFinalVisibleOutcomeWaterfallFactSource(
          input.finalVisibleOutcome
        ),
        reasonCode: input.finalVisibleOutcome.reasonCode,
        ids: buildFinalVisibleOutcomeWaterfallIds(input),
      });
    default:
      return assertNever(input.finalVisibleOutcome.status);
  }
}

function buildFinalVisibleOutcomeWaterfallIds(input: {
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome;
  trace: SpaceDispatchTraceSnapshot | null;
}): Partial<WakeTraceWaterfallStepIds> {
  return {
    publishedSignalId:
      input.finalVisibleOutcome.signalId ??
      input.trace?.result?.publishedSignalId ??
      input.trace?.resultInbox?.publishedSignalId ??
      null,
    replySignalId: null,
  };
}

function resolveFinalVisibleOutcomeWaterfallFactSource(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome
): WakeTraceWaterfallFactSource | null {
  switch (finalVisibleOutcome.sourceFact) {
    case "final_visible_message":
      return "space_signal_by_published_signal_id";
    case "result_inbox":
      return "dispatch_result_inbox";
    case "runtime_coordinator_head_lifecycle":
      return "runtime_coordinator_head_lifecycle";
    case "dispatch_result":
      return "dispatch_result";
    case "runtime_coordinator_execution":
    case "runtime_coordinator_event":
    case "none":
      return null;
    default:
      return assertNever(finalVisibleOutcome.sourceFact);
  }
}

function formatFinalVisibleMessageWaterfallReasonCode(
  finalVisibleMessage: NonNullable<
    NonNullable<SpaceDispatchTraceSnapshot["finalVisibleMessage"]>
  >
): string | null {
  if (finalVisibleMessage.signalType === "signal.system_notice") {
    switch (finalVisibleMessage.noticeType) {
      case "terminal_failure":
        return "final_visible_message.terminal_failure_notice";
      case "policy_blocked":
        return "final_visible_message.policy_blocked_notice";
      case "stay_silent":
        return "final_visible_message.stay_silent_notice";
      case "wake_stopped":
        return "final_visible_message.wake_stopped_notice";
      case null:
        return null;
      default:
        return assertNever(finalVisibleMessage.noticeType);
    }
  }
  if (finalVisibleMessage.signalType === "signal.status") {
    return "final_visible_message.status";
  }
  return null;
}

function isTerminalResultInboxPublishState(
  publishState:
    | NonNullable<SpaceDispatchTraceSnapshot["resultInbox"]>["publishState"]
    | null
    | undefined
): boolean {
  return (
    publishState === "reply_publication_failed" ||
    publishState === "reply_suppressed_stopped" ||
    publishState === "invalid_space_action" ||
    publishState === "legacy_result_quarantined"
  );
}

function createWakeTraceWaterfallStep(input: {
  baseIds: WakeTraceWaterfallStepIds;
  factSource?: WakeTraceWaterfallFactSource | null;
  ids?: Partial<WakeTraceWaterfallStepIds>;
  name: WakeTraceWaterfallStepName;
  observedAt?: string | null;
  order: number;
  reasonCode?: string | null;
  status: WakeTraceWaterfallStepStatus;
}): WakeTraceWaterfallStep {
  return {
    order: input.order,
    name: input.name,
    status: input.status,
    factSource: input.factSource ?? null,
    observedAt: input.observedAt ?? null,
    reasonCode: input.reasonCode ?? null,
    ids: {
      ...input.baseIds,
      ...input.ids,
    },
  };
}

function summarizeWakeTraceWaterfall(input: {
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  sourceSignal: WakeTraceWaterfallSourceSignalFact | null;
  steps: readonly WakeTraceWaterfallStep[];
  trace: SpaceDispatchTraceSnapshot | null;
}): {
  status: WakeTraceWaterfallSummaryStatus;
  terminalStep: WakeTraceWaterfallStepName | null;
  reasonCode: string | null;
} {
  const finalVisibleOutcome = input.trace
    ? projectSpaceDispatchTraceFinalVisibleOutcome(input.trace)
    : null;
  if (finalVisibleOutcome) {
    const finalVisibleOutcomeSummary =
      summarizeFinalVisibleOutcomeWaterfall(finalVisibleOutcome);
    if (finalVisibleOutcomeSummary) {
      return finalVisibleOutcomeSummary;
    }
  }

  const replyStep = input.steps.find((step) => step.name === "reply_signal");
  if (replyStep?.status === "found") {
    return {
      status: "replied",
      terminalStep: "reply_signal",
      reasonCode: null,
    };
  }

  const retryableRuntimeCoordinatorFailure =
    resolveRuntimeCoordinatorRetryableFailureReasonCode(input.trace);
  if (retryableRuntimeCoordinatorFailure) {
    return {
      status: "pending",
      terminalStep: null,
      reasonCode: retryableRuntimeCoordinatorFailure,
    };
  }

  const missingRuntimeCoordinatorAuthority =
    resolveRuntimeCoordinatorMissingAuthorityReasonCode(input.trace);
  if (missingRuntimeCoordinatorAuthority) {
    return {
      status: "pending",
      terminalStep: null,
      reasonCode: missingRuntimeCoordinatorAuthority,
    };
  }

  const preExecutionNoExecutionEvidence =
    resolvePreExecutionNoExecutionEvidenceReasonCode(input.trace);
  if (preExecutionNoExecutionEvidence) {
    return {
      status: "pending",
      terminalStep: null,
      reasonCode: preExecutionNoExecutionEvidence,
    };
  }

  const runtimeCoordinatorHeadPendingReason =
    resolveRuntimeCoordinatorHeadPendingReasonCode(input.trace);
  if (runtimeCoordinatorHeadPendingReason) {
    return {
      status: "pending",
      terminalStep: null,
      reasonCode: runtimeCoordinatorHeadPendingReason,
    };
  }

  const runtimeCoordinatorTerminalFailure =
    resolveRuntimeCoordinatorTerminalFailureReasonCode(input.trace);
  if (runtimeCoordinatorTerminalFailure) {
    return {
      status: "failed",
      terminalStep: null,
      reasonCode: runtimeCoordinatorTerminalFailure,
    };
  }

  const projectedRootCause = input.trace
    ? projectSpaceDispatchTraceRootCause(input.trace)
    : null;
  if (
    projectedRootCause &&
    projectedRootCause.reasonCode !== "reply.delivered" &&
    projectedRootCause.reasonCode !== "reply.not_found" &&
    shouldUseProjectedRootCauseBeforeStepFallback(input.trace)
  ) {
    return {
      status: "failed",
      terminalStep: null,
      reasonCode: projectedRootCause.reasonCode,
    };
  }

  const failedStep = input.steps.find(
    (step) => step.status === "failed" || step.status === "degraded"
  );
  if (failedStep) {
    return {
      status: "failed",
      terminalStep: failedStep.name,
      reasonCode: failedStep.reasonCode,
    };
  }

  if (isExecutionInProgress(input.trace)) {
    return {
      status: "running",
      terminalStep: null,
      reasonCode: resolveDispatchOrAttemptRunningReasonCode(input.trace),
    };
  }

  if (input.lookupMatch || input.outboxRecord) {
    return {
      status: "pending",
      terminalStep: null,
      reasonCode: null,
    };
  }

  if (input.sourceSignal) {
    return {
      status: "missing",
      terminalStep: "planner",
      reasonCode: "wake_trace.planner_output_not_found",
    };
  }

  return {
    status: "missing",
    terminalStep: "source_signal",
    reasonCode: "wake_trace.source_signal_not_found",
  };
}

function summarizeFinalVisibleOutcomeWaterfall(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcome
): {
  status: WakeTraceWaterfallSummaryStatus;
  terminalStep: WakeTraceWaterfallStepName | null;
  reasonCode: string | null;
} | null {
  switch (finalVisibleOutcome.status) {
    case "visible_reply":
      return {
        status: "replied",
        terminalStep: "reply_signal",
        reasonCode: null,
      };
    case "visible_failure":
      return {
        status: "failed",
        terminalStep: "reply_signal",
        reasonCode: finalVisibleOutcome.reasonCode,
      };
    case "visible_stopped":
      return {
        status: "stopped",
        terminalStep: "reply_signal",
        reasonCode: finalVisibleOutcome.reasonCode,
      };
    case "publication_pending":
    case "publication_retrying":
      return {
        status: "pending",
        terminalStep: null,
        reasonCode: finalVisibleOutcome.reasonCode,
      };
    case "publication_unresolved":
      return {
        status: "failed",
        terminalStep: "reply_signal",
        reasonCode: finalVisibleOutcome.reasonCode,
      };
    case "not_applicable":
      return null;
    default:
      return assertNever(finalVisibleOutcome.status);
  }
}

function shouldUseProjectedRootCauseBeforeStepFallback(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  if (!trace) {
    return false;
  }
  const projectedRootCause = projectSpaceDispatchTraceRootCause(trace);
  const latestAttempt = trace.latestAttempt;
  return (
    projectedRootCause.source === "final_visible_message" ||
    (projectedRootCause.source === "latest_attempt" &&
      Boolean(latestAttempt?.errorCode) &&
      isTerminalFailedAttemptStatus(latestAttempt?.status))
  );
}

function buildWakeTraceStepIds(input: {
  clientMessageId: string | null;
  dispatchId: string | null;
  lookupMatch: SpaceDispatchLookupMatch | null;
  sourceSignalId: string | null;
  targetProfileId: string;
  trace: SpaceDispatchTraceSnapshot | null;
}): WakeTraceWaterfallStepIds {
  return {
    clientMessageId: input.clientMessageId,
    sourceSignalId: input.sourceSignalId,
    targetProfileId: input.targetProfileId,
    targetWakeLifecycleId:
      input.trace?.runtimeCoordinatorHeadLifecycle?.targetWakeLifecycleId ??
      null,
    dispatchId: input.dispatchId,
    attemptId:
      input.trace?.latestAttempt?.attemptId ??
      input.lookupMatch?.latestAttemptId ??
      null,
    claimLeaseId: null,
    bindingId:
      input.trace?.runtimeCoordinatorExecution?.bindingId ??
      input.trace?.executionIdentity?.core.bindingId ??
      null,
    openMeldServiceRuntimeId:
      input.trace?.runtimeCoordinatorExecution?.openMeldServiceRuntimeId
        .value ??
      input.trace?.executionIdentity?.core.openMeldServiceRuntimeId.value ??
      null,
    agentControllerRef:
      input.trace?.runtimeCoordinatorExecution?.agentControllerRef ??
      input.trace?.executionIdentity?.core.agentControllerRef ??
      null,
    resultKey: input.trace?.resultInbox?.resultKey ?? null,
    resultRef: input.trace?.result?.resultRef ?? null,
    publishedSignalId:
      input.trace?.result?.publishedSignalId ??
      input.trace?.resultInbox?.publishedSignalId ??
      null,
    replySignalId: input.trace?.replySignal?.signalId ?? null,
  };
}

function collectWakeTraceWaterfallTargetProfileIds(
  input: ProjectWakeTraceWaterfallInput
): string[] {
  if (input.targetProfileId) {
    return [input.targetProfileId];
  }

  const targetProfileIds = new Set<string>();
  for (const target of input.sourceSignal?.targetProfileIds ?? []) {
    const normalized = normalizeOptionalText(target);
    if (normalized) {
      targetProfileIds.add(normalized);
    }
  }
  for (const record of input.outboxRecords) {
    targetProfileIds.add(record.targetProfileId);
  }
  for (const match of input.lookup?.matches ?? []) {
    targetProfileIds.add(match.targetProfileId);
  }
  return [...targetProfileIds];
}

function resolveWakeTraceTargetLabel(input: {
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  targetLabelByProfileId: ReadonlyMap<string, string>;
  targetProfileId: string;
}): string {
  return formatWakeTraceTargetLabel(
    normalizeOptionalText(input.outboxRecord?.targetProfileMentionLabel) ??
      normalizeOptionalText(input.outboxRecord?.targetProfileNameSnapshot) ??
      normalizeOptionalText(
        input.targetLabelByProfileId.get(input.targetProfileId)
      ) ??
      input.targetProfileId
  );
}

function buildDispatchCorrelationFact(input: {
  clientMessageId: string | null;
  lookupMatch: SpaceDispatchLookupMatch | null;
  outboxRecord: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
}): {
  dispatchId: string;
  latestAttemptId?: string | null;
  sourceClientMessageId: string | null;
  sourceEventId: string;
  targetProfileId: string;
} | null {
  if (input.lookupMatch) {
    return {
      dispatchId: input.lookupMatch.dispatchId,
      latestAttemptId: input.lookupMatch.latestAttemptId,
      sourceClientMessageId: input.clientMessageId,
      sourceEventId: input.lookupMatch.sourceSignalId,
      targetProfileId: input.lookupMatch.targetProfileId,
    };
  }
  if (input.outboxRecord) {
    return {
      dispatchId: input.outboxRecord.dispatchId,
      sourceClientMessageId:
        input.outboxRecord.sourceClientMessageId ?? input.clientMessageId,
      sourceEventId: input.outboxRecord.sourceEventId,
      targetProfileId: input.outboxRecord.targetProfileId,
    };
  }
  return null;
}

function buildLatestAttemptCorrelationFact(
  lookupMatch: SpaceDispatchLookupMatch | null
): { attemptId: string; dispatchId: string } | null {
  if (!lookupMatch?.latestAttemptId) {
    return null;
  }
  return {
    attemptId: lookupMatch.latestAttemptId,
    dispatchId: lookupMatch.dispatchId,
  };
}

function isTerminalFailedDispatchStatus(status: string): boolean {
  return status === "failed_terminal" || status === "blocked";
}

function isTerminalFailedAttemptStatus(
  status: string | null | undefined
): boolean {
  return (
    status === "blocked" ||
    status === "failed_terminal" ||
    status === "timed_out"
  );
}

function isExecutionInProgress(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  if (trace?.runtimeCoordinatorExecution) {
    return isRuntimeCoordinatorExecutionInProgress(trace);
  }
  if (hasRuntimeCoordinatorMissingAuthority(trace)) {
    return false;
  }
  return (
    trace?.execution?.phase === "accepted_local" ||
    trace?.execution?.phase === "running"
  );
}

function terminalFailureBeforeResult(
  lookupMatch: SpaceDispatchLookupMatch | null,
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  if (hasRuntimeCoordinatorExecutionAuthority(trace)) {
    return false;
  }
  return (
    isTerminalFailedDispatchStatus(
      trace?.dispatch.status ?? lookupMatch?.status ?? ""
    ) ||
    isTerminalFailedAttemptStatus(trace?.latestAttempt?.status) ||
    isTerminalFailedAttemptStatus(lookupMatch?.latestAttemptStatus)
  );
}

function resolveDispatchOrAttemptRunningReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  if (trace?.runtimeCoordinatorExecution) {
    const staleProgressReasonCode =
      resolveRuntimeProgressStaleReasonCode(trace);
    if (staleProgressReasonCode) {
      return staleProgressReasonCode;
    }
    const localQueueReasonCode =
      resolveRuntimeCoordinatorLocalQueueReasonCode(trace);
    if (localQueueReasonCode) {
      return localQueueReasonCode;
    }
    return isRuntimeCoordinatorExecutionInProgress(trace)
      ? `runtime_coordinator.${trace.runtimeCoordinatorExecution.status}`
      : null;
  }
  return null;
}

function readLatestAcceptedLocalQueue(
  trace: SpaceDispatchTraceSnapshot | null
): Record<string, unknown> | null {
  if (trace?.runtimeCoordinatorExecution?.status !== "accepted_local") {
    return null;
  }
  const lifecycleEvent = trace.runtimeCoordinatorEvents
    .filter((event) => event.eventType === "lifecycle_accepted_local")
    .at(-1);
  return lifecycleEvent
    ? readPayloadObject(
        parseRuntimeCoordinatorEventPayload(lifecycleEvent),
        "localQueue"
      )
    : null;
}

/** The Service still holds this accepted execution in its local queue. */
export function isRuntimeCoordinatorExecutionLocallyQueued(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  return (
    readPayloadString(readLatestAcceptedLocalQueue(trace), "status") ===
    "queued"
  );
}

function resolveRuntimeCoordinatorLocalQueueReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  const conversationOccupancyReasonCode =
    resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(trace);
  if (conversationOccupancyReasonCode) {
    return conversationOccupancyReasonCode;
  }
  const localQueue = readLatestAcceptedLocalQueue(trace);
  if (!localQueue) {
    return null;
  }
  const status = readPayloadString(localQueue, "status");
  if (status === "starting_runtime") {
    return "runtime.local_queue.starting_runtime";
  }
  if (status !== "queued") {
    return null;
  }
  switch (readPayloadString(localQueue, "waitReason")) {
    case "global_concurrency":
      return "runtime.local_queue.waiting_global_concurrency";
    case "local_execution_lane_concurrency":
      return "runtime.local_queue.waiting_local_execution_lane";
    case "workspace_conflict":
      return "runtime.local_queue.waiting_workspace_conflict";
    case "agent_profile_concurrency":
      return "runtime.local_queue.waiting_agent_profile_concurrency";
    case "agent_controller_maintenance":
      return "runtime.local_queue.waiting_controller_maintenance";
    case "none":
      return "runtime.local_queue.waiting_runner_slot";
    default:
      return "runtime.local_queue.waiting_unknown";
  }
}

/** The wait reason shown on Wake progress, from the latest Service lifecycle. */
export function resolveRuntimeCoordinatorWakeProgressWaitReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): WakeProgressWaitReasonCode | null {
  return (
    resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(trace) ??
    resolveWakeProgressLocalQueueWaitReasonCode(
      readLatestAcceptedLocalQueue(trace)
    )
  );
}

export function resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): WakeProgressWaitReasonCode | null {
  const occupancyEvent = trace?.runtimeCoordinatorEvents
    .filter(
      (event) =>
        event.eventType === "lifecycle_accepted_local" ||
        event.eventType === "lifecycle_running"
    )
    .map((event) =>
      readPayloadObject(
        parseRuntimeCoordinatorEventPayload(event),
        "agentControllerConversationOccupancy"
      )
    )
    .filter((occupancy) => occupancy !== null)
    .at(-1);
  if (readPayloadString(occupancyEvent ?? null, "state") === "occupied") {
    return WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
  }
  return null;
}

function resolveRuntimeProgressStaleReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  if (
    hasRuntimeCoordinatorPreResultAuthority(trace) &&
    hasRuntimeCoordinatorProgressStalePolicyEvidence(trace)
  ) {
    return "runtime.progress_stale";
  }
  if (trace?.execution?.progressEvidenceState === "stalled") {
    return "runtime.progress_stale";
  }
  if (trace?.latestAttempt?.errorCode === "daemon.delivery.execution_stalled") {
    return "runtime.progress_stale";
  }
  return null;
}

function hasRuntimeCoordinatorProgressStalePolicyEvidence(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  return Boolean(
    trace?.runtimeCoordinatorEvents.some(
      (event) =>
        event.eventType === "runtime_coordinator_decision_recorded" &&
        event.reasonCode ===
          RUNTIME_COORDINATOR_PROGRESS_STALE_POLICY_REASON_CODE
    )
  );
}

function isRuntimeCoordinatorExecutionInProgress(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  switch (trace?.runtimeCoordinatorExecution?.status) {
    case "created":
    case "delivery_pending":
    case "delivery_accepted":
    case "cancellation_requested":
    case "accepted_local":
    case "running":
    case "completed_local":
    case "result_received":
    case "result_accepted":
      return true;
    default:
      return false;
  }
}

function hasRuntimeCoordinatorPreResultAuthority(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  switch (trace?.runtimeCoordinatorExecution?.status) {
    case "created":
    case "delivery_pending":
    case "delivery_accepted":
    case "cancellation_requested":
    case "accepted_local":
    case "running":
    case "completed_local":
      return true;
    default:
      return false;
  }
}

function hasRuntimeCoordinatorMissingAuthority(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  if (
    trace?.runtimeCoordinatorHeadLifecycle?.readStatus ===
    "authority_unavailable"
  ) {
    return true;
  }
  if (trace?.runtimeCoordinatorHeadLifecycle?.readStatus === "found") {
    return false;
  }
  return Boolean(
    !trace?.runtimeCoordinatorExecution &&
      trace?.runtimeCoordinatorCreationDiagnostics.length
  );
}

function hasRuntimeCoordinatorExecutionAuthority(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  return Boolean(
    trace?.runtimeCoordinatorExecution ||
      trace?.runtimeCoordinatorHeadLifecycle?.readStatus === "found" ||
      hasRuntimeCoordinatorMissingAuthority(trace)
  );
}

function hasRuntimeCoordinatorHeadNoExecution(
  trace: SpaceDispatchTraceSnapshot | null
): boolean {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  return Boolean(
    headLifecycle?.readStatus === "found" &&
      (headLifecycle.noExecutionDecision || headLifecycle.publicationIntent)
  );
}

function resolveRuntimeCoordinatorMissingAuthorityReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  if (!hasRuntimeCoordinatorMissingAuthority(trace)) {
    return null;
  }
  if (
    trace?.runtimeCoordinatorHeadLifecycle?.readStatus ===
    "authority_unavailable"
  ) {
    return trace.runtimeCoordinatorHeadLifecycle.reasonCode;
  }
  const latestDiagnostic =
    trace?.runtimeCoordinatorCreationDiagnostics.at(-1) ?? null;
  return (
    normalizeOptionalText(latestDiagnostic?.reasonCode) ??
    "runtime_coordinator.execution_not_created"
  );
}

function resolveRuntimeCoordinatorHeadPendingReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus !== "found") {
    return null;
  }
  if (headLifecycle.publicationIntent) {
    return (
      headLifecycle.noExecutionDecision?.reasonCode ??
      headLifecycle.publicationIntent.reasonCode
    );
  }
  if (headLifecycle.runtimeCoordinatorExecutionId) {
    return null;
  }
  if (headLifecycle.status === "accepted") {
    return "runtime_coordinator.head_accepted";
  }
  if (headLifecycle.status === "waiting") {
    return (
      headLifecycle.waitingBoundary?.reasonCode ??
      "runtime_coordinator.head_waiting"
    );
  }
  if (headLifecycle.status === "execution_linked") {
    return "runtime_coordinator.head_execution_linked";
  }
  return null;
}

const PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES = new Set([
  "local_service.identity_mismatch",
]);

function resolvePreExecutionNoExecutionEvidenceReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (
    !trace ||
    trace.runtimeCoordinatorExecution ||
    headLifecycle?.readStatus !== "found" ||
    headLifecycle.runtimeCoordinatorExecutionId ||
    headLifecycle.waitingBoundary
  ) {
    return null;
  }

  const authoritativeHeadReason =
    headLifecycle.noExecutionDecision?.reasonCode ??
    headLifecycle.publicationIntent?.reasonCode ??
    null;
  return authoritativeHeadReason &&
    PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES.has(
      authoritativeHeadReason
    )
    ? authoritativeHeadReason
    : null;
}

function resolveRuntimeCoordinatorHeadPublicationIntentReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  const headLifecycle = trace?.runtimeCoordinatorHeadLifecycle;
  if (
    headLifecycle?.readStatus !== "found" ||
    !headLifecycle.publicationIntent
  ) {
    return null;
  }
  return (
    headLifecycle.noExecutionDecision?.reasonCode ??
    headLifecycle.publicationIntent.reasonCode
  );
}

function resolveRuntimeCoordinatorRetryableFailureReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  if (trace?.runtimeCoordinatorExecution?.status !== "failed_retryable") {
    return null;
  }
  return (
    normalizeOptionalText(
      trace.runtimeCoordinatorExecution.terminalOutcome?.reasonCode
    ) ?? "runtime_coordinator.failed_retryable"
  );
}

function resolveRuntimeCoordinatorTerminalFailureReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  if (trace?.runtimeCoordinatorExecution?.status !== "failed_terminal") {
    return null;
  }
  return (
    normalizeOptionalText(
      trace.runtimeCoordinatorExecution.terminalOutcome?.reasonCode
    ) ?? "runtime_coordinator.failed_terminal"
  );
}

function timestampMsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return new Date(value).toISOString();
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseRuntimeCoordinatorEventPayload(
  event: SpaceDispatchTraceSnapshot["runtimeCoordinatorEvents"][number]
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(event.payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readPayloadObject(
  payload: Record<string, unknown> | null,
  fieldName: string
): Record<string, unknown> | null {
  const value = payload?.[fieldName];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPayloadString(
  payload: Record<string, unknown> | null,
  fieldName: string
): string | null {
  const value = payload?.[fieldName];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function formatWakeTraceTargetLabel(value: string): string {
  const normalized = normalizeOptionalText(value) ?? "agent";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function assertNever(value: never): never {
  throw new Error(`unexpected wake trace waterfall step: ${String(value)}`);
}
