import type {
  AdapterDispatchDiagnostics,
  AdapterDispatchTelemetry,
  AdapterRuntimeEvent,
} from "@openmeld/adapter-core";
import type {
  RuntimeTaskResult,
  runRuntimeTask,
} from "@openmeld/local-execution";
import type {
  DispatchContinuityObservation,
  LocalExecutionSlotTaskResult,
} from "@openmeld/local-service";
import type {
  OpenMeldDaemonTaskResultPayload,
  RuntimeTransportDeliverDispatchRequest,
} from "@openmeld/schemas/types";
import type { Presenter } from "../../runtime/presenter/types";
import { emitRunLine } from "../core/logger";
import { emitDaemonDispatchJournalEvent } from "./daemon-dispatch-journal";
import type {
  DispatchLocalJournalPhase,
  ParsedDispatchTask,
} from "./execute-dispatch-types";
import { buildDispatchCorrelation } from "./parse-dispatch-task";

export function resolveAdapterTelemetry(
  dispatchResult: Awaited<ReturnType<typeof runRuntimeTask>>["dispatchResult"]
): AdapterDispatchTelemetry | null {
  if (!dispatchResult.dispatched) {
    return null;
  }
  return dispatchResult.adapterResult.telemetry ?? null;
}

export function resolveAdapterDiagnostics(
  dispatchResult: Awaited<ReturnType<typeof runRuntimeTask>>["dispatchResult"]
): AdapterDispatchDiagnostics | null {
  if (!dispatchResult.dispatched) {
    return null;
  }
  return dispatchResult.adapterResult.diagnostics ?? null;
}

export function buildRuntimeObservationPayload(input: {
  continuityObservation: DispatchContinuityObservation | null;
  daemonWorkingDirectory: string;
  deliveryRecoveryReason: ParsedDispatchTask["deliveryRecoveryReason"];
  dispatchId: string;
  providerRuntimeWorkingDirectory: string;
  resultPayload: OpenMeldDaemonTaskResultPayload;
  runtimeResult: Pick<
    Awaited<ReturnType<typeof runRuntimeTask>>,
    "dispatchResult" | "resultPayload"
  >;
  runtimeStartedAtMs: number;
  taskId: string;
}): Record<string, unknown> {
  const telemetry = resolveAdapterTelemetry(input.runtimeResult.dispatchResult);
  const diagnostics = resolveAdapterDiagnostics(
    input.runtimeResult.dispatchResult
  );
  const runtimeCompletedAtMs = Date.now();
  const runtimeTelemetryPayload =
    telemetry === null ? {} : buildAdapterRuntimeObservationPayload(telemetry);

  return {
    attemptId: input.runtimeResult.resultPayload.attemptId,
    daemonWorkingDirectory: input.daemonWorkingDirectory,
    dispatchId: input.dispatchId,
    ...("errorCode" in input.resultPayload && input.resultPayload.errorCode
      ? { errorCode: input.resultPayload.errorCode }
      : {}),
    ...(diagnostics?.modelNegotiation
      ? { modelNegotiation: diagnostics.modelNegotiation }
      : {}),
    providerRuntimeWorkingDirectory: input.providerRuntimeWorkingDirectory,
    result: input.resultPayload.status,
    runtimeDurationMs: runtimeCompletedAtMs - input.runtimeStartedAtMs,
    taskId: input.taskId,
    ...(input.deliveryRecoveryReason
      ? { deliveryRecoveryReason: input.deliveryRecoveryReason }
      : {}),
    ...runtimeTelemetryPayload,
  };
}

function buildAdapterRuntimeObservationPayload(
  telemetry: AdapterDispatchTelemetry
): Record<string, number | string | boolean | null> {
  const timeToMetric = (tsMs: number | null | undefined): number | null => {
    return tsMs === undefined || tsMs === null
      ? null
      : tsMs - telemetry.invokedAtMs;
  };
  const adapterDurationMs = timeToMetric(telemetry.completedAtMs);
  const timeToFirstOutputMs = timeToMetric(telemetry.firstOutputAtMs);
  const timeToFirstStderrMs = timeToMetric(telemetry.firstStderrAtMs);
  const timeToFirstStdoutMs = timeToMetric(telemetry.firstStdoutAtMs);
  const timeToProcessSpawnMs = timeToMetric(telemetry.processSpawnedAtMs);
  const timeToStdinClosedMs = timeToMetric(telemetry.stdinClosedAtMs);

  return {
    ...(adapterDurationMs === null ? {} : { adapterDurationMs }),
    ...(telemetry.contextHealed === undefined
      ? {}
      : { contextHealed: telemetry.contextHealed }),
    ...(telemetry.contextCompactionObserved === undefined
      ? {}
      : {
          contextCompactionObserved: telemetry.contextCompactionObserved,
        }),
    ...(telemetry.tokenUsage
      ? {
          lastCachedInputTokens: telemetry.tokenUsage.last.cachedInputTokens,
          lastInputTokens: telemetry.tokenUsage.last.inputTokens,
          lastOutputTokens: telemetry.tokenUsage.last.outputTokens,
          lastReasoningOutputTokens:
            telemetry.tokenUsage.last.reasoningOutputTokens,
          lastTotalTokens: telemetry.tokenUsage.last.totalTokens,
          modelContextWindowTokens: telemetry.tokenUsage.modelContextWindow,
          totalCachedInputTokens: telemetry.tokenUsage.total.cachedInputTokens,
          totalInputTokens: telemetry.tokenUsage.total.inputTokens,
          totalOutputTokens: telemetry.tokenUsage.total.outputTokens,
          totalReasoningOutputTokens:
            telemetry.tokenUsage.total.reasoningOutputTokens,
          totalTokens: telemetry.tokenUsage.total.totalTokens,
        }
      : {}),
    resumedContext: telemetry.resumedContext,
    ...(timeToFirstOutputMs === null ? {} : { timeToFirstOutputMs }),
    ...(timeToFirstStderrMs === null ? {} : { timeToFirstStderrMs }),
    ...(timeToFirstStdoutMs === null ? {} : { timeToFirstStdoutMs }),
    ...(timeToProcessSpawnMs === null ? {} : { timeToProcessSpawnMs }),
    ...(telemetry.processId === undefined
      ? {}
      : { providerProcessId: telemetry.processId }),
    ...(timeToStdinClosedMs === null ? {} : { timeToStdinClosedMs }),
    ...(telemetry.timeoutTriggeredAtMs === undefined
      ? {}
      : { providerTimedOut: true }),
    ...(telemetry.exitCode === undefined
      ? {}
      : { providerExitCode: telemetry.exitCode }),
    ...(telemetry.exitSignal === undefined
      ? {}
      : { providerExitSignal: telemetry.exitSignal }),
  };
}

export function emitProviderRuntimePhaseLine(input: {
  agentControllerRef: string;
  dispatchId: string;
  event: AdapterRuntimeEvent;
  presenter: Presenter;
  runtimeStartedAtMs: number;
  targetProfileId: string;
  taskId: string;
}): void {
  const sinceRuntimeStartedMs = input.event.tsMs - input.runtimeStartedAtMs;
  const basePayload = {
    agentControllerRef: input.agentControllerRef,
    dispatchId: input.dispatchId,
    phase: input.event.phase,
    ...(input.event.phase === "process_spawned" && input.event.processLaunchKind
      ? { processLaunchKind: input.event.processLaunchKind }
      : {}),
    processId: "processId" in input.event ? input.event.processId : null,
    ...(input.event.phase === "process_spawned" &&
    input.event.processWorkingDirectoryKind
      ? {
          processWorkingDirectoryKind: input.event.processWorkingDirectoryKind,
        }
      : {}),
    sinceRuntimeStartedMs,
    targetProfileId: input.targetProfileId,
    taskId: input.taskId,
  };

  switch (input.event.phase) {
    case "process_spawned":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_process_spawned",
        text: `provider process spawned for task ${input.taskId}`,
        payload: basePayload,
      });
      return;
    case "stdin_closed":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_input_written",
        text: `provider input written for task ${input.taskId}`,
        payload: basePayload,
      });
      return;
    case "first_stdout":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_first_stdout",
        text: `provider first stdout observed for task ${input.taskId}`,
        payload: basePayload,
      });
      return;
    case "first_stderr":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_first_stderr",
        text: `provider first stderr observed for task ${input.taskId}`,
        payload: basePayload,
      });
      return;
    case "timeout_triggered":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_timeout_triggered",
        text: `provider timeout triggered for task ${input.taskId}`,
        payload: basePayload,
      });
      return;
    case "process_exit":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_process_exit",
        text: `provider process exited for task ${input.taskId}`,
        payload: {
          ...basePayload,
          exitCode: input.event.exitCode,
          exitSignal: input.event.signal,
        },
      });
      return;
    case "provider_conversation_observed":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_conversation_observed",
        text: `provider conversation observed for task ${input.taskId}`,
        payload: {
          ...basePayload,
          agentControllerConversationId:
            input.event.agentControllerConversationId,
        },
      });
      return;
    default:
      return;
  }
}

export function emitContinuityWarningIfNeeded(input: {
  continuityObservation: DispatchContinuityObservation | null;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
}): void {
  if (!input.continuityObservation?.shouldWarn) {
    return;
  }
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.continuity_warning",
    text: `implicit conversation rotation detected for task ${input.parsedTask.taskId}; OpenMeld adopted the new context id`,
    payload: {
      agentControllerRef: input.parsedTask.agentControllerRef,
      dispatchId: input.parsedTask.dispatchId,
      existingContextId: input.continuityObservation.existingContextId,
      resolvedContextId: input.continuityObservation.resolvedContextId,
      status: input.continuityObservation.status,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });
}

export function emitRuntimeObservationSummaryLine(input: {
  agentControllerRef: string;
  dispatchId: string;
  presenter: Presenter;
  runtimeResult: RuntimeTaskResult;
  targetProfileId: string;
  taskId: string;
}): void {
  const telemetry = resolveAdapterTelemetry(input.runtimeResult.dispatchResult);
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.runtime_result_observed",
    text: `runtime result observed for task ${input.taskId}`,
    payload: {
      agentControllerRef: input.agentControllerRef,
      dispatchId: input.dispatchId,
      hasTelemetry: telemetry !== null,
      ...(telemetry === null
        ? {}
        : {
            hasExitCode: telemetry.exitCode !== undefined,
            hasFirstOutputAtMs: telemetry.firstOutputAtMs !== undefined,
            hasFirstStderrAtMs: telemetry.firstStderrAtMs !== undefined,
            hasFirstStdoutAtMs: telemetry.firstStdoutAtMs !== undefined,
            hasInvokedAtMs: telemetry.invokedAtMs !== undefined,
            hasProcessId: telemetry.processId !== undefined,
            hasProcessSpawnedAtMs: telemetry.processSpawnedAtMs !== undefined,
            hasStdinClosedAtMs: telemetry.stdinClosedAtMs !== undefined,
            hasStreamingMode: telemetry.streamingMode !== undefined,
            resumedContext: telemetry.resumedContext,
          }),
      resultStatus: input.runtimeResult.resultPayload.status,
      targetProfileId: input.targetProfileId,
      taskId: input.taskId,
    },
  });
}

export function summarizeTaskResultPayload(
  payload: OpenMeldDaemonTaskResultPayload
): LocalExecutionSlotTaskResult {
  if (payload.status === "failed") {
    return {
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
      result: "failed",
    };
  }
  if (payload.status === "partial_success") {
    return {
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
      result: "partial_success",
    };
  }
  return {
    errorCode: null,
    errorMessage: null,
    result: "success",
  };
}

export function emitDispatchLocalPhaseJournalEvent(input: {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  metadata?: Record<string, unknown>;
  parsedTask: ParsedDispatchTask | null;
  phase: DispatchLocalJournalPhase;
  result: string;
}): void {
  const correlation = buildDispatchCorrelation({
    deliverRequest: input.deliverRequest,
    parsedTask: input.parsedTask,
  });
  emitDaemonDispatchJournalEvent({
    attemptId: correlation.attemptId,
    connectionGeneration: input.deliverRequest.connectionGeneration,
    daemonSessionId: input.deliverRequest.daemonSessionId,
    dispatchId: correlation.dispatchId,
    leaseEpoch: input.deliverRequest.leaseEpoch,
    metadata: {
      phase: input.phase,
      ...(input.metadata ?? {}),
    },
    profileId: correlation.targetProfileId,
    result: input.result,
    taskId: correlation.taskId,
    type: "dispatch.local.phase",
  });
}

export function buildResultDispatchJournalMetadata(
  payload: OpenMeldDaemonTaskResultPayload
): Record<string, unknown> {
  const spaceAction = payload.spaceAction ?? null;
  const outputLength = "output" in payload ? payload.output.length : null;
  const errorCode = "errorCode" in payload ? (payload.errorCode ?? null) : null;
  const errorType = "errorType" in payload ? (payload.errorType ?? null) : null;
  const errorMessage =
    "errorMessage" in payload ? (payload.errorMessage ?? null) : null;

  return {
    agentId: payload.agentId,
    agentControllerRef: payload.agentControllerRef ?? null,
    errorCode,
    errorMessage,
    errorType,
    outputLength,
    sourceEventId: payload.sourceEventId,
    spaceActionProvenance: payload.spaceActionProvenance ?? null,
    spaceActionType: spaceAction?.type ?? null,
    suppressPublicOutcome: payload.suppressPublicOutcome ?? false,
    ...(spaceAction?.type === "post_message"
      ? {
          postMessageTextLength: spaceAction.messageEnvelope.text.length,
        }
      : {}),
    ...(spaceAction?.type === "post_status"
      ? {
          postStatus: spaceAction.status,
          postStatusTextLength: spaceAction.text.length,
        }
      : {}),
    ...(spaceAction?.type === "stay_silent"
      ? {
          staySilentReasonLength: spaceAction.reason.length,
        }
      : {}),
  };
}
