import type { z } from "zod/v4";

type Schemas =
  typeof import("../../schemas/http/agent-profile-creation-request");

export type AgentProfileCreationApprovalPolicy = z.infer<
  Schemas["agentProfileCreationApprovalPolicySchema"]
>;
export type AgentProfileCreationRequestSource = z.infer<
  Schemas["agentProfileCreationRequestSourceSchema"]
>;
export type AgentProfileCreationSessionStrategy = z.infer<
  Schemas["agentProfileCreationSessionStrategySchema"]
>;
export type AgentProfileCreationRequestStatus = z.infer<
  Schemas["agentProfileCreationRequestStatusSchema"]
>;
export type AgentProfileCreationRequestStatusReason = z.infer<
  Schemas["agentProfileCreationRequestStatusReasonSchema"]
>;
export type AgentProfileCreationRequest = z.infer<
  Schemas["agentProfileCreationRequestSchema"]
>;
export type CreateAgentProfileCreationRequestBody = z.infer<
  Schemas["createAgentProfileCreationRequestBodySchema"]
>;
export type CreateAgentProfileCreationRequestResponse = z.infer<
  Schemas["createAgentProfileCreationRequestResponseSchema"]
>;
export type ListAgentProfileCreationRequestsResponse = z.infer<
  Schemas["listAgentProfileCreationRequestsResponseSchema"]
>;
export type DecideAgentProfileCreationRequestBody = z.infer<
  Schemas["decideAgentProfileCreationRequestBodySchema"]
>;
export type AgentProfileCreationRequestMutationResponse = z.infer<
  Schemas["agentProfileCreationRequestMutationResponseSchema"]
>;
export type AgentProfileCreationApprovalPreference = z.infer<
  Schemas["agentProfileCreationApprovalPreferenceSchema"]
>;
export type SetAgentProfileCreationApprovalPreferenceBody = z.infer<
  Schemas["setAgentProfileCreationApprovalPreferenceBodySchema"]
>;
export type GetAgentProfileCreationApprovalPreferenceResponse = z.infer<
  Schemas["getAgentProfileCreationApprovalPreferenceResponseSchema"]
>;
export type SetAgentProfileCreationApprovalPreferenceResponse = z.infer<
  Schemas["setAgentProfileCreationApprovalPreferenceResponseSchema"]
>;
