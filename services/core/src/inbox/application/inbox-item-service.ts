import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
import { inboxSourceCandidateSchema } from "@openmeld/schemas";
import type {
  InboxSourceCandidate,
  InboxSourceKind,
} from "@openmeld/schemas/types";
import {
  type InboxSourceWriteGuard,
  listOpenOrganizationDocumentDraftInboxTargets as listOpenOrganizationDocumentDraftInboxTargetsInRepo,
  prepareEnsureInboxItemStatements as prepareEnsureInboxItemStatementsInRepo,
  prepareReopenCoalescedInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements as prepareResolveInboxItemsBySourceStatementsInRepo,
  readInboxItemBySource,
  resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet as resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSetInRepo,
} from "../infrastructure/postgresql/inbox-item-repo";
import {
  repairInteractionReviewCategory,
  repairLegacyInteractionAttention,
} from "./inbox-legacy-interaction-attention";
import {
  normalizeLegacySpaceAwareness,
  repairLegacySpaceAwareness,
} from "./inbox-legacy-space-awareness";
export class InboxSourceConflictError extends Error {
  constructor() {
    super("Inbox source identity conflicts with an existing item");
    this.name = "InboxSourceConflictError";
  }
}
export async function ensureInboxItem(input: {
  sourceGuard?: InboxSourceWriteGuard;
  /** Source-owner migration opt-in; never accepted from HTTP/RPC candidates. */
  allowLegacySourceClassificationRepair?: boolean;
  candidate: InboxSourceCandidate;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<{
  deliveryId: string | null;
  itemId: string;
}> {
  const candidate = normalizeLegacySpaceAwareness(
    inboxSourceCandidateSchema.parse(input.candidate)
  );
  assertValidTimestamp(input.nowMs, "nowMs");
  let existing = await readInboxItemBySource({
    db: input.db,
    organizationId: candidate.organizationId,
    recipientUserId: candidate.recipientUserId,
    sourceKey: candidate.sourceKey,
    sourceKind: candidate.sourceKind,
  });
  if (
    existing &&
    (await repairLegacySpaceAwareness({
      candidate,
      db: input.db,
      existing,
      nowMs: input.nowMs,
    }))
  ) {
    existing = await readInboxItemBySource({
      db: input.db,
      organizationId: candidate.organizationId,
      recipientUserId: candidate.recipientUserId,
      sourceKey: candidate.sourceKey,
      sourceKind: candidate.sourceKind,
    });
  }
  if (
    existing &&
    input.allowLegacySourceClassificationRepair === true &&
    (await repairLegacyInteractionAttention({
      candidate,
      existing,
      db: input.db,
      nowMs: input.nowMs,
    }))
  ) {
    existing = await readInboxItemBySource({
      db: input.db,
      organizationId: candidate.organizationId,
      recipientUserId: candidate.recipientUserId,
      sourceKind: candidate.sourceKind,
      sourceKey: candidate.sourceKey,
    });
  }
  if (
    existing &&
    input.allowLegacySourceClassificationRepair === true &&
    (await repairInteractionReviewCategory({
      candidate,
      existing,
      db: input.db,
    }))
  ) {
    existing = await readInboxItemBySource({
      db: input.db,
      organizationId: candidate.organizationId,
      recipientUserId: candidate.recipientUserId,
      sourceKind: candidate.sourceKind,
      sourceKey: candidate.sourceKey,
    });
  }
  if (existing) {
    assertCandidateMatchesExisting(candidate, existing);
  }
  const prepared = await prepareEnsureInboxItemStatementsInRepo({
    candidate,
    db: input.db,
    nowMs: input.nowMs,
    sourceGuard: input.sourceGuard,
  });
  try {
    await input.db.transaction(async (client) => {
      const results: QueryResult[] = [];
      for (const query of prepared.statements) {
        results.push(await client.query(query));
      }
      return results;
    });
  } catch (error) {
    const raced = await readInboxItemBySource({
      db: input.db,
      organizationId: candidate.organizationId,
      recipientUserId: candidate.recipientUserId,
      sourceKey: candidate.sourceKey,
      sourceKind: candidate.sourceKind,
    });
    if (raced) {
      assertCandidateMatchesExisting(candidate, raced);
    }
    throw error;
  }
  return { deliveryId: prepared.deliveryId, itemId: prepared.itemId };
}
/** See prepareReopenCoalescedInboxItemStatements. */
export async function reopenCoalescedInboxItem(input: {
  candidate: InboxSourceCandidate;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<{ deliveryId: string | null; itemId: string }> {
  assertValidTimestamp(input.nowMs, "nowMs");
  const prepared = await prepareReopenCoalescedInboxItemStatements(input);
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of prepared.statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return { deliveryId: prepared.deliveryId, itemId: prepared.itemId };
}
export async function resolveInboxItemsBySource(input: {
  db: PostgresDatabase;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
  /** Resolve only an item that still satisfies this source predicate. */
  sourceGuard?: InboxSourceWriteGuard;
}): Promise<number> {
  assertRequiredIdentifier(input.organizationId, "organizationId");
  assertRequiredIdentifier(input.sourceKey, "sourceKey");
  assertValidTimestamp(input.resolvedAtMs, "resolvedAtMs");
  const results = await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of prepareResolveInboxItemsBySourceStatementsInRepo(
      input
    )) {
      results.push(await client.query(query));
    }
    return results;
  });
  return Math.max(0, Math.trunc(Number(results[0]?.rowCount ?? 0)));
}
export async function prepareEnsureInboxItemStatements(input: {
  candidate: InboxSourceCandidate;
  db: PostgresDatabase;
  nowMs: number;
  sourceGuard?: InboxSourceWriteGuard;
}) {
  return await prepareEnsureInboxItemStatementsInRepo(input);
}
export function prepareResolveInboxItemsBySourceStatements(input: {
  db: PostgresDatabase;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
  markRead?: boolean;
  sourceGuard?: InboxSourceWriteGuard;
}) {
  return prepareResolveInboxItemsBySourceStatementsInRepo(input);
}
export async function resolveSupersededOrganizationDocumentDraftInboxItems(input: {
  currentSourceKey: string | null;
  db: PostgresDatabase;
  documentId: string;
  organizationId: string;
  resolvedAtMs: number;
}): Promise<number> {
  assertRequiredIdentifier(input.organizationId, "organizationId");
  assertRequiredIdentifier(input.documentId, "documentId");
  assertValidTimestamp(input.resolvedAtMs, "resolvedAtMs");
  if (input.currentSourceKey !== null) {
    assertRequiredIdentifier(input.currentSourceKey, "currentSourceKey");
  }
  const currentSourcePredicate =
    input.currentSourceKey === null ? "" : "AND source_key <> $5";
  const itemStatement = {
    text: `
        UPDATE "openmeld"."inbox_items"
        SET
          resolution_status = 'resolved',
          resolved_at_ms = $1,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE organization_id = $3
          AND source_kind = 'organization_document_draft'
          AND attention = 'action_required'
          AND resolution_status = 'open'
          AND ((source_target_json)::jsonb #>> '{kind}') = 'organization_document'
          AND ((source_target_json)::jsonb #>> '{documentId}') = $4
          ${currentSourcePredicate}
      `,
    values: [
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.documentId,
      ...(input.currentSourceKey === null ? [] : [input.currentSourceKey]),
    ],
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
              AND resolution_status = 'resolved'
              AND resolved_at_ms = $4
              AND ((source_target_json)::jsonb #>> '{kind}') = 'organization_document'
              AND ((source_target_json)::jsonb #>> '{documentId}') = $5
          )
      `,
    values: [
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.resolvedAtMs,
      input.documentId,
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
export async function listOpenOrganizationDocumentDraftInboxTargets(input: {
  db: PostgresDatabase;
  limit: number;
  offset?: number;
}) {
  assertBoundedListLimit(input.limit, "limit");
  const offset = input.offset ?? 0;
  if (!(Number.isSafeInteger(offset) && offset >= 0)) {
    throw new TypeError("offset must be a non-negative integer");
  }
  return await listOpenOrganizationDocumentDraftInboxTargetsInRepo({
    db: input.db,
    limit: input.limit,
    offset,
  });
}
export async function resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet(input: {
  allowedRecipientUserIds: readonly string[];
  db: PostgresDatabase;
  documentId: string;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
}): Promise<number> {
  assertRequiredIdentifier(input.organizationId, "organizationId");
  assertRequiredIdentifier(input.documentId, "documentId");
  assertRequiredIdentifier(input.sourceKey, "sourceKey");
  assertValidTimestamp(input.resolvedAtMs, "resolvedAtMs");
  const allowedRecipientUserIds = [
    ...new Set(
      input.allowedRecipientUserIds.map((recipientUserId) => {
        assertRequiredIdentifier(recipientUserId, "allowedRecipientUserId");
        return recipientUserId;
      })
    ),
  ].sort();
  if (allowedRecipientUserIds.length === 0) {
    throw new TypeError("At least one allowed recipient is required");
  }
  return await resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSetInRepo(
    { ...input, allowedRecipientUserIds }
  );
}
function assertCandidateMatchesExisting(
  candidate: InboxSourceCandidate,
  existing: {
    attention: InboxSourceCandidate["attention"];
    importance: InboxSourceCandidate["importance"];
    kind: InboxSourceCandidate["kind"];
    occurredAtMs: number;
    sourceTargetJson: string;
    sourceFactsJson: string | null;
  }
): void {
  if (
    existing.kind !== candidate.kind ||
    existing.attention !== candidate.attention ||
    existing.importance !== candidate.importance ||
    existing.occurredAtMs !== candidate.occurredAtMs ||
    existing.sourceFactsJson !==
      (candidate.sourceFacts ? JSON.stringify(candidate.sourceFacts) : null) ||
    existing.sourceTargetJson !== JSON.stringify(candidate.sourceTarget)
  ) {
    throw new InboxSourceConflictError();
  }
}
function assertRequiredIdentifier(value: string, fieldName: string): void {
  if (!(value.trim() && value.length <= 256)) {
    throw new TypeError(`${fieldName} must be a non-empty identifier`);
  }
}
function assertValidTimestamp(value: number, fieldName: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
}
function assertBoundedListLimit(value: number, fieldName: string): void {
  if (!(Number.isSafeInteger(value) && value > 0 && value <= 500)) {
    throw new TypeError(`${fieldName} must be an integer between 1 and 500`);
  }
}
