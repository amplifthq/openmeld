import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

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

export const centerAgentTurnDiagnosticSchema = z.strictObject({
  acceptedAtMs: nullableTimestampMsSchema,
  callbackReceivedAtMs: nullableTimestampMsSchema,
  completedAtMs: nullableTimestampMsSchema,
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
