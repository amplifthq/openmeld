import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/agent-profile-work-recovery");

export type AgentProfileWorkRecoveryAction = z.infer<
  Schemas["agentProfileWorkRecoveryActionSchema"]
>;
export type AgentProfileWorkRecoveryRouteParams = z.infer<
  Schemas["agentProfileWorkRecoveryRouteParamsSchema"]
>;
export type ExecuteAgentProfileWorkRecoveryBody = z.infer<
  Schemas["executeAgentProfileWorkRecoveryBodySchema"]
>;
export type ExecuteAgentProfileWorkRecoveryResponse = z.infer<
  Schemas["executeAgentProfileWorkRecoveryResponseSchema"]
>;
