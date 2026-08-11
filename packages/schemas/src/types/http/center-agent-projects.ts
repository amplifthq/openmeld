import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-projects");

export type CenterAgentProject = z.infer<Schemas["centerAgentProjectSchema"]>;
export type CenterAgentListProjectsToolRpcInput = z.infer<
  Schemas["centerAgentListProjectsToolRpcInputSchema"]
>;
export type CenterAgentListProjectsToolResponse = z.infer<
  Schemas["centerAgentListProjectsToolResponseSchema"]
>;
export type CenterAgentCreateProjectToolRpcInput = z.infer<
  Schemas["centerAgentCreateProjectToolRpcInputSchema"]
>;
export type CenterAgentCreateProjectToolResponse = z.infer<
  Schemas["centerAgentCreateProjectToolResponseSchema"]
>;
export type CenterAgentUpdateProjectToolRpcInput = z.infer<
  Schemas["centerAgentUpdateProjectToolRpcInputSchema"]
>;
export type CenterAgentUpdateProjectToolResponse = z.infer<
  Schemas["centerAgentUpdateProjectToolResponseSchema"]
>;
export type CenterAgentSetAgentProfileDefaultProjectToolRpcInput = z.infer<
  Schemas["centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema"]
>;
export type CenterAgentSetAgentProfileDefaultProjectToolResponse = z.infer<
  Schemas["centerAgentSetAgentProfileDefaultProjectToolResponseSchema"]
>;
export type CenterAgentPrepareRemoveProjectToolRpcInput = z.infer<
  Schemas["centerAgentPrepareRemoveProjectToolRpcInputSchema"]
>;
export type CenterAgentPrepareRemoveProjectToolResponse = z.infer<
  Schemas["centerAgentPrepareRemoveProjectToolResponseSchema"]
>;
export type CenterAgentRemoveProjectToolRpcInput = z.infer<
  Schemas["centerAgentRemoveProjectToolRpcInputSchema"]
>;
export type CenterAgentRemoveProjectToolResponse = z.infer<
  Schemas["centerAgentRemoveProjectToolResponseSchema"]
>;
