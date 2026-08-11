import type { z } from "zod/v4";

type ConversationPolicySchema =
  typeof import("../../schemas/daemon/conversation-contract")["conversationPolicySchema"];
type AgentControllerConversationKindSchema =
  typeof import("../../schemas/daemon/conversation-contract")["agentControllerConversationKindSchema"];
type AgentControllerConversationRefSchema =
  typeof import("../../schemas/daemon/conversation-contract")["agentControllerConversationRefSchema"];

export type ConversationPolicy = z.infer<ConversationPolicySchema>;
export type AgentControllerConversationKind =
  z.infer<AgentControllerConversationKindSchema>;
export type AgentControllerConversationRef =
  z.infer<AgentControllerConversationRefSchema>;
