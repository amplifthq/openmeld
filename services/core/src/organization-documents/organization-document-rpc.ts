import {
  canMaterializeCenterAgentOrganizationDocuments,
  resolveCenterAgentContextScopePlan,
} from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
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
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
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
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import {
  resolveCenterAgentAuditAttribution,
  writeCenterAgentAuditEntry,
} from "../center-agent/center-agent-audit";
import { prepareCenterAgentAuditJournalEntryStatement } from "../center-agent/center-agent-repository";
import { requireCurrentDesignatedCenterAgentCaller } from "../center-agent/current-designated-center-agent";
import {
  recordCenterAgentMemberResearchComputerFile,
  requireCenterAgentMemberResearchDraftTarget,
} from "../center-agent-member-research/member-research-repository";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import {
  readOrganizationPersonalClassification,
  resolveActiveOrganizationMembership,
} from "../organizations/organization-context";
import { resolveOrganizationDirectoryMembers } from "../organizations/organization-directory";
import { readOrganizationInformationProtectionForPrompt } from "../organizations/organization-information-protection-prompt";
import { observeOrganizationWorkingLanguage } from "../organizations/organization-working-language-repository";
import { prepareRemoteAgentMemberRequest } from "../remote-agent/application/remote-agent-member-request";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
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
  const { actor, service } = await prepareHumanRequest(
    env,
    request.context,
    true
  );
  const agentRead = request.context.actorContext.profileKind === "agent";
  const [documents, folders] = await Promise.all([
    service.list(actor, agentRead),
    service.listFolders(actor),
  ]);
  return parseResponse(listOrganizationDocumentsResponseSchema, {
    canManage: !agentRead && (actor.role === "owner" || actor.role === "admin"),
    currentUserId: actor.userId,
    documents: agentRead
      ? documents.map((document) => ({
          ...document,
          canEditContent: false,
          canManage: false,
          hasDraft: false,
        }))
      : documents,
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
  const { actor, service } = await prepareHumanRequest(
    env,
    request.context,
    true
  );
  const document = await service.get(actor, request.documentId);
  const agentRead = request.context.actorContext.profileKind === "agent";
  if (agentRead && !document.content.trim()) {
    throw createCoreRpcHttpError({
      code: "organization_document.not_found",
      reason: "No approved document content is available.",
      status: 404,
    });
  }
  return parseResponse(getOrganizationDocumentResponseSchema, {
    document: agentRead
      ? {
          ...document,
          canEditContent: false,
          canManage: false,
          draftContent: null,
          draftCreatedAt: null,
          draftCreatedBy: null,
        }
      : document,
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
  const { authorization, member } = await prepareDocumentReadRequest(
    env,
    request
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
      service.list(actor, true),
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

async function prepareDocumentReadRequest(
  env: CoreBindings,
  request: CenterAgentReadOrganizationDocumentsRpcInput
) {
  if (
    request.context.actorContext.agentControllerRef !==
    HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    if (!request.speakerMember) {
      throw createCoreRpcHttpError({
        code: "organization_document.member_required",
        reason: "Center document reads require a verified Organization member.",
        status: 403,
      });
    }
    return await prepareRemoteAgentMemberRequest(
      env,
      request.context,
      request.speakerMember
    );
  }
  const authorization = await requireRemoteAgentToolCaller({
    env,
    context: request.context,
  });
  if (!("personalExecution" in authorization)) {
    throw new Error("Expected an admitted personal Remote Agent execution.");
  }
  const { request: admitted, delivery } = authorization.personalExecution;
  if (
    !canMaterializeCenterAgentOrganizationDocuments(
      resolveCenterAgentContextScopePlan(admitted.turnEnvelope)
    )
  ) {
    throw createCoreRpcHttpError({
      code: "organization_document.audience_not_allowed",
      reason: "Organization documents are unavailable to this task's audience.",
      status: 403,
    });
  }
  // Read as the receiving owned Agent, never as the sender or as Center.
  const { actor } = await prepareHumanRequest(env, authorization.context, true);
  return {
    authorization,
    member: {
      role: actor.role,
      userId: actor.userId,
      profileId: authorization.actorProfileId,
      sourceNativeDeliveryId: delivery.deliveryId,
    },
  };
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
async function allowsSharedOrganizationWorkingLanguageObservation(input: {
  env: CoreBindings;
  memberResearchTaskId: string;
  organizationId: string;
  requestId: string;
}): Promise<boolean> {
  const classification = await readOrganizationPersonalClassification({
    env: input.env,
    organizationId: input.organizationId,
    requestId: input.requestId,
  });
  if (!classification.ok) {
    console.warn(
      "[core.organization_document.working_language_classification_unavailable]",
      {
        memberResearchTaskId: input.memberResearchTaskId,
        organizationId: input.organizationId,
        requestId: input.requestId,
      }
    );
    return false;
  }
  if (classification.personal) {
    return false;
  }
  return true;
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
  let memberResearch:
    | {
        submissionId: string;
        taskId: string;
      }
    | undefined;
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
  const memberResearchReport = draft.memberResearchReport;
  if (memberResearch && !memberResearchReport) {
    throw new Error(
      "Member research draft lost its validated structured report result."
    );
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
  if (memberResearch && memberResearchReport) {
    const observedLanguageTag = memberResearchReport.observedLanguageTag;
    const reportResult = memberResearchReport.result;
    const nowMs = Date.now();
    const taskUpdateStatement = {
      text: `
          UPDATE "openmeld"."center_agent_member_research_tasks"
          SET
            observed_language_tag = COALESCE($1, observed_language_tag),
            report_result = $2
          WHERE id = $3
            AND status = 'running'
            AND (report_result IS NULL OR report_result = $4)
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."center_agent_member_research_batches" AS batch
              WHERE batch.id = center_agent_member_research_tasks.batch_id
                AND batch.organization_id = $5
            )
        `,
      values: [
        observedLanguageTag ?? null,
        reportResult,
        memberResearch.taskId,
        reportResult,
        organizationId,
      ],
    };
    const updateTask = async (
      client: import("@openmeld/db/postgresql").PoolClient
    ) => {
      if ((await client.query(taskUpdateStatement)).rowCount !== 1) {
        throw new Error(
          "Member research task changed concurrently; report was rolled back."
        );
      }
    };
    const observesSharedOrganization = observedLanguageTag
      ? await allowsSharedOrganizationWorkingLanguageObservation({
          env,
          memberResearchTaskId: memberResearch.taskId,
          organizationId,
          requestId: request.context.actorContext.requestId,
        })
      : false;
    if (observedLanguageTag && observesSharedOrganization) {
      const attribution = await resolveCenterAgentAuditAttribution({
        authorization,
        onBehalfOfProfileId: representedHuman.profileId,
      });
      const auditStatement = prepareCenterAgentAuditJournalEntryStatement({
        action: "observe_working_language",
        actorProfileId: authorization.actorProfileId,
        attribution,
        db,
        id: crypto.randomUUID(),
        nowMs,
        organizationId,
        resource: {
          id: organizationId,
          type: "organization_working_language",
        },
        sourceNativeDeliveryId,
      });
      await observeOrganizationWorkingLanguage({
        beforeMutation: updateTask,
        db,
        languageTag: observedLanguageTag,
        nowMs,
        onChangedStatements: [auditStatement],
        organizationId,
      });
    } else {
      await db.transaction(updateTask);
    }
  }
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
  db: PostgresDatabase;
  documentId: string;
  organizationId: string;
  subjectUserId: string;
}): Promise<string> {
  const folder = await input.db
    .query<{
      name: string;
    }>({
      text: `
        SELECT person.name
        FROM "openmeld"."organization_documents" document
        INNER JOIN "openmeld"."organization_document_folders" person
          ON person.id = document.folder_id
         AND person.organization_id = document.organization_id
        INNER JOIN "openmeld"."organization_document_folders" root
          ON root.id = person.parent_folder_id
         AND root.organization_id = document.organization_id
        WHERE document.id = $1
          AND document.organization_id = $2
          AND document.kind = 'member_profile'
          AND document.subject_user_id = $3
          AND person.system_kind = 'profile_reports_person'
          AND person.subject_user_id = document.subject_user_id
          AND root.system_kind = 'profile_reports_root'
        LIMIT 1
      `,
      values: [input.documentId, input.organizationId, input.subjectUserId],
    })
    .then((result) => result.rows[0] ?? null);
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
    createOrganizationDocumentService({ db }).readPromptContext(
      organizationId,
      request.includeSourceReferences === true
    ),
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
  context: OpenMeldRequestContext,
  allowAgentRead = false
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
  if (
    context.actorContext.profileKind !== "human" &&
    !(allowAgentRead && context.actorContext.profileKind === "agent")
  ) {
    throw createCoreRpcHttpError({
      code: "organization_document.human_actor_required",
      reason: "Organization documents must be managed by a human profile.",
      status: 403,
    });
  }
  const db = requireStore(env);
  const profile = await db
    .query({
      text: `
        SELECT 1
        FROM "openmeld"."openmeld_profiles"
        WHERE profile_id = $1
          AND owner_user_id = $2
          AND profile_kind = $3
          AND (profile_kind = 'human' OR organization_id = $4)
          AND status = 'active'
        LIMIT 1
      `,
      values: [
        context.actorContext.openMeldProfileId,
        membership.userId,
        context.actorContext.profileKind,
        membership.organizationId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!profile) {
    throw createCoreRpcHttpError({
      code: "organization_document.human_actor_required",
      reason: "Organization documents must be managed by your human profile.",
      status: 403,
    });
  }
  const actor: OrganizationDocumentActor = {
    organizationId: membership.organizationId,
    role:
      context.actorContext.profileKind === "agent" ? "member" : membership.role,
    userId: membership.userId,
  };
  return {
    actor,
    service: createOrganizationDocumentService({ db }),
  };
}
function requireStore(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
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
  requireExpectedOrganizationContext({
    actualOrganizationId: activeOrganizationId,
    errorCode: "organization_document.organization_context_changed",
    expectedOrganizationId,
  });
}
function parseRequest<T>(
  schema: {
    safeParse(value: unknown):
      | {
          data: T;
          success: true;
        }
      | {
          success: false;
        };
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
    safeParse(value: unknown):
      | {
          data: T;
          success: true;
        }
      | {
          success: false;
        };
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
