import { inboxSourceCandidateSchema } from "@openmeld/schemas";
import type {
  InboxSourceCandidate,
  InboxSourceKind,
} from "@openmeld/schemas/types";
import {
  listOpenOrganizationDocumentDraftInboxTargets as listOpenOrganizationDocumentDraftInboxTargetsInRepo,
  prepareEnsureInboxItemStatements as prepareEnsureInboxItemStatementsInRepo,
  prepareResolveInboxItemsBySourceStatements as prepareResolveInboxItemsBySourceStatementsInRepo,
  readInboxItemBySource,
  resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet as resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSetInRepo,
} from "../infrastructure/d1/inbox-item-repo";

export class InboxSourceConflictError extends Error {
  constructor() {
    super("Inbox source identity conflicts with an existing item");
    this.name = "InboxSourceConflictError";
  }
}

export async function ensureInboxItem(input: {
  candidate: InboxSourceCandidate;
  db: D1Database;
  nowMs: number;
}): Promise<{ deliveryId: string | null; itemId: string }> {
  const candidate = inboxSourceCandidateSchema.parse(input.candidate);
  assertValidTimestamp(input.nowMs, "nowMs");
  const existing = await readInboxItemBySource({
    db: input.db,
    organizationId: candidate.organizationId,
    recipientUserId: candidate.recipientUserId,
    sourceKey: candidate.sourceKey,
    sourceKind: candidate.sourceKind,
  });
  if (existing) {
    assertCandidateMatchesExisting(candidate, existing);
  }
  const prepared = await prepareEnsureInboxItemStatementsInRepo({
    candidate,
    db: input.db,
    nowMs: input.nowMs,
  });
  try {
    await input.db.batch(prepared.statements);
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

export async function resolveInboxItemsBySource(input: {
  db: D1Database;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
}): Promise<number> {
  assertRequiredIdentifier(input.organizationId, "organizationId");
  assertRequiredIdentifier(input.sourceKey, "sourceKey");
  assertValidTimestamp(input.resolvedAtMs, "resolvedAtMs");
  const results = await input.db.batch(
    prepareResolveInboxItemsBySourceStatementsInRepo(input)
  );
  return Math.max(0, Math.trunc(Number(results[0]?.meta.changes ?? 0)));
}

export async function prepareEnsureInboxItemStatements(input: {
  candidate: InboxSourceCandidate;
  db: D1Database;
  nowMs: number;
}) {
  return await prepareEnsureInboxItemStatementsInRepo(input);
}

export function prepareResolveInboxItemsBySourceStatements(input: {
  db: D1Database;
  organizationId: string;
  resolvedAtMs: number;
  sourceKey: string;
  sourceKind: InboxSourceKind;
}) {
  return prepareResolveInboxItemsBySourceStatementsInRepo(input);
}

export async function resolveSupersededOrganizationDocumentDraftInboxItems(input: {
  currentSourceKey: string | null;
  db: D1Database;
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
    input.currentSourceKey === null ? "" : "AND source_key <> ?";
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
          AND attention = 'action_required'
          AND resolution_status = 'open'
          AND json_extract(source_target_json, '$.kind') = 'organization_document'
          AND json_extract(source_target_json, '$.documentId') = ?
          ${currentSourcePredicate}
      `
    )
    .bind(
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.documentId,
      ...(input.currentSourceKey === null ? [] : [input.currentSourceKey])
    );
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
              AND resolution_status = 'resolved'
              AND resolved_at_ms = ?
              AND json_extract(source_target_json, '$.kind') = 'organization_document'
              AND json_extract(source_target_json, '$.documentId') = ?
          )
      `
    )
    .bind(
      input.resolvedAtMs,
      input.resolvedAtMs,
      input.organizationId,
      input.resolvedAtMs,
      input.documentId
    );
  const results = await input.db.batch([itemStatement, deliveryStatement]);
  return Math.max(0, Math.trunc(Number(results[0]?.meta.changes ?? 0)));
}

export async function listOpenOrganizationDocumentDraftInboxTargets(input: {
  db: D1Database;
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
  db: D1Database;
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
  }
): void {
  if (
    existing.kind !== candidate.kind ||
    existing.attention !== candidate.attention ||
    existing.importance !== candidate.importance ||
    existing.occurredAtMs !== candidate.occurredAtMs ||
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
