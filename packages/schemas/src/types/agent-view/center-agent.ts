import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/agent-view/center-agent");

export type CenterAgentOrganizationTarget = z.infer<
  Schemas["centerAgentOrganizationTargetSchema"]
>;

export type CenterAgentOrganizationScope = z.infer<
  Schemas["centerAgentOrganizationScopeSchema"]
>;
