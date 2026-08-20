import type { z } from "zod/v4";

type AgentControllerInterfaceAuthSnapshotSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceAuthSnapshotSchema"];
type AgentControllerInterfaceAuthStatusSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceAuthStatusSchema"];
type AgentControllerInterfaceCapabilitiesSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceCapabilitiesSchema"];
type AgentControllerInterfaceCheckSnapshotSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceCheckSnapshotSchema"];
type AgentControllerInterfaceCheckStatusSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceCheckStatusSchema"];
type AgentControllerInterfaceLaunchSnapshotSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceLaunchSnapshotSchema"];
type AgentControllerInterfaceModelSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceModelSchema"];
type AgentControllerInterfaceNativeInterfaceSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceNativeInterfaceSchema"];
type AgentControllerInterfaceSkillSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceSkillSchema"];
type AgentControllerInterfaceSnapshotSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceSnapshotSchema"];
type AgentControllerInterfaceStatusSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceStatusSchema"];
type AgentControllerInterfaceUsageLimitSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceUsageLimitSchema"];
type AgentControllerInterfaceVersionAdvisorySchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceVersionAdvisorySchema"];
type AgentControllerInterfaceVersionAdvisoryStatusSchema =
  typeof import("../../schemas/runtime/agent-controller-interface")["agentControllerInterfaceVersionAdvisoryStatusSchema"];

export type AgentControllerInterfaceAuthSnapshot =
  z.infer<AgentControllerInterfaceAuthSnapshotSchema>;
export type AgentControllerInterfaceAuthStatus =
  z.infer<AgentControllerInterfaceAuthStatusSchema>;
export type AgentControllerInterfaceCapabilities =
  z.infer<AgentControllerInterfaceCapabilitiesSchema>;
export type AgentControllerInterfaceCheckSnapshot =
  z.infer<AgentControllerInterfaceCheckSnapshotSchema>;
export type AgentControllerInterfaceCheckStatus =
  z.infer<AgentControllerInterfaceCheckStatusSchema>;
export type AgentControllerInterfaceLaunchSnapshot =
  z.infer<AgentControllerInterfaceLaunchSnapshotSchema>;
export type AgentControllerInterfaceModel =
  z.infer<AgentControllerInterfaceModelSchema>;
export type AgentControllerInterfaceNativeInterface =
  z.infer<AgentControllerInterfaceNativeInterfaceSchema>;
export type AgentControllerInterfaceSkill =
  z.infer<AgentControllerInterfaceSkillSchema>;
export type AgentControllerInterfaceSnapshot =
  z.infer<AgentControllerInterfaceSnapshotSchema>;
export type AgentControllerInterfaceStatus =
  z.infer<AgentControllerInterfaceStatusSchema>;
export type AgentControllerInterfaceUsageLimit =
  z.infer<AgentControllerInterfaceUsageLimitSchema>;
export type AgentControllerInterfaceVersionAdvisory =
  z.infer<AgentControllerInterfaceVersionAdvisorySchema>;
export type AgentControllerInterfaceVersionAdvisoryStatus =
  z.infer<AgentControllerInterfaceVersionAdvisoryStatusSchema>;
