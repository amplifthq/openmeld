import type { z } from "zod/v4";

export type AgentControllerSessionTitle = z.infer<
  typeof import("../../schemas/runtime/agent-controller-session").agentControllerSessionTitleSchema
>;
