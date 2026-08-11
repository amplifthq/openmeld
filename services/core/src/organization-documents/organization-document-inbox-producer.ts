import { INBOX_TITLE_MAX_CHARS } from "@openmeld/schemas";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
  resolveSupersededOrganizationDocumentDraftInboxItems,
} from "../inbox/application/inbox-item-service";
import { truncateInboxText } from "../inbox/application/inbox-text";

const ORGANIZATION_DOCUMENT_DRAFT_SOURCE_KIND =
  "organization_document_draft" as const;

type OrganizationDocumentDraftReviewContext = {
  documentId: string;
  draftCreatedAtMs: number;
  organizationId: string;
  title: string;
};

export async function projectOrganizationDocumentDraftReview(input: {
  db: D1Database;
  draft: OrganizationDocumentDraftReviewContext;
  recipientUserIds: readonly string[];
}): Promise<void> {
  const sourceKey = buildOrganizationDocumentDraftSourceKey(input.draft);
  const titlePrefix = "Review “";
  const titleSuffix = "”";
  const documentTitle = truncateInboxText(
    input.draft.title,
    INBOX_TITLE_MAX_CHARS - titlePrefix.length - titleSuffix.length
  );
  for (const recipientUserId of [...new Set(input.recipientUserIds)].sort()) {
    await ensureInboxItem({
      candidate: {
        attention: "action_required",
        contextLabel: null,
        importance: "normal",
        kind: "document_review",
        occurredAtMs: input.draft.draftCreatedAtMs,
        organizationId: input.draft.organizationId,
        preview: "The Center Agent prepared a document update for approval.",
        recipientUserId,
        sourceKey,
        sourceKind: ORGANIZATION_DOCUMENT_DRAFT_SOURCE_KIND,
        sourceTarget: {
          documentId: input.draft.documentId,
          kind: "organization_document",
        },
        title: `${titlePrefix}${documentTitle}${titleSuffix}`,
      },
      db: input.db,
      nowMs: input.draft.draftCreatedAtMs,
    });
  }
}

export async function resolveOrganizationDocumentDraftReview(input: {
  db: D1Database;
  documentId: string;
  draftCreatedAtMs: number;
  organizationId: string;
  resolvedAtMs: number;
}): Promise<void> {
  await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    sourceKey: buildOrganizationDocumentDraftSourceKey(input),
    sourceKind: ORGANIZATION_DOCUMENT_DRAFT_SOURCE_KIND,
  });
}

export async function resolveAllOrganizationDocumentDraftReviews(input: {
  db: D1Database;
  documentId: string;
  organizationId: string;
  resolvedAtMs: number;
}): Promise<void> {
  await resolveSupersededOrganizationDocumentDraftInboxItems({
    currentSourceKey: null,
    ...input,
  });
}

export function buildOrganizationDocumentDraftSourceKey(input: {
  documentId: string;
  draftCreatedAtMs: number;
}): string {
  return `${input.documentId}:${input.draftCreatedAtMs}`;
}
