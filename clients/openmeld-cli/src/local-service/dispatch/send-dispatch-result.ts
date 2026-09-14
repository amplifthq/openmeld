import {
  buildRuntimeWorkspaceFingerprint,
  buildTaskResultEnvelope,
} from "@openmeld/local-execution";
import {
  normalizeOptionalWorkingDirectory,
  openMeldDaemonTaskResultPayloadSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportDispatchInteractionDeliveredRequestSchema,
  runtimeTransportDispatchInteractionRequestSchema,
  runtimeTransportDispatchLifecycleRequestSchema,
  runtimeTransportDispatchPreviewEndRequestSchema,
  runtimeTransportDispatchPreviewRequestSchema,
  runtimeTransportDispatchReasoningRequestSchema,
  runtimeTransportDispatchRuntimeEvidenceRequestSchema,
  runtimeTransportDispatchToolActivityRequestSchema,
  runtimeTransportSubmitTaskResultRequestSchema,
  toCompatibleSpaceAddressingRequestWireValue,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  AgentInteractionRequest,
  AgentStreamToolPart,
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldDaemonTaskResultPayload,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeTransportAgentControllerConversationOccupancy,
  RuntimeTransportDispatchLifecyclePhase,
  RuntimeTransportDispatchLocalQueueDiagnostics,
  RuntimeTransportDispatchReasoningRequest,
  RuntimeTransportDispatchRuntimeEvidencePhase,
  RuntimeTransportHeartbeatRequest,
  RuntimeTransportRegisterSessionRequest,
  RuntimeTransportResultIdentityEcho,
  RuntimeTransportRuntimeEvidenceIdentityEcho,
} from "@openmeld/schemas/types";
import type { WsClient } from "../../transport/ws";
import { normalizeOptionalText } from "../core/logger";
import type {
  DispatchResultPayloadResolveInput,
  OpenMeldDaemonTaskErrorType,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";

export function sendDispatchResultFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  payload: OpenMeldDaemonTaskResultPayload;
  runtimeCoordinatorExecutionId?: string | null;
  socket: WsClient;
}): void {
  sendDispatchResultEnvelopeFrame({
    ...input,
    taskResult: buildTaskResultEnvelope(input.payload),
  });
}

export function sendDispatchResultEnvelopeFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId?: string | null;
  socket: WsClient;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): void {
  const resultRequest = runtimeTransportSubmitTaskResultRequestSchema.safeParse(
    {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ...(input.runtimeCoordinatorExecutionId
        ? { runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId }
        : {}),
      ...(input.executionTokenEcho
        ? { executionTokenEcho: input.executionTokenEcho }
        : {}),
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      executionIdentityEcho: input.executionIdentityEcho,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      taskResult: input.taskResult,
    }
  );
  if (!resultRequest.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.result_payload_invalid",
      message: "invalid daemon dispatch result payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.result",
    payload: resultRequest.data,
  });
}

export function sendDispatchLifecycleFrame(input: {
  agentControllerConversationOccupancy?: RuntimeTransportAgentControllerConversationOccupancy | null;
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  leaseEpoch: number;
  phase: RuntimeTransportDispatchLifecyclePhase;
  localQueue?: RuntimeTransportDispatchLocalQueueDiagnostics | null;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  runtimeCoordinatorExecutionId?: string | null;
  socket: WsClient;
}): void {
  const lifecycleRequest =
    runtimeTransportDispatchLifecycleRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ...(input.runtimeCoordinatorExecutionId
        ? { runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId }
        : {}),
      ...(input.executionTokenEcho
        ? { executionTokenEcho: input.executionTokenEcho }
        : {}),
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      phase: input.phase,
      lifecycleAtMs: Date.now(),
      ...(input.agentControllerConversationOccupancy === undefined ||
      input.agentControllerConversationOccupancy === null
        ? {}
        : {
            agentControllerConversationOccupancy:
              input.agentControllerConversationOccupancy,
          }),
      ...(input.localQueue === undefined || input.localQueue === null
        ? {}
        : { localQueue: input.localQueue }),
    });
  if (!lifecycleRequest.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.lifecycle_payload_invalid",
      message: "invalid daemon dispatch lifecycle payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.lifecycle",
    payload: lifecycleRequest.data,
  });
}

export function sendDispatchRuntimeEvidenceFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  durationMs?: number | null;
  errorName?: string | null;
  executionIdentityEcho: RuntimeTransportRuntimeEvidenceIdentityEcho;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  phase: RuntimeTransportDispatchRuntimeEvidencePhase;
  reasonCode?: string | null;
  runtimeCoordinatorExecutionId?: string | null;
  socket: WsClient;
  sourceClientMessageId?: string | null;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
}): void {
  const runtimeEvidenceRequest =
    runtimeTransportDispatchRuntimeEvidenceRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ...(input.runtimeCoordinatorExecutionId
        ? { runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId }
        : {}),
      ...(input.executionTokenEcho
        ? { executionTokenEcho: input.executionTokenEcho }
        : {}),
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      executionIdentityEcho: input.executionIdentityEcho,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      phase: input.phase,
      evidenceAtMs: Date.now(),
      taskId: input.taskId,
      spaceId: input.spaceId,
      sourceSignalId: input.sourceSignalId,
      ...(input.sourceClientMessageId === undefined ||
      input.sourceClientMessageId === null
        ? {}
        : { sourceClientMessageId: input.sourceClientMessageId }),
      targetProfileId: input.targetProfileId,
      ...(input.durationMs === undefined || input.durationMs === null
        ? {}
        : { durationMs: input.durationMs }),
      ...(input.reasonCode === undefined || input.reasonCode === null
        ? {}
        : { reasonCode: input.reasonCode }),
      ...(input.errorName === undefined || input.errorName === null
        ? {}
        : { errorName: input.errorName }),
    });
  if (!runtimeEvidenceRequest.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.runtime_evidence_payload_invalid",
      message: "invalid daemon dispatch runtime evidence payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.runtime_evidence",
    payload: runtimeEvidenceRequest.data,
  });
}

export function sendDispatchReasoningFrame(
  input: Omit<RuntimeTransportDispatchReasoningRequest, "v"> & {
    socket: WsClient;
  }
): void {
  const { socket, ...payload } = input;
  const parsed = runtimeTransportDispatchReasoningRequestSchema.safeParse({
    ...payload,
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  });
  if (!parsed.success) {
    return;
  }
  sendDaemonFrame(socket, {
    code: "daemon.dispatch.reasoning",
    payload: parsed.data,
  });
}

export function sendDispatchToolActivityFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportRuntimeEvidenceIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho;
  leaseEpoch: number;
  observedAtMs: number;
  part: AgentStreamToolPart;
  runtimeCoordinatorExecutionId: string;
  sequence: number;
  socket: WsClient;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
}): void {
  const request = runtimeTransportDispatchToolActivityRequestSchema.safeParse({
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    executionTokenEcho: input.executionTokenEcho,
    dispatchId: input.dispatchId,
    attemptId: input.attemptId,
    executionIdentityEcho: input.executionIdentityEcho,
    daemonSessionId: input.daemonSessionId,
    connectionGeneration: input.connectionGeneration,
    leaseEpoch: input.leaseEpoch,
    sequence: input.sequence,
    observedAtMs: input.observedAtMs,
    taskId: input.taskId,
    spaceId: input.spaceId,
    sourceSignalId: input.sourceSignalId,
    targetProfileId: input.targetProfileId,
    part: input.part,
  });
  if (!request.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.tool_activity_payload_invalid",
      message: "invalid daemon dispatch tool activity payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.tool_activity",
    payload: request.data,
  });
}

export function sendDispatchInteractionRequestFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportRuntimeEvidenceIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho;
  interaction: AgentInteractionRequest;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string;
  socket: WsClient;
  taskId: string;
}): void {
  const request = runtimeTransportDispatchInteractionRequestSchema.safeParse({
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    executionTokenEcho: input.executionTokenEcho,
    dispatchId: input.dispatchId,
    attemptId: input.attemptId,
    executionIdentityEcho: input.executionIdentityEcho,
    daemonSessionId: input.daemonSessionId,
    connectionGeneration: input.connectionGeneration,
    leaseEpoch: input.leaseEpoch,
    taskId: input.taskId,
    interaction: input.interaction,
  });
  if (!request.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.interaction_payload_invalid",
      message: "invalid local agent interaction request payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.interaction_request",
    payload: request.data,
  });
}

export function sendDispatchInteractionDeliveredFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  deliveredAtMs: number;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportRuntimeEvidenceIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho;
  interactionId: string;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string;
  socket: WsClient;
}): void {
  const request =
    runtimeTransportDispatchInteractionDeliveredRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      executionTokenEcho: input.executionTokenEcho,
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      executionIdentityEcho: input.executionIdentityEcho,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      interactionId: input.interactionId,
      deliveredAtMs: input.deliveredAtMs,
    });
  if (!request.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.interaction_delivery_payload_invalid",
      message: "invalid local agent interaction delivery payload",
    });
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.interaction_delivered",
    payload: request.data,
  });
}

export function sendDispatchPreviewFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  leaseEpoch: number;
  previewText: string;
  socket: WsClient;
}): void {
  const previewRequest = runtimeTransportDispatchPreviewRequestSchema.safeParse(
    {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      previewText: input.previewText,
    }
  );
  if (!previewRequest.success) {
    return;
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.preview",
    payload: previewRequest.data,
  });
}

export function sendDispatchPreviewEndFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  leaseEpoch: number;
  socket: WsClient;
}): void {
  const previewEndRequest =
    runtimeTransportDispatchPreviewEndRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
    });
  if (!previewEndRequest.success) {
    return;
  }
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.preview_end",
    payload: previewEndRequest.data,
  });
}

export function resolveDispatchResultPayload(
  input: DispatchResultPayloadResolveInput
): OpenMeldDaemonTaskResultPayload {
  const contextId =
    normalizeOptionalText(input.contextDelta?.agentControllerConversationId) ??
    normalizeOptionalText(input.existingContextId);
  const agentControllerConversation =
    input.contextDelta?.agentControllerConversation ??
    input.contextResolution?.agentControllerConversation ??
    input.agentControllerConversationForDispatch;
  const effectiveRuntimeWorkingDirectory =
    normalizeOptionalWorkingDirectory(input.workingDirectory) ?? null;
  const runtimeWorkspaceFingerprint = effectiveRuntimeWorkingDirectory
    ? buildRuntimeWorkspaceFingerprint(effectiveRuntimeWorkingDirectory)
    : null;
  const promptTrace = input.promptTrace ?? null;

  if (
    input.basePayload.status === "success" ||
    input.basePayload.status === "partial_success"
  ) {
    const candidate = openMeldDaemonTaskResultPayloadSchema.safeParse(
      buildResolvedTaskResultPayloadCandidate(input, {
        contextId,
        promptTrace,
        requireContextId: false,
        agentControllerConversation,
        effectiveRuntimeWorkingDirectory,
        runtimeWorkspaceFingerprint,
      })
    );
    if (candidate.success) {
      return candidate.data;
    }
    return buildDispatchResultNormalizationFailure(input, {
      errorCode: "schema.invalid.runtime_response",
      errorMessage:
        "schema.invalid.runtime_response: failed to enrich runtime task result payload",
      errorType: "config",
    });
  }

  const candidate = openMeldDaemonTaskResultPayloadSchema.safeParse(
    buildResolvedTaskResultPayloadCandidate(input, {
      contextId,
      promptTrace,
      requireContextId: false,
      agentControllerConversation,
      effectiveRuntimeWorkingDirectory,
      runtimeWorkspaceFingerprint,
    })
  );
  if (candidate.success) {
    return candidate.data;
  }
  return buildDispatchResultNormalizationFailure(input, {
    errorCode: "schema.invalid.runtime_response",
    errorMessage:
      "schema.invalid.runtime_response: failed to normalize failed runtime task payload",
    errorType: "config",
  });
}

function buildResolvedTaskResultPayloadCandidate(
  input: DispatchResultPayloadResolveInput,
  options: {
    contextId: string | null;
    effectiveRuntimeWorkingDirectory: string | null;
    promptTrace: OpenMeldDaemonTaskResultPayload["promptTrace"] | null;
    requireContextId: boolean;
    runtimeWorkspaceFingerprint: string | null;
    agentControllerConversation:
      | AgentControllerConversationRef
      | null
      | undefined;
  }
): Record<string, unknown> {
  const resolvedAgentControllerConversationId =
    options.requireContextId || options.contextId
      ? { agentControllerConversationId: options.contextId }
      : {};

  return {
    ...input.basePayload,
    attemptId: input.attemptId,
    agentControllerRef: input.agentControllerRef,
    ...resolvedAgentControllerConversationId,
    ...(options.agentControllerConversation
      ? { agentControllerConversation: options.agentControllerConversation }
      : {}),
    ...(options.effectiveRuntimeWorkingDirectory
      ? {
          effectiveRuntimeWorkingDirectory:
            options.effectiveRuntimeWorkingDirectory,
        }
      : {}),
    ...(options.runtimeWorkspaceFingerprint
      ? {
          runtimeWorkspaceFingerprint: options.runtimeWorkspaceFingerprint,
        }
      : {}),
    ...(options.promptTrace ? { promptTrace: options.promptTrace } : {}),
    ...(input.bootstrapTemplateFacts
      ? { bootstrapTemplateFacts: input.bootstrapTemplateFacts }
      : {}),
    ...(input.dispatchExecution
      ? { dispatchExecution: input.dispatchExecution }
      : {}),
    ...(input.openClawGatewayVisibility
      ? { openClawGatewayVisibility: input.openClawGatewayVisibility }
      : {}),
    ...(input.openClawBinding
      ? { openClawBinding: input.openClawBinding }
      : {}),
    ...(input.spaceAction ? { spaceAction: input.spaceAction } : {}),
    ...(input.spaceAction && input.spaceActionProvenance
      ? { spaceActionProvenance: input.spaceActionProvenance }
      : {}),
  };
}

function buildDispatchResultNormalizationFailure(
  input: DispatchResultPayloadResolveInput,
  error: {
    errorCode: string;
    errorMessage: string;
    errorType: OpenMeldDaemonTaskErrorType;
  }
): OpenMeldDaemonTaskResultPayload {
  return buildFailedTaskResultPayload({
    attemptId: input.attemptId,
    agentControllerRef: input.agentControllerRef,
    errorCode: error.errorCode,
    errorMessage: error.errorMessage,
    errorType: error.errorType,
    sourceEventId: input.sourceEventId,
    suppressPublicOutcome: true,
    targetProfileId: input.targetProfileId,
    taskId: input.taskId,
  });
}

export function buildFailedTaskResultPayload(input: {
  attemptId: string;
  agentControllerRef: string | null;
  errorCode: string;
  errorMessage: string;
  errorType: OpenMeldDaemonTaskErrorType;
  sourceEventId: string;
  suppressPublicOutcome?: boolean;
  promptTrace?: OpenMeldDaemonTaskResultPayload["promptTrace"] | null;
  projectFailureContext?:
    | OpenMeldDaemonTaskResultPayload["projectFailureContext"]
    | null;
  targetProfileId: string;
  taskId: string;
  openClawGatewayVisibility?:
    | OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
    | null;
  openClawBinding?: OpenMeldDaemonTaskResultPayload["openClawBinding"] | null;
  localOwnerConflict?:
    | OpenMeldDaemonTaskResultPayload["localOwnerConflict"]
    | null;
  agentControllerConversation?: AgentControllerConversationRef | null;
  effectiveRuntimeWorkingDirectory?: string | null;
}): OpenMeldDaemonTaskResultPayload {
  const normalizedWorkingDirectory =
    normalizeOptionalWorkingDirectory(input.effectiveRuntimeWorkingDirectory) ??
    null;
  const payload = openMeldDaemonTaskResultPayloadSchema.safeParse({
    status: "failed",
    attemptId: input.attemptId,
    taskId: input.taskId,
    sourceEventId: input.sourceEventId,
    agentId: input.targetProfileId,
    deduped: false,
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    errorType: input.errorType,
    errorCode: input.errorCode,
    ...(input.suppressPublicOutcome === true
      ? { suppressPublicOutcome: true }
      : {}),
    ...(input.promptTrace ? { promptTrace: input.promptTrace } : {}),
    ...(input.projectFailureContext
      ? { projectFailureContext: input.projectFailureContext }
      : {}),
    ...(input.openClawGatewayVisibility
      ? { openClawGatewayVisibility: input.openClawGatewayVisibility }
      : {}),
    ...(input.openClawBinding
      ? { openClawBinding: input.openClawBinding }
      : {}),
    ...(input.localOwnerConflict
      ? { localOwnerConflict: input.localOwnerConflict }
      : {}),
    ...(input.agentControllerConversation
      ? { agentControllerConversation: input.agentControllerConversation }
      : {}),
    ...(normalizedWorkingDirectory
      ? {
          effectiveRuntimeWorkingDirectory: normalizedWorkingDirectory,
        }
      : {}),
    errorMessage: input.errorMessage.startsWith(`${input.errorCode}:`)
      ? input.errorMessage
      : `${input.errorCode}: ${input.errorMessage}`,
  });
  if (!payload.success) {
    return {
      status: "failed",
      attemptId: input.attemptId,
      taskId: input.taskId,
      sourceEventId: input.sourceEventId,
      agentId: input.targetProfileId,
      deduped: false,
      suppressPublicOutcome: true,
      errorType: "internal",
      errorMessage:
        "dispatch.execution_failed: failed to construct task result payload",
    };
  }
  return payload.data;
}

function sendDaemonFrame(
  inputSocket: WsClient,
  input: {
    code:
      | "daemon.dispatch.interaction_delivered"
      | "daemon.dispatch.interaction_request"
      | "daemon.dispatch.lifecycle"
      | "daemon.dispatch.preview"
      | "daemon.dispatch.preview_end"
      | "daemon.dispatch.result"
      | "daemon.dispatch.runtime_evidence"
      | "daemon.dispatch.tool_activity"
      | "daemon.dispatch.reasoning"
      | "daemon.session.heartbeat"
      | "daemon.session.register";
    payload:
      | RuntimeTransportHeartbeatRequest
      | RuntimeTransportRegisterSessionRequest
      | Record<string, unknown>;
  }
): void {
  inputSocket.send(
    JSON.stringify(
      toCompatibleSpaceAddressingRequestWireValue({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        code: input.code,
        payload: input.payload,
      })
    )
  );
}
