import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
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
export function createPostgresFeedbackIssueRepository(input: {
  db: PostgresDatabase;
}): FeedbackIssueRepository {
  return {
    async findInboxByKey(query): Promise<FeedbackInboxRecord | null> {
      const row = await input.db
        .query<FeedbackInboxRow>({
          text: `
            SELECT
              inbox_id,
              organization_id,
              label,
              inbox_key,
              delivery_mode,
              status,
              created_at_ms,
              updated_at_ms
            FROM "openmeld"."openMeldFeedback_inboxes"
            WHERE inbox_key = $1
            LIMIT 1
          `,
          values: [query.inboxKey],
        })
        .then((result) => result.rows[0] ?? null);
      return row ? mapFeedbackInboxRow(row) : null;
    },
    async createIssue(issue): Promise<FeedbackIssueRecord> {
      await input.db.query({
        text: `
            INSERT INTO "openmeld"."openMeldFeedback_issues" (
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `,
        values: [
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
          issue.updatedAtMs,
        ],
      });
      return issue;
    },
    async listIssues(query): Promise<FeedbackIssueRecord[]> {
      const statement = buildFeedbackIssueListStatement(query);
      const result = await input.db.query<FeedbackIssueRow>(statement);
      return result.rows.map(mapFeedbackIssueRow);
    },
    async updateIssueStatus(update): Promise<FeedbackIssueStatusUpdateResult> {
      const result = await input.db.query({
        text: `
            UPDATE "openmeld"."openMeldFeedback_issues"
            SET
              status = $1,
              triage_note = $2,
              updated_at_ms = $3
            WHERE issue_id = $4
              AND organization_id = $5
              AND status = ANY($6::text[])
          `,
        values: [
          update.status,
          update.triageNote,
          update.updatedAtMs,
          update.issueId,
          update.organizationId,
          update.allowedCurrentStatuses,
        ],
      });
      const row = await findFeedbackIssueRow(input.db, {
        issueId: update.issueId,
        organizationId: update.organizationId,
      });
      if (Number(result.rowCount ?? 0) === 1) {
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
  db: PostgresDatabase,
  input: {
    issueId: string;
    organizationId: string;
  }
): Promise<FeedbackIssueRow | null> {
  return await db
    .query<FeedbackIssueRow>({
      text: `
        SELECT ${FEEDBACK_ISSUE_SELECT_COLUMNS}
        FROM "openmeld"."openMeldFeedback_issues"
        WHERE issue_id = $1 AND organization_id = $2
        LIMIT 1
      `,
      values: [input.issueId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
}
function buildFeedbackIssueListStatement(input: {
  organizationId: string;
  status?: FeedbackIssueRecord["status"];
  cursor: FeedbackIssueCursor | null;
  limit: number;
}): QueryConfig {
  const conditions = ["organization_id = $1"];
  const values: Array<number | string> = [input.organizationId];
  if (input.status) {
    conditions.push(`status = $${values.length + 1}`);
    values.push(input.status);
  }
  if (input.cursor) {
    conditions.push(
      `(created_at_ms, issue_id) < ($${values.length + 1}, $${values.length + 2})`
    );
    values.push(input.cursor.createdAtMs, input.cursor.issueId);
  }
  values.push(input.limit);
  return {
    text: `
        SELECT ${FEEDBACK_ISSUE_SELECT_COLUMNS}
        FROM "openmeld"."openMeldFeedback_issues"
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at_ms DESC NULLS LAST, issue_id DESC NULLS LAST
        LIMIT $${values.length}
      `,
    values: [...values],
  };
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
