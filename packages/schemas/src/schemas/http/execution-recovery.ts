import { z } from "zod/v4";

const requiredIdentifierSchema = z.string().trim().min(1).max(512);
const nullableIdentifierSchema = requiredIdentifierSchema.nullable();

export const executionRecoveryActionSchema = z.enum([
  "recover_result",
  "resume_controller_conversation",
  "retry_as_new_execution",
]);

export const executionRecoveryTierSchema = z.enum([
  "durable_result_replay",
  "exact_controller_conversation_resume",
  "fresh_execution",
  "manual_review",
  "none",
]);

export const executionRecoveryDestinationSchema = z.discriminatedUnion(
  "surface",
  [
    z.strictObject({
      surface: z.literal("space"),
      spaceId: requiredIdentifierSchema,
      threadId: nullableIdentifierSchema,
    }),
    z.strictObject({
      surface: z.enum(["slack", "lark"]),
      conversationId: requiredIdentifierSchema,
      messageId: nullableIdentifierSchema,
      spaceId: requiredIdentifierSchema,
    }),
  ]
);

export const executionRecoveryIdentitySchema = z.strictObject({
  spaceId: requiredIdentifierSchema,
  dispatchId: requiredIdentifierSchema,
  attemptId: nullableIdentifierSchema,
  taskId: nullableIdentifierSchema,
  targetProfileId: requiredIdentifierSchema,
  runtimeCoordinatorExecutionId: nullableIdentifierSchema,
  resultRef: nullableIdentifierSchema,
  agentControllerRef: nullableIdentifierSchema,
  agentControllerConversationId: nullableIdentifierSchema,
});

export const executionRecoveryActionCapabilitySchema = z.strictObject({
  action: executionRecoveryActionSchema,
  enabled: z.boolean(),
  label: z.enum([
    "Recover result",
    "Recover reply",
    // Mixed-version compatibility for projections created before the user-facing
    // action was renamed. Current producers emit "Recover reply".
    "Continue conversation",
    "Retry as new execution",
  ]),
  reasonCode: requiredIdentifierSchema,
  warning: z.string().trim().min(1).max(1000).nullable(),
});

export const executionRecoveryProjectionSchema = z.strictObject({
  identity: executionRecoveryIdentitySchema,
  destination: executionRecoveryDestinationSchema,
  tier: executionRecoveryTierSchema,
  status: z.enum([
    "available",
    "in_progress",
    "recovered",
    "outcome_unknown",
    "unavailable",
  ]),
  recommendedAction: executionRecoveryActionSchema.nullable(),
  actions: z.strictObject({
    recoverResult: executionRecoveryActionCapabilitySchema,
    resumeControllerConversation: executionRecoveryActionCapabilitySchema,
    retryAsNewExecution: executionRecoveryActionCapabilitySchema,
  }),
  recoveredPublicationId: nullableIdentifierSchema,
  updatedAtMs: z.number().int().nonnegative(),
});

export const inspectExecutionRecoveryQuerySchema = z.strictObject({
  dispatchId: requiredIdentifierSchema,
});

export const inspectExecutionRecoveryResponseSchema = z.strictObject({
  recovery: executionRecoveryProjectionSchema,
});

export const executeExecutionRecoveryBodySchema = z.strictObject({
  action: executionRecoveryActionSchema,
  operationId: requiredIdentifierSchema,
  expectedIdentity: executionRecoveryIdentitySchema,
  destination: executionRecoveryDestinationSchema,
});

export const executeExecutionRecoveryResponseSchema = z.strictObject({
  status: z.enum([
    "already_completed",
    "completed",
    "new_execution_requested",
    "outcome_unknown",
    "retry_later",
  ]),
  action: executionRecoveryActionSchema,
  operationId: requiredIdentifierSchema,
  recovery: executionRecoveryProjectionSchema,
  publicationId: nullableIdentifierSchema,
  newExecutionId: nullableIdentifierSchema,
  reasonCode: requiredIdentifierSchema,
});
