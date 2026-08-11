import type { z } from "zod/v4";

type AgentControllerPermissionModeSchema =
  typeof import("../schemas/agent-controller-permission-mode")["agentControllerPermissionModeSchema"];

export type AgentControllerPermissionMode =
  z.infer<AgentControllerPermissionModeSchema>;
