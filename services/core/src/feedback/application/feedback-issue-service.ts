import {
  FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE,
  FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE,
  FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
  FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
  FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
  feedbackIssueStatusSchema,
  submitFeedbackIssueRequestSchema,
} from "@openmeld/schemas";
import type {
  FeedbackClientContext,
  FeedbackIssueStatus,
  FeedbackSubmitErrorCode,
  SubmitFeedbackIssueRequest,
  SubmitFeedbackIssueResponse,
} from "@openmeld/schemas/types";

export const FEEDBACK_INBOX_ONLY_DELIVERY_MODE = "inbox_only" as const;

const FEEDBACK_ISSUE_ALLOWED_CURRENT_STATUSES_BY_TARGET = {
  new: ["new"],
  dismissed: ["new", "dismissed"],
  investigating: ["new", "investigating"],
  ticketed: ["new", "ticketed"],
  needs_human: ["new", "needs_human"],
  resolved: ["investigating", "ticketed", "needs_human", "resolved"],
} as const satisfies Record<
  FeedbackIssueStatus,
  readonly FeedbackIssueStatus[]
>;

export type FeedbackInboxRecord = {
  inboxId: string;
  organizationId: string;
  label: string;
  inboxKey: string;
  deliveryMode: string;
  status: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type FeedbackIssueRecord = {
  issueId: string;
  inboxId: string;
  organizationId: string;
  category: SubmitFeedbackIssueRequest["category"];
  summary: string;
  details: string | null;
  submitterKind: SubmitFeedbackIssueRequest["submitterKind"];
  submitterUserId: string | null;
  sourceOrganizationId: string | null;
  contactEmail: string | null;
  clientContext: FeedbackClientContext | null;
  status: FeedbackIssueStatus;
  triageNote: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type FeedbackIssueCursor = {
  createdAtMs: number;
  issueId: string;
};

export type FeedbackIssueStatusUpdateResult =
  | { outcome: "updated"; issue: FeedbackIssueRecord }
  | { outcome: "not_found" }
  | {
      outcome: "invalid_transition";
      currentStatus: FeedbackIssueStatus;
    };

export type FeedbackIssueRepository = {
  findInboxByKey(input: {
    inboxKey: string;
  }): Promise<FeedbackInboxRecord | null>;
  createIssue(issue: FeedbackIssueRecord): Promise<FeedbackIssueRecord>;
  listIssues(input: {
    organizationId: string;
    status?: FeedbackIssueStatus;
    cursor: FeedbackIssueCursor | null;
    limit: number;
  }): Promise<FeedbackIssueRecord[]>;
  updateIssueStatus(input: {
    allowedCurrentStatuses: readonly FeedbackIssueStatus[];
    organizationId: string;
    issueId: string;
    status: FeedbackIssueStatus;
    triageNote: string | null;
    updatedAtMs: number;
  }): Promise<FeedbackIssueStatusUpdateResult>;
};

type FeedbackIssueLogger = {
  info(
    message: string,
    fields: Record<string, boolean | number | string | null>
  ): void;
  warn(
    message: string,
    fields: Record<string, boolean | number | string | null>
  ): void;
};

export class FeedbackIssueServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FeedbackIssueServiceError";
    this.code = code;
  }
}

export function createFeedbackIssueService(input: {
  generateIssueId: () => string;
  logger?: FeedbackIssueLogger;
  nowMs?: () => number;
  repository: FeedbackIssueRepository;
}) {
  const logger = input.logger ?? console;
  const nowMs = input.nowMs ?? Date.now;

  return {
    async submitFeedbackIssue(submission: {
      inboxKey: string;
      request: SubmitFeedbackIssueRequest;
      submitterUserId?: string | null;
    }): Promise<SubmitFeedbackIssueResponse> {
      const inboxKey = normalizeRequiredText(submission.inboxKey);
      const parsedRequest = submitFeedbackIssueRequestSchema.safeParse(
        submission.request
      );
      if (!(inboxKey && parsedRequest.success)) {
        throw new FeedbackIssueServiceError(
          FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
          "feedback submission is invalid"
        );
      }

      const request = parsedRequest.data;
      const inbox = await input.repository.findInboxByKey({ inboxKey });
      if (!inbox) {
        logFeedbackSubmissionRejection(logger, {
          request,
          reasonCode: FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
          inboxId: null,
        });
        throw new FeedbackIssueServiceError(
          FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
          "feedback inbox was not found"
        );
      }

      if (
        inbox.status !== "active" ||
        inbox.deliveryMode !== FEEDBACK_INBOX_ONLY_DELIVERY_MODE
      ) {
        logFeedbackSubmissionRejection(logger, {
          request,
          reasonCode: FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
          inboxId: inbox.inboxId,
        });
        throw new FeedbackIssueServiceError(
          FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
          "feedback submission is disabled"
        );
      }

      const createdAtMs = nowMs();
      const issue: FeedbackIssueRecord = {
        issueId: input.generateIssueId(),
        inboxId: inbox.inboxId,
        organizationId: inbox.organizationId,
        category: request.category,
        summary: request.summary,
        details: request.details ?? null,
        submitterKind: request.submitterKind,
        submitterUserId: normalizeOptionalText(submission.submitterUserId),
        sourceOrganizationId: request.sourceOrganizationId ?? null,
        contactEmail: request.contactEmail ?? null,
        clientContext: request.clientContext ?? null,
        status: "new",
        triageNote: null,
        createdAtMs,
        updatedAtMs: createdAtMs,
      };

      await input.repository.createIssue(issue);
      logger.info("[core.feedback.issue_submitted]", {
        event: "core.feedback.issue_submitted",
        issueId: issue.issueId,
        inboxId: issue.inboxId,
        category: issue.category,
        submitterKind: issue.submitterKind,
        summaryLength: issue.summary.length,
        detailsLength: issue.details?.length ?? 0,
        reasonCode: "submitted",
      });

      return { ok: true, issueId: issue.issueId };
    },

    async listFeedbackIssues(query: {
      organizationId: string;
      status?: FeedbackIssueStatus;
      cursor?: FeedbackIssueCursor | null;
      limit?: number;
    }): Promise<{
      items: FeedbackIssueRecord[];
      nextCursor: FeedbackIssueCursor | null;
    }> {
      const organizationId = normalizeRequiredText(query.organizationId);
      const status = parseOptionalFeedbackIssueStatus(query.status);
      const cursor = parseFeedbackIssueCursor(query.cursor);
      const limit = resolveFeedbackIssueListLimit(query.limit);
      if (!(organizationId && status.valid && cursor.valid && limit)) {
        throw new FeedbackIssueServiceError(
          FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
          "feedback issue query is invalid"
        );
      }

      const issues = await input.repository.listIssues({
        organizationId,
        ...(status.value ? { status: status.value } : {}),
        cursor: cursor.value,
        limit: limit + 1,
      });
      const items = issues.slice(0, limit);
      const lastItem = items.at(-1) ?? null;
      const nextCursor =
        issues.length > limit && lastItem
          ? {
              createdAtMs: lastItem.createdAtMs,
              issueId: lastItem.issueId,
            }
          : null;
      return { items, nextCursor };
    },

    async updateFeedbackIssueStatus(update: {
      organizationId: string;
      issueId: string;
      status: FeedbackIssueStatus;
      triageNote?: string | null;
    }): Promise<FeedbackIssueRecord> {
      const organizationId = normalizeRequiredText(update.organizationId);
      const issueId = normalizeRequiredText(update.issueId);
      const parsedStatus = feedbackIssueStatusSchema.safeParse(update.status);
      const triageNote = normalizeNullableText(update.triageNote);
      if (
        !(organizationId && issueId && parsedStatus.success && triageNote.valid)
      ) {
        throw new FeedbackIssueServiceError(
          FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
          "feedback issue update is invalid"
        );
      }

      const updateResult = await input.repository.updateIssueStatus({
        allowedCurrentStatuses:
          FEEDBACK_ISSUE_ALLOWED_CURRENT_STATUSES_BY_TARGET[parsedStatus.data],
        organizationId,
        issueId,
        status: parsedStatus.data,
        triageNote: triageNote.value,
        updatedAtMs: nowMs(),
      });
      if (updateResult.outcome === "not_found") {
        throw new FeedbackIssueServiceError(
          FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE,
          "feedback issue was not found"
        );
      }
      if (updateResult.outcome === "invalid_transition") {
        throw new FeedbackIssueServiceError(
          FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE,
          "feedback issue status transition is invalid"
        );
      }

      const { issue } = updateResult;
      logger.info("[core.feedback.issue_status_updated]", {
        event: "core.feedback.issue_status_updated",
        issueId: issue.issueId,
        inboxId: issue.inboxId,
        category: issue.category,
        submitterKind: issue.submitterKind,
        summaryLength: issue.summary.length,
        detailsLength: issue.details?.length ?? 0,
        reasonCode: issue.status,
      });
      return issue;
    },
  };
}

function logFeedbackSubmissionRejection(
  logger: FeedbackIssueLogger,
  input: {
    request: SubmitFeedbackIssueRequest;
    reasonCode: FeedbackSubmitErrorCode;
    inboxId: string | null;
  }
): void {
  logger.warn("[core.feedback.issue_submission_rejected]", {
    event: "core.feedback.issue_submission_rejected",
    issueId: null,
    inboxId: input.inboxId,
    category: input.request.category,
    submitterKind: input.request.submitterKind,
    summaryLength: input.request.summary.length,
    detailsLength: input.request.details?.length ?? 0,
    reasonCode: input.reasonCode,
  });
}

function normalizeRequiredText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: unknown): string | null {
  return normalizeRequiredText(value);
}

function normalizeNullableText(value: unknown): {
  valid: boolean;
  value: string | null;
} {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }
  if (typeof value !== "string") {
    return { valid: false, value: null };
  }
  return value.length <= 2000
    ? { valid: true, value }
    : { valid: false, value: null };
}

function parseOptionalFeedbackIssueStatus(value: unknown): {
  valid: boolean;
  value: FeedbackIssueStatus | null;
} {
  if (value === undefined) {
    return { valid: true, value: null };
  }
  const parsed = feedbackIssueStatusSchema.safeParse(value);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false, value: null };
}

function parseFeedbackIssueCursor(value: unknown): {
  valid: boolean;
  value: FeedbackIssueCursor | null;
} {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, value: null };
  }
  const candidate = value as Partial<FeedbackIssueCursor>;
  const issueId = normalizeRequiredText(candidate.issueId);
  if (
    !(issueId && Number.isInteger(candidate.createdAtMs)) ||
    Number(candidate.createdAtMs) < 0
  ) {
    return { valid: false, value: null };
  }
  return {
    valid: true,
    value: { createdAtMs: Number(candidate.createdAtMs), issueId },
  };
}

function resolveFeedbackIssueListLimit(value: unknown): number | null {
  const limit = value === undefined ? 50 : value;
  return Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100
    ? Number(limit)
    : null;
}
