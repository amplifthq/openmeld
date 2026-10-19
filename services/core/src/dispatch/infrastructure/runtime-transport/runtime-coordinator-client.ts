import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { PermissionModeAdvisory } from "@openmeld/schemas";
import {
  buildRuntimeCoordinatorExecutionId,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportDeliverDispatchPayloadSchema,
  runtimeTransportDeliverDispatchRequestSchema,
  runtimeTransportDeliverDispatchResponseSchema,
  runtimeTransportPreExecutionHandoffRequestSchema,
  runtimeTransportPreExecutionHandoffResponseSchema,
  runtimeTransportRuntimeCoordinatorDecisionRequestSchema,
  runtimeTransportRuntimeCoordinatorDecisionResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema,
  runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema,
  runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema,
  runtimeTransportRuntimeCoordinatorWakeStopRequestSchema,
  runtimeTransportRuntimeCoordinatorWakeStopResponseSchema,
  runtimeTransportWaitDispatchResultRequestSchema,
  runtimeTransportWaitDispatchResultResponseSchema,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  wakeStopEligibilityReadModelSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchDeliveryRecoveryReason,
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeTransportDeliverDispatchPayload,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDeliverDispatchResponse,
  RuntimeTransportDeliveryExecutionIdentity,
  RuntimeTransportLookupRouteResponse,
  RuntimeTransportPreExecutionHandoffRequest,
  RuntimeTransportPreExecutionHandoffResponse,
  RuntimeTransportRuntimeCoordinatorDecisionRequest,
  RuntimeTransportRuntimeCoordinatorDecisionResponse,
  RuntimeTransportRuntimeCoordinatorHeadAcceptRequest,
  RuntimeTransportRuntimeCoordinatorHeadAcceptResponse,
  RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRequest,
  RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse,
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingResponse,
  RuntimeTransportRuntimeCoordinatorReadInteractionRequest,
  RuntimeTransportRuntimeCoordinatorReadInteractionRevisionResponse,
  RuntimeTransportRuntimeCoordinatorRespondInteractionRequest,
  RuntimeTransportRuntimeCoordinatorRespondInteractionResponse,
  RuntimeTransportRuntimeCoordinatorWakeStopRequest,
  RuntimeTransportRuntimeCoordinatorWakeStopResponse,
  RuntimeTransportWaitDispatchResultRequest,
  RuntimeTransportWaitDispatchResultResponse,
  WakeStopEligibilityReadModel,
  WorkingLanguageGuidance,
} from "@openmeld/schemas/types";
import { renderDispatchSourceText } from "@openmeld/space";
import type { CoreBindings } from "../../../lib/bindings";
import type { SpaceBootstrapTimingCollector } from "../../../space/application/space-bootstrap-timing";
import { callRuntimeTransportApi } from "./runtime-transport-api-client";

// Only an owner-requested Wake may carry the advisory.
function buildPermissionModeAdvisoryPayload(input: {
  permissionModeAdvisory?: PermissionModeAdvisory | null;
  requesterIsAgentOwner?: boolean;
}): Pick<RuntimeTransportDeliverDispatchPayload, "permissionModeAdvisory"> {
  return input.permissionModeAdvisory && input.requesterIsAgentOwner === true
    ? { permissionModeAdvisory: input.permissionModeAdvisory }
    : {};
}

async function measureRuntimeTransportClientTiming<T>(input: {
  description: string;
  name: string;
  read: () => Promise<T> | T;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<T> {
  if (!input.timing) {
    return await input.read();
  }
  return await input.timing.measure(
    {
      description: input.description,
      name: input.name,
    },
    input.read
  );
}
function resolveRuntimeTransportDeliveryRecoveryReason(
  reason: OpenMeldDaemonDispatchQueueMessage["deliveryRecoveryReason"]
): OpenMeldDaemonDispatchDeliveryRecoveryReason | null {
  return reason === "connection_replaced" || reason === "route_lost"
    ? reason
    : null;
}
export const deliverRuntimeTransportDispatch = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  dispatch: RuntimeTransportDeliverDispatchRequest;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<RuntimeTransportDeliverDispatchResponse> => {
  const parsedRequest = await measureRuntimeTransportClientTiming({
    description: "Validate the RuntimeTransport delivery request",
    name: "openmeld_dispatch_deliver_request_parse",
    read: () =>
      runtimeTransportDeliverDispatchRequestSchema.safeParse(input.dispatch),
    timing: input.timing,
  });
  if (!parsedRequest.success) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.not_found",
    };
  }
  const response = await measureRuntimeTransportClientTiming({
    description: "Call RuntimeTransport deliver-dispatch",
    name: "openmeld_dispatch_deliver_rpc",
    read: () =>
      callRuntimeTransportApi({
        env: input.env,
        ownerUserId: input.ownerUserId,
        path: "/deliver-dispatch",
        body: parsedRequest.data,
      }),
    timing: input.timing,
  });
  const parsed = await measureRuntimeTransportClientTiming({
    description: "Validate the RuntimeTransport delivery response",
    name: "openmeld_dispatch_deliver_response_parse",
    read: () =>
      runtimeTransportDeliverDispatchResponseSchema.safeParse(response),
    timing: input.timing,
  });
  if (!parsed.success) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.not_found",
    };
  }
  return parsed.data;
};
export const waitRuntimeTransportDispatchResult = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  attemptId: string;
  dispatchId: string;
  daemonSessionId: string;
  connectionGeneration: number;
  leaseEpoch: number;
  timeoutMs?: number;
}): Promise<RuntimeTransportWaitDispatchResultResponse> => {
  const requestBody = parseWaitDispatchResultRequest({
    attemptId: input.attemptId,
    dispatchId: input.dispatchId,
    daemonSessionId: input.daemonSessionId,
    connectionGeneration: input.connectionGeneration,
    leaseEpoch: input.leaseEpoch,
    timeoutMs: input.timeoutMs,
  });
  if (!requestBody) {
    return {
      state: "failed",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/wait-dispatch-result",
    body: requestBody,
  });
  return parseWaitDispatchResultResponse(response);
};
export const buildRuntimeTransportDeliverDispatchRequest = (input: {
  attemptId: string;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  ownerUserId: string;
  route: Extract<
    RuntimeTransportLookupRouteResponse,
    {
      online: true;
    }
  >;
  message: OpenMeldDaemonDispatchQueueMessage;
  agentControllerConversationId?: string | null;
  sourceSignal: {
    profileId: string | null;
    profileKind: "agent" | "human" | "system" | null;
    profileHandle?: string | null;
    profileMentionLabel?: string | null;
    text: string;
  };
  targetProfileMentionLabel?: string | null;
  targetProfileIsCenterAgent?: boolean | null;
  targetProfileName?: string | null;
  defaultProjectId?: string | null;
  organizationProtectedInformation?: string | null;
  workingLanguage?: WorkingLanguageGuidance | null;
  requesterIsAgentOwner?: boolean;
  /** From usesSeparateColleagueConversation (member-agent-program.md §4.3). */
  separateRequesterConversation?: boolean;
  permissionModeAdvisory?: PermissionModeAdvisory | null;
}): RuntimeTransportDeliverDispatchRequest => {
  const sourceProfileHandle = normalizeOptionalText(
    input.sourceSignal.profileHandle
  );
  const sourceProfileMentionLabel = normalizeOptionalText(
    input.sourceSignal.profileMentionLabel
  );
  const sourceSignalSnapshot = buildRuntimeTransportSourceSignalSnapshot({
    agentControllerRef: input.message.controllerSnapshot.agentControllerRef,
    executionIdentity: input.executionIdentity,
    route: input.route,
    sourceSignalSnapshot: input.message.sourceSignalSnapshot,
  });
  const deliveryRecoveryReason = resolveRuntimeTransportDeliveryRecoveryReason(
    input.message.deliveryRecoveryReason
  );
  const payloadCandidate: RuntimeTransportDeliverDispatchPayload = {
    ...buildRequesterDeliveryFields(input),
    executionContext: input.message.executionContext,
    runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId({
      dispatchId: input.message.dispatchId,
      spaceId: input.message.spaceId,
      targetProfileId: input.message.targetProfileId,
    }),
    attemptId: input.attemptId,
    dispatchId: input.message.dispatchId,
    executionIdentity: input.executionIdentity,
    taskId: input.message.taskId,
    spaceId: input.message.spaceId,
    sourceEventId: input.message.sourceEventId,
    sourceClientMessageId: input.message.sourceClientMessageId ?? null,
    sourceSignal: {
      profileId: input.sourceSignal.profileId,
      profileKind: input.sourceSignal.profileKind,
      ...(sourceProfileHandle ? { profileHandle: sourceProfileHandle } : {}),
      ...(sourceProfileMentionLabel
        ? { profileMentionLabel: sourceProfileMentionLabel }
        : {}),
      text: renderDispatchSourceText({
        requestTimeContext:
          input.message.sourceSignalSnapshot?.requestTimeContext,
        evidenceRefs: input.message.sourceSignalSnapshot?.evidenceRefs,
        workHandoff: input.message.sourceSignalSnapshot?.workHandoff,
        text: input.sourceSignal.text,
        quotedMessage: input.message.sourceSignalSnapshot?.quotedMessage,
        contextMessages: input.message.sourceSignalSnapshot?.contextMessages,
        pinnedFiles: input.message.sourceSignalSnapshot?.pinnedFiles,
      }),
    },
    targetProfileId: input.message.targetProfileId,
    ...(normalizeOptionalText(input.defaultProjectId)
      ? {
          defaultProjectId: normalizeOptionalText(
            input.defaultProjectId
          ) as string,
        }
      : {}),
    ...(normalizeOptionalText(input.organizationProtectedInformation)
      ? {
          organizationProtectedInformation: normalizeOptionalText(
            input.organizationProtectedInformation
          ) as string,
        }
      : {}),
    ...buildWorkingLanguagePayload(input.workingLanguage),
    ...buildPermissionModeAdvisoryPayload(input),
    dispatchContractVersion: input.message.dispatchContractVersion,
    dispatchPolicy: input.message.dispatchPolicy,
    controllerSnapshot: input.message.controllerSnapshot,
    contextIdMappingSpec: input.message.contextIdMappingSpec,
    dispatchRulesSnapshot: input.message.dispatchRulesSnapshot,
    ...(input.message.spaceContractSnapshot
      ? { spaceContractSnapshot: input.message.spaceContractSnapshot }
      : {}),
    ...(input.message.continuitySnapshot
      ? { continuitySnapshot: input.message.continuitySnapshot }
      : {}),
    ...(sourceSignalSnapshot ? { sourceSignalSnapshot } : {}),
    ...(input.message.sourceMessageEnvelope
      ? { sourceMessageEnvelope: input.message.sourceMessageEnvelope }
      : {}),
    ...(input.message.replyToSnapshot
      ? { replyToSnapshot: input.message.replyToSnapshot }
      : {}),
    ...(input.message.threadContext
      ? { threadContext: input.message.threadContext }
      : {}),
    ...(input.message.spaceNameSnapshot
      ? { spaceNameSnapshot: input.message.spaceNameSnapshot }
      : {}),
    enqueuedAtMs: input.message.enqueuedAtMs,
    idempotencyKey: input.message.idempotencyKey,
    ...(input.message.spacePassword
      ? { spacePassword: input.message.spacePassword }
      : {}),
    ...(input.targetProfileName
      ? { targetProfileName: input.targetProfileName }
      : {}),
    ...(input.targetProfileMentionLabel
      ? { targetProfileMentionLabel: input.targetProfileMentionLabel }
      : {}),
    ...(input.targetProfileIsCenterAgent === true
      ? { targetProfileIsCenterAgent: true }
      : {}),
    ...buildBindingConversationDeliveryFields(
      input.message,
      input.agentControllerConversationId
    ),
    ...(deliveryRecoveryReason ? { deliveryRecoveryReason } : {}),
    ...(input.message.dispatchChainId
      ? { dispatchChainId: input.message.dispatchChainId }
      : {}),
    autoRelayDepth: input.message.autoRelayDepth,
    visitedProfileIds: input.message.visitedProfileIds,
    visitedProfileIdsHash: input.message.visitedProfileIdsHash,
    transportMode: input.message.transportMode,
  };
  const parsedPayload =
    runtimeTransportDeliverDispatchPayloadSchema.safeParse(payloadCandidate);
  if (!parsedPayload.success) {
    throw new Error("invalid runtime transport dispatch payload");
  }
  const requestCandidate: RuntimeTransportDeliverDispatchRequest = {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    dispatchId: input.message.dispatchId,
    attemptId: input.attemptId,
    ownerUserId: input.ownerUserId,
    profileId: input.message.targetProfileId,
    daemonSessionId: input.route.daemonSessionId,
    connectionGeneration: input.route.connectionGeneration,
    leaseEpoch: input.route.leaseEpoch,
    payload: parsedPayload.data,
  };
  return requestCandidate;
};
function buildWorkingLanguagePayload(
  workingLanguage?: WorkingLanguageGuidance | null
): Pick<RuntimeTransportDeliverDispatchPayload, "workingLanguage"> | object {
  return workingLanguage ? { workingLanguage } : {};
}
function buildRuntimeTransportSourceSignalSnapshot(input: {
  agentControllerRef: string | null;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  route: Extract<
    RuntimeTransportLookupRouteResponse,
    {
      online: true;
    }
  >;
  sourceSignalSnapshot?: OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"];
}): OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] | undefined {
  if (!input.sourceSignalSnapshot) {
    return undefined;
  }
  // Preserve the installed Service's strict snapshot shape. Context is rendered
  // into the existing source text at this transport boundary.
  const {
    requestTimeContext,
    quotedMessage,
    pinnedFiles,
    contextMessages,
    workHandoff,
    evidenceRefs,
    ...sourceSnapshot
  } = input.sourceSignalSnapshot;
  if (
    workHandoff?.files.length &&
    input.route.capabilities.spaceWorkHandoff !== true
  ) {
    throw new Error(
      "Update this Computer's OpenMeld Service before handing off selected files."
    );
  }
  if (
    workHandoff?.schemaVersion === 2 &&
    !input.route.capabilities.runtimeAdapters?.some(
      (adapter) =>
        adapter.adapterId ===
          parseAgentControllerRef(input.agentControllerRef)?.id &&
        (adapter.capabilityDeclaration.executionContextVersion ?? 0) >= 5
    )
  ) {
    throw new Error(
      "service.update_required: Update this Computer's OpenMeld Service before handing off work."
    );
  }
  const snapshot = {
    ...sourceSnapshot,
    ...(workHandoff ? { workHandoff } : {}),
    ...(contextMessages?.length
      ? {
          files: [
            ...new Map(
              [
                ...(sourceSnapshot.files ?? []),
                ...contextMessages.flatMap((message) => message.files ?? []),
              ].map((file) => [`${file.fileId}:${file.revision}`, file])
            ).values(),
          ].slice(0, SPACE_MESSAGE_FILE_MAX_COUNT),
          attachments: [
            ...new Map(
              [
                ...(sourceSnapshot.attachments ?? []),
                ...contextMessages.flatMap(
                  (message) => message.attachments ?? []
                ),
              ].map((attachment) => [attachment.id, attachment])
            ).values(),
          ].slice(0, SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE),
        }
      : {}),
    text: renderDispatchSourceText({
      requestTimeContext,
      evidenceRefs,
      text: sourceSnapshot.text,
      workHandoff,
      quotedMessage,
      contextMessages,
      pinnedFiles,
    }),
  };
  if (routeSupportsLocalFileImageInput(input)) {
    return snapshot;
  }
  const { attachments: _attachments, ...textOnlySnapshot } = snapshot;
  return textOnlySnapshot;
}
function buildRequesterDeliveryFields(input: {
  requesterIsAgentOwner?: boolean;
  separateRequesterConversation?: boolean;
}): Pick<
  RuntimeTransportDeliverDispatchPayload,
  "requesterIsAgentOwner" | "separateRequesterConversation"
> {
  return {
    ...(input.requesterIsAgentOwner === undefined
      ? {}
      : { requesterIsAgentOwner: input.requesterIsAgentOwner }),
    ...(input.separateRequesterConversation
      ? { separateRequesterConversation: true as const }
      : {}),
  };
}
function buildBindingConversationDeliveryFields(
  message: OpenMeldDaemonDispatchQueueMessage,
  conversationId?: string | null
): {
  agentControllerConversationId?: string;
} {
  if (message.executionContext) {
    return {};
  }
  const value = normalizeOptionalText(conversationId);
  return value ? { agentControllerConversationId: value } : {};
}
function routeSupportsLocalFileImageInput(input: {
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  route: Extract<
    RuntimeTransportLookupRouteResponse,
    {
      online: true;
    }
  >;
}): boolean {
  const adapterId = parseAgentControllerRef(
    input.executionIdentity.core.agentControllerRef
  )?.id;
  if (!adapterId) {
    return false;
  }
  return (
    input.route.capabilities.runtimeAdapters?.some(
      (adapter) =>
        adapter.adapterId === adapterId &&
        adapter.capabilityDeclaration.imageInputCapability === "local_file_path"
    ) ?? false
  );
}
export const decideRuntimeTransportRuntimeCoordinatorExecution = async (input: {
  decision: RuntimeTransportRuntimeCoordinatorDecisionRequest;
  env: CoreBindings;
  ownerUserId: string;
}): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> => {
  const parsedRequest =
    runtimeTransportRuntimeCoordinatorDecisionRequestSchema.safeParse(
      input.decision
    );
  if (!parsedRequest.success) {
    return {
      ok: false,
      reasonCode: "runtime_coordinator.decision_request_invalid",
      runtimeCoordinatorExecutionId:
        input.decision.runtimeCoordinatorExecutionId,
      status: "retry_later",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/runtime-coordinator/decide",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportRuntimeCoordinatorDecisionResponseSchema.safeParse(
      response
    );
  if (!parsed.success) {
    return {
      ok: false,
      reasonCode: "runtime_coordinator.decision_unavailable",
      runtimeCoordinatorExecutionId:
        parsedRequest.data.runtimeCoordinatorExecutionId,
      status: "retry_later",
    };
  }
  return parsed.data;
};
export const acceptRuntimeTransportRuntimeCoordinatorHead = async (input: {
  env: CoreBindings;
  head: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest;
  ownerUserId: string;
}): Promise<RuntimeTransportRuntimeCoordinatorHeadAcceptResponse> => {
  const parsedRequest =
    runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema.safeParse(
      input.head
    );
  const targetWakeLifecycleId =
    input.head.targetWakeLifecycleIdentity?.targetWakeLifecycleId ?? "";
  if (!parsedRequest.success) {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_request_invalid",
      status: "retry_later",
      targetWakeLifecycleId,
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/runtime-coordinator/head/accept",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema.safeParse(
      response
    );
  if (!parsed.success) {
    return {
      ok: false,
      primaryDispatchId: null,
      reasonCode: "runtime_coordinator.head_accept_unavailable",
      status: "retry_later",
      targetWakeLifecycleId:
        parsedRequest.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
    };
  }
  return parsed.data;
};
export const recordRuntimeTransportRuntimeCoordinatorHeadNoExecution =
  async (input: {
    env: CoreBindings;
    noExecution: RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest;
    ownerUserId: string;
  }): Promise<RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse> => {
    const parsedRequest =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse(
        input.noExecution
      );
    const targetWakeLifecycleId =
      input.noExecution.targetWakeLifecycleIdentity?.targetWakeLifecycleId ??
      "";
    if (!parsedRequest.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.head_no_execution_request_invalid",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId,
      };
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/head/no-execution",
      body: parsedRequest.data,
    });
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema.safeParse(
        response
      );
    if (!parsed.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.head_no_execution_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsedRequest.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      };
    }
    return parsed.data;
  };
export const recordRuntimeTransportRuntimeCoordinatorHeadPreAgentStop =
  async (input: {
    env: CoreBindings;
    ownerUserId: string;
    preAgentStop: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest;
  }): Promise<RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse> => {
    const parsedRequest =
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema.safeParse(
        input.preAgentStop
      );
    const targetWakeLifecycleId =
      input.preAgentStop.targetWakeLifecycleIdentity?.targetWakeLifecycleId ??
      "";
    if (!parsedRequest.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_request_invalid",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId,
      };
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/head/pre-agent-stop",
      body: parsedRequest.data,
    });
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema.safeParse(
        response
      );
    if (!parsed.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsedRequest.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      };
    }
    return parsed.data;
  };
export const recordRuntimeTransportRuntimeCoordinatorHeadWaiting =
  async (input: {
    env: CoreBindings;
    ownerUserId: string;
    waiting: RuntimeTransportRuntimeCoordinatorHeadWaitingRequest;
  }): Promise<RuntimeTransportRuntimeCoordinatorHeadWaitingResponse> => {
    const parsedRequest =
      runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema.safeParse(
        input.waiting
      );
    const targetWakeLifecycleId =
      input.waiting.targetWakeLifecycleIdentity?.targetWakeLifecycleId ??
      "unknown";
    if (!parsedRequest.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_waiting_request_invalid",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId,
      };
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/head/waiting",
      body: parsedRequest.data,
    });
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema.safeParse(
        response
      );
    if (!parsed.success) {
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_waiting_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsedRequest.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      };
    }
    return parsed.data;
  };
export const readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace =
  async (input: {
    env: CoreBindings;
    includeExecutionContext?: boolean;
    ownerUserId: string;
    request: RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRequest;
  }): Promise<RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse> => {
    const parsedRequest =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema.safeParse(
        input.request
      );
    const targetWakeLifecycleId =
      input.request.targetWakeLifecycleIdentity?.targetWakeLifecycleId ??
      "unknown";
    if (!parsedRequest.success) {
      return projectHeadTraceExecutionContext({
        response: {
          ok: false,
          readStatus: "authority_unavailable",
          reasonCode:
            "runtime_coordinator.head_lifecycle_trace_request_invalid",
          targetWakeLifecycleId,
        },
        includeExecutionContext: input.includeExecutionContext,
      });
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/head/trace",
      ...(input.includeExecutionContext
        ? { query: { executionContext: "1" } }
        : {}),
      body: parsedRequest.data,
    });
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema.safeParse(
        response
      );
    return projectHeadTraceExecutionContext({
      includeExecutionContext: input.includeExecutionContext,
      response: parsed.success
        ? parsed.data
        : {
            ok: false,
            readStatus: "authority_unavailable",
            reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
            targetWakeLifecycleId:
              parsedRequest.data.targetWakeLifecycleIdentity
                .targetWakeLifecycleId,
          },
    });
  };

function projectHeadTraceExecutionContext(input: {
  includeExecutionContext?: boolean;
  response: RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse;
}): RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse {
  if (!input.includeExecutionContext || input.response.executionContext) {
    return input.response;
  }
  return {
    ...input.response,
    executionContext: {
      readStatus: "authority_unavailable",
      reasonCode:
        input.response.readStatus === "authority_unavailable"
          ? input.response.reasonCode
          : "execution_context.diagnostics_not_reported",
    },
  };
}

export const readRuntimeTransportRuntimeCoordinatorPublicationWakeStopEligibility =
  async (input: {
    env: CoreBindings;
    ownerUserId: string;
    wakeStop: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  }): Promise<WakeStopEligibilityReadModel | null> => {
    const request =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse(
        input.wakeStop
      );
    if (!request.success) {
      return null;
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/wake-stop/publication-eligibility",
      body: request.data,
    });
    const parsed = wakeStopEligibilityReadModelSchema
      .nullable()
      .safeParse(response);
    return parsed.success ? parsed.data : null;
  };
export const requestRuntimeTransportRuntimeCoordinatorWakeStop = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  wakeStop: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
}): Promise<RuntimeTransportRuntimeCoordinatorWakeStopResponse> => {
  const parsedRequest =
    runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse(
      input.wakeStop
    );
  if (!parsedRequest.success) {
    return buildRuntimeCoordinatorWakeStopRetryLaterResponse({
      reasonCode: "runtime_coordinator.wake_stop_request_invalid",
      runtimeCoordinatorExecutionId:
        input.wakeStop.runtimeCoordinatorExecutionId ?? null,
      targetProfileId: input.wakeStop.targetProfileId,
    });
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/runtime-coordinator/wake-stop",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportRuntimeCoordinatorWakeStopResponseSchema.safeParse(
      response
    );
  if (!parsed.success) {
    return buildRuntimeCoordinatorWakeStopRetryLaterResponse({
      reasonCode: "runtime_coordinator.wake_stop_unavailable",
      runtimeCoordinatorExecutionId:
        parsedRequest.data.runtimeCoordinatorExecutionId,
      targetProfileId: parsedRequest.data.targetProfileId,
    });
  }
  return parsed.data;
};
export const readRuntimeTransportRuntimeCoordinatorInteraction = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  request: RuntimeTransportRuntimeCoordinatorReadInteractionRequest;
}): Promise<RuntimeTransportRuntimeCoordinatorReadInteractionRevisionResponse> => {
  const parsedRequest =
    runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema.safeParse(
      input.request
    );
  if (!parsedRequest.success) {
    return { interactionUpdatedAtMs: null, pendingInteraction: null };
  }
  const revisionResponse =
    runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema.safeParse(
      await callRuntimeTransportApi({
        env: input.env,
        ownerUserId: input.ownerUserId,
        path: "/runtime-coordinator/interaction/read-revision",
        body: parsedRequest.data,
      })
    );
  if (revisionResponse.success) {
    return revisionResponse.data;
  }
  // A Hub still on an earlier build answers the revision path with
  // not_found. Keep the request visible through the frozen read; the Wake
  // progress revision then stays on the lifecycle time.
  const legacyResponse =
    runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema.safeParse(
      await callRuntimeTransportApi({
        env: input.env,
        ownerUserId: input.ownerUserId,
        path: "/runtime-coordinator/interaction/read",
        body: parsedRequest.data,
      })
    );
  return {
    interactionUpdatedAtMs: null,
    pendingInteraction: legacyResponse.success
      ? legacyResponse.data.pendingInteraction
      : null,
  };
};
export const respondToRuntimeTransportRuntimeCoordinatorInteraction =
  async (input: {
    env: CoreBindings;
    ownerUserId: string;
    request: RuntimeTransportRuntimeCoordinatorRespondInteractionRequest;
  }): Promise<RuntimeTransportRuntimeCoordinatorRespondInteractionResponse> => {
    const parsedRequest =
      runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema.safeParse(
        input.request
      );
    if (!parsedRequest.success) {
      return {
        message: "The interaction response is invalid.",
        ok: false,
        status: "response_invalid",
      };
    }
    const response = await callRuntimeTransportApi({
      env: input.env,
      ownerUserId: input.ownerUserId,
      path: "/runtime-coordinator/interaction/respond",
      body: parsedRequest.data,
    });
    const parsed =
      runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema.safeParse(
        response
      );
    return parsed.success
      ? parsed.data
      : {
          message:
            "OpenMeld could not deliver this answer right now. Please try again.",
          ok: false,
          status: "retry_later",
        };
  };
export const recordRuntimeTransportPreExecutionHandoff = async (input: {
  env: CoreBindings;
  ownerUserId: string;
  handoff: RuntimeTransportPreExecutionHandoffRequest;
}): Promise<RuntimeTransportPreExecutionHandoffResponse> => {
  const parsedRequest =
    runtimeTransportPreExecutionHandoffRequestSchema.safeParse(input.handoff);
  if (!parsedRequest.success) {
    return {
      ok: false,
      reasonCode: "runtime_coordinator.pre_execution_handoff_request_invalid",
      status: "retry_later",
    };
  }
  const response = await callRuntimeTransportApi({
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/runtime-coordinator/pre-execution-handoff",
    body: parsedRequest.data,
  });
  const parsed =
    runtimeTransportPreExecutionHandoffResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      ok: false,
      reasonCode: "runtime_coordinator.pre_execution_handoff_unavailable",
      status: "retry_later",
    };
  }
  return parsed.data;
};
const buildRuntimeCoordinatorWakeStopRetryLaterResponse = (input: {
  reasonCode: string;
  runtimeCoordinatorExecutionId: string | null;
  targetProfileId: string;
}): RuntimeTransportRuntimeCoordinatorWakeStopResponse => ({
  ok: false,
  reasonCode: input.reasonCode,
  runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
  status: "retry_later",
  targetProfileId: input.targetProfileId,
  cancellationState: {
    observedAtMs: Date.now(),
    reasonCode: input.reasonCode,
    status: "delivery_rejected",
  },
});
const parseWaitDispatchResultRequest = (raw: {
  attemptId: string;
  dispatchId: string;
  daemonSessionId: string;
  connectionGeneration: number;
  leaseEpoch: number;
  timeoutMs?: number;
}): RuntimeTransportWaitDispatchResultRequest | null => {
  const parsed = runtimeTransportWaitDispatchResultRequestSchema.safeParse({
    attemptId: normalizeOptionalText(raw.attemptId),
    dispatchId: normalizeOptionalText(raw.dispatchId),
    daemonSessionId: normalizeOptionalText(raw.daemonSessionId),
    connectionGeneration:
      Number.isInteger(raw.connectionGeneration) && raw.connectionGeneration > 0
        ? raw.connectionGeneration
        : null,
    leaseEpoch:
      Number.isInteger(raw.leaseEpoch) && raw.leaseEpoch > 0
        ? raw.leaseEpoch
        : null,
    timeoutMs:
      typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? Math.max(1, Math.trunc(raw.timeoutMs))
        : undefined,
  });
  return parsed.success ? parsed.data : null;
};
const parseWaitDispatchResultResponse = (
  raw: unknown
): RuntimeTransportWaitDispatchResultResponse => {
  const parsed =
    runtimeTransportWaitDispatchResultResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      state: "failed",
      reasonCode: "daemon.delivery.timeout",
    };
  }
  return parsed.data;
};
const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};
