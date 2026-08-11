import {
  feedbackClientContextSchema,
  feedbackIssueStatusSchema,
  submitFeedbackIssueRequestSchema,
} from "@openmeld/schemas";
import type {
  FeedbackInboxRecord,
  FeedbackIssueCursor,
  FeedbackIssueRecord,
  FeedbackIssueRepository,
  FeedbackIssueStatusUpdateResult,
} from "../../application/feedback-issue-service";

type FeedbackInboxRow = {
  inbox_id: string;
  organization_id: string;
  label: string;
  inbox_key: string;
  delivery_mode: string;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type FeedbackIssueRow = {
  issue_id: string;
  inbox_id: string;
  organization_id: string;
  category: string;
  summary: string;
  details: string | null;
  submitter_kind: string;
  submitter_user_id: string | null;
  source_organization_id: string | null;
  contact_email: string | null;
  client_context: string | null;
  status: string;
  triage_note: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

const FEEDBACK_ISSUE_SELECT_COLUMNS = `
  issue_id,
  inbox_id,
  organization_id,
  category,
  summary,
  details,
  submitter_kind,
  submitter_user_id,
  source_organization_id,
  contact_email,
  client_context,
  status,
  triage_note,
  created_at_ms,
  updated_at_ms
`;

export function createD1FeedbackIssueRepository(input: {
  db: D1Database;
}): FeedbackIssueRepository {
  return {
    async findInboxByKey(query): Promise<FeedbackInboxRecord | null> {
      const row = await input.db
        .prepare(
          `
            SELECT
              inbox_id,
              organization_id,
              label,
              inbox_key,
              delivery_mode,
              status,
              created_at_ms,
              updated_at_ms
            FROM openMeldFeedback_inboxes
            WHERE inbox_key = ?
            LIMIT 1
          `
        )
        .bind(query.inboxKey)
        .first<FeedbackInboxRow>();
      return row ? mapFeedbackInboxRow(row) : null;
    },

    async createIssue(issue): Promise<FeedbackIssueRecord> {
      await input.db
        .prepare(
          `
            INSERT INTO openMeldFeedback_issues (
              issue_id,
              inbox_id,
              organization_id,
              category,
              summary,
              details,
              submitter_kind,
              submitter_user_id,
              source_organization_id,
              contact_email,
              client_context,
              status,
              triage_note,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          issue.issueId,
          issue.inboxId,
          issue.organizationId,
          issue.category,
          issue.summary,
          issue.details,
          issue.submitterKind,
          issue.submitterUserId,
          issue.sourceOrganizationId,
          issue.contactEmail,
          issue.clientContext === null
            ? null
            : JSON.stringify(issue.clientContext),
          issue.status,
          issue.triageNote,
          issue.createdAtMs,
          issue.updatedAtMs
        )
        .run();
      return issue;
    },

    async listIssues(query): Promise<FeedbackIssueRecord[]> {
      const statement = buildFeedbackIssueListStatement(input.db, query);
      const result = await statement.all<FeedbackIssueRow>();
      return result.results.map(mapFeedbackIssueRow);
    },

    async updateIssueStatus(update): Promise<FeedbackIssueStatusUpdateResult> {
      const allowedStatusPlaceholders = update.allowedCurrentStatuses
        .map(() => "?")
        .join(", ");
      const result = await input.db
        .prepare(
          `
            UPDATE openMeldFeedback_issues
            SET
              status = ?,
              triage_note = ?,
              updated_at_ms = ?
            WHERE issue_id = ?
              AND organization_id = ?
              AND status IN (${allowedStatusPlaceholders})
          `
        )
        .bind(
          update.status,
          update.triageNote,
          update.updatedAtMs,
          update.issueId,
          update.organizationId,
          ...update.allowedCurrentStatuses
        )
        .run();
      if (!result.success) {
        throw new Error("feedback issue status update failed");
      }

      const row = await findFeedbackIssueRow(input.db, {
        issueId: update.issueId,
        organizationId: update.organizationId,
      });
      if (Number(result.meta.changes ?? 0) === 1) {
        if (!row) {
          throw new Error("updated feedback issue could not be read back");
        }
        return { outcome: "updated", issue: mapFeedbackIssueRow(row) };
      }
      if (!row) {
        return { outcome: "not_found" };
      }

      const currentStatus = feedbackIssueStatusSchema.safeParse(row.status);
      if (!currentStatus.success) {
        throw new Error("feedback issue row contains an invalid status");
      }
      return {
        outcome: "invalid_transition",
        currentStatus: currentStatus.data,
      };
    },
  };
}

async function findFeedbackIssueRow(
  db: D1Database,
  input: { issueId: string; organizationId: string }
): Promise<FeedbackIssueRow | null> {
  return await db
    .prepare(
      `
        SELECT ${FEEDBACK_ISSUE_SELECT_COLUMNS}
        FROM openMeldFeedback_issues
        WHERE issue_id = ? AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.issueId, input.organizationId)
    .first<FeedbackIssueRow>();
}

function buildFeedbackIssueListStatement(
  db: D1Database,
  input: {
    organizationId: string;
    status?: FeedbackIssueRecord["status"];
    cursor: FeedbackIssueCursor | null;
    limit: number;
  }
): D1PreparedStatement {
  const conditions = ["organization_id = ?"];
  const values: Array<number | string> = [input.organizationId];
  if (input.status) {
    conditions.push("status = ?");
    values.push(input.status);
  }
  if (input.cursor) {
    conditions.push(
      "(created_at_ms < ? OR (created_at_ms = ? AND issue_id < ?))"
    );
    values.push(
      input.cursor.createdAtMs,
      input.cursor.createdAtMs,
      input.cursor.issueId
    );
  }
  values.push(input.limit);

  return db
    .prepare(
      `
        SELECT ${FEEDBACK_ISSUE_SELECT_COLUMNS}
        FROM openMeldFeedback_issues
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at_ms DESC, issue_id DESC
        LIMIT ?
      `
    )
    .bind(...values);
}

function mapFeedbackInboxRow(row: FeedbackInboxRow): FeedbackInboxRecord {
  return {
    inboxId: row.inbox_id,
    organizationId: row.organization_id,
    label: row.label,
    inboxKey: row.inbox_key,
    deliveryMode: row.delivery_mode,
    status: row.status,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function mapFeedbackIssueRow(row: FeedbackIssueRow): FeedbackIssueRecord {
  const category = submitFeedbackIssueRequestSchema.shape.category.safeParse(
    row.category
  );
  const submitterKind =
    submitFeedbackIssueRequestSchema.shape.submitterKind.safeParse(
      row.submitter_kind
    );
  const status = feedbackIssueStatusSchema.safeParse(row.status);
  if (!(category.success && submitterKind.success && status.success)) {
    throw new Error("feedback issue row contains invalid enum values");
  }

  return {
    issueId: row.issue_id,
    inboxId: row.inbox_id,
    organizationId: row.organization_id,
    category: category.data,
    summary: row.summary,
    details: row.details,
    submitterKind: submitterKind.data,
    submitterUserId: row.submitter_user_id,
    sourceOrganizationId: row.source_organization_id,
    contactEmail: row.contact_email,
    clientContext: parseFeedbackClientContext(row.client_context),
    status: status.data,
    triageNote: row.triage_note,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function parseFeedbackClientContext(value: string | null) {
  if (value === null) {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    throw new Error("feedback issue client context is invalid JSON");
  }
  const parsed = feedbackClientContextSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("feedback issue client context is invalid");
  }
  return parsed.data;
}
