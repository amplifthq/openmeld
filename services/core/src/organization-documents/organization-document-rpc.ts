import {
  approveOrganizationDocumentDraftResponseSchema,
  approveOrganizationDocumentDraftRpcInputSchema,
  CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT,
  centerAgentDraftOrganizationDocumentResponseSchema,
  centerAgentDraftOrganizationDocumentRpcInputSchema,
  centerAgentOrganizationDocumentsComputerSnapshotResponseSchema,
  centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema,
  centerAgentReadOrganizationDocumentsResponseSchema,
  centerAgentReadOrganizationDocumentsRpcInputSchema,
  createOrganizationDocumentFolderResponseSchema,
  createOrganizationDocumentFolderRpcInputSchema,
  createOrganizationDocumentResponseSchema,
  createOrganizationDocumentRpcInputSchema,
  deleteOrganizationDocumentFolderResponseSchema,
  deleteOrganizationDocumentFolderRpcInputSchema,
  deleteOrganizationDocumentResponseSchema,
  deleteOrganizationDocumentRpcInputSchema,
  discardOrganizationDocumentDraftResponseSchema,
  discardOrganizationDocumentDraftRpcInputSchema,
  getOrganizationDocumentResponseSchema,
  getOrganizationDocumentRpcInputSchema,
  listOrganizationDocumentsResponseSchema,
  listOrganizationDocumentsRpcInputSchema,
  organizationDocumentPromptContextResponseSchema,
  organizationDocumentPromptContextRpcInputSchema,
  recordCenterAgentMemberResearchComputerFileResponseSchema,
  recordCenterAgentMemberResearchComputerFileRpcInputSchema,
  updateOrganizationDocumentFolderResponseSchema,
  updateOrganizationDocumentFolderRpcInputSchema,
  updateOrganizationDocumentResponseSchema,
  updateOrganizationDocumentRpcInputSchema,
} from "@openmeld/schemas";
import type {
  ApproveOrganizationDocumentDraftResponse,
  ApproveOrganizationDocumentDraftRpcInput,
  CenterAgentDraftOrganizationDocumentResponse,
  CenterAgentDraftOrganizationDocumentRpcInput,
  CenterAgentOrganizationDocumentsComputerSnapshotResponse,
  CenterAgentOrganizationDocumentsComputerSnapshotRpcInput,
  CenterAgentReadOrganizationDocumentsResponse,
  CenterAgentReadOrganizationDocumentsRpcInput,
  CreateOrganizationDocumentFolderResponse,
  CreateOrganizationDocumentFolderRpcInput,
  CreateOrganizationDocumentResponse,
  CreateOrganizationDocumentRpcInput,
  DeleteOrganizationDocumentFolderResponse,
  DeleteOrganizationDocumentFolderRpcInput,
  DeleteOrganizationDocumentResponse,
  DeleteOrganizationDocumentRpcInput,
  DiscardOrganizationDocumentDraftResponse,
  DiscardOrganizationDocumentDraftRpcInput,
  GetOrganizationDocumentResponse,
  GetOrganizationDocumentRpcInput,
  ListOrganizationDocumentsResponse,
  ListOrganizationDocumentsRpcInput,
  OpenMeldRequestContext,
  OrganizationDocumentPromptContextResponse,
  OrganizationDocumentPromptContextRpcInput,
  RecordCenterAgentMemberResearchComputerFileResponse,
  RecordCenterAgentMemberResearchComputerFileRpcInput,
  UpdateOrganizationDocumentFolderResponse,
  UpdateOrganizationDocumentFolderRpcInput,
  UpdateOrganizationDocumentResponse,
  UpdateOrganizationDocumentRpcInput,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { writeCenterAgentAuditEntry } from "../center-agent/center-agent-audit";
import { requireCurrentDesignatedCenterAgentCaller } from "../center-agent/current-designated-center-agent";
import {
  recordCenterAgentMemberResearchComputerFile,
  requireCenterAgentMemberResearchDraftTarget,
} from "../center-agent-member-research/member-research-repository";
import { type CoreBindings, organizationDocumentsDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { resolveOrganizationDirectoryMembers } from "../organizations/organization-directory";
import { readOrganizationInformationProtectionForPrompt } from "../organizations/organization-information-protection-prompt";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  createOrganizationDocumentService,
  type OrganizationDocumentActor,
  type OrganizationDocumentReadActor,
} from "./organization-document-service";

export async function rpcListOrganizationDocuments(
  env: CoreBindings,
  input: ListOrganizationDocumentsRpcInput
): Promise<ListOrganizationDocumentsResponse> {
  const request = parseRequest(listOrganizationDocumentsRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(env, request.context);
  const [documents, folders] = await Promise.all([
    service.list(actor),
    service.listFolders(actor),
  ]);
  return parseResponse(listOrganizationDocumentsResponseSchema, {
    canManage: actor.role === "owner" || actor.role === "admin",
    currentUserId: actor.userId,
    documents,
    folders,
    organizationId: actor.organizationId,
  });
}

export async function rpcCreateOrganizationDocumentFolder(
  env: CoreBindings,
  input: CreateOrganizationDocumentFolderRpcInput
): Promise<CreateOrganizationDocumentFolderResponse> {
  const request = parseRequest(
    createOrganizationDocumentFolderRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(createOrganizationDocumentFolderResponseSchema, {
    folder: await service.createFolder(actor, {
      name: request.name,
      parentFolderId: request.parentFolderId,
    }),
  });
}

export async function rpcUpdateOrganizationDocumentFolder(
  env: CoreBindings,
  input: UpdateOrganizationDocumentFolderRpcInput
): Promise<UpdateOrganizationDocumentFolderResponse> {
  const request = parseRequest(
    updateOrganizationDocumentFolderRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  const folder =
    request.name === undefined
      ? await service.moveFolder(
          actor,
          request.folderId,
          request.parentFolderId ?? null
        )
      : await service.renameFolder(actor, request.folderId, {
          name: request.name,
        });
  return parseResponse(updateOrganizationDocumentFolderResponseSchema, {
    folder,
  });
}

export async function rpcDeleteOrganizationDocumentFolder(
  env: CoreBindings,
  input: DeleteOrganizationDocumentFolderRpcInput
): Promise<DeleteOrganizationDocumentFolderResponse> {
  const request = parseRequest(
    deleteOrganizationDocumentFolderRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  await service.deleteFolder(actor, request.folderId);
  return parseResponse(deleteOrganizationDocumentFolderResponseSchema, {
    deleted: true,
    folderId: request.folderId,
    organizationId: actor.organizationId,
  });
}

export async function rpcGetOrganizationDocument(
  env: CoreBindings,
  input: GetOrganizationDocumentRpcInput
): Promise<GetOrganizationDocumentResponse> {
  const request = parseRequest(getOrganizationDocumentRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(env, request.context);
  return parseResponse(getOrganizationDocumentResponseSchema, {
    document: await service.get(actor, request.documentId),
  });
}

export async function rpcCreateOrganizationDocument(
  env: CoreBindings,
  input: CreateOrganizationDocumentRpcInput
): Promise<CreateOrganizationDocumentResponse> {
  const request = parseRequest(createOrganizationDocumentRpcInputSchema, input);
  const { context, expectedOrganizationId, ...body } = request;
  const { actor, service } = await prepareHumanRequest(env, context);
  requireExpectedOrganization(actor.organizationId, expectedOrganizationId);
  return parseResponse(createOrganizationDocumentResponseSchema, {
    document: await service.create(actor, body),
  });
}

export async function rpcUpdateOrganizationDocument(
  env: CoreBindings,
  input: UpdateOrganizationDocumentRpcInput
): Promise<UpdateOrganizationDocumentResponse> {
  const request = parseRequest(updateOrganizationDocumentRpcInputSchema, input);
  const { context, documentId, expectedOrganizationId, ...body } = request;
  const { actor, service } = await prepareHumanRequest(env, context);
  requireExpectedOrganization(actor.organizationId, expectedOrganizationId);
  return parseResponse(updateOrganizationDocumentResponseSchema, {
    document: await service.update(actor, documentId, body),
  });
}

export async function rpcDeleteOrganizationDocument(
  env: CoreBindings,
  input: DeleteOrganizationDocumentRpcInput
): Promise<DeleteOrganizationDocumentResponse> {
  const request = parseRequest(deleteOrganizationDocumentRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  await service.delete(actor, request.documentId);
  return parseResponse(deleteOrganizationDocumentResponseSchema, {
    deleted: true,
    documentId: request.documentId,
    organizationId: actor.organizationId,
  });
}

export async function rpcApproveOrganizationDocumentDraft(
  env: CoreBindings,
  input: ApproveOrganizationDocumentDraftRpcInput
): Promise<ApproveOrganizationDocumentDraftResponse> {
  const request = parseRequest(
    approveOrganizationDocumentDraftRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(approveOrganizationDocumentDraftResponseSchema, {
    document: await service.approveDraft(
      actor,
      request.documentId,
      request.expectedDraftCreatedAt
    ),
  });
}

export async function rpcDiscardOrganizationDocumentDraft(
  env: CoreBindings,
  input: DiscardOrganizationDocumentDraftRpcInput
): Promise<DiscardOrganizationDocumentDraftResponse> {
  const request = parseRequest(
    discardOrganizationDocumentDraftRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(discardOrganizationDocumentDraftResponseSchema, {
    document: await service.discardDraft(
      actor,
      request.documentId,
      request.expectedDraftCreatedAt
    ),
  });
}

export async function rpcCenterAgentReadOrganizationDocuments(
  env: CoreBindings,
  input: CenterAgentReadOrganizationDocumentsRpcInput
): Promise<CenterAgentReadOrganizationDocumentsResponse> {
  const request = parseRequest(
    centerAgentReadOrganizationDocumentsRpcInputSchema,
    input
  );
  const { authorization, member } =
    await prepareCenterAgentOrganizationMemberRequest(
      env,
      request.context,
      request.speakerMember
    );
  const service = createOrganizationDocumentService({
    db: requireStore(env),
  });
  const actor: OrganizationDocumentReadActor = {
    organizationId: authorization.activeOrganization.organizationId,
    role: member.role,
    userId: member.userId,
  };
  if (request.action === "list") {
    const [listedDocuments, folders] = await Promise.all([
      service.list(actor),
      service.listFolders(actor),
    ]);
    const documents = listedDocuments.map(
      ({ folderId, id, kind, title, updatedAt }) => ({
        folderId,
        id,
        kind,
        title,
        updatedAt,
      })
    );
    await writeCenterAgentAuditEntry({
      action: "read_org_documents",
      authorization,
      onBehalfOfProfileId: member.profileId,
      resource: {
        id: actor.organizationId,
        type: "organization_document_catalog",
      },
      sourceNativeDeliveryId: member.sourceNativeDeliveryId,
    });
    return parseResponse(centerAgentReadOrganizationDocumentsResponseSchema, {
      action: "list",
      documents,
      folders,
      organizationId: actor.organizationId,
    });
  }
  const document = await service.get(actor, request.documentId);
  await writeCenterAgentAuditEntry({
    action: "read_org_documents",
    authorization,
    onBehalfOfProfileId: member.profileId,
    resource: { id: document.id, type: "organization_document" },
    sourceNativeDeliveryId: member.sourceNativeDeliveryId,
  });
  return parseResponse(centerAgentReadOrganizationDocumentsResponseSchema, {
    action: "get",
    document: {
      content: document.content,
      folderId: document.folderId,
      id: document.id,
      kind: document.kind,
      subjectUserId: document.subjectUserId,
      title: document.title,
      updatedAt: document.updatedAt,
    },
    organizationId: actor.organizationId,
  });
}

export async function rpcCenterAgentOrganizationDocumentsComputerSnapshot(
  env: CoreBindings,
  input: CenterAgentOrganizationDocumentsComputerSnapshotRpcInput
): Promise<CenterAgentOrganizationDocumentsComputerSnapshotResponse> {
  const request = parseRequest(
    centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema,
    input
  );
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: request.context,
    env,
  });
  const organizationId = authorization.activeOrganization.organizationId;
  const snapshot = await createOrganizationDocumentService({
    db: requireStore(env),
  }).readComputerSnapshot(organizationId);
  const revision = await sha256Hex(
    JSON.stringify({
      documents: [...snapshot.documents].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      folders: [...snapshot.folders].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      organizationId,
    })
  );
  await writeCenterAgentAuditEntry({
    action: "read_org_documents",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      id: organizationId,
      type: "organization_document_computer_snapshot",
    },
    sourceNativeDeliveryId: null,
  });
  return parseResponse(
    centerAgentOrganizationDocumentsComputerSnapshotResponseSchema,
    { ...snapshot, revision }
  );
}

export async function rpcCenterAgentDraftOrganizationDocument(
  env: CoreBindings,
  input: CenterAgentDraftOrganizationDocumentRpcInput
): Promise<CenterAgentDraftOrganizationDocumentResponse> {
  const request = parseRequest(
    centerAgentDraftOrganizationDocumentRpcInputSchema,
    input
  );
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      request.context,
      request.speakerMember
    );
  const {
    context: _context,
    memberResearchTaskId,
    speakerMember: _speakerMember,
    ...draft
  } = request;
  const db = requireStore(env);
  let memberResearch: { submissionId: string; taskId: string } | undefined;
  if (memberResearchTaskId) {
    const submissionId = request.context.agentControllerConversationId;
    if (!submissionId) {
      throw createCoreRpcHttpError({
        code: "center_agent_member_research.submission_required",
        reason: "Member research drafts require a Remote Agent submission.",
        status: 409,
      });
    }
    await requireCenterAgentMemberResearchDraftTarget({
      db,
      documentId: draft.documentId,
      kind: draft.kind,
      organizationId: authorization.activeOrganization.organizationId,
      submissionId,
      subjectUserId: draft.subjectUserId,
      taskId: memberResearchTaskId,
    });
    memberResearch = { submissionId, taskId: memberResearchTaskId };
  }
  const service = createOrganizationDocumentService({ db });
  const organizationId = authorization.activeOrganization.organizationId;
  const { currentContent, ...response } = await service.draft(
    organizationId,
    memberResearch ? { ...draft, memberResearch } : draft,
    async () => {
      const directoryMembers = await resolveOrganizationDirectoryMembers({
        authWorker: env.OPENMELD_AUTH_WORKER,
        organizationId,
        requestId: request.context.actorContext.requestId,
      });
      const reviewerUserIds = directoryMembers
        .filter((member) => member.role === "owner" || member.role === "admin")
        .map((member) => member.userId);
      if (reviewerUserIds.length === 0) {
        throw new Error("organization_document.reviewers_unavailable");
      }
      return reviewerUserIds;
    }
  );
  await writeCenterAgentAuditEntry({
    action: "draft_org_document",
    authorization,
    onBehalfOfProfileId: representedHuman.profileId,
    resource: { id: response.document.id, type: "organization_document" },
    sourceNativeDeliveryId,
  });
  let memberResearchDraft:
    | {
        content: string;
        documentId: string;
        profileReportFolderName: string;
        subjectUserId: string;
        title: string;
      }
    | undefined;
  if (memberResearch) {
    const subjectUserId = response.document.subjectUserId;
    if (!subjectUserId) {
      throw new Error(
        "Member research created a Profile Report without its subject user."
      );
    }
    memberResearchDraft = {
      content: currentContent,
      documentId: response.document.id,
      profileReportFolderName:
        await requireMemberResearchProfileReportFolderName({
          db,
          documentId: response.document.id,
          organizationId,
          subjectUserId,
        }),
      subjectUserId,
      title: response.document.title,
    };
  }
  return parseResponse(centerAgentDraftOrganizationDocumentResponseSchema, {
    ...response,
    ...(memberResearchDraft ? { memberResearchDraft } : {}),
  });
}

async function requireMemberResearchProfileReportFolderName(input: {
  db: D1Database;
  documentId: string;
  organizationId: string;
  subjectUserId: string;
}): Promise<string> {
  const folder = await input.db
    .prepare(
      `
        SELECT person.name
        FROM organization_documents document
        INNER JOIN organization_document_folders person
          ON person.id = document.folder_id
         AND person.organization_id = document.organization_id
        INNER JOIN organization_document_folders root
          ON root.id = person.parent_folder_id
         AND root.organization_id = document.organization_id
        WHERE document.id = ?
          AND document.organization_id = ?
          AND document.kind = 'member_profile'
          AND document.subject_user_id = ?
          AND person.system_kind = 'profile_reports_person'
          AND person.subject_user_id = document.subject_user_id
          AND root.system_kind = 'profile_reports_root'
        LIMIT 1
      `
    )
    .bind(input.documentId, input.organizationId, input.subjectUserId)
    .first<{ name: string }>();
  if (!folder) {
    throw new Error(
      "Member research created a Profile Report without its managed person folder."
    );
  }
  return folder.name;
}

export async function rpcRecordCenterAgentMemberResearchComputerFile(
  env: CoreBindings,
  input: RecordCenterAgentMemberResearchComputerFileRpcInput
): Promise<RecordCenterAgentMemberResearchComputerFileResponse> {
  const request = parseRequest(
    recordCenterAgentMemberResearchComputerFileRpcInputSchema,
    input
  );
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: request.context,
    env,
  });
  const submissionId = request.context.agentControllerConversationId;
  if (!submissionId) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.submission_required",
      reason: "Profile Report files require a Remote Agent submission.",
      status: 409,
    });
  }
  if (
    !request.path.startsWith(`${CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT}/`)
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.computer_file_path_invalid",
      reason:
        "Profile Report files must stay in the Center Agent's private profile-report folder.",
      status: 422,
    });
  }
  const recorded = await recordCenterAgentMemberResearchComputerFile({
    db: requireStore(env),
    documentId: request.documentId,
    nowMs: Date.now(),
    organizationId: authorization.activeOrganization.organizationId,
    path: request.path,
    subjectUserId: request.subjectUserId,
    submissionId,
    taskId: request.taskId,
  });
  return parseResponse(
    recordCenterAgentMemberResearchComputerFileResponseSchema,
    { ...recorded, recorded: true }
  );
}

export async function rpcReadOrganizationDocumentPromptContext(
  env: CoreBindings,
  input: OrganizationDocumentPromptContextRpcInput
): Promise<OrganizationDocumentPromptContextResponse> {
  const request = parseRequest(
    organizationDocumentPromptContextRpcInputSchema,
    input
  );
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: request.context,
    env,
  });
  const organizationId = authorization.activeOrganization.organizationId;
  const db = requireStore(env);
  const [promptContext, organizationProtectedInformation] = await Promise.all([
    createOrganizationDocumentService({ db }).readPromptContext(organizationId),
    request.includeOrganizationProtectedInformation
      ? readOrganizationInformationProtectionForPrompt({ db, organizationId })
      : Promise.resolve(null),
  ]);
  return parseResponse(organizationDocumentPromptContextResponseSchema, {
    ...promptContext,
    ...(request.includeOrganizationProtectedInformation
      ? {
          organizationProtectedInformation,
        }
      : {}),
    organizationId,
  });
}

async function prepareHumanRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext
) {
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "organization_document.human_actor_required",
      reason: "Organization documents must be managed by a human profile.",
      status: 403,
    });
  }
  const db = requireStore(env);
  const profile = await db
    .prepare(
      `
        SELECT 1
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND owner_user_id = ?
          AND profile_kind = 'human'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(context.actorContext.openMeldProfileId, membership.userId)
    .first();
  if (!profile) {
    throw createCoreRpcHttpError({
      code: "organization_document.human_actor_required",
      reason: "Organization documents must be managed by your human profile.",
      status: 403,
    });
  }
  const actor: OrganizationDocumentActor = {
    organizationId: membership.organizationId,
    role: membership.role,
    userId: membership.userId,
  };
  return {
    actor,
    service: createOrganizationDocumentService({ db }),
  };
}

function requireStore(env: CoreBindings): D1Database {
  const db = organizationDocumentsDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "organization_document.store_unavailable",
      reason: "Organization documents are temporarily unavailable.",
      status: 503,
    });
  }
  return db;
}

function requireExpectedOrganization(
  activeOrganizationId: string,
  expectedOrganizationId: string
): void {
  if (activeOrganizationId === expectedOrganizationId) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_document.organization_context_changed",
    reason:
      "The active Organization changed before this document request was applied.",
    status: 409,
  });
}

function parseRequest<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Organization document request is invalid.",
      status: 400,
    });
  }
  return parsed.data;
}

function parseResponse<T>(
  schema: {
    safeParse(value: unknown): { data: T; success: true } | { success: false };
  },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Failed to build a valid Organization document response.");
  }
  return parsed.data;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
