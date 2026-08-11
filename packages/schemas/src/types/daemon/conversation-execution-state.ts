import type { z } from "zod/v4";

type BootstrapTemplateFactsSchema =
  typeof import("../../schemas/daemon/conversation-execution-state")["bootstrapTemplateFactsSchema"];
type ConversationExecutionStateSchema =
  typeof import("../../schemas/daemon/conversation-execution-state")["conversationExecutionStateSchema"];

export type BootstrapTemplateFacts = z.infer<BootstrapTemplateFactsSchema>;
export type ConversationExecutionState =
  z.infer<ConversationExecutionStateSchema>;
