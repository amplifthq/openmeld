import { inboxSourceCandidateSchema } from "@openmeld/schemas";
import type {
  InboxSourceCandidate,
  InboxSourceKind,
} from "@openmeld/schemas/types";

export type InboxItemRecord = {
  attention: InboxSourceCandidate["attention"];
  contextLabel: string | null;
  id: string;
  importance: InboxSourceCandidate["importance"];
  kind: InboxSourceCandidate["kind"];
  occurredAtMs: number;
  organizationId: string;
  preview: string;
  recipientUserId: string;
  sourceKey: string;
  sourceKind: InboxSourceKind;
  sourceTargetJson: string;
  title: string;
};

type InboxItemRow = {
  attention: InboxItemRecord["attention"];
  context_label: string | null;
  id: string;
  importance: InboxItemRecord["importance"];
  kind: InboxItemRecord["kind"];
  occurred_at_ms: number;
  organization_id: string;
  preview: string;
  recipient_user_id: string;
  source_key: string;
  source_kind: InboxSourceKind;
  source_target_json: string;
  title: string;
};

export type PreparedInboxItemWrite = {
  deliveryId: string | null;
  itemId: string;
  statements: D1PreparedStatement[];
};

export type OpenOrganizationDocumentDraftInboxTarget = {
  documentId: string;
  organizationId: string;
  sourceKey: string;
};

export type OpenOrganizationDocumentDraftInboxTargetPage = {
  targets: OpenOrganizationDocumentDraftInboxTarget[];
  total: number;
};

export async function prepareEnsureInboxItemStatements(input: {
  candidate: InboxSourceCandidate;
  db: D1Database;
  nowMs: number;
}): Promise<PreparedInboxItemWrite> {
  const candidate = inboxSourceCandidateSchema.parse(input.candidate);
  const sourceTargetJson = JSON.stringify(candidate.sourceTarget);
  const itemId = await buildStableId("inbox_item", [
    candidate.organizationId,
    candidate.recipientUserId,
    candidate.sourceKind,
    candidate.sourceKey,
  ]);
  const deliveryId =
    candidate.importance === "urgent"
      ? await buildStableId("inbox_email", [itemId])
      : null;
  const resolutionStatus =
    candidate.attention === "action_required" ? "open" : "not_applicable";
  const targetSpaceId =
    candidate.sourceKind === "space_signal" && candidate.attention === "update"
      ? readInboxTargetSpaceId(candidate.sourceTarget)
      : null;
  const spaceReadWatermark = targetSpaceId
    ? {
        bindings: [
          candidate.organizationId,
          candidate.recipientUserId,
          targetSpaceId,
          candidate.occurredAtMs,
        ],
        expression: `(
            SELECT read_at_ms
            FROM inbox_center_agent_read_watermarks
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND space_id = ?
              AND through_occurred_at_ms >= ?
            LIMIT 1
          )`,
      }
    : { bindings: [], expression: "NULL" };
  const insertItem = input.db
    .prepare(
      `
        INSERT INTO inbox_items (
          id,
          organization_id,
          recipient_user_id,
          kind,
          attention,
          importance,
          title,
          preview,
          context_label,
          source_kind,
          source_key,
          source_target_json,
          resolution_status,
          read_at_ms,
          occurred_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ${spaceReadWatermark.expression},
          ?, ?, ?
        )
        ON CONFLICT(organization_id, recipient_user_id, source_kind, source_key)
        DO UPDATE SET
          title = CASE
            WHEN inbox_items.kind = excluded.kind
              AND inbox_items.attention = excluded.attention
              AND inbox_items.importance = excluded.importance
              AND inbox_items.source_target_json = excluded.source_target_json
              AND inbox_items.occurred_at_ms = excluded.occurred_at_ms
            THEN excluded.title
            ELSE NULL
          END,
          preview = excluded.preview,
          context_label = excluded.context_label,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      itemId,
      candidate.organizationId,
      candidate.recipientUserId,
      candidate.kind,
      candidate.attention,
      candidate.importance,
      candidate.title,
      candidate.preview,
      candidate.contextLabel,
      candidate.sourceKind,
      candidate.sourceKey,
      sourceTargetJson,
      resolutionStatus,
      ...spaceReadWatermark.bindings,
      candidate.occurredAtMs,
      input.nowMs,
      input.nowMs
    );
  const statements = [insertItem];
  if (deliveryId) {
    statements.push(
      input.db
        .prepare(
          `
            INSERT INTO inbox_email_deliveries (
              id,
              inbox_item_id,
              state,
              attempt_count,
              next_attempt_at_ms,
              created_at_ms,
              updated_at_ms
            )
            SELECT ?, id, 'pending', 0, ?, ?, ?
            FROM inbox_items
            WHERE id = ?
              AND importance = 'urgent'
            ON CONFLICT(inbox_item_id) DO NOTHING
          `
        )
        .bind(deliveryId, input.nowMs, input.nowMs, input.nowMs, itemId)
    );
  }
  return { deliveryId, itemId, statements };
}

function readInboxTargetSpaceId(
  target: InboxSourceCandidate["sourceTarget"]
): string | null {
  switch (target.kind) {
    case "space":
      return target.spaceId;
    case "center_agent":
      return target.spaceId ?? null;
    case "agent_interaction":
    case "center_agent_task":
    case "organization_document":
    case "settings":
      return null;
    default:
      return assertNever(target);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Inbox source target: ${String(value)}`);
}

export function prepareResolveInboxItemsBySourceStatements(input: {
  db: D1Database;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
}): D1PreparedStatement[] {
  const itemUpdate = input.db
    .prepare(
      `
        UPDATE inbox_items
        SET
          resolution_status = 'resolved',
          resolved_at_ms = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE organization_id = ?
          AND source_kind = ?
          AND source_key = ?
          AND attention = 'action_required'
          AND resolution_status = 'open'
      `
    )
    .bind(
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKind,
      input.sourceKey
    );
  const deliveryUpdate = input.db
    .prepare(
      `
        UPDATE inbox_email_deliveries
        SET
          state = 'suppressed',
          suppressed_reason = 'source_resolved',
          suppressed_at_ms = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE state = 'pending'
          AND inbox_item_id IN (
            SELECT id
            FROM inbox_items
            WHERE organization_id = ?
              AND source_kind = ?
              AND source_key = ?
          )
      `
    )
    .bind(
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKind,
      input.sourceKey
    );
  return [itemUpdate, deliveryUpdate];
}

export async function readInboxItemBySource(input: {
  db: D1Database;
  organizationId: string;
  recipientUserId: string;
  sourceKey: string;
  sourceKind: InboxSourceKind;
}): Promise<InboxItemRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          recipient_user_id,
          kind,
          attention,
          importance,
          title,
          preview,
          context_label,
          source_kind,
          source_key,
          source_target_json,
          occurred_at_ms
        FROM inbox_items
        WHERE organization_id = ?
          AND recipient_user_id = ?
          AND source_kind = ?
          AND source_key = ?
        LIMIT 1
      `
    )
    .bind(
      input.organizationId,
      input.recipientUserId,
      input.sourceKind,
      input.sourceKey
    )
    .first<InboxItemRow>();
  return row ? mapInboxItemRow(row) : null;
}

export async function listOpenOrganizationDocumentDraftInboxTargets(input: {
  db: D1Database;
  limit: number;
  offset: number;
}): Promise<OpenOrganizationDocumentDraftInboxTargetPage> {
  const scopeSql = `
    FROM inbox_items
    WHERE source_kind = 'organization_document_draft'
      AND attention = 'action_required'
      AND resolution_status = 'open'
      AND json_extract(source_target_json, '$.kind') = 'organization_document'
      AND length(trim(json_extract(source_target_json, '$.documentId'))) > 0
  `;
  const count = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT 1
          ${scopeSql}
          GROUP BY organization_id, source_key, json_extract(source_target_json, '$.documentId')
        )
      `
    )
    .first<{ count: number }>();
  const rows = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          source_key,
          json_extract(source_target_json, '$.documentId') AS document_id
        ${scopeSql}
        GROUP BY organization_id, source_key, document_id
        ORDER BY MIN(occurred_at_ms), organization_id, source_key
        LIMIT ? OFFSET ?
      `
    )
    .bind(input.limit, input.offset)
    .all<{
      document_id: string;
      organization_id: string;
      source_key: string;
    }>();
  return {
    targets: (rows.results ?? []).map((row) => ({
      documentId: row.document_id,
      organizationId: row.organization_id,
      sourceKey: row.source_key,
    })),
    total: Math.max(0, Math.trunc(Number(count?.count ?? 0))),
  };
}

export async function resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet(input: {
  allowedRecipientUserIds: readonly string[];
  db: D1Database;
  documentId: string;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
}): Promise<number> {
  const placeholders = input.allowedRecipientUserIds.map(() => "?").join(", ");
  const scopeBindings = [
    input.organizationId,
    input.sourceKey,
    input.documentId,
    ...input.allowedRecipientUserIds,
  ];
  const itemStatement = input.db
    .prepare(
      `
        UPDATE inbox_items
        SET
          resolution_status = 'resolved',
          resolved_at_ms = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE organization_id = ?
          AND source_kind = 'organization_document_draft'
          AND source_key = ?
          AND attention = 'action_required'
          AND resolution_status = 'open'
          AND json_extract(source_target_json, '$.kind') = 'organization_document'
          AND json_extract(source_target_json, '$.documentId') = ?
          AND recipient_user_id NOT IN (${placeholders})
      `
    )
    .bind(input.resolvedAtMs, input.resolvedAtMs, ...scopeBindings);
  const deliveryStatement = input.db
    .prepare(
      `
        UPDATE inbox_email_deliveries
        SET
          state = 'suppressed',
          suppressed_reason = 'source_resolved',
          suppressed_at_ms = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE state = 'pending'
          AND inbox_item_id IN (
            SELECT id
            FROM inbox_items
            WHERE organization_id = ?
              AND source_kind = 'organization_document_draft'
              AND source_key = ?
              AND resolution_status = 'resolved'
              AND resolved_at_ms = ?
              AND json_extract(source_target_json, '$.kind') = 'organization_document'
              AND json_extract(source_target_json, '$.documentId') = ?
              AND recipient_user_id NOT IN (${placeholders})
          )
      `
    )
    .bind(
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKey,
      input.resolvedAtMs,
      input.documentId,
      ...input.allowedRecipientUserIds
    );
  const results = await input.db.batch([itemStatement, deliveryStatement]);
  return Math.max(0, Math.trunc(Number(results[0]?.meta.changes ?? 0)));
}

function mapInboxItemRow(row: InboxItemRow): InboxItemRecord {
  return {
    attention: row.attention,
    contextLabel: row.context_label,
    id: row.id,
    importance: row.importance,
    kind: row.kind,
    occurredAtMs: row.occurred_at_ms,
    organizationId: row.organization_id,
    preview: row.preview,
    recipientUserId: row.recipient_user_id,
    sourceKey: row.source_key,
    sourceKind: row.source_kind,
    sourceTargetJson: row.source_target_json,
    title: row.title,
  };
}

async function buildStableId(
  prefix: string,
  parts: readonly string[]
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${prefix}_${hex}`;
}
