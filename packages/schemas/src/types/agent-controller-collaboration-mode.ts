import type { z } from "zod/v4";

type AgentControllerCollaborationModeSchema =
  typeof import("../schemas/agent-controller-collaboration-mode")["agentControllerCollaborationModeSchema"];

export type AgentControllerCollaborationMode =
  z.infer<AgentControllerCollaborationModeSchema>;
