import type { z } from "zod/v4";

type ConversationBootstrapReasonSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["conversationBootstrapReasonSchema"];
type ConversationBootstrapSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["conversationBootstrapSchema"];
type DispatchExecutionSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["dispatchExecutionSchema"];
type LocalRuntimeContextExecutionSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["localRuntimeContextExecutionSchema"];
type LocalRuntimeContextPlanSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["localRuntimeContextPlanSchema"];
type LocalRuntimeContextReasonSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["localRuntimeContextReasonSchema"];
type NextDispatchPlanSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["nextDispatchPlanSchema"];
type AgentControllerConversationResumePlanSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["agentControllerConversationResumePlanSchema"];
type AgentControllerConversationResumeSchema =
  typeof import("../../schemas/daemon/conversation-lifecycle")["agentControllerConversationResumeSchema"];

export type ConversationBootstrapReason =
  z.infer<ConversationBootstrapReasonSchema>;
export type ConversationBootstrap = z.infer<ConversationBootstrapSchema>;
export type DispatchExecution = z.infer<DispatchExecutionSchema>;
export type LocalRuntimeContextExecution =
  z.infer<LocalRuntimeContextExecutionSchema>;
export type LocalRuntimeContextPlan = z.infer<LocalRuntimeContextPlanSchema>;
export type LocalRuntimeContextReason =
  z.infer<LocalRuntimeContextReasonSchema>;
export type NextDispatchPlan = z.infer<NextDispatchPlanSchema>;
export type AgentControllerConversationResume =
  z.infer<AgentControllerConversationResumeSchema>;
export type AgentControllerConversationResumePlan =
  z.infer<AgentControllerConversationResumePlanSchema>;
