import { RUNTIME_TRANSPORT_SCHEMA_VERSION } from "@openmeld/schemas";
import type {
  RuntimeTransportDeletedAgentProfileWakeCancellationRequest,
  RuntimeTransportDeletedAgentProfileWakeCancellationResponse,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse,
  RuntimeTransportRuntimeCoordinatorWakeStopRequest,
  RuntimeTransportRuntimeCoordinatorWakeStopResponse,
} from "@openmeld/schemas/types";
import type {
  RuntimeCoordinatorHeadLifecycleRecord,
  RuntimeCoordinatorRunCommandState,
} from "./runtime-coordinator-authority";
import { isAcceptedHeadAwaitingExecution } from "./runtime-coordinator-authority";

export const DELETED_AGENT_PROFILE_WAKE_STOP_REASON =
  "The Agent Profile was deleted.";

export type DeletedAgentProfileWakeCancellationPorts = {
  readHeadLifecycleRecords: () => Promise<
    RuntimeCoordinatorHeadLifecycleRecord[]
  >;
  readRunCommandStates: () => Promise<RuntimeCoordinatorRunCommandState[]>;
  stopHeadBeforeExecution: (
    request: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest
  ) => Promise<RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse>;
  stopRuntimeExecution: (
    request: RuntimeTransportRuntimeCoordinatorWakeStopRequest
  ) => Promise<RuntimeTransportRuntimeCoordinatorWakeStopResponse>;
};

export async function cancelDeletedAgentProfileWakesWithPorts(input: {
  request: RuntimeTransportDeletedAgentProfileWakeCancellationRequest;
  ports: DeletedAgentProfileWakeCancellationPorts;
}): Promise<RuntimeTransportDeletedAgentProfileWakeCancellationResponse> {
  const [headRecords, runCommandStates] = await Promise.all([
    input.ports.readHeadLifecycleRecords(),
    input.ports.readRunCommandStates(),
  ]);
  const matchingRunCommandStates = runCommandStates.filter(
    (state) =>
      state.ownerUserId === input.request.ownerUserId &&
      state.targetProfileId === input.request.targetProfileId &&
      state.localProgress.phase !== "result_received"
  );
  const matchingHeadRecords = headRecords.filter(
    (record) =>
      record.ownerUserId === input.request.ownerUserId &&
      record.targetWakeLifecycleIdentity.targetProfileId ===
        input.request.targetProfileId &&
      (record.status === "waiting" ||
        isAcceptedHeadAwaitingExecution(record)) &&
      !record.runtimeCoordinatorExecutionId &&
      !record.executionLinkedAtMs
  );

  const headStopOutcomes: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse[] =
    [];
  for (const record of matchingHeadRecords) {
    try {
      headStopOutcomes.push(
        await input.ports.stopHeadBeforeExecution({
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: input.request.ownerUserId,
          dispatchId: record.primaryDispatchId,
          idempotencyKey: record.primaryIdempotencyKey,
          reason: DELETED_AGENT_PROFILE_WAKE_STOP_REASON,
          ...(record.targetDisplay?.targetProfileMentionLabel
            ? {
                targetProfileMentionLabel:
                  record.targetDisplay.targetProfileMentionLabel,
              }
            : {}),
          ...(record.targetDisplay?.targetProfileName
            ? { targetProfileName: record.targetDisplay.targetProfileName }
            : {}),
          targetWakeLifecycleIdentity: record.targetWakeLifecycleIdentity,
        })
      );
    } catch (error) {
      headStopOutcomes.push({
        ok: false,
        primaryDispatchId: record.primaryDispatchId,
        publicationIntentId: null,
        reasonCode: readCancellationErrorReasonCode(
          error,
          "runtime_coordinator.deleted_profile_head_stop_unavailable"
        ),
        runtimeCoordinatorExecutionId:
          record.runtimeCoordinatorExecutionId ?? null,
        status: "retry_later",
        targetWakeLifecycleId: record.targetWakeLifecycleId,
      });
    }
  }

  const executionStopOutcomes: RuntimeTransportRuntimeCoordinatorWakeStopResponse[] =
    [];
  for (const commandState of matchingRunCommandStates) {
    try {
      executionStopOutcomes.push(
        await input.ports.stopRuntimeExecution({
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: input.request.ownerUserId,
          runtimeCoordinatorExecutionId:
            commandState.runtimeCoordinatorExecutionId,
          dispatchId: commandState.dispatchId,
          spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
          sourceClientMessageId: commandState.sourceClientMessageId,
          targetProfileId: input.request.targetProfileId,
          reason: DELETED_AGENT_PROFILE_WAKE_STOP_REASON,
        })
      );
    } catch (error) {
      const reasonCode = readCancellationErrorReasonCode(
        error,
        "runtime_coordinator.deleted_profile_execution_stop_unavailable"
      );
      executionStopOutcomes.push({
        ok: false,
        reasonCode,
        runtimeCoordinatorExecutionId:
          commandState.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.request.targetProfileId,
        cancellationState: {
          observedAtMs: Date.now(),
          reasonCode,
          status: "delivery_rejected",
        },
      });
    }
  }

  return {
    executionStopOutcomes,
    headStopOutcomes,
    status: resolveBulkCancellationStatus({
      executionStopOutcomes,
      headStopOutcomes,
    }),
    targetProfileId: input.request.targetProfileId,
  };
}

function resolveBulkCancellationStatus(input: {
  executionStopOutcomes: RuntimeTransportRuntimeCoordinatorWakeStopResponse[];
  headStopOutcomes: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse[];
}): RuntimeTransportDeletedAgentProfileWakeCancellationResponse["status"] {
  const totalCount =
    input.executionStopOutcomes.length + input.headStopOutcomes.length;
  if (totalCount === 0) {
    return "inactive";
  }
  const successfulCount =
    input.headStopOutcomes.filter((outcome) => outcome.ok).length +
    input.executionStopOutcomes.filter(
      (outcome) => outcome.ok || outcome.status === "not_stoppable"
    ).length;
  if (successfulCount === totalCount) {
    return "cancellation_requested";
  }
  return successfulCount > 0 ? "partially_requested" : "unavailable";
}

function readCancellationErrorReasonCode(
  error: unknown,
  fallback: string
): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim();
  return normalized.length > 0 && normalized.length <= 160
    ? normalized
    : fallback;
}
