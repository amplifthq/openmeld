import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { messageChannelConversationLocatorSchema } from "../runtime/message-channel";
import { remoteAgentTurnRuntimeEvidenceSchema } from "../runtime/remote-agent-worker";

export const CENTER_AGENT_TURN_DIAGNOSTICS_DEFAULT_LIMIT = 10;
export const CENTER_AGENT_TURN_DIAGNOSTICS_MAX_LIMIT = 20;
export const CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS = 2000;

export const centerAgentTurnDiagnosticStatusSchema = z.enum([
  "guardrail_rejected",
  "flag_rejected",
  "worker_unavailable",
  "submitted",
  "accepted",
  "retry_observed",
  "completed",
  "callback_rejected",
  "failed",
]);

export const centerAgentTurnDiagnosticPublicationStateSchema = z.enum([
  "claimed",
  "outcome_unknown",
  "published",
]);

const nullableTimestampMsSchema = z.number().int().nonnegative().nullable();
const nullableIdentifierSchema = z.string().trim().min(1).nullable();

export const centerAgentTurnDiagnosticConversationSourceSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      isCurrentConversation: z.boolean(),
      kind: z.literal("space"),
      spaceId: z.string().trim().min(1),
    }),
    z.strictObject({
      channelId: z.string().trim().min(1),
      isCurrentConversation: z.boolean(),
      kind: z.literal("slack"),
      teamId: z.string().trim().min(1),
      threadTs: z.string().trim().min(1),
    }),
    z.strictObject({
      isCurrentConversation: z.boolean(),
      kind: z.literal("message_channel"),
      locator: messageChannelConversationLocatorSchema,
    }),
  ])
  .nullable();

export const centerAgentTurnDiagnosticSchema = z.strictObject({
  acceptedAtMs: nullableTimestampMsSchema,
  callbackReceivedAtMs: nullableTimestampMsSchema,
  completedAtMs: nullableTimestampMsSchema,
  conversationSource:
    centerAgentTurnDiagnosticConversationSourceSchema.optional(),
  createdAtMs: z.number().int().nonnegative(),
  deliveryId: z.string().trim().min(1),
  dispatchId: z.string().trim().min(1),
  failureCode: nullableIdentifierSchema,
  failureDetail: z
    .string()
    .max(CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS)
    .nullable(),
  failureDetailTruncated: z.boolean(),
  publicationState: centerAgentTurnDiagnosticPublicationStateSchema.nullable(),
  publishedResultId: nullableIdentifierSchema,
  runtimeEvidence: remoteAgentTurnRuntimeEvidenceSchema
    .omit({ submissionId: true })
    .nullable(),
  runtimeEvidenceStatus: z.enum(["available", "not_recorded", "unavailable"]),
  status: centerAgentTurnDiagnosticStatusSchema,
  submissionId: nullableIdentifierSchema,
  submittedAtMs: nullableTimestampMsSchema,
  triggerMessageId: z.string().trim().min(1),
  updatedAtMs: z.number().int().nonnegative(),
});

export const centerAgentReadTurnDiagnosticsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_TURN_DIAGNOSTICS_MAX_LIMIT)
    .optional(),
});

export const centerAgentReadTurnDiagnosticsResponseSchema = z.strictObject({
  currentTurn: centerAgentTurnDiagnosticSchema,
  organizationId: z.string().trim().min(1),
  previousTurns: z
    .array(centerAgentTurnDiagnosticSchema)
    .max(CENTER_AGENT_TURN_DIAGNOSTICS_MAX_LIMIT),
});
