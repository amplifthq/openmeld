import type { z } from "zod/v4";

type RemoteAgentCoreCallbackBodySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentCoreCallbackBodySchema"];
type RemoteAgentCoreCallbackResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentCoreCallbackResponseSchema"];
type RoutineWorkflowContinuationEventPayloadSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["routineWorkflowContinuationEventPayloadSchema"];
type RemoteAgentWorkerAuthorContextSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerAuthorContextSchema"];
type RemoteAgentWorkerAdmissionRejectedResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerAdmissionRejectedResponseSchema"];
type RemoteAgentWorkerAdmissionRejectionCodeSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerAdmissionRejectionCodeSchema"];
type RemoteAgentWorkerSubmissionStatusSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmissionStatusSchema"];
type RemoteAgentWorkerCancellationRequestSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerCancellationRequestSchema"];
type RemoteAgentWorkerCancellationResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerCancellationResponseSchema"];
type RemoteAgentWorkerExecutionProgressKindSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerExecutionProgressKindSchema"];
type RemoteAgentWorkerExecutionQuerySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerExecutionQuerySchema"];
type RemoteAgentWorkerExecutionQueryResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerExecutionQueryResponseSchema"];
type RemoteAgentWorkerExecutionStateSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerExecutionStateSchema"];
type RemoteAgentWorkerExecutionStatusSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerExecutionStatusSchema"];
type RemoteAgentWorkerInputAttachmentSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerInputAttachmentSchema"];
type RemoteAgentWorkerSubmitMessagesResultSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitMessagesResultSchema"];
type RemoteAgentWorkerSubmitTurnRequestSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnRequestSchema"];
type RemoteAgentWorkerSubmitTurnRequestV1Schema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnRequestV1Schema"];
type RemoteAgentWorkerSubmitTurnRequestV2Schema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnRequestV2Schema"];
type RemoteAgentWorkerSubmitTurnRequestV3Schema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnRequestV3Schema"];
type RemoteAgentWorkerSubmitTurnRequestV4Schema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnRequestV4Schema"];
type RemoteAgentConversationContinuityContextSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentConversationContinuityContextSchema"];
type RemoteAgentConversationContinuityEntrySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentConversationContinuityEntrySchema"];
type RemoteAgentRuntimeConversationSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentRuntimeConversationSchema"];
type RemoteAgentWorkerConversationIdentitySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerConversationIdentitySchema"];
type RemoteAgentWorkerSubmitTurnResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerSubmitTurnResponseSchema"];
type RemoteAgentRuntimeEvidenceOutcomeReasonCodeSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema"];
type RemoteAgentAdmissionStageOperationSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentAdmissionStageOperationSchema"];
type RemoteAgentRpcOperationSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentRpcOperationSchema"];
type RemoteAgentWorkerReadUsageDiagnosticsRequestSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerReadUsageDiagnosticsRequestSchema"];
type RemoteAgentWorkerRuntimeDiagnosticsRequestSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerRuntimeDiagnosticsRequestSchema"];
type RemoteAgentWorkerRuntimeDiagnosticsResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerRuntimeDiagnosticsResponseSchema"];
type RemoteAgentWorkerTurnMessageSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentWorkerTurnMessageSchema"];
type RemoteAgentStreamDeltaCallbackBodySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentStreamDeltaCallbackBodySchema"];
type RemoteAgentStreamDeltaCallbackResponseSchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentStreamDeltaCallbackResponseSchema"];
type RemoteAgentStreamPartCallbackBodySchema =
  typeof import("../../schemas/runtime/remote-agent-worker")["remoteAgentStreamPartCallbackBodySchema"];

export type RemoteAgentCoreCallbackBody =
  z.infer<RemoteAgentCoreCallbackBodySchema>;
export type RemoteAgentCoreCallbackResponse =
  z.infer<RemoteAgentCoreCallbackResponseSchema>;
export type RoutineWorkflowContinuationEventPayload =
  z.infer<RoutineWorkflowContinuationEventPayloadSchema>;
export type RemoteAgentWorkerAuthorContext =
  z.infer<RemoteAgentWorkerAuthorContextSchema>;
export type RemoteAgentWorkerAdmissionRejectedResponse =
  z.infer<RemoteAgentWorkerAdmissionRejectedResponseSchema>;
export type RemoteAgentWorkerAdmissionRejectionCode =
  z.infer<RemoteAgentWorkerAdmissionRejectionCodeSchema>;
export type RemoteAgentWorkerSubmissionStatus =
  z.infer<RemoteAgentWorkerSubmissionStatusSchema>;
export type RemoteAgentWorkerCancellationRequest =
  z.infer<RemoteAgentWorkerCancellationRequestSchema>;
export type RemoteAgentWorkerCancellationResponse =
  z.infer<RemoteAgentWorkerCancellationResponseSchema>;
export type RemoteAgentWorkerExecutionProgressKind =
  z.infer<RemoteAgentWorkerExecutionProgressKindSchema>;
export type RemoteAgentWorkerExecutionQuery =
  z.infer<RemoteAgentWorkerExecutionQuerySchema>;
export type RemoteAgentWorkerExecutionQueryResponse =
  z.infer<RemoteAgentWorkerExecutionQueryResponseSchema>;
export type RemoteAgentWorkerExecutionState =
  z.infer<RemoteAgentWorkerExecutionStateSchema>;
export type RemoteAgentWorkerExecutionStatus =
  z.infer<RemoteAgentWorkerExecutionStatusSchema>;
export type RemoteAgentWorkerInputAttachment =
  z.infer<RemoteAgentWorkerInputAttachmentSchema>;
export type RemoteAgentWorkerSubmitMessagesResult =
  z.infer<RemoteAgentWorkerSubmitMessagesResultSchema>;
export type RemoteAgentWorkerSubmitTurnRequest =
  z.infer<RemoteAgentWorkerSubmitTurnRequestSchema>;
export type RemoteAgentWorkerSubmitTurnRequestV1 =
  z.infer<RemoteAgentWorkerSubmitTurnRequestV1Schema>;
export type RemoteAgentWorkerSubmitTurnRequestV2 =
  z.infer<RemoteAgentWorkerSubmitTurnRequestV2Schema>;
export type RemoteAgentWorkerSubmitTurnRequestV3 =
  z.infer<RemoteAgentWorkerSubmitTurnRequestV3Schema>;
export type RemoteAgentWorkerSubmitTurnRequestV4 =
  z.infer<RemoteAgentWorkerSubmitTurnRequestV4Schema>;
export type RemoteAgentConversationContinuityContext =
  z.infer<RemoteAgentConversationContinuityContextSchema>;
export type RemoteAgentConversationContinuityEntry =
  z.infer<RemoteAgentConversationContinuityEntrySchema>;
export type RemoteAgentRuntimeConversation =
  z.infer<RemoteAgentRuntimeConversationSchema>;
export type RemoteAgentWorkerConversationIdentity =
  z.infer<RemoteAgentWorkerConversationIdentitySchema>;
export type RemoteAgentWorkerSubmitTurnResponse =
  z.infer<RemoteAgentWorkerSubmitTurnResponseSchema>;
export type RemoteAgentRuntimeEvidenceOutcomeReasonCode =
  z.infer<RemoteAgentRuntimeEvidenceOutcomeReasonCodeSchema>;
export type RemoteAgentAdmissionStageOperation =
  z.infer<RemoteAgentAdmissionStageOperationSchema>;
export type RemoteAgentRpcOperation = z.infer<RemoteAgentRpcOperationSchema>;
export type RemoteAgentWorkerReadUsageDiagnosticsRequest =
  z.infer<RemoteAgentWorkerReadUsageDiagnosticsRequestSchema>;
export type RemoteAgentWorkerRuntimeDiagnosticsRequest =
  z.infer<RemoteAgentWorkerRuntimeDiagnosticsRequestSchema>;
export type RemoteAgentWorkerRuntimeDiagnosticsResponse =
  z.infer<RemoteAgentWorkerRuntimeDiagnosticsResponseSchema>;
export type RemoteAgentWorkerTurnMessage =
  z.infer<RemoteAgentWorkerTurnMessageSchema>;
export type RemoteAgentStreamDeltaCallbackBody =
  z.infer<RemoteAgentStreamDeltaCallbackBodySchema>;
export type RemoteAgentStreamDeltaCallbackResponse =
  z.infer<RemoteAgentStreamDeltaCallbackResponseSchema>;
export type RemoteAgentStreamPartCallbackBody =
  z.infer<RemoteAgentStreamPartCallbackBodySchema>;
