import type { z } from "zod/v4";

type CenterAgentMemoryProviderSchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentMemoryProviderSchema"];
type CenterAgentMemoryWipeStatusSchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentMemoryWipeStatusSchema"];
type CenterAgentWipeMemberMemoryResponseSchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentWipeMemberMemoryResponseSchema"];
type CenterAgentOrganizationMemoryPolicyResponseSchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentOrganizationMemoryPolicyResponseSchema"];
type UpdateCenterAgentOrganizationMemoryPolicyBodySchema =
  typeof import("../../schemas/http/center-agent-memory")["updateCenterAgentOrganizationMemoryPolicyBodySchema"];
type CenterAgentRememberForOrganizationBodySchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentRememberForOrganizationBodySchema"];
type CenterAgentRememberForOrganizationResponseSchema =
  typeof import("../../schemas/http/center-agent-memory")["centerAgentRememberForOrganizationResponseSchema"];

export type CenterAgentMemoryProvider =
  z.infer<CenterAgentMemoryProviderSchema>;
export type CenterAgentMemoryWipeStatus =
  z.infer<CenterAgentMemoryWipeStatusSchema>;
export type CenterAgentWipeMemberMemoryResponse =
  z.infer<CenterAgentWipeMemberMemoryResponseSchema>;
export type CenterAgentOrganizationMemoryPolicyResponse =
  z.infer<CenterAgentOrganizationMemoryPolicyResponseSchema>;
export type UpdateCenterAgentOrganizationMemoryPolicyBody =
  z.infer<UpdateCenterAgentOrganizationMemoryPolicyBodySchema>;
export type CenterAgentRememberForOrganizationBody =
  z.infer<CenterAgentRememberForOrganizationBodySchema>;
export type CenterAgentRememberForOrganizationResponse =
  z.infer<CenterAgentRememberForOrganizationResponseSchema>;
