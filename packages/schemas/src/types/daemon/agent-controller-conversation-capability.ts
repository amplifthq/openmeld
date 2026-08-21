import type { z } from "zod/v4";

type AgentControllerConversationCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationCapabilitySchema"];
type AgentControllerConversationDiscoverCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationDiscoverCapabilitySchema"];
type AgentControllerConversationExternalImportCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationExternalImportCapabilitySchema"];
type AgentControllerConversationForkCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationForkCapabilitySchema"];
type AgentControllerConversationResumeCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationResumeCapabilitySchema"];
type AgentControllerConversationTurnOverrideCapabilitySchema =
  typeof import("../../schemas/daemon/agent-controller-conversation-capability")["agentControllerConversationTurnOverrideCapabilitySchema"];

export type AgentControllerConversationCapability =
  z.infer<AgentControllerConversationCapabilitySchema>;
export type AgentControllerConversationDiscoverCapability =
  z.infer<AgentControllerConversationDiscoverCapabilitySchema>;
export type AgentControllerConversationExternalImportCapability =
  z.infer<AgentControllerConversationExternalImportCapabilitySchema>;
export type AgentControllerConversationForkCapability =
  z.infer<AgentControllerConversationForkCapabilitySchema>;
export type AgentControllerConversationResumeCapability =
  z.infer<AgentControllerConversationResumeCapabilitySchema>;
export type AgentControllerConversationTurnOverrideCapability =
  z.infer<AgentControllerConversationTurnOverrideCapabilitySchema>;
