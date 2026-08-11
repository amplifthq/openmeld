import {
  listOpenOrganizationDocumentDraftInboxTargets,
  resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet,
  resolveSupersededOrganizationDocumentDraftInboxItems,
} from "../inbox/application/inbox-item-service";
import type { CoreBindings } from "../lib/bindings";
import { resolveOrganizationDirectoryMembers } from "../organizations/organization-directory";
import {
  buildOrganizationDocumentDraftSourceKey,
  projectOrganizationDocumentDraftReview,
} from "./organization-document-inbox-producer";

export const ORGANIZATION_DOCUMENT_INBOX_RECONCILE_LIMIT = 100;

type PendingOrganizationDocumentDraftRow = {
  draft_created_at: number;
  id: string;
  organization_id: string;
  title: string;
};

export type OrganizationDocumentInboxReconcileResult = {
  attempted: number;
  errors: number;
  projected: number;
};

export async function reconcileOrganizationDocumentDraftInbox(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  db: D1Database;
  limit?: number;
  nowMs: number;
}): Promise<OrganizationDocumentInboxReconcileResult> {
  const limit = normalizeLimit(input.limit);
  const drafts = await listPendingOrganizationDocumentDrafts({
    db: input.db,
    limit,
    nowMs: input.nowMs,
  });
  const openTargets = await listRotatingOpenDraftInboxTargets({
    db: input.db,
    limit,
    nowMs: input.nowMs,
  });
  const work = new Map<string, PendingOrganizationDocumentDraftRow | null>();
  for (const draft of drafts) {
    work.set(buildDocumentWorkKey(draft.organization_id, draft.id), draft);
  }
  for (const target of openTargets) {
    const key = buildDocumentWorkKey(target.organizationId, target.documentId);
    if (!work.has(key)) {
      work.set(
        key,
        await readPendingOrganizationDocumentDraft({
          db: input.db,
          documentId: target.documentId,
          organizationId: target.organizationId,
        })
      );
    }
  }
  const reviewerUserIdsByOrganizationId = new Map<string, string[]>();
  const failedOrganizationIds = new Set<string>();
  const result: OrganizationDocumentInboxReconcileResult = {
    attempted: work.size,
    errors: 0,
    projected: 0,
  };

  for (const [workKey, draft] of work) {
    const [organizationId, documentId] = parseDocumentWorkKey(workKey);
    try {
      await reconcileOrganizationDocumentInboxWorkItem({
        authWorker: input.authWorker,
        db: input.db,
        documentId,
        draft,
        failedOrganizationIds,
        nowMs: input.nowMs,
        organizationId,
        reviewerUserIdsByOrganizationId,
      });
      result.projected += 1;
    } catch (error) {
      result.errors += 1;
      logReconciliationFailure({ documentId, draft, error, organizationId });
    }
  }
  return result;
}

async function reconcileOrganizationDocumentInboxWorkItem(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  db: D1Database;
  documentId: string;
  draft: PendingOrganizationDocumentDraftRow | null;
  failedOrganizationIds: Set<string>;
  nowMs: number;
  organizationId: string;
  reviewerUserIdsByOrganizationId: Map<string, string[]>;
}): Promise<void> {
  if (!input.draft) {
    await resolveSupersededOrganizationDocumentDraftInboxItems({
      currentSourceKey: null,
      db: input.db,
      documentId: input.documentId,
      organizationId: input.organizationId,
      resolvedAtMs: input.nowMs,
    });
    return;
  }
  const reviewerUserIds = await resolveReviewerUserIds({
    authWorker: input.authWorker,
    failedOrganizationIds: input.failedOrganizationIds,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    reviewerUserIdsByOrganizationId: input.reviewerUserIdsByOrganizationId,
  });
  const currentSourceKey = buildOrganizationDocumentDraftSourceKey({
    documentId: input.draft.id,
    draftCreatedAtMs: input.draft.draft_created_at,
  });
  await resolveSupersededOrganizationDocumentDraftInboxItems({
    currentSourceKey,
    db: input.db,
    documentId: input.draft.id,
    organizationId: input.draft.organization_id,
    resolvedAtMs: input.nowMs,
  });
  await resolveOrganizationDocumentDraftInboxItemsOutsideRecipientSet({
    allowedRecipientUserIds: reviewerUserIds,
    db: input.db,
    documentId: input.draft.id,
    organizationId: input.draft.organization_id,
    resolvedAtMs: input.nowMs,
    sourceKey: currentSourceKey,
  });
  await projectOrganizationDocumentDraftReview({
    db: input.db,
    draft: {
      documentId: input.draft.id,
      draftCreatedAtMs: input.draft.draft_created_at,
      organizationId: input.draft.organization_id,
      title: input.draft.title,
    },
    recipientUserIds: reviewerUserIds,
  });
}

async function resolveReviewerUserIds(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  failedOrganizationIds: Set<string>;
  nowMs: number;
  organizationId: string;
  reviewerUserIdsByOrganizationId: Map<string, string[]>;
}): Promise<string[]> {
  if (input.failedOrganizationIds.has(input.organizationId)) {
    throw new Error("organization_document.reviewers_unavailable");
  }
  const cached = input.reviewerUserIdsByOrganizationId.get(
    input.organizationId
  );
  if (cached) {
    return cached;
  }
  try {
    const members = await resolveOrganizationDirectoryMembers({
      authWorker: input.authWorker,
      organizationId: input.organizationId,
      requestId: `organization-document-inbox-reconcile:${input.nowMs}`,
    });
    const reviewerUserIds = members
      .filter((member) => member.role === "owner" || member.role === "admin")
      .map((member) => member.userId);
    if (reviewerUserIds.length === 0) {
      throw new Error("organization_document.reviewers_unavailable");
    }
    input.reviewerUserIdsByOrganizationId.set(
      input.organizationId,
      reviewerUserIds
    );
    return reviewerUserIds;
  } catch (error) {
    input.failedOrganizationIds.add(input.organizationId);
    throw error;
  }
}

async function listRotatingOpenDraftInboxTargets(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}) {
  const firstPage = await listOpenOrganizationDocumentDraftInboxTargets({
    db: input.db,
    limit: input.limit,
  });
  if (firstPage.total <= input.limit) {
    return firstPage.targets;
  }
  const pageCount = Math.ceil(firstPage.total / input.limit);
  const minute = Math.floor(input.nowMs / 60_000);
  const offset = (minute % pageCount) * input.limit;
  if (offset === 0) {
    return firstPage.targets;
  }
  return (
    await listOpenOrganizationDocumentDraftInboxTargets({
      db: input.db,
      limit: input.limit,
      offset,
    })
  ).targets;
}

async function listPendingOrganizationDocumentDrafts(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<PendingOrganizationDocumentDraftRow[]> {
  const count = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM organization_documents
        WHERE draft_content IS NOT NULL
          AND draft_created_at IS NOT NULL
      `
    )
    .first<{ count: number }>();
  const total = Math.max(0, Math.trunc(Number(count?.count ?? 0)));
  if (total === 0) {
    return [];
  }
  const pageCount = Math.ceil(total / input.limit);
  const minute = Math.floor(input.nowMs / 60_000);
  const offset = (minute % pageCount) * input.limit;
  const rows = await input.db
    .prepare(
      `
        SELECT id, organization_id, title, draft_created_at
        FROM organization_documents
        WHERE draft_content IS NOT NULL
          AND draft_created_at IS NOT NULL
        ORDER BY draft_created_at, id
        LIMIT ? OFFSET ?
      `
    )
    .bind(input.limit, offset)
    .all<PendingOrganizationDocumentDraftRow>();
  return rows.results ?? [];
}

async function readPendingOrganizationDocumentDraft(input: {
  db: D1Database;
  documentId: string;
  organizationId: string;
}): Promise<PendingOrganizationDocumentDraftRow | null> {
  return await input.db
    .prepare(
      `
        SELECT id, organization_id, title, draft_created_at
        FROM organization_documents
        WHERE organization_id = ?
          AND id = ?
          AND draft_content IS NOT NULL
          AND draft_created_at IS NOT NULL
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.documentId)
    .first<PendingOrganizationDocumentDraftRow>();
}

function buildDocumentWorkKey(
  organizationId: string,
  documentId: string
): string {
  return `${organizationId}\u0000${documentId}`;
}

function parseDocumentWorkKey(value: string): [string, string] {
  const separatorIndex = value.indexOf("\u0000");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new TypeError("Organization document Inbox work key is invalid");
  }
  return [value.slice(0, separatorIndex), value.slice(separatorIndex + 1)];
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return ORGANIZATION_DOCUMENT_INBOX_RECONCILE_LIMIT;
  }
  if (!(Number.isSafeInteger(value) && value > 0 && value <= 500)) {
    throw new TypeError("Organization document Inbox limit is invalid");
  }
  return value;
}

function logReconciliationFailure(input: {
  documentId?: string;
  draft?: PendingOrganizationDocumentDraftRow | null;
  error: unknown;
  organizationId?: string;
}): void {
  console.warn("[core.organization_document.inbox_reconcile_failed]", {
    documentId: input.draft?.id ?? input.documentId,
    error:
      input.error instanceof Error ? input.error.message : String(input.error),
    organizationId: input.draft?.organization_id ?? input.organizationId,
  });
}
