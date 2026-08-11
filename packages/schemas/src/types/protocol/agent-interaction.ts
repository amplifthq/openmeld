import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/protocol/agent-interaction");

export type AgentInteractionKind = z.infer<
  Schemas["agentInteractionKindSchema"]
>;
export type AgentInteractionPermissionOptionIntent = z.infer<
  Schemas["agentInteractionPermissionOptionIntentSchema"]
>;
export type AgentInteractionPermissionOption = z.infer<
  Schemas["agentInteractionPermissionOptionSchema"]
>;
export type AgentInteractionPermissionSubject = z.infer<
  Schemas["agentInteractionPermissionSubjectSchema"]
>;
export type AgentInteractionQuestionOption = z.infer<
  Schemas["agentInteractionQuestionOptionSchema"]
>;
export type AgentInteractionQuestion = z.infer<
  Schemas["agentInteractionQuestionSchema"]
>;
export type AgentInteractionRequest = z.infer<
  Schemas["agentInteractionRequestSchema"]
>;
export type AgentInteractionQuestionAnswer = z.infer<
  Schemas["agentInteractionQuestionAnswerSchema"]
>;
export type AgentInteractionResponse = z.infer<
  Schemas["agentInteractionResponseSchema"]
>;
export type AgentInteractionResolution = z.infer<
  Schemas["agentInteractionResolutionSchema"]
>;
export type AgentInteractionPendingSummary = z.infer<
  Schemas["agentInteractionPendingSummarySchema"]
>;
