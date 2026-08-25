import * as z from "zod/v4";

export const conversationBootstrapReasonSchema = z.enum([
  "missing_bootstrap_state",
  "compatibility_recreate",
  "template_changed",
  "idle_stale",
  "dispatch_count_stale",
  "context_healed",
  "context_replaced",
]);

export const localRuntimeContextReasonSchema = z.enum([
  "first_local_runtime_context",
  "workspace_changed",
  "transport_mode_changed",
  "policy_changed",
  "execution_state_missing",
  "controller_changed",
]);

export const agentControllerConversationResumePlanBlockedReasonSchema = z.enum([
  "controller_changed",
]);

export const agentControllerConversationResumePlanSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("not_bound"),
    }),
    z.strictObject({
      status: z.literal("continue_existing"),
    }),
    z.strictObject({
      status: z.literal("blocked"),
      reason: agentControllerConversationResumePlanBlockedReasonSchema,
    }),
  ]
);

export const localRuntimeContextPlanSchema = z.strictObject({
  status: z.enum(["reuse", "recreate"]),
  reason: z.union([localRuntimeContextReasonSchema, z.null()]),
});

export const conversationBootstrapSchema = z.discriminatedUnion("status", [
  z.strictObject({
    reason: z.null(),
    status: z.literal("applied"),
  }),
  z.strictObject({
    reason: conversationBootstrapReasonSchema,
    status: z.literal("pending"),
  }),
]);

export const nextDispatchPlanSchema = z.strictObject({
  agentControllerConversationResume:
    agentControllerConversationResumePlanSchema,
  localRuntimeContext: localRuntimeContextPlanSchema,
  bootstrap: conversationBootstrapSchema,
});

export const agentControllerConversationResumeSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("not_bound"),
    }),
    z.strictObject({
      status: z.literal("continued"),
    }),
    z.strictObject({
      status: z.literal("replaced_by_provider"),
    }),
  ]
);

export const localRuntimeContextExecutionSchema = z.strictObject({
  status: z.enum(["reused", "recreated"]),
  reason: z.union([localRuntimeContextReasonSchema, z.null()]),
});

export const dispatchExecutionSchema = z.strictObject({
  agentControllerConversationResume: agentControllerConversationResumeSchema,
  localRuntimeContext: localRuntimeContextExecutionSchema,
  bootstrap: conversationBootstrapSchema,
});
