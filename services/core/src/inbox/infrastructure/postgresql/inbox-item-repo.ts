import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import {
  inboxSourceCandidateSchema,
  inboxSourceFactsSchema,
  inboxSourceTargetSchema,
} from "@openmeld/schemas";
import type {
  InboxSourceCandidate,
  InboxSourceKind,
  InboxSourceTarget,
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
  sourceFactsJson: string | null;
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
  source_facts_json: string | null;
  title: string;
};
export type PreparedInboxItemWrite = {
  deliveryId: string | null;
  itemId: string;
  statements: QueryConfig[];
};
/** Internal, source-owned predicate evaluated in the same transaction as projection. */
export type InboxSourceWriteGuard = {
  sql: (parameterOffset: number) => string;
  bindings: readonly (string | number | null)[];
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
  db: PostgresDatabase;
  nowMs: number;
  sourceGuard?: InboxSourceWriteGuard;
}): Promise<PreparedInboxItemWrite> {
  const candidate = inboxSourceCandidateSchema.parse(input.candidate);
  const sourceTargetJson = JSON.stringify(candidate.sourceTarget);
  const sourceFactsJson = candidate.sourceFacts
    ? JSON.stringify(candidate.sourceFacts)
    : null;
  const itemId = await buildStableId("inbox_item", [
    candidate.organizationId,
    candidate.recipientUserId,
    candidate.sourceKind,
    candidate.sourceKey,
  ]);
  const deliveryId =
    (candidate.importance === "urgent" &&
      !(
        candidate.sourceTarget.kind === "space" &&
        candidate.sourceTarget.agentOwnerActivity === true
      )) ||
    candidate.sourceTarget.kind === "organization_join_request"
      ? await buildStableId("inbox_email", [itemId])
      : null;
  const resolutionStatus =
    candidate.attention === "action_required" ? "open" : "not_applicable";
  const targetScope =
    candidate.sourceKind === "space_signal" && candidate.attention === "update"
      ? readInboxTargetScope(candidate.sourceTarget)
      : null;
  let spaceReadWatermark: {
    bindings: Array<number | string>;
    expression: string;
  } = { bindings: [], expression: "NULL" };
  if (targetScope?.threadRootSignalId) {
    spaceReadWatermark = {
      bindings: [
        candidate.organizationId,
        candidate.recipientUserId,
        targetScope.spaceId,
        targetScope.threadRootSignalId,
        candidate.occurredAtMs,
      ],
      expression: `(
            SELECT read_at_ms
            FROM "openmeld"."inbox_space_thread_read_watermarks"
            WHERE organization_id = $18
              AND recipient_user_id = $19
              AND space_id = $20
              AND thread_root_signal_id = $21
              AND through_occurred_at_ms >= $22
            LIMIT 1
          )`,
    };
  } else if (targetScope) {
    spaceReadWatermark = {
      bindings: [
        candidate.organizationId,
        candidate.recipientUserId,
        targetScope.spaceId,
        candidate.occurredAtMs,
      ],
      expression: `(
            SELECT read_at_ms
            FROM "openmeld"."inbox_center_agent_read_watermarks"
            WHERE organization_id = $18
              AND recipient_user_id = $19
              AND space_id = $20
              AND through_occurred_at_ms >= $21
            LIMIT 1
          )`,
    };
  }
  const insertItem = {
    text: `
        INSERT INTO "openmeld"."inbox_items" (
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
          source_facts_json,
          resolution_status,
          read_at_ms,
          occurred_at_ms,
          created_at_ms,
          updated_at_ms
        ) SELECT
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          ${spaceReadWatermark.expression},
          $15, $16, $17
        WHERE ${input.sourceGuard?.sql(17 + spaceReadWatermark.bindings.length) ?? "TRUE"}
        ON CONFLICT(organization_id, recipient_user_id, source_kind, source_key)
        DO UPDATE SET
          title = CASE
            WHEN inbox_items.kind = excluded.kind
              AND inbox_items.attention = excluded.attention
              AND inbox_items.importance = excluded.importance
              AND inbox_items.source_target_json = excluded.source_target_json
              AND inbox_items.source_facts_json IS NOT DISTINCT FROM excluded.source_facts_json
              AND inbox_items.occurred_at_ms = excluded.occurred_at_ms
            THEN excluded.title
            ELSE NULL
          END,
          preview = excluded.preview,
          context_label = excluded.context_label,
          updated_at_ms = GREATEST(inbox_items.updated_at_ms, excluded.updated_at_ms)
      `,
    values: [
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
      sourceFactsJson,
      resolutionStatus,
      candidate.occurredAtMs,
      input.nowMs,
      input.nowMs,
      ...spaceReadWatermark.bindings,
      ...(input.sourceGuard?.bindings ?? []),
    ],
  };
  const statements = [insertItem];
  if (deliveryId) {
    statements.push({
      text: `
            INSERT INTO "openmeld"."inbox_email_deliveries" (
              id,
              inbox_item_id,
              state,
              attempt_count,
              next_attempt_at_ms,
              created_at_ms,
              updated_at_ms
            )
            SELECT $1, id, 'pending', 0, $2, $3, $4
            FROM "openmeld"."inbox_items"
            WHERE id = $5
              AND (importance = 'urgent' OR ((source_target_json)::jsonb #>> '{kind}') = 'organization_join_request')
              AND (${input.sourceGuard?.sql(5) ?? "TRUE"})
            ON CONFLICT(inbox_item_id) DO NOTHING
          `,
      values: [
        deliveryId,
        input.nowMs,
        input.nowMs,
        input.nowMs,
        itemId,
        ...(input.sourceGuard?.bindings ?? []),
      ],
    });
  }
  return { deliveryId, itemId, statements };
}
/**
 * One item per source that every later candidate updates and reopens in
 * place, for sources that coalesce repeated requests into one item (an
 * Agent's questions within one Session). Only a strictly newer candidate
 * replaces or reopens the item; replaying the current one never reopens it
 * after it ended. The urgent email delivery row is created once per item, so
 * a reopened item never sends another email.
 */
export async function prepareReopenCoalescedInboxItemStatements(input: {
  candidate: InboxSourceCandidate;
  nowMs: number;
}): Promise<PreparedInboxItemWrite> {
  const candidate = inboxSourceCandidateSchema.parse(input.candidate);
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
  const upsertItem = {
    text: `
        INSERT INTO "openmeld"."inbox_items" (
          id, organization_id, recipient_user_id, kind, attention, importance,
          title, preview, context_label, source_kind, source_key,
          source_target_json, source_facts_json, resolution_status,
          read_at_ms, occurred_at_ms, created_at_ms, updated_at_ms
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          NULL, $15, $16, $16
        )
        ON CONFLICT(organization_id, recipient_user_id, source_kind, source_key)
        DO UPDATE SET
          kind = excluded.kind,
          attention = excluded.attention,
          importance = excluded.importance,
          title = excluded.title,
          preview = excluded.preview,
          context_label = excluded.context_label,
          source_target_json = excluded.source_target_json,
          source_facts_json = excluded.source_facts_json,
          resolution_status = excluded.resolution_status,
          resolved_at_ms = NULL,
          read_at_ms = NULL,
          cleared_at_ms = NULL,
          occurred_at_ms = excluded.occurred_at_ms,
          updated_at_ms = GREATEST(inbox_items.updated_at_ms, excluded.updated_at_ms)
        WHERE inbox_items.occurred_at_ms < excluded.occurred_at_ms
          OR (
            inbox_items.source_target_json = excluded.source_target_json
            AND inbox_items.resolution_status = 'open'
          )
      `,
    values: [
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
      JSON.stringify(candidate.sourceTarget),
      candidate.sourceFacts ? JSON.stringify(candidate.sourceFacts) : null,
      candidate.attention === "action_required" ? "open" : "not_applicable",
      candidate.occurredAtMs,
      input.nowMs,
    ],
  };
  const statements: QueryConfig[] = [upsertItem];
  if (deliveryId) {
    statements.push({
      text: `
          INSERT INTO "openmeld"."inbox_email_deliveries" (
            id, inbox_item_id, state, attempt_count, next_attempt_at_ms,
            created_at_ms, updated_at_ms
          )
          SELECT $1, id, 'pending', 0, $2, $2, $2
          FROM "openmeld"."inbox_items"
          WHERE id = $3 AND importance = 'urgent'
          ON CONFLICT(inbox_item_id) DO NOTHING
        `,
      values: [deliveryId, input.nowMs, itemId],
    });
  }
  return { deliveryId, itemId, statements };
}
function readInboxTargetScope(target: InboxSourceCandidate["sourceTarget"]): {
  spaceId: string;
  threadRootSignalId: string | null;
} | null {
  switch (target.kind) {
    case "space":
      return {
        spaceId: target.spaceId,
        threadRootSignalId: target.threadRootSignalId ?? null,
      };
    case "center_agent":
      return target.spaceId
        ? { spaceId: target.spaceId, threadRootSignalId: null }
        : null;
    case "agent_interaction":
    case "agent_profile":
    case "agent_profile_creation_request":
    case "agent_access_request":
    case "credential_confirmation":
    case "organization_join_request":
    case "message_channel":
    case "organization_document":
    case "computer_connection":
    case "desktop_update":
    case "plugin_action_request":
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
  db: PostgresDatabase;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
  markRead?: boolean;
  sourceGuard?: InboxSourceWriteGuard;
}): QueryConfig[] {
  const endedInteraction =
    input.sourceKind === "runtime_coordinator_interaction";
  const itemUpdate = {
    text: `
        UPDATE "openmeld"."inbox_items"
        SET
          resolution_status = 'resolved',
          resolved_at_ms = $1,
          ${input.markRead || endedInteraction ? "read_at_ms = coalesce(read_at_ms, $1)," : ""}
          ${endedInteraction ? "title = 'Request ended', preview = 'This request no longer needs a response.'," : ""}
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE organization_id = $3
          AND source_kind = $4
          AND source_key = $5
          AND attention = 'action_required'
          AND resolution_status = 'open'
          AND (${input.sourceGuard?.sql(5) ?? "TRUE"})
      `,
    values: [
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKind,
      input.sourceKey,
      ...(input.sourceGuard?.bindings ?? []),
    ],
  };
  const deliveryUpdate = {
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = 'suppressed',
          suppressed_reason = 'source_resolved',
          suppressed_at_ms = $1,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE state = 'pending'
          AND inbox_item_id IN (
            SELECT id
            FROM "openmeld"."inbox_items"
            WHERE organization_id = $3
              AND source_kind = $4
              AND source_key = $5
              AND resolution_status = 'resolved'
          )
      `,
    values: [
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKind,
      input.sourceKey,
    ],
  };
  return [itemUpdate, deliveryUpdate];
}
export async function readInboxItemBySource(input: {
  db: PostgresDatabase;
  organizationId: string;
  recipientUserId: string;
  sourceKey: string;
  sourceKind: InboxSourceKind;
}): Promise<InboxItemRecord | null> {
  const row = await input.db
    .query<InboxItemRow>({
      text: `
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
          source_facts_json,
          occurred_at_ms
        FROM "openmeld"."inbox_items"
        WHERE organization_id = $1
          AND recipient_user_id = $2
          AND source_kind = $3
          AND source_key = $4
        LIMIT 1
      `,
      values: [
        input.organizationId,
        input.recipientUserId,
        input.sourceKind,
        input.sourceKey,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapInboxItemRow(row) : null;
}
/** Read a bounded batch of reminders from the retired continuation producer. */
export async function listLegacyTaskContinuationInboxItems(input: {
  db: PostgresDatabase;
  organizationId: string;
  recipientUserId: string;
}): Promise<{ sourceKey: string; occurredAtMs: number }[]> {
  const rows = await input.db.query<{
    sourceKey: string;
    occurredAtMs: number;
  }>({
    text: `SELECT source_key AS "sourceKey", occurred_at_ms AS "occurredAtMs"
    FROM "openmeld"."inbox_items"
    WHERE organization_id = $1 AND recipient_user_id = $2
      AND source_kind = 'remote_agent_native_delivery'
      AND source_key LIKE '%:admission_retry_exhausted'
      AND kind = 'system_issue' AND attention = 'action_required'
      AND importance = 'urgent' AND resolution_status = 'open'
      AND resolved_at_ms IS NULL
    ORDER BY id LIMIT 80`,
    values: [input.organizationId, input.recipientUserId],
  });
  return rows.rows;
}

/** Correct only the retired continuation producer's exact projection on replay. */
export async function repairLegacyTaskContinuationInboxItem(input: {
  candidate: InboxSourceCandidate;
  db: PostgresDatabase;
  legacySourceTarget: InboxSourceTarget;
  nowMs: number;
}): Promise<void> {
  const candidate = inboxSourceCandidateSchema.parse(input.candidate);
  if (
    candidate.sourceKind !== "remote_agent_native_delivery" ||
    !candidate.sourceKey.endsWith(":admission_retry_exhausted") ||
    candidate.kind !== "system_issue" ||
    candidate.attention !== "update" ||
    candidate.importance !== "normal" ||
    candidate.sourceTarget.kind !== "space"
  ) {
    throw new TypeError("Invalid task continuation Inbox repair");
  }
  const legacyTarget = inboxSourceTargetSchema.parse(input.legacySourceTarget);
  if (
    legacyTarget.kind !== "space" ||
    legacyTarget.spaceId !== candidate.sourceTarget.spaceId ||
    legacyTarget.threadRootSignalId !==
      candidate.sourceTarget.threadRootSignalId
  ) {
    throw new TypeError("Task continuation Inbox repair changed its audience");
  }
  const guard = (
    offset: number
  ) => `organization_id = $${offset + 1} AND recipient_user_id = $${offset + 2}
    AND source_kind = 'remote_agent_native_delivery' AND source_key = $${offset + 3}
    AND kind = 'system_issue' AND attention = 'action_required' AND importance = 'urgent'
    AND resolution_status = 'open' AND resolved_at_ms IS NULL
    AND source_target_json = $${offset + 4} AND source_facts_json = $${offset + 5} AND occurred_at_ms = $${offset + 6}`;
  const bindings = [
    candidate.organizationId,
    candidate.recipientUserId,
    candidate.sourceKey,
    JSON.stringify(legacyTarget),
    // Match the schema-serialized facts written by the original producer.
    JSON.stringify(
      inboxSourceFactsSchema.parse({
        recipientReasons: ["requester"],
        requestCategory: "action",
        version: 1,
      })
    ),
    candidate.occurredAtMs,
  ];
  // Preserve identity, read, removal and the failed task's source truth. This
  // retired action request becomes informational, never a resolved task.
  // Suppress unsent
  // urgent email in the same transaction before downgrading the projection.
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `UPDATE "openmeld"."inbox_email_deliveries" SET state = 'suppressed',
      suppressed_reason = 'item_not_urgent', suppressed_at_ms = $1,
      updated_at_ms = GREATEST(updated_at_ms, $2), claim_id = NULL, claim_expires_at_ms = NULL
      WHERE state = 'pending' AND inbox_item_id IN (SELECT id FROM "openmeld"."inbox_items" WHERE ${guard(2)})`,
          values: [input.nowMs, input.nowMs, ...bindings],
        }),
        await client.query({
          text: `UPDATE "openmeld"."inbox_items" SET attention = 'update', importance = 'normal',
      resolution_status = 'not_applicable',
      source_target_json = $1, source_facts_json = $2, title = $3, preview = $4, updated_at_ms = GREATEST(updated_at_ms, $5)
      WHERE ${guard(5)}`,
          values: [
            JSON.stringify(candidate.sourceTarget),
            JSON.stringify(candidate.sourceFacts),
            candidate.title,
            candidate.preview ?? null,
            input.nowMs,
            ...bindings,
          ],
        }),
      ] as const
  );
}
export async function replaceInboxSourceTargetsIfCurrent(input: {
  currentSourceTarget: InboxSourceTarget;
  db: PostgresDatabase;
  nextSourceTarget: InboxSourceTarget;
  organizationId: string;
  recipientUserId: string;
  sourceKeys: readonly string[];
  sourceKind: InboxSourceKind;
  updatedAtMs: number;
}): Promise<number> {
  if (!(Number.isSafeInteger(input.updatedAtMs) && input.updatedAtMs >= 0)) {
    throw new TypeError("updatedAtMs must be a non-negative safe integer");
  }
  const sourceKeys = [...new Set(input.sourceKeys.map((key) => key.trim()))];
  if (
    !(input.organizationId.trim() && input.recipientUserId.trim()) ||
    sourceKeys.length === 0 ||
    sourceKeys.length > 10 ||
    sourceKeys.some((key) => !key || key.length > 256)
  ) {
    throw new TypeError("Inbox source-target replacement scope is invalid");
  }
  const currentSourceTarget = inboxSourceTargetSchema.parse(
    input.currentSourceTarget
  );
  const nextSourceTarget = inboxSourceTargetSchema.parse(
    input.nextSourceTarget
  );
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."inbox_items"
        SET
          source_target_json = $1,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE organization_id = $3
          AND recipient_user_id = $4
          AND source_kind = $5
          AND source_key = ANY($6::text[])
          AND source_target_json = $7
      `,
    values: [
      JSON.stringify(nextSourceTarget),
      input.updatedAtMs,
      input.organizationId,
      input.recipientUserId,
      input.sourceKind,
      sourceKeys,
      JSON.stringify(currentSourceTarget),
    ],
  });
  return Math.max(0, Math.trunc(Number(result.rowCount ?? 0)));
}
export async function listOpenOrganizationDocumentDraftInboxTargets(input: {
  db: PostgresDatabase;
  limit: number;
  offset: number;
}): Promise<OpenOrganizationDocumentDraftInboxTargetPage> {
  const scopeSql = `
    FROM "openmeld"."inbox_items"
    WHERE source_kind = 'organization_document_draft'
      AND attention = 'action_required'
      AND resolution_status = 'open'
      AND ((source_target_json)::jsonb #>> '{kind}') = 'organization_document'
      AND length(trim(((source_target_json)::jsonb #>> '{documentId}'))) > 0
  `;
  const count = await input.db
    .query<{
      count: number;
    }>({
      text: `
        SELECT COUNT(*) AS count
        FROM (
          SELECT 1
          ${scopeSql}
          GROUP BY organization_id, source_key, ((source_target_json)::jsonb #>> '{documentId}')
        )
      `,
      values: [],
    })
    .then((result) => result.rows[0] ?? null);
  const rows = await input.db.query<{
    document_id: string;
    organization_id: string;
    source_key: string;
  }>({
    text: `
        SELECT
          organization_id,
          source_key,
          ((source_target_json)::jsonb #>> '{documentId}') AS document_id
        ${scopeSql}
        GROUP BY organization_id, source_key, document_id
        ORDER BY MIN(occurred_at_ms), organization_id, source_key
        LIMIT $1 OFFSET $2
      `,
    values: [input.limit, input.offset],
  });
  return {
    targets: (rows.rows ?? []).map((row) => ({
      documentId: row.document_id,
      organizationId: row.organization_id,
      sourceKey: row.source_key,
    })),
    total: Math.max(0, Math.trunc(Number(count?.count ?? 0))),
  };
}
export async function resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet(input: {
  allowedRecipientUserIds: readonly string[];
  db: PostgresDatabase;
  documentId: string;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
}): Promise<number> {
  const scopeBindings = [
    input.organizationId,
    input.sourceKey,
    input.documentId,
    input.allowedRecipientUserIds,
  ];
  const itemStatement = {
    text: `
        UPDATE "openmeld"."inbox_items"
        SET
          resolution_status = 'resolved',
          resolved_at_ms = $1,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE organization_id = $3
          AND source_kind = 'organization_document_draft'
          AND source_key = $4
          AND attention = 'action_required'
          AND resolution_status = 'open'
          AND ((source_target_json)::jsonb #>> '{kind}') = 'organization_document'
          AND ((source_target_json)::jsonb #>> '{documentId}') = $5
          AND NOT (recipient_user_id = ANY($6::text[]))
      `,
    values: [input.resolvedAtMs, input.resolvedAtMs, ...scopeBindings],
  };
  const deliveryStatement = {
    text: `
        UPDATE "openmeld"."inbox_email_deliveries"
        SET
          state = 'suppressed',
          suppressed_reason = 'source_resolved',
          suppressed_at_ms = $1,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE state = 'pending'
          AND inbox_item_id IN (
            SELECT id
            FROM "openmeld"."inbox_items"
            WHERE organization_id = $3
              AND source_kind = 'organization_document_draft'
              AND source_key = $4
              AND resolution_status = 'resolved'
              AND resolved_at_ms = $5
              AND ((source_target_json)::jsonb #>> '{kind}') = 'organization_document'
              AND ((source_target_json)::jsonb #>> '{documentId}') = $6
              AND NOT (recipient_user_id = ANY($7::text[]))
          )
      `,
    values: [
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.sourceKey,
      input.resolvedAtMs,
      input.documentId,
      input.allowedRecipientUserIds,
    ],
  };
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query(itemStatement),
        await client.query(deliveryStatement),
      ] as const
  );
  return Math.max(0, Math.trunc(Number(results[0].rowCount ?? 0)));
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
    sourceFactsJson: row.source_facts_json,
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
