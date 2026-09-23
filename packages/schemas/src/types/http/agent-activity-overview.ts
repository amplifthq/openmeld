import type { z } from "zod/v4";

type OverviewSchemas =
  typeof import("../../schemas/http/agent-activity-overview");
export type AgentActivityOverviewResponse = z.infer<
  OverviewSchemas["agentActivityOverviewResponseSchema"]
>;
