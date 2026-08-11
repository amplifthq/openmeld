import type { z } from "zod/v4";
import type {
  agentControllerTaskLifecycleEventRejectedReasonSchema,
  agentControllerTaskLifecycleEventSourceSchema,
  agentControllerTaskLifecycleEventTypeSchema,
  runtimeAgentControllerReportRejectedReasonSchema,
  runtimeAgentControllerReportStatusSchema,
  runtimeProviderConversationProofMethodSchema,
  runtimeProviderConversationProofProviderSchema,
  runtimeProviderConversationProofRejectedReasonSchema,
  runtimeProviderConversationProofStatusSchema,
  runtimeRegistrationRejectedReasonSchema,
  runtimeReportingRouteParamsSchema,
  runtimeReportingRuntimeIdSchema,
  submitAgentControllerTaskLifecycleEventItemSchema,
  submitAgentControllerTaskLifecycleEventResultSchema,
  submitAgentControllerTaskLifecycleEventsBodySchema,
  submitAgentControllerTaskLifecycleEventsResponseSchema,
  submitAgentControllerTaskLifecycleEventsRpcInputSchema,
  submitRuntimeAgentControllerReportItemSchema,
  submitRuntimeAgentControllerReportResultSchema,
  submitRuntimeAgentControllerReportsBodySchema,
  submitRuntimeAgentControllerReportsResponseSchema,
  submitRuntimeProviderConversationProofItemSchema,
  submitRuntimeProviderConversationProofResultSchema,
  submitRuntimeProviderConversationProofsBodySchema,
  submitRuntimeProviderConversationProofsResponseSchema,
  submitRuntimeRegistrationBodySchema,
  submitRuntimeRegistrationResponseSchema,
} from "../../schemas/http/runtime-reporting";

export type AgentControllerTaskLifecycleEventType = z.infer<
  typeof agentControllerTaskLifecycleEventTypeSchema
>;
export type AgentControllerTaskLifecycleEventSource = z.infer<
  typeof agentControllerTaskLifecycleEventSourceSchema
>;
export type AgentControllerTaskLifecycleEventRejectedReason = z.infer<
  typeof agentControllerTaskLifecycleEventRejectedReasonSchema
>;
export type SubmitAgentControllerTaskLifecycleEventItem = z.infer<
  typeof submitAgentControllerTaskLifecycleEventItemSchema
>;
export type SubmitAgentControllerTaskLifecycleEventsBody = z.infer<
  typeof submitAgentControllerTaskLifecycleEventsBodySchema
>;
export type SubmitAgentControllerTaskLifecycleEventsRpcInput = z.infer<
  typeof submitAgentControllerTaskLifecycleEventsRpcInputSchema
>;
export type SubmitAgentControllerTaskLifecycleEventResult = z.infer<
  typeof submitAgentControllerTaskLifecycleEventResultSchema
>;
export type SubmitAgentControllerTaskLifecycleEventsResponse = z.infer<
  typeof submitAgentControllerTaskLifecycleEventsResponseSchema
>;

export type RuntimeReportingRouteParams = z.infer<
  typeof runtimeReportingRouteParamsSchema
>;
export type RuntimeReportingRuntimeId = z.infer<
  typeof runtimeReportingRuntimeIdSchema
>;
export type SubmitRuntimeRegistrationBody = z.infer<
  typeof submitRuntimeRegistrationBodySchema
>;
export type RuntimeRegistrationRejectedReason = z.infer<
  typeof runtimeRegistrationRejectedReasonSchema
>;
export type SubmitRuntimeRegistrationResponse = z.infer<
  typeof submitRuntimeRegistrationResponseSchema
>;
export type RuntimeAgentControllerReportStatus = z.infer<
  typeof runtimeAgentControllerReportStatusSchema
>;
export type SubmitRuntimeAgentControllerReportItem = z.infer<
  typeof submitRuntimeAgentControllerReportItemSchema
>;
export type SubmitRuntimeAgentControllerReportsBody = z.infer<
  typeof submitRuntimeAgentControllerReportsBodySchema
>;
export type RuntimeAgentControllerReportRejectedReason = z.infer<
  typeof runtimeAgentControllerReportRejectedReasonSchema
>;
export type SubmitRuntimeAgentControllerReportResult = z.infer<
  typeof submitRuntimeAgentControllerReportResultSchema
>;
export type SubmitRuntimeAgentControllerReportsResponse = z.infer<
  typeof submitRuntimeAgentControllerReportsResponseSchema
>;
export type RuntimeProviderConversationProofProvider = z.infer<
  typeof runtimeProviderConversationProofProviderSchema
>;
export type RuntimeProviderConversationProofMethod = z.infer<
  typeof runtimeProviderConversationProofMethodSchema
>;
export type RuntimeProviderConversationProofStatus = z.infer<
  typeof runtimeProviderConversationProofStatusSchema
>;
export type SubmitRuntimeProviderConversationProofItem = z.infer<
  typeof submitRuntimeProviderConversationProofItemSchema
>;
export type SubmitRuntimeProviderConversationProofsBody = z.infer<
  typeof submitRuntimeProviderConversationProofsBodySchema
>;
export type RuntimeProviderConversationProofRejectedReason = z.infer<
  typeof runtimeProviderConversationProofRejectedReasonSchema
>;
export type SubmitRuntimeProviderConversationProofResult = z.infer<
  typeof submitRuntimeProviderConversationProofResultSchema
>;
export type SubmitRuntimeProviderConversationProofsResponse = z.infer<
  typeof submitRuntimeProviderConversationProofsResponseSchema
>;
