import {
  CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY,
  centerAgentMemberResearchReportSchema,
  ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
  ORGANIZATION_DOCUMENT_FOLDER_LIMIT,
  ORGANIZATION_DOCUMENT_FOLDER_NAME_MAX_CHARS,
  ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS,
  ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT,
} from "@openmeld/schemas";
import type {
  CenterAgentDraftOrganizationDocumentRpcInput,
  CenterAgentOrganizationDocumentsComputerSnapshotResponse,
  OrganizationDocument,
  OrganizationDocumentFolder,
  OrganizationDocumentKind,
  OrganizationDocumentSummary,
  UpdateOrganizationDocumentBody,
} from "@openmeld/schemas/types";
import { renderCenterAgentMemberResearchDraft } from "../center-agent-member-research/member-research-report";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  projectOrganizationDocumentDraftReview,
  resolveAllOrganizationDocumentDraftReviews,
  resolveOrganizationDocumentDraftReview,
} from "./organization-document-inbox-producer";

const ORGANIZATION_BRIEF_TITLE = "Organization Brief";
const PROFILE_REPORTS_ROOT_FOLDER_NAME = "Profile Reports";
const PROFILE_REPORT_TYPE = "work_profile" as const;
const PROFILE_REPORT_TYPE_LABEL = "Work Profile";

export type OrganizationDocumentActor = {
  organizationId: string;
  role: string;
  userId: string;
};

export type OrganizationDocumentReadActor = Omit<
  OrganizationDocumentActor,
  "userId"
> & {
  userId: string | null;
};

type OrganizationDocumentRow = {
  content: string;
  created_at: number;
  draft_content: string | null;
  draft_created_at: number | null;
  draft_created_by: string | null;
  folder_id: string | null;
  id: string;
  kind: OrganizationDocumentKind;
  organization_id: string;
  profile_report_date: string | null;
  profile_report_type: typeof PROFILE_REPORT_TYPE | null;
  subject_user_id: string | null;
  title: string;
  updated_at: number;
};

type OrganizationDocumentFolderRow = {
  created_at: number;
  id: string;
  name: string;
  organization_id: string;
  parent_folder_id: string | null;
  subject_user_id: string | null;
  system_kind: "profile_reports_person" | "profile_reports_root" | null;
  updated_at: number;
};

type OrganizationDocumentServiceDependencies = {
  db: D1Database;
  newId?: () => string;
  now?: () => number;
};

type OrganizationDocumentDraftInput = Omit<
  CenterAgentDraftOrganizationDocumentRpcInput,
  "context" | "memberResearchTaskId" | "speakerMember"
> & {
  memberResearch?: {
    submissionId: string;
    taskId: string;
  };
};

type PreparedOrganizationDocumentDraftInput = OrganizationDocumentDraftInput & {
  folderId?: string | null;
  profileReportDate?: string;
  profileReportType?: typeof PROFILE_REPORT_TYPE;
  title?: string;
};

type OrganizationDocumentDraftWriteResult = {
  document: OrganizationDocumentSummary;
  draftCreatedAtMs: number | null;
  draftReplaced: boolean;
  replacedDraftCreatedAtMs: number | null;
};

type OrganizationDocumentDraftReviewerSource =
  | readonly string[]
  | (() => Promise<readonly string[]>);

type OrganizationDocumentUpdateInput = Omit<
  UpdateOrganizationDocumentBody,
  "expectedOrganizationId"
>;

export function createOrganizationDocumentService(
  dependencies: OrganizationDocumentServiceDependencies
) {
  const now = dependencies.now ?? Date.now;
  const newId = dependencies.newId ?? (() => crypto.randomUUID());

  return {
    async approveDraft(
      actor: OrganizationDocumentActor,
      documentId: string,
      expectedDraftCreatedAt: string
    ): Promise<OrganizationDocument> {
      requireManager(actor);
      const existing = await requireDocument(
        dependencies.db,
        actor.organizationId,
        documentId
      );
      const expectedDraftCreatedAtMs = requireExpectedDraft(
        existing,
        expectedDraftCreatedAt
      );
      const resolvedAtMs = now();
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_documents
            SET content = draft_content,
                draft_content = NULL,
                draft_created_by = NULL,
                draft_created_at = NULL,
                updated_at = ?
            WHERE id = ?
              AND organization_id = ?
              AND draft_content IS NOT NULL
              AND draft_created_at = ?
          `
        )
        .bind(
          resolvedAtMs,
          documentId,
          actor.organizationId,
          expectedDraftCreatedAtMs
        )
        .run();
      if (result.meta.changes !== 1) {
        throw draftChangedError();
      }
      await runBestEffortDraftInboxProjection(
        {
          documentId,
          operation: "resolve",
          organizationId: actor.organizationId,
        },
        async () => {
          await resolveOrganizationDocumentDraftReview({
            db: dependencies.db,
            documentId,
            draftCreatedAtMs: expectedDraftCreatedAtMs,
            organizationId: actor.organizationId,
            resolvedAtMs,
          });
        }
      );
      return await getDocument(dependencies.db, actor, documentId);
    },

    async create(
      actor: OrganizationDocumentActor,
      input: {
        content: string;
        folderId?: string | null;
        kind: OrganizationDocumentKind;
        subjectUserId?: string | null;
        title?: string;
      }
    ): Promise<OrganizationDocument> {
      requireManager(actor);
      validateContent(input.content);
      const timestamp = now();
      const placement = await resolveNewDocumentPlacement({
        actor,
        db: dependencies.db,
        input,
        newId,
        timestamp,
      });
      const documentId = newId();
      try {
        const result = await dependencies.db
          .prepare(
            `
              INSERT INTO organization_documents (
                id,
                organization_id,
                kind,
                subject_user_id,
                profile_report_date,
                profile_report_type,
                folder_id,
                title,
                content,
                draft_content,
                draft_created_by,
                draft_created_at,
                created_at,
                updated_at
              )
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?
              WHERE ? != 'knowledge'
                OR (
                  SELECT COUNT(*)
                  FROM organization_documents
                  WHERE organization_id = ? AND kind = 'knowledge'
                ) < ?
            `
          )
          .bind(
            documentId,
            actor.organizationId,
            input.kind,
            placement.subjectUserId,
            placement.profileReportDate,
            placement.profileReportType,
            placement.folderId,
            placement.title,
            input.content,
            timestamp,
            timestamp,
            input.kind,
            actor.organizationId,
            ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT
          )
          .run();
        if (result.meta.changes !== 1) {
          throw knowledgeLimitError();
        }
      } catch (error) {
        throw mapCreateError(error, input.kind);
      }
      return await getDocument(dependencies.db, actor, documentId);
    },

    async createFolder(
      actor: OrganizationDocumentActor,
      input: { name: string; parentFolderId?: string | null }
    ): Promise<OrganizationDocumentFolder> {
      requireManager(actor);
      const name = validateFolderName(input.name);
      const parentFolderId = input.parentFolderId ?? null;
      if (parentFolderId !== null) {
        const parentFolder = await requireFolder(
          dependencies.db,
          actor.organizationId,
          parentFolderId
        );
        if (parentFolder.isManaged) {
          throw managedPlacementError();
        }
      }
      await requireFolderNameAvailable(
        dependencies.db,
        actor.organizationId,
        name,
        parentFolderId
      );
      const timestamp = now();
      const folderId = newId();
      try {
        const result = await dependencies.db
          .prepare(
            `
              INSERT INTO organization_document_folders (
                id,
                organization_id,
                parent_folder_id,
                name,
                created_at,
                updated_at
              )
              SELECT ?, ?, ?, ?, ?, ?
              WHERE (
                SELECT COUNT(*)
                FROM organization_document_folders
                WHERE organization_id = ?
              ) < ?
            `
          )
          .bind(
            folderId,
            actor.organizationId,
            parentFolderId,
            name,
            timestamp,
            timestamp,
            actor.organizationId,
            ORGANIZATION_DOCUMENT_FOLDER_LIMIT
          )
          .run();
        if (result.meta.changes !== 1) {
          throw folderLimitError();
        }
      } catch (error) {
        throw mapFolderWriteError(error);
      }
      return await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
    },

    async deleteFolder(
      actor: OrganizationDocumentActor,
      folderId: string
    ): Promise<void> {
      requireManager(actor);
      const folder = await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
      if (folder.isManaged) {
        throw managedPlacementError();
      }
      const parentFolderId = folder.parentFolderId ?? null;
      try {
        // Deleting a folder unwraps one level instead of deleting content:
        // its documents and direct child folders move to its parent.
        const [, , deleteResult] = await dependencies.db.batch([
          dependencies.db
            .prepare(
              `
                UPDATE organization_documents
                SET folder_id = ?
                WHERE organization_id = ? AND folder_id = ?
              `
            )
            .bind(parentFolderId, actor.organizationId, folderId),
          dependencies.db
            .prepare(
              `
                UPDATE organization_document_folders
                SET parent_folder_id = ?, updated_at = ?
                WHERE organization_id = ? AND parent_folder_id = ?
              `
            )
            .bind(parentFolderId, now(), actor.organizationId, folderId),
          dependencies.db
            .prepare(
              "DELETE FROM organization_document_folders WHERE id = ? AND organization_id = ?"
            )
            .bind(folderId, actor.organizationId),
        ]);
        if (deleteResult?.meta.changes !== 1) {
          throw folderNotFoundError();
        }
      } catch (error) {
        throw mapFolderWriteError(error);
      }
    },

    async listFolders(
      actor: OrganizationDocumentReadActor
    ): Promise<OrganizationDocumentFolder[]> {
      const result = await dependencies.db
        .prepare(
          `
            SELECT *
            FROM organization_document_folders
            WHERE organization_id = ?
            ORDER BY lower(name), created_at
          `
        )
        .bind(actor.organizationId)
        .all<OrganizationDocumentFolderRow>();
      return (result.results ?? []).map(toFolder);
    },

    async renameFolder(
      actor: OrganizationDocumentActor,
      folderId: string,
      input: { name: string }
    ): Promise<OrganizationDocumentFolder> {
      requireManager(actor);
      const name = validateFolderName(input.name);
      const existing = await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
      if (existing.isManaged) {
        throw managedPlacementError();
      }
      if (existing.name !== name) {
        await requireFolderNameAvailable(
          dependencies.db,
          actor.organizationId,
          name,
          existing.parentFolderId ?? null,
          folderId
        );
      }
      try {
        await dependencies.db
          .prepare(
            `
              UPDATE organization_document_folders
              SET name = ?, updated_at = ?
              WHERE id = ? AND organization_id = ?
            `
          )
          .bind(name, now(), folderId, actor.organizationId)
          .run();
      } catch (error) {
        throw mapFolderWriteError(error);
      }
      return await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
    },

    async moveFolder(
      actor: OrganizationDocumentActor,
      folderId: string,
      parentFolderId: string | null
    ): Promise<OrganizationDocumentFolder> {
      requireManager(actor);
      const folder = await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
      if (folder.isManaged) {
        throw managedPlacementError();
      }
      if (parentFolderId !== null) {
        const parentFolder = await requireFolder(
          dependencies.db,
          actor.organizationId,
          parentFolderId
        );
        if (parentFolder.isManaged) {
          throw managedPlacementError();
        }
      }
      if ((folder.parentFolderId ?? null) === parentFolderId) {
        return folder;
      }
      await requireFolderNameAvailable(
        dependencies.db,
        actor.organizationId,
        folder.name,
        parentFolderId,
        folderId
      );
      try {
        const result = await dependencies.db
          .prepare(
            `
              WITH RECURSIVE descendants(id) AS (
                SELECT id
                FROM organization_document_folders
                WHERE id = ? AND organization_id = ?
                UNION ALL
                SELECT child.id
                FROM organization_document_folders AS child
                INNER JOIN descendants ON child.parent_folder_id = descendants.id
                WHERE child.organization_id = ?
              )
              UPDATE organization_document_folders
              SET parent_folder_id = ?, updated_at = ?
              WHERE id = ?
                AND organization_id = ?
                AND (? IS NULL OR ? NOT IN (SELECT id FROM descendants))
            `
          )
          .bind(
            folderId,
            actor.organizationId,
            actor.organizationId,
            parentFolderId,
            now(),
            folderId,
            actor.organizationId,
            parentFolderId,
            parentFolderId
          )
          .run();
        if (result.meta.changes !== 1) {
          throw folderCycleError();
        }
      } catch (error) {
        throw mapFolderWriteError(error);
      }
      return await requireFolder(
        dependencies.db,
        actor.organizationId,
        folderId
      );
    },

    async delete(
      actor: OrganizationDocumentActor,
      documentId: string
    ): Promise<void> {
      requireManager(actor);
      const resolvedAtMs = now();
      const result = await dependencies.db
        .prepare(
          "DELETE FROM organization_documents WHERE id = ? AND organization_id = ?"
        )
        .bind(documentId, actor.organizationId)
        .run();
      if (result.meta.changes !== 1) {
        throw documentNotFoundError();
      }
      await runBestEffortDraftInboxProjection(
        {
          documentId,
          operation: "resolve_all",
          organizationId: actor.organizationId,
        },
        async () => {
          await resolveAllOrganizationDocumentDraftReviews({
            db: dependencies.db,
            documentId,
            organizationId: actor.organizationId,
            resolvedAtMs,
          });
        }
      );
    },

    async discardDraft(
      actor: OrganizationDocumentActor,
      documentId: string,
      expectedDraftCreatedAt: string
    ): Promise<OrganizationDocument> {
      requireManager(actor);
      const existing = await requireDocument(
        dependencies.db,
        actor.organizationId,
        documentId
      );
      const expectedDraftCreatedAtMs = requireExpectedDraft(
        existing,
        expectedDraftCreatedAt
      );
      const resolvedAtMs = now();
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_documents
            SET draft_content = NULL,
                draft_created_by = NULL,
                draft_created_at = NULL,
                updated_at = ?
            WHERE id = ?
              AND organization_id = ?
              AND draft_content IS NOT NULL
              AND draft_created_at = ?
          `
        )
        .bind(
          resolvedAtMs,
          documentId,
          actor.organizationId,
          expectedDraftCreatedAtMs
        )
        .run();
      if (result.meta.changes !== 1) {
        throw draftChangedError();
      }
      await runBestEffortDraftInboxProjection(
        {
          documentId,
          operation: "resolve",
          organizationId: actor.organizationId,
        },
        async () => {
          await resolveOrganizationDocumentDraftReview({
            db: dependencies.db,
            documentId,
            draftCreatedAtMs: expectedDraftCreatedAtMs,
            organizationId: actor.organizationId,
            resolvedAtMs,
          });
        }
      );
      return await getDocument(dependencies.db, actor, documentId);
    },

    async draft(
      organizationId: string,
      input: OrganizationDocumentDraftInput,
      reviewerSource: OrganizationDocumentDraftReviewerSource
    ): Promise<{
      document: OrganizationDocumentSummary;
      draftReplaced: boolean;
    }> {
      const preparedInput = input.memberResearch
        ? await prepareMemberResearchDraft({
            db: dependencies.db,
            draftedAtMs: now(),
            input,
            newId,
            organizationId,
          })
        : input;
      validateContent(preparedInput.draftContent);
      if (
        !preparedInput.documentId &&
        preparedInput.folderId !== undefined &&
        preparedInput.folderId !== null
      ) {
        await requireFolder(
          dependencies.db,
          organizationId,
          preparedInput.folderId
        );
      }
      const result = preparedInput.documentId
        ? await updateOrganizationDocumentDraft({
            db: dependencies.db,
            input: preparedInput,
            now,
            organizationId,
          })
        : await createOrganizationDocumentDraft({
            db: dependencies.db,
            input: preparedInput,
            newId,
            now,
            organizationId,
          });
      const draftCreatedAtMs = result.draftCreatedAtMs;
      if (
        draftCreatedAtMs !== null &&
        result.document.kind !== "member_profile"
      ) {
        await runBestEffortDraftInboxProjection(
          {
            documentId: result.document.id,
            operation: "project",
            organizationId,
          },
          async () => {
            if (result.replacedDraftCreatedAtMs !== null) {
              await resolveOrganizationDocumentDraftReview({
                db: dependencies.db,
                documentId: result.document.id,
                draftCreatedAtMs: result.replacedDraftCreatedAtMs,
                organizationId,
                resolvedAtMs: draftCreatedAtMs,
              });
            }
            const reviewerUserIds =
              typeof reviewerSource === "function"
                ? await reviewerSource()
                : reviewerSource;
            await projectOrganizationDocumentDraftReview({
              db: dependencies.db,
              draft: {
                documentId: result.document.id,
                draftCreatedAtMs,
                organizationId,
                title: result.document.title,
              },
              recipientUserIds: reviewerUserIds,
            });
          }
        );
      }
      return {
        document: result.document,
        draftReplaced: result.draftReplaced,
      };
    },

    get: async (
      actor: OrganizationDocumentReadActor,
      documentId: string
    ): Promise<OrganizationDocument> =>
      await getDocument(dependencies.db, actor, documentId),

    async list(
      actor: OrganizationDocumentReadActor
    ): Promise<OrganizationDocumentSummary[]> {
      const result = await dependencies.db
        .prepare(
          `
            SELECT *
            FROM organization_documents
            WHERE organization_id = ?
            ORDER BY
              CASE kind WHEN 'brief' THEN 0 WHEN 'member_profile' THEN 1 ELSE 2 END,
              lower(title),
              created_at
          `
        )
        .bind(actor.organizationId)
        .all<OrganizationDocumentRow>();
      return (result.results ?? []).map((row) => toSummary(row, actor));
    },

    async readPromptContext(organizationId: string): Promise<{
      briefContent: string | null;
      documentTitles: string[];
    }> {
      const result = await dependencies.db
        .prepare(
          `
            SELECT kind, title, content
            FROM organization_documents
            WHERE organization_id = ?
            ORDER BY
              CASE kind WHEN 'brief' THEN 0 WHEN 'member_profile' THEN 1 ELSE 2 END,
              lower(title),
              created_at
          `
        )
        .bind(organizationId)
        .all<Pick<OrganizationDocumentRow, "content" | "kind" | "title">>();
      const rows = result.results ?? [];
      const briefContent = rows.find((row) => row.kind === "brief")?.content;
      return {
        briefContent: briefContent?.trim() ? briefContent : null,
        documentTitles: rows
          .filter((row) => row.content.trim().length > 0)
          .map((row) => row.title),
      };
    },

    async readComputerSnapshot(
      organizationId: string
    ): Promise<
      Omit<CenterAgentOrganizationDocumentsComputerSnapshotResponse, "revision">
    > {
      const actor = centerAgentDocumentActor(organizationId);
      const [documentRows, folders] = await Promise.all([
        dependencies.db
          .prepare(
            `
              SELECT *
              FROM organization_documents
              WHERE organization_id = ?
              ORDER BY
                CASE kind WHEN 'brief' THEN 0 WHEN 'member_profile' THEN 1 ELSE 2 END,
                lower(title),
                created_at
            `
          )
          .bind(organizationId)
          .all<OrganizationDocumentRow>(),
        dependencies.db
          .prepare(
            `
              SELECT *
              FROM organization_document_folders
              WHERE organization_id = ?
              ORDER BY lower(name), created_at
            `
          )
          .bind(organizationId)
          .all<OrganizationDocumentFolderRow>(),
      ]);
      return {
        documents: (documentRows.results ?? []).map((row) => {
          const document = toDocument(row, actor);
          return {
            content: document.content,
            folderId: document.folderId,
            id: document.id,
            kind: document.kind,
            subjectUserId: document.subjectUserId,
            title: document.title,
            updatedAt: document.updatedAt,
          };
        }),
        folders: (folders.results ?? []).map(toFolder),
        organizationId,
      };
    },

    async update(
      actor: OrganizationDocumentActor,
      documentId: string,
      input: OrganizationDocumentUpdateInput
    ): Promise<OrganizationDocument> {
      const existing = await requireDocument(
        dependencies.db,
        actor.organizationId,
        documentId
      );
      await validateDocumentUpdate({
        actor,
        db: dependencies.db,
        existing,
        input,
      });
      const version = requireHumanDocumentUpdateVersion(input);
      const update = buildDocumentUpdate(existing, input, now());
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_documents
            SET ${update.assignments.join(", ")}
            WHERE id = ? AND organization_id = ?
              AND (
                ? = 0
                OR (updated_at = ? AND draft_created_at IS ?)
              )
          `
        )
        .bind(
          ...update.values,
          documentId,
          actor.organizationId,
          version ? 1 : 0,
          version?.documentUpdatedAtMs ?? null,
          version?.draftCreatedAtMs ?? null
        )
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        await requireDocument(
          dependencies.db,
          actor.organizationId,
          documentId
        );
        throw workingCopyConflictError();
      }
      return await getDocument(dependencies.db, actor, documentId);
    },

    async updateApprovedKnowledge(
      actor: OrganizationDocumentActor,
      documentId: string,
      input: { content: string; folderId?: string | null; title?: string }
    ): Promise<OrganizationDocument> {
      requireManager(actor);
      const existing = await requireDocument(
        dependencies.db,
        actor.organizationId,
        documentId
      );
      if (existing.kind !== "knowledge") {
        throw documentError(
          400,
          "invalid_payload",
          "Center Agent formal saves support ordinary knowledge documents only."
        );
      }
      if (existing.draft_content !== null) {
        throw pendingDraftConflictError();
      }
      validateContent(input.content);
      if (input.folderId !== undefined && input.folderId !== null) {
        const folder = await requireFolder(
          dependencies.db,
          actor.organizationId,
          input.folderId
        );
        if (folder.isManaged) {
          throw managedPlacementError();
        }
      }
      const update = buildDocumentUpdate(existing, input, now());
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_documents
            SET ${update.assignments.join(", ")}
            WHERE id = ? AND organization_id = ? AND draft_content IS NULL
          `
        )
        .bind(...update.values, documentId, actor.organizationId)
        .run();
      if (result.meta.changes !== 1) {
        const current = await requireDocument(
          dependencies.db,
          actor.organizationId,
          documentId
        );
        if (current.draft_content !== null) {
          throw pendingDraftConflictError();
        }
        throw documentNotFoundError();
      }
      return await getDocument(dependencies.db, actor, documentId);
    },
  };
}

async function resolveNewDocumentPlacement(input: {
  actor: OrganizationDocumentActor;
  db: D1Database;
  input: {
    folderId?: string | null;
    kind: OrganizationDocumentKind;
    subjectUserId?: string | null;
    title?: string;
  };
  newId: () => string;
  timestamp: number;
}): Promise<{
  folderId: string | null;
  profileReportDate: string | null;
  profileReportType: typeof PROFILE_REPORT_TYPE | null;
  subjectUserId: string | null;
  title: string;
}> {
  const subjectUserId = input.input.subjectUserId ?? null;
  if (input.input.kind === "member_profile" && subjectUserId) {
    const profileReportDate = toIsoDate(input.timestamp);
    const placement = await ensureProfileReportPlacement({
      db: input.db,
      displayName: await readMemberDisplayName({
        db: input.db,
        organizationId: input.actor.organizationId,
        subjectUserId,
      }),
      newId: input.newId,
      organizationId: input.actor.organizationId,
      subjectUserId,
      timestamp: input.timestamp,
    });
    return {
      folderId: placement.folderId,
      profileReportDate,
      profileReportType: PROFILE_REPORT_TYPE,
      subjectUserId,
      title: await resolveNextProfileReportTitle({
        db: input.db,
        organizationId: input.actor.organizationId,
        profileReportDate,
        subjectUserId,
      }),
    };
  }

  const folderId = input.input.folderId ?? null;
  if (folderId !== null) {
    await requireUnmanagedFolder(
      input.db,
      input.actor.organizationId,
      folderId
    );
  }
  return {
    folderId,
    profileReportDate: null,
    profileReportType: null,
    subjectUserId,
    title: await resolveNewDocumentTitle({
      actor: input.actor,
      db: input.db,
      kind: input.input.kind,
      subjectUserId,
      title: input.input.title,
    }),
  };
}

async function validateDocumentUpdate(input: {
  actor: OrganizationDocumentActor;
  db: D1Database;
  existing: OrganizationDocumentRow;
  input: { content?: string; folderId?: string | null; title?: string };
}): Promise<void> {
  const isManager = canManage(input.actor);
  const isSubject =
    input.existing.kind === "member_profile" &&
    input.existing.subject_user_id === input.actor.userId;
  if (!(isManager || (isSubject && input.input.content !== undefined))) {
    throw writeForbiddenError();
  }
  const placementChanged =
    input.input.title !== undefined || input.input.folderId !== undefined;
  if (!isManager && placementChanged) {
    throw writeForbiddenError();
  }
  if (input.existing.kind === "member_profile" && placementChanged) {
    throw managedPlacementError();
  }
  if (input.input.content !== undefined) {
    validateContent(input.input.content);
  }
  if (input.input.folderId !== undefined && input.input.folderId !== null) {
    await requireUnmanagedFolder(
      input.db,
      input.actor.organizationId,
      input.input.folderId
    );
  }
}

async function requireUnmanagedFolder(
  db: D1Database,
  organizationId: string,
  folderId: string
): Promise<void> {
  const folder = await requireFolder(db, organizationId, folderId);
  if (folder.isManaged) {
    throw managedPlacementError();
  }
}

async function prepareMemberResearchDraft(input: {
  db: D1Database;
  draftedAtMs: number;
  input: OrganizationDocumentDraftInput;
  newId: () => string;
  organizationId: string;
}): Promise<PreparedOrganizationDocumentDraftInput> {
  const parsedReport = centerAgentMemberResearchReportSchema.safeParse(
    input.input.memberResearchReport
  );
  if (!parsedReport.success) {
    const issue = parsedReport.error.issues[0]?.message;
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.report_quality_failed",
      reason: `This Profile Report did not meet the member research evidence contract.${issue ? ` ${issue}` : ""}`,
      status: 422,
    });
  }
  const existing = input.input.documentId
    ? await requireDocument(
        input.db,
        input.organizationId,
        input.input.documentId
      )
    : null;
  const subjectUserId =
    existing?.subject_user_id ?? input.input.subjectUserId ?? null;
  if (
    (existing && existing.kind !== "member_profile") ||
    !subjectUserId ||
    (!existing && input.input.kind !== "member_profile")
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.report_quality_failed",
      reason:
        "Member research can only produce a Profile Report for its assigned Organization member.",
      status: 422,
    });
  }
  const subjectDisplayName = await readMemberDisplayName({
    db: input.db,
    organizationId: input.organizationId,
    subjectUserId,
  });
  const placement = await ensureProfileReportPlacement({
    db: input.db,
    displayName: subjectDisplayName,
    newId: input.newId,
    organizationId: input.organizationId,
    subjectUserId,
    timestamp: input.draftedAtMs,
  });
  const profileReportDate = toIsoDate(input.draftedAtMs);
  return {
    ...input.input,
    draftContent: renderCenterAgentMemberResearchDraft({
      approvedContent: existing?.content ?? null,
      draftedAtMs: input.draftedAtMs,
      report: parsedReport.data,
      subjectDisplayName,
    }),
    folderId: placement.folderId,
    profileReportDate,
    profileReportType: PROFILE_REPORT_TYPE,
    title: existing
      ? existing.title
      : await resolveNextProfileReportTitle({
          db: input.db,
          organizationId: input.organizationId,
          profileReportDate,
          subjectUserId,
        }),
  };
}

async function updateOrganizationDocumentDraft(input: {
  db: D1Database;
  input: PreparedOrganizationDocumentDraftInput;
  now: () => number;
  organizationId: string;
}): Promise<OrganizationDocumentDraftWriteResult> {
  const documentId = input.input.documentId;
  if (!documentId) {
    throw new Error("An existing Organization document draft requires an id.");
  }
  const existing = await requireDocument(
    input.db,
    input.organizationId,
    documentId
  );
  const timestamp = input.now();
  const memberResearch = input.input.memberResearch ?? null;
  const expectedDocumentUpdatedAtMs =
    input.input.expectedDocumentUpdatedAt === undefined
      ? null
      : Date.parse(input.input.expectedDocumentUpdatedAt);
  const result = await input.db
    .prepare(
      `
        UPDATE organization_documents
        SET draft_content = ?,
            draft_created_by = ?,
            draft_created_at = ?,
            last_member_research_task_id = COALESCE(?, last_member_research_task_id),
            folder_id = CASE WHEN ? = 1 THEN ? ELSE folder_id END,
            title = CASE WHEN ? = 1 THEN ? ELSE title END,
            profile_report_date = CASE WHEN ? = 1 THEN ? ELSE profile_report_date END,
            profile_report_type = CASE WHEN ? = 1 THEN ? ELSE profile_report_type END,
            updated_at = ?
        WHERE id = ? AND organization_id = ?
          AND (? IS NULL OR updated_at = ?)
          AND (
            ? IS NULL
            OR EXISTS (
              SELECT 1
              FROM center_agent_member_research_tasks task
              INNER JOIN center_agent_member_research_batches batch
                ON batch.id = task.batch_id
              INNER JOIN openMeldRemoteAgent_native_delivery_ledger delivery
                ON delivery.idempotency_key = task.id
              WHERE task.id = ?
                AND task.status = 'running'
                AND batch.organization_id = organization_documents.organization_id
                AND delivery.organization_id = batch.organization_id
                AND delivery.submission_id = ?
                AND delivery.status IN ('accepted', 'retry_observed')
                AND task.subject_user_id = organization_documents.subject_user_id
                AND organization_documents.kind = 'member_profile'
                AND NOT EXISTS (
                  SELECT 1
                  FROM organization_documents evidence
                  WHERE evidence.last_member_research_task_id = task.id
                )
            )
          )
      `
    )
    .bind(
      input.input.draftContent,
      CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY,
      timestamp,
      memberResearch?.taskId ?? null,
      input.input.folderId === undefined ? 0 : 1,
      input.input.folderId ?? null,
      input.input.title === undefined ? 0 : 1,
      input.input.title ?? null,
      input.input.profileReportDate === undefined ? 0 : 1,
      input.input.profileReportDate ?? null,
      input.input.profileReportType === undefined ? 0 : 1,
      input.input.profileReportType ?? null,
      timestamp,
      documentId,
      input.organizationId,
      expectedDocumentUpdatedAtMs,
      expectedDocumentUpdatedAtMs,
      memberResearch?.taskId ?? null,
      memberResearch?.taskId ?? null,
      memberResearch?.submissionId ?? null
    )
    .run();
  if (result.meta.changes !== 1) {
    return await resolveOrganizationDocumentDraftUpdateMiss({
      db: input.db,
      input: input.input,
      organizationId: input.organizationId,
      expectedDocumentUpdatedAtMs,
    });
  }
  const updated = await requireDocument(
    input.db,
    input.organizationId,
    documentId
  );
  return {
    document: toSummary(
      updated,
      centerAgentDocumentActor(input.organizationId)
    ),
    draftCreatedAtMs: timestamp,
    draftReplaced: existing.draft_content !== null,
    replacedDraftCreatedAtMs: existing.draft_created_at,
  };
}

async function resolveOrganizationDocumentDraftUpdateMiss(input: {
  db: D1Database;
  expectedDocumentUpdatedAtMs: number | null;
  input: PreparedOrganizationDocumentDraftInput;
  organizationId: string;
}): Promise<OrganizationDocumentDraftWriteResult> {
  if (input.expectedDocumentUpdatedAtMs !== null && input.input.documentId) {
    const current = await requireDocument(
      input.db,
      input.organizationId,
      input.input.documentId
    );
    if (
      current.draft_content === input.input.draftContent &&
      current.draft_created_by ===
        CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY
    ) {
      return {
        document: toSummary(
          current,
          centerAgentDocumentActor(input.organizationId)
        ),
        draftCreatedAtMs: null,
        draftReplaced: false,
        replacedDraftCreatedAtMs: null,
      };
    }
    if (current.updated_at !== input.expectedDocumentUpdatedAtMs) {
      throw workingCopyConflictError();
    }
  }
  return await resolveOrganizationDocumentDraftWriteMiss({
    db: input.db,
    input: input.input,
    organizationId: input.organizationId,
    standardError: documentNotFoundError,
  });
}

async function createOrganizationDocumentDraft(input: {
  db: D1Database;
  input: PreparedOrganizationDocumentDraftInput;
  newId: () => string;
  now: () => number;
  organizationId: string;
}): Promise<OrganizationDocumentDraftWriteResult> {
  if (!input.input.kind) {
    throw documentError(
      400,
      "invalid_payload",
      "A new draft requires a document kind."
    );
  }
  const actor = {
    ...centerAgentDocumentActor(input.organizationId),
    role: "owner",
  };
  const subjectUserId = input.input.subjectUserId ?? null;
  const title = await resolveNewDocumentTitle({
    actor,
    db: input.db,
    kind: input.input.kind,
    subjectUserId,
    title: input.input.title,
  });
  const timestamp = input.now();
  const documentId = input.newId();
  const memberResearch = input.input.memberResearch ?? null;
  try {
    const result = await input.db
      .prepare(
        `
          INSERT INTO organization_documents (
            id,
            organization_id,
            kind,
            subject_user_id,
            profile_report_date,
            profile_report_type,
            folder_id,
            title,
            content,
            draft_content,
            draft_created_by,
            draft_created_at,
            last_member_research_task_id,
            created_at,
            updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?
          WHERE (
              ? IS NULL
              OR (
                ? = 'member_profile'
                AND ? IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM center_agent_member_research_tasks task
                  INNER JOIN center_agent_member_research_batches batch
                    ON batch.id = task.batch_id
                  INNER JOIN openMeldRemoteAgent_native_delivery_ledger delivery
                    ON delivery.idempotency_key = task.id
                  WHERE task.id = ?
                    AND task.status = 'running'
                    AND batch.organization_id = ?
                    AND delivery.organization_id = batch.organization_id
                    AND delivery.submission_id = ?
                    AND delivery.status IN ('accepted', 'retry_observed')
                    AND task.subject_user_id = ?
                    AND NOT EXISTS (
                      SELECT 1
                      FROM organization_documents evidence
                      WHERE evidence.last_member_research_task_id = task.id
                    )
                )
              )
            )
            AND (? != 'knowledge'
            OR (
              SELECT COUNT(*)
              FROM organization_documents
              WHERE organization_id = ? AND kind = 'knowledge'
            ) < ?)
        `
      )
      .bind(
        documentId,
        input.organizationId,
        input.input.kind,
        subjectUserId,
        input.input.profileReportDate ?? null,
        input.input.profileReportType ?? null,
        input.input.folderId ?? null,
        title,
        input.input.draftContent,
        CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY,
        timestamp,
        memberResearch?.taskId ?? null,
        timestamp,
        timestamp,
        memberResearch?.taskId ?? null,
        input.input.kind,
        subjectUserId,
        memberResearch?.taskId ?? null,
        input.organizationId,
        memberResearch?.submissionId ?? null,
        subjectUserId,
        input.input.kind,
        input.organizationId,
        ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT
      )
      .run();
    if (result.meta.changes !== 1) {
      return await resolveOrganizationDocumentDraftWriteMiss({
        db: input.db,
        input: input.input,
        organizationId: input.organizationId,
        standardError: knowledgeLimitError,
      });
    }
  } catch (error) {
    throw mapCreateError(error, input.input.kind);
  }
  const created = await requireDocument(
    input.db,
    input.organizationId,
    documentId
  );
  return {
    document: toSummary(
      created,
      centerAgentDocumentActor(input.organizationId)
    ),
    draftCreatedAtMs: timestamp,
    draftReplaced: false,
    replacedDraftCreatedAtMs: null,
  };
}

async function resolveOrganizationDocumentDraftWriteMiss(input: {
  db: D1Database;
  input: OrganizationDocumentDraftInput;
  organizationId: string;
  standardError: () => Error;
}): Promise<OrganizationDocumentDraftWriteResult> {
  const replay = await readMemberResearchDraftReplay(input);
  if (replay) {
    return replay;
  }
  if (input.input.memberResearch) {
    throw memberResearchDraftConflictError();
  }
  throw input.standardError();
}

function centerAgentDocumentActor(
  organizationId: string
): OrganizationDocumentActor {
  return { organizationId, role: "member", userId: "center_agent" };
}

async function getDocument(
  db: D1Database,
  actor: OrganizationDocumentReadActor,
  documentId: string
): Promise<OrganizationDocument> {
  const row = await requireDocument(db, actor.organizationId, documentId);
  return toDocument(row, actor);
}

async function requireDocument(
  db: D1Database,
  organizationId: string,
  documentId: string
): Promise<OrganizationDocumentRow> {
  const row = await db
    .prepare(
      "SELECT * FROM organization_documents WHERE id = ? AND organization_id = ? LIMIT 1"
    )
    .bind(documentId, organizationId)
    .first<OrganizationDocumentRow>();
  if (!row) {
    throw documentNotFoundError();
  }
  return row;
}

async function resolveNewDocumentTitle(input: {
  actor: OrganizationDocumentActor;
  db: D1Database;
  kind: OrganizationDocumentKind;
  subjectUserId: string | null;
  title?: string;
}): Promise<string> {
  if (input.kind === "brief") {
    if (input.subjectUserId !== null) {
      throw invalidSubjectError();
    }
    return ORGANIZATION_BRIEF_TITLE;
  }
  if (input.kind === "member_profile") {
    if (!input.subjectUserId) {
      throw invalidSubjectError();
    }
    const subjectDisplayName = await readMemberDisplayName({
      db: input.db,
      organizationId: input.actor.organizationId,
      subjectUserId: input.subjectUserId,
    });
    return validateTitle(input.title ?? `${subjectDisplayName} Profile Report`);
  }
  if (input.subjectUserId !== null) {
    throw invalidSubjectError();
  }
  if (!input.title) {
    throw documentError(
      400,
      "invalid_payload",
      "A knowledge document requires a title."
    );
  }
  return validateTitle(input.title);
}

async function readMemberDisplayName(input: {
  db: D1Database;
  organizationId: string;
  subjectUserId: string;
}): Promise<string> {
  const subject = await input.db
    .prepare(
      `
        SELECT users.name
        FROM members
        INNER JOIN users ON users.id = members.user_id
        WHERE members.organization_id = ? AND members.user_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.subjectUserId)
    .first<{ name: string }>();
  if (!subject) {
    throw documentError(
      400,
      "organization_document.subject_not_member",
      "The selected person is not an active Organization member."
    );
  }
  return subject.name;
}

async function ensureProfileReportPlacement(input: {
  db: D1Database;
  displayName: string;
  newId: () => string;
  organizationId: string;
  subjectUserId: string;
  timestamp: number;
}): Promise<{ folderId: string }> {
  const root = await ensureProfileReportsRootFolder(input);
  const person = await ensureProfileReportsPersonFolder({
    ...input,
    parentFolderId: root.id,
  });
  return { folderId: person.id };
}

async function ensureProfileReportsRootFolder(input: {
  db: D1Database;
  newId: () => string;
  organizationId: string;
  timestamp: number;
}): Promise<OrganizationDocumentFolderRow> {
  const managedRoot = await readProfileReportsRootFolder(input);
  if (managedRoot) {
    return managedRoot;
  }
  const existingNamedRoot = await input.db
    .prepare(
      `
        SELECT *
        FROM organization_document_folders
        WHERE organization_id = ?
          AND parent_folder_id IS NULL
          AND lower(name) = lower(?)
        LIMIT 1
      `
    )
    .bind(input.organizationId, PROFILE_REPORTS_ROOT_FOLDER_NAME)
    .first<OrganizationDocumentFolderRow>();
  if (existingNamedRoot) {
    await input.db
      .prepare(
        `
          UPDATE organization_document_folders
          SET system_kind = 'profile_reports_root',
              subject_user_id = NULL,
              updated_at = ?
          WHERE id = ?
            AND organization_id = ?
            AND system_kind IS NULL
        `
      )
      .bind(input.timestamp, existingNamedRoot.id, input.organizationId)
      .run();
    const adopted = await readProfileReportsRootFolder(input);
    if (adopted) {
      return adopted;
    }
  }
  const folderId = input.newId();
  try {
    const result = await input.db
      .prepare(
        `
          INSERT INTO organization_document_folders (
            id,
            organization_id,
            parent_folder_id,
            system_kind,
            subject_user_id,
            name,
            created_at,
            updated_at
          )
          SELECT ?, ?, NULL, 'profile_reports_root', NULL, ?, ?, ?
          WHERE (
            SELECT COUNT(*)
            FROM organization_document_folders
            WHERE organization_id = ?
          ) < ?
        `
      )
      .bind(
        folderId,
        input.organizationId,
        PROFILE_REPORTS_ROOT_FOLDER_NAME,
        input.timestamp,
        input.timestamp,
        input.organizationId,
        ORGANIZATION_DOCUMENT_FOLDER_LIMIT
      )
      .run();
    if (result.meta.changes !== 1) {
      throw folderLimitError();
    }
  } catch (error) {
    const racedRoot = await readProfileReportsRootFolder(input);
    if (racedRoot) {
      return racedRoot;
    }
    throw mapFolderWriteError(error);
  }
  return await requireFolderRow(input.db, input.organizationId, folderId);
}

async function readProfileReportsRootFolder(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationDocumentFolderRow | null> {
  return await input.db
    .prepare(
      `
        SELECT *
        FROM organization_document_folders
        WHERE organization_id = ?
          AND system_kind = 'profile_reports_root'
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<OrganizationDocumentFolderRow>();
}

async function ensureProfileReportsPersonFolder(input: {
  db: D1Database;
  displayName: string;
  newId: () => string;
  organizationId: string;
  parentFolderId: string;
  subjectUserId: string;
  timestamp: number;
}): Promise<OrganizationDocumentFolderRow> {
  const existing = await readProfileReportsPersonFolder(input);
  if (existing) {
    return existing;
  }
  for (let suffix = 1; suffix <= ORGANIZATION_DOCUMENT_FOLDER_LIMIT; suffix++) {
    const name = buildProfileReportsPersonFolderName(input.displayName, suffix);
    const nameCollision = await input.db
      .prepare(
        `
          SELECT id
          FROM organization_document_folders
          WHERE organization_id = ?
            AND parent_folder_id = ?
            AND lower(name) = lower(?)
          LIMIT 1
        `
      )
      .bind(input.organizationId, input.parentFolderId, name)
      .first<{ id: string }>();
    if (nameCollision) {
      continue;
    }
    const folderId = input.newId();
    try {
      const result = await input.db
        .prepare(
          `
            INSERT INTO organization_document_folders (
              id,
              organization_id,
              parent_folder_id,
              system_kind,
              subject_user_id,
              name,
              created_at,
              updated_at
            )
            SELECT ?, ?, ?, 'profile_reports_person', ?, ?, ?, ?
            WHERE (
              SELECT COUNT(*)
              FROM organization_document_folders
              WHERE organization_id = ?
            ) < ?
          `
        )
        .bind(
          folderId,
          input.organizationId,
          input.parentFolderId,
          input.subjectUserId,
          name,
          input.timestamp,
          input.timestamp,
          input.organizationId,
          ORGANIZATION_DOCUMENT_FOLDER_LIMIT
        )
        .run();
      if (result.meta.changes !== 1) {
        throw folderLimitError();
      }
      return await requireFolderRow(input.db, input.organizationId, folderId);
    } catch (error) {
      const racedFolder = await readProfileReportsPersonFolder(input);
      if (racedFolder) {
        return racedFolder;
      }
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw mapFolderWriteError(error);
    }
  }
  throw folderLimitError();
}

async function readProfileReportsPersonFolder(input: {
  db: D1Database;
  organizationId: string;
  subjectUserId: string;
}): Promise<OrganizationDocumentFolderRow | null> {
  return await input.db
    .prepare(
      `
        SELECT *
        FROM organization_document_folders
        WHERE organization_id = ?
          AND system_kind = 'profile_reports_person'
          AND subject_user_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.subjectUserId)
    .first<OrganizationDocumentFolderRow>();
}

function buildProfileReportsPersonFolderName(
  displayName: string,
  suffix: number
): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw documentError(
      400,
      "organization_document.folder_name_invalid",
      "A Profile Report needs the member's name before it can be saved."
    );
  }
  const suffixText = suffix === 1 ? "" : ` (${suffix})`;
  const name = `${normalized.slice(
    0,
    ORGANIZATION_DOCUMENT_FOLDER_NAME_MAX_CHARS - suffixText.length
  )}${suffixText}`;
  return validateFolderName(name);
}

async function resolveNextProfileReportTitle(input: {
  db: D1Database;
  organizationId: string;
  profileReportDate: string;
  subjectUserId: string;
}): Promise<string> {
  const result = await input.db
    .prepare(
      `
        SELECT title
        FROM organization_documents
        WHERE organization_id = ?
          AND kind = 'member_profile'
          AND subject_user_id = ?
          AND profile_report_date = ?
          AND profile_report_type = ?
      `
    )
    .bind(
      input.organizationId,
      input.subjectUserId,
      input.profileReportDate,
      PROFILE_REPORT_TYPE
    )
    .all<{ title: string }>();
  const existingTitles = new Set(result.results.map((row) => row.title));
  for (let copyNumber = 1; copyNumber <= 100; copyNumber += 1) {
    const title = buildProfileReportTitle(input.profileReportDate, copyNumber);
    if (!existingTitles.has(title)) {
      return title;
    }
  }
  throw documentError(
    409,
    "organization_document.profile_report_name_exhausted",
    "Today's Profile Report could not be saved. Try again tomorrow or ask your Center Agent to use a different report type."
  );
}

function buildProfileReportTitle(
  reportDate: string,
  copyNumber: number
): string {
  const suffix = copyNumber === 1 ? "" : ` (${copyNumber})`;
  return `${reportDate} — ${PROFILE_REPORT_TYPE_LABEL}${suffix}`;
}

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes(
    "UNIQUE constraint failed"
  );
}

function toDocument(
  row: OrganizationDocumentRow,
  actor: OrganizationDocumentReadActor
): OrganizationDocument {
  return {
    canEditContent:
      canManage(actor) ||
      (row.kind === "member_profile" && row.subject_user_id === actor.userId),
    canManage: canManage(actor),
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    draftContent: row.draft_content,
    draftCreatedAt:
      row.draft_created_at === null
        ? null
        : new Date(row.draft_created_at).toISOString(),
    draftCreatedBy:
      row.draft_created_by ===
      CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY
        ? CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY
        : null,
    folderId: row.folder_id,
    id: row.id,
    kind: row.kind,
    organizationId: row.organization_id,
    profileReportDate: row.profile_report_date,
    profileReportType: row.profile_report_type,
    subjectUserId: row.subject_user_id,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toSummary(
  row: OrganizationDocumentRow,
  actor: OrganizationDocumentReadActor
): OrganizationDocumentSummary {
  const {
    draftContent: _draftContent,
    draftCreatedAt: _draftCreatedAt,
    draftCreatedBy: _draftCreatedBy,
    content: _content,
    ...summary
  } = toDocument(row, actor);
  return { ...summary, hasDraft: row.draft_content !== null };
}

async function readMemberResearchDraftReplay(input: {
  db: D1Database;
  input: OrganizationDocumentDraftInput;
  organizationId: string;
}): Promise<OrganizationDocumentDraftWriteResult | null> {
  if (!input.input.memberResearch) {
    return null;
  }
  const document = await input.db
    .prepare(
      `
        SELECT *
        FROM organization_documents
        WHERE organization_id = ?
          AND last_member_research_task_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.input.memberResearch.taskId)
    .first<OrganizationDocumentRow>();
  if (!document) {
    return null;
  }
  const matchesRequestedTarget = input.input.documentId
    ? document.id === input.input.documentId
    : input.input.kind === "member_profile" &&
      document.subject_user_id === input.input.subjectUserId;
  if (!matchesRequestedTarget) {
    return null;
  }
  return {
    document: toSummary(document, {
      organizationId: input.organizationId,
      role: "member",
      userId: "center_agent",
    }),
    draftCreatedAtMs: document.draft_created_at,
    draftReplaced: false,
    replacedDraftCreatedAtMs: null,
  };
}

async function runBestEffortDraftInboxProjection(
  context: {
    documentId: string;
    operation: "project" | "resolve" | "resolve_all";
    organizationId: string;
  },
  project: () => Promise<void>
): Promise<void> {
  try {
    await project();
  } catch (error) {
    console.warn("[core.organization_document.draft_inbox_projection_failed]", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function canManage(actor: OrganizationDocumentReadActor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

function requireManager(actor: OrganizationDocumentActor): void {
  if (!canManage(actor)) {
    throw writeForbiddenError();
  }
}

function validateContent(content: string): void {
  if (content.length > ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS) {
    throw documentError(
      400,
      "organization_document.content_too_long",
      `Document content cannot exceed ${ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS.toLocaleString("en-US")} characters.`
    );
  }
}

function pendingDraftConflictError(): Error {
  return documentError(
    409,
    "organization_document.pending_draft_conflict",
    "This document already has a pending draft. Review or discard that draft before saving approved content."
  );
}

function buildDocumentUpdate(
  existing: OrganizationDocumentRow,
  input: OrganizationDocumentUpdateInput,
  updatedAt: number
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.title !== undefined) {
    assignments.push("title = ?");
    values.push(
      existing.kind === "brief"
        ? ORGANIZATION_BRIEF_TITLE
        : validateTitle(input.title)
    );
  }
  if (input.content !== undefined) {
    assignments.push("content = ?");
    values.push(input.content);
    if (existing.kind === "member_profile") {
      assignments.push(
        "draft_content = NULL",
        "draft_created_by = NULL",
        "draft_created_at = NULL"
      );
    }
  }
  if (input.folderId !== undefined) {
    assignments.push("folder_id = ?");
    values.push(input.folderId);
  }
  if (assignments.length === 0) {
    throw documentError(
      400,
      "invalid_payload",
      "At least one document field must be updated."
    );
  }
  assignments.push("updated_at = ?");
  values.push(updatedAt);
  return { assignments, values };
}

function requireHumanDocumentUpdateVersion(
  input: OrganizationDocumentUpdateInput
): { documentUpdatedAtMs: number; draftCreatedAtMs: number | null } | null {
  if (input.content === undefined) {
    return null;
  }
  if (
    input.expectedDocumentUpdatedAt === undefined ||
    input.expectedDraftCreatedAt === undefined
  ) {
    throw documentError(
      400,
      "invalid_payload",
      "Saving document content requires the loaded document and draft versions."
    );
  }
  return {
    documentUpdatedAtMs: Date.parse(input.expectedDocumentUpdatedAt),
    draftCreatedAtMs:
      input.expectedDraftCreatedAt === null
        ? null
        : Date.parse(input.expectedDraftCreatedAt),
  };
}

function requireExpectedDraft(
  row: OrganizationDocumentRow,
  expectedDraftCreatedAt: string
): number {
  if (row.draft_content === null || row.draft_created_at === null) {
    throw documentError(
      409,
      "organization_document.draft_not_found",
      "This document has no pending draft."
    );
  }
  const expectedDraftCreatedAtMs = Date.parse(expectedDraftCreatedAt);
  if (row.draft_created_at !== expectedDraftCreatedAtMs) {
    throw draftChangedError();
  }
  return expectedDraftCreatedAtMs;
}

function draftChangedError(): Error {
  return documentError(
    409,
    "organization_document.draft_changed",
    "This draft changed after it was loaded. Review the latest draft before continuing."
  );
}

function workingCopyConflictError(): Error {
  return documentError(
    409,
    "organization_document.working_copy_conflict",
    "This document changed after this copy was loaded. Load the latest version and reapply the useful edits before saving again."
  );
}

function memberResearchDraftConflictError(): Error {
  return documentError(
    409,
    "center_agent_member_research.draft_task_mismatch",
    "This member research task cannot accept a draft."
  );
}

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (
    normalized.length === 0 ||
    normalized.length > ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS
  ) {
    throw documentError(
      400,
      "organization_document.title_invalid",
      "Document titles must be between 1 and 200 characters."
    );
  }
  return normalized;
}

function mapCreateError(error: unknown, kind: OrganizationDocumentKind): Error {
  if (isCoreDocumentError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("organization_documents_org_brief_unique") ||
    (kind === "brief" && message.includes("UNIQUE constraint failed"))
  ) {
    return documentError(
      409,
      "organization_document.brief_exists",
      "This Organization already has an Organization Brief."
    );
  }
  return documentError(
    503,
    "organization_document.store_unavailable",
    `The ${kind} document could not be saved.`
  );
}

function isCoreDocumentError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    typeof (error as Error & { status?: unknown }).status === "number"
  );
}

function knowledgeLimitError(): Error {
  return documentError(
    409,
    "organization_document.knowledge_limit_reached",
    `An Organization can have up to ${ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT} knowledge documents.`
  );
}

function invalidSubjectError(): Error {
  return documentError(
    400,
    "organization_document.subject_invalid",
    "Only a Profile Report can be associated with a member."
  );
}

function managedPlacementError(): Error {
  return documentError(
    409,
    "organization_document.managed_placement",
    "OpenMeld keeps Profile Reports in this folder automatically. No folder changes are needed."
  );
}

function toFolder(
  row: OrganizationDocumentFolderRow
): OrganizationDocumentFolder {
  return {
    createdAt: new Date(row.created_at).toISOString(),
    id: row.id,
    isManaged: row.system_kind !== null,
    name: row.name,
    organizationId: row.organization_id,
    parentFolderId: row.parent_folder_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function validateFolderName(name: string): string {
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized.length > ORGANIZATION_DOCUMENT_FOLDER_NAME_MAX_CHARS
  ) {
    throw documentError(
      400,
      "organization_document.folder_name_invalid",
      "Folder names must be between 1 and 200 characters."
    );
  }
  return normalized;
}

async function requireFolder(
  db: D1Database,
  organizationId: string,
  folderId: string
): Promise<OrganizationDocumentFolder> {
  return toFolder(await requireFolderRow(db, organizationId, folderId));
}

async function requireFolderRow(
  db: D1Database,
  organizationId: string,
  folderId: string
): Promise<OrganizationDocumentFolderRow> {
  const row = await db
    .prepare(
      "SELECT * FROM organization_document_folders WHERE id = ? AND organization_id = ? LIMIT 1"
    )
    .bind(folderId, organizationId)
    .first<OrganizationDocumentFolderRow>();
  if (!row) {
    throw folderNotFoundError();
  }
  return row;
}

async function requireFolderNameAvailable(
  db: D1Database,
  organizationId: string,
  name: string,
  parentFolderId: string | null,
  excludeFolderId?: string
): Promise<void> {
  const row = await db
    .prepare(
      `
        SELECT id
        FROM organization_document_folders
        WHERE organization_id = ?
          AND lower(name) = lower(?)
          AND (
            (parent_folder_id IS NULL AND ? IS NULL)
            OR parent_folder_id = ?
          )
          AND id != ?
        LIMIT 1
      `
    )
    .bind(
      organizationId,
      name,
      parentFolderId,
      parentFolderId,
      excludeFolderId ?? ""
    )
    .first<{ id: string }>();
  if (row) {
    throw folderExistsError();
  }
}

function mapFolderWriteError(error: unknown): Error {
  if (isCoreDocumentError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed")) {
    return folderExistsError();
  }
  if (message.includes("CHECK constraint failed")) {
    return documentError(
      400,
      "organization_document.folder_name_invalid",
      "Folder names must be between 1 and 200 characters."
    );
  }
  return documentError(
    503,
    "organization_document.store_unavailable",
    "Organization document folders are temporarily unavailable."
  );
}

function folderExistsError(): Error {
  return documentError(
    409,
    "organization_document.folder_exists",
    "A folder with this name already exists here."
  );
}

function folderCycleError(): Error {
  return documentError(
    409,
    "organization_document.folder_cycle",
    "A folder cannot be moved inside itself or one of its subfolders."
  );
}

function folderLimitError(): Error {
  return documentError(
    409,
    "organization_document.folder_limit_reached",
    `Organizations can keep up to ${ORGANIZATION_DOCUMENT_FOLDER_LIMIT} document folders.`
  );
}

function folderNotFoundError(): Error {
  return documentError(
    404,
    "organization_document.folder_not_found",
    "This folder no longer exists."
  );
}

function documentNotFoundError(): Error {
  return documentError(
    404,
    "organization_document.not_found",
    "Organization document not found."
  );
}

function writeForbiddenError(): Error {
  return documentError(
    403,
    "organization_document.write_forbidden",
    "Only an Organization owner or admin can manage this document."
  );
}

function documentError(status: number, code: string, reason: string): Error {
  return createCoreRpcHttpError({ code, reason, status });
}
