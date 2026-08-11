import type { z } from "zod/v4";

type AgentContextResolutionSchema =
  typeof import("../../schemas/daemon/controller-contract")["agentContextResolutionSchema"];
type RuntimeAgentControllerConversationIdMappingSpecSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeAgentControllerConversationIdMappingSpecSchema"];
type RuntimeAgentControllerLaunchCandidateSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeAgentControllerLaunchCandidateSchema"];
type RuntimeAgentControllerLaunchContractSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeAgentControllerLaunchContractSchema"];
type RuntimeAgentControllerSettingsSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeAgentControllerSettingsSchema"];
type RuntimeDispatchPolicySchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeDispatchPolicySchema"];
type RuntimeStreamingModeSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeStreamingModeSchema"];
type RuntimeTransportModeSchema =
  typeof import("../../schemas/daemon/controller-contract")["runtimeTransportModeSchema"];

export type AgentContextResolution = z.infer<AgentContextResolutionSchema>;
export type RuntimeAgentControllerConversationIdMappingSpec =
  z.infer<RuntimeAgentControllerConversationIdMappingSpecSchema>;
export type RuntimeAgentControllerLaunchCandidate =
  z.infer<RuntimeAgentControllerLaunchCandidateSchema>;
export type RuntimeAgentControllerLaunchContract =
  z.infer<RuntimeAgentControllerLaunchContractSchema>;
export type RuntimeAgentControllerSettings =
  z.infer<RuntimeAgentControllerSettingsSchema>;
export type RuntimeDispatchPolicy = z.infer<RuntimeDispatchPolicySchema>;
export type RuntimeStreamingMode = z.infer<RuntimeStreamingModeSchema>;
export type RuntimeTransportMode = z.infer<RuntimeTransportModeSchema>;
