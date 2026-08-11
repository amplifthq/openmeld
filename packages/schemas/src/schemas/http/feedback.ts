import { z } from "zod/v4";

export const FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE =
  "feedback.submit.invalid_input" as const;
export const FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE =
  "feedback.submit.inbox_not_found" as const;
export const FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE =
  "feedback.submit.rate_limited" as const;
export const FEEDBACK_SUBMIT_DISABLED_ERROR_CODE =
  "feedback.submit.disabled" as const;
export const FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE =
  "feedback.issue.not_found" as const;
export const FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE =
  "feedback.issue.invalid_input" as const;
export const FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE =
  "feedback.issue.invalid_transition" as const;

export const FEEDBACK_SUBMIT_ERROR_CODES = [
  FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
  FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
  FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
] as const;

export const FEEDBACK_ISSUE_ERROR_CODES = [
  FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE,
  FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE,
] as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();

export const FEEDBACK_ISSUE_CATEGORIES = [
  "bug",
  "experience",
  "idea",
  "question",
] as const;

export const feedbackIssueCategorySchema = z.enum(FEEDBACK_ISSUE_CATEGORIES);

export const feedbackSubmitterKindSchema = z.enum([
  "human",
  "local_agent",
  "center_agent",
]);

export const FEEDBACK_ISSUE_STATUSES = [
  "new",
  "dismissed",
  "investigating",
  "ticketed",
  "needs_human",
  "resolved",
] as const;

export const feedbackIssueStatusSchema = z.enum(FEEDBACK_ISSUE_STATUSES);

export const feedbackSubmitErrorCodeSchema = z.enum(
  FEEDBACK_SUBMIT_ERROR_CODES
);

export const feedbackIssueErrorCodeSchema = z.enum(FEEDBACK_ISSUE_ERROR_CODES);

export const feedbackClientContextSchema = z.strictObject({
  clientKind: z
    .enum(["web", "cli", "desktop", "center_agent", "other"])
    .optional(),
  clientVersion: z.string().max(64).optional(),
  os: z.string().max(64).optional(),
});

export const submitFeedbackIssueRequestSchema = z.strictObject({
  category: feedbackIssueCategorySchema,
  summary: z.string().min(1).max(200),
  details: z.string().max(4000).optional(),
  submitterKind: feedbackSubmitterKindSchema,
  sourceOrganizationId: z.string().optional(),
  contactEmail: z.email().optional(),
  clientContext: feedbackClientContextSchema.optional(),
});

export const submitFeedbackIssueResponseSchema = z.strictObject({
  ok: z.literal(true),
  issueId: z.string().min(1),
});

export const feedbackIssueSubmitRpcRequestSchema = z.strictObject({
  inboxKey: z.string().min(1).max(256),
  request: submitFeedbackIssueRequestSchema,
  submitterUserId: z.string().min(1).nullable(),
});

export const feedbackIssueCursorSchema = z.strictObject({
  createdAtMs: timestampMsSchema,
  issueId: boundedIdentifierSchema,
});

export const feedbackIssueRecordSchema = z.strictObject({
  issueId: boundedIdentifierSchema,
  inboxId: boundedIdentifierSchema,
  organizationId: boundedIdentifierSchema,
  category: feedbackIssueCategorySchema,
  summary: z.string().min(1).max(200),
  details: z.string().max(4000).nullable(),
  submitterKind: feedbackSubmitterKindSchema,
  submitterUserId: z.string().nullable(),
  sourceOrganizationId: z.string().nullable(),
  contactEmail: z.email().nullable(),
  clientContext: feedbackClientContextSchema.nullable(),
  status: feedbackIssueStatusSchema,
  triageNote: z.string().max(2000).nullable(),
  createdAtMs: timestampMsSchema,
  updatedAtMs: timestampMsSchema,
});

export const listFeedbackIssuesForOrganizationRequestSchema = z.strictObject({
  organizationId: boundedIdentifierSchema,
  status: feedbackIssueStatusSchema.optional(),
  cursor: feedbackIssueCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const listFeedbackIssuesForOrganizationResponseSchema = z.strictObject({
  items: z.array(feedbackIssueRecordSchema),
  nextCursor: feedbackIssueCursorSchema.nullable(),
});

export const updateFeedbackIssueStatusForOrganizationRequestSchema =
  z.strictObject({
    organizationId: boundedIdentifierSchema,
    issueId: boundedIdentifierSchema,
    status: feedbackIssueStatusSchema,
    triageNote: z.string().max(2000).optional(),
  });

export const feedbackReportingPolicyResponseSchema = z.strictObject({
  organizationId: boundedIdentifierSchema,
  reportingEnabled: z.boolean(),
  updatedByUserId: boundedIdentifierSchema.nullable(),
});

export const readFeedbackReportingPolicyRequestSchema = z.strictObject({
  organizationId: boundedIdentifierSchema,
});

export const updateFeedbackReportingPolicyBodySchema = z.strictObject({
  reportingEnabled: z.boolean(),
});
