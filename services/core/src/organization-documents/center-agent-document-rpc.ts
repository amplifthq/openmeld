import {
  centerAgentManageOrganizationDocumentsResponseSchema,
  centerAgentManageOrganizationDocumentsRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAction,
  CenterAgentManageOrganizationDocumentsResponse,
  CenterAgentManageOrganizationDocumentsRpcInput,
  OrganizationDocument,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { prepareCenterAgentAuditJournalEntryIfMissingStatement } from "../center-agent/center-agent-repository";
import { type CoreBindings, organizationDocumentsDb } from "../lib/bindings";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  readRoutineRecord,
  readRoutineRunExecutionRecord,
} from "../routines/routine-repository";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  beginCenterAgentOrganizationDocumentOperation,
  buildCenterAgentOrganizationDocumentRequestSignature,
  type CenterAgentOrganizationDocumentOperationKind,
  type CenterAgentOrganizationDocumentOperationRecord,
  prepareCompleteCenterAgentOrganizationDocumentOperationStatement,
  readCenterAgentOrganizationDocumentOperation,
  requireCenterAgentOrganizationDocumentOperationRequestMatch,
} from "./center-agent-document-operation-repository";
import {
  createOrganizationDocumentService,
  type OrganizationDocumentActor,
} from "./organization-document-service";

type RuntimeSchema<T> = {
  safeParse(
    value: unknown
  ):
    | { data: T; success: true }
    | { error: { message: string }; success: false };
};

type PreparedCenterAgentDocumentRequest = {
  actor: OrganizationDocumentActor;
  actorProfileId: string;
  db: D1Database;
  representedHuman: Awaited<
    ReturnType<typeof prepareCenterAgentRepresentedMemberRequest>
  >["representedHuman"];
  sourceNativeDeliveryId: string | null;
};

export async function rpcCenterAgentManageOrganizationDocuments(
  env: CoreBindings,
  input: CenterAgentManageOrganizationDocumentsRpcInput
): Promise<CenterAgentManageOrganizationDocumentsResponse> {
  const request = parseRequest(
    centerAgentManageOrganizationDocumentsRpcInputSchema,
    input
  );
  const prepared = await prepareRequest(env, request);
  const operationRequest = await prepareOperationRequest({
    kind: request.action,
    operationId: request.operationId,
    payload: operationPayload(request),
    prepared,
  });
  if (operationRequest.existingOperation?.status === "completed") {
    return resolveExistingOperation({
      operation: operationRequest.existingOperation,
      requestSignature: operationRequest.requestSignature,
    });
  }
  if (request.action === "save_document") {
    try {
      await requireApprovedKnowledgeSaveAuthorization({
        context: request.context,
        prepared,
      });
    } catch (error) {
      const replay =
        await readCompletedOperationReplayAfterAuthorizationFailure({
          operationRequest,
          prepared,
        });
      if (replay) {
        return replay;
      }
      throw error;
    }
  }
  const claim = await beginOperation({
    requestSignature: operationRequest.requestSignature,
    scope: operationRequest.scope,
    prepared,
    targetResourceId: resolveOperationTargetResourceId(request),
  });
  if (claim.outcome !== "claimed") {
    return resolveExistingOperation({
      operation: claim.operation,
      requestSignature: operationRequest.requestSignature,
    });
  }
  const operation = claim.operation;

  const service = createOrganizationDocumentService({
    db: prepared.db,
    newId: () => operation.targetResourceId,
  });
  let response: CenterAgentManageOrganizationDocumentsResponse;
  let action: CenterAgentAction;
  let resource: { id: string; type: string };

  switch (request.action) {
    case "create_folder": {
      const folder = await service
        .createFolder(prepared.actor, {
          name: request.name,
          parentFolderId: request.parentFolderId,
        })
        .catch(async (error) => {
          const existing = (await service.listFolders(prepared.actor)).find(
            (candidate) => candidate.id === operation.targetResourceId
          );
          if (!existing) {
            throw error;
          }
          return existing;
        });
      response = parseResponse({
        action: "create_folder",
        folder,
        organizationId: prepared.actor.organizationId,
      });
      action = "create_org_document_folder";
      resource = { id: folder.id, type: "organization_document_folder" };
      break;
    }
    case "rename_folder": {
      const folder = await service.renameFolder(
        prepared.actor,
        request.folderId,
        { name: request.name }
      );
      response = parseResponse({
        action: "rename_folder",
        folder,
        organizationId: prepared.actor.organizationId,
      });
      action = "rename_org_document_folder";
      resource = { id: folder.id, type: "organization_document_folder" };
      break;
    }
    case "move_document": {
      const document = await service.update(
        prepared.actor,
        request.documentId,
        { folderId: request.folderId }
      );
      response = parseResponse({
        action: "move_document",
        document: toProjection(document),
        organizationId: prepared.actor.organizationId,
      });
      action = "move_org_document";
      resource = { id: document.id, type: "organization_document" };
      break;
    }
    case "save_document": {
      const document = request.documentId
        ? await service.updateApprovedKnowledge(
            prepared.actor,
            request.documentId,
            {
              content: request.content,
              ...(request.folderId === undefined
                ? {}
                : { folderId: request.folderId }),
              ...(request.title === undefined ? {} : { title: request.title }),
            }
          )
        : await service
            .create(prepared.actor, {
              content: request.content,
              folderId: request.folderId ?? null,
              kind: "knowledge",
              title: request.title,
            })
            .catch(async (error) => {
              try {
                return await service.get(
                  prepared.actor,
                  operation.targetResourceId
                );
              } catch {
                throw error;
              }
            });
      response = parseResponse({
        action: "save_document",
        document: toProjection(document),
        organizationId: prepared.actor.organizationId,
        outcome: request.documentId ? "updated" : "created",
      });
      action = "save_org_document";
      resource = { id: document.id, type: "organization_document" };
      break;
    }
    default:
      return assertNever(request);
  }

  return await completeOperation({
    action,
    operation,
    prepared,
    resource,
    response,
  });
}

async function requireApprovedKnowledgeSaveAuthorization(input: {
  context: CenterAgentManageOrganizationDocumentsRpcInput["context"];
  prepared: PreparedCenterAgentDocumentRequest;
}): Promise<void> {
  const submissionId = input.context.agentControllerConversationId?.trim();
  const delivery = submissionId
    ? await readRemoteAgentNativeDeliveryBySubmissionId({
        db: input.prepared.db,
        submissionId,
      })
    : null;
  const active =
    delivery?.status === "accepted" || delivery?.status === "retry_observed";
  if (
    !(
      delivery &&
      active &&
      delivery.organizationId === input.prepared.actor.organizationId &&
      delivery.profileId === input.prepared.actorProfileId &&
      delivery.onBehalfOfProfileId ===
        input.prepared.representedHuman.profileId &&
      delivery.onBehalfOfUserId === input.prepared.representedHuman.userId
    )
  ) {
    throwDirectSaveAuthorizationError();
  }

  // Interactive deliveries already carry a Core-recorded represented member.
  // Their full worker request is deliberately retired after admission, while
  // Routine worker requests stay durable so Core can verify the stored grant.
  if (!delivery.routineRunId) {
    return;
  }

  const request = delivery.workerSubmitRequest;
  if (!request) {
    throwDirectSaveAuthorizationError();
  }
  const sender = request.turnEnvelope.sender;
  if (
    sender.kind !== "routine" ||
    sender.delegatedBy.ownerUserId !== input.prepared.representedHuman.userId ||
    request.turnEnvelope.trigger.source !== "routine" ||
    request.turnEnvelope.trigger.runId !== delivery.routineRunId
  ) {
    throwDirectSaveAuthorizationError();
  }
  const run = delivery.routineRunId
    ? await readRoutineRunExecutionRecord({
        db: input.prepared.db,
        runId: delivery.routineRunId,
      })
    : null;
  const routine = run
    ? await readRoutineRecord({
        db: input.prepared.db,
        organizationId: input.prepared.actor.organizationId,
        routineId: run.routineId,
      })
    : null;
  if (
    !(
      run &&
      routine &&
      run.status === "submitted" &&
      run.nativeDeliveryId === delivery.deliveryId &&
      sender.routineId === run.routineId &&
      routine.authorizedActions.includes(
        "organization_documents.save_approved_knowledge"
      )
    )
  ) {
    throwDirectSaveAuthorizationError();
  }
}

function throwDirectSaveAuthorizationError(): never {
  throw createCoreRpcHttpError({
    code: "organization_document.direct_save_not_authorized",
    reason:
      "This active Center Agent turn is not authorized to finalize approved Organization knowledge.",
    status: 403,
  });
}

async function prepareRequest(
  env: CoreBindings,
  request: CenterAgentManageOrganizationDocumentsRpcInput
): Promise<PreparedCenterAgentDocumentRequest> {
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const db = organizationDocumentsDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "organization_document.store_unavailable",
      reason: "Organization document storage is unavailable.",
      status: 503,
    });
  }
  return {
    actor: {
      organizationId:
        represented.authorization.activeOrganization.organizationId,
      role: represented.representedHuman.role,
      userId: represented.representedHuman.userId,
    },
    actorProfileId: represented.authorization.actorProfileId,
    db,
    representedHuman: represented.representedHuman,
    sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
  };
}

function resolveOperationTargetResourceId(
  request: CenterAgentManageOrganizationDocumentsRpcInput
): string {
  switch (request.action) {
    case "create_folder":
      return `org_document_${crypto.randomUUID()}`;
    case "rename_folder":
      return request.folderId;
    case "move_document":
      return request.documentId;
    case "save_document":
      return request.documentId ?? `org_document_${crypto.randomUUID()}`;
    default:
      return assertNever(request);
  }
}

function assertNever(value: never): never {
  throw new TypeError(
    `Unsupported Organization Document action: ${String(value)}`
  );
}

async function prepareOperationRequest(input: {
  kind: CenterAgentOrganizationDocumentOperationKind;
  operationId: string;
  payload: unknown;
  prepared: PreparedCenterAgentDocumentRequest;
}) {
  const requestSignature =
    await buildCenterAgentOrganizationDocumentRequestSignature(input.payload);
  const scope = {
    actorProfileId: input.prepared.actorProfileId,
    operationId: input.operationId,
    operationKind: input.kind,
    organizationId: input.prepared.actor.organizationId,
    representedUserId: input.prepared.representedHuman.userId,
  };
  return {
    existingOperation: await readCenterAgentOrganizationDocumentOperation({
      db: input.prepared.db,
      scope,
    }),
    requestSignature,
    scope,
  };
}

async function beginOperation(input: {
  prepared: PreparedCenterAgentDocumentRequest;
  requestSignature: string;
  scope: Parameters<
    typeof beginCenterAgentOrganizationDocumentOperation
  >[0]["scope"];
  targetResourceId: string;
}): ReturnType<typeof beginCenterAgentOrganizationDocumentOperation> {
  return await beginCenterAgentOrganizationDocumentOperation({
    db: input.prepared.db,
    nowMs: Date.now(),
    requestSignature: input.requestSignature,
    scope: input.scope,
    targetResourceId: input.targetResourceId,
  });
}

function resolveExistingOperation(input: {
  operation: CenterAgentOrganizationDocumentOperationRecord;
  requestSignature: string;
}): CenterAgentManageOrganizationDocumentsResponse {
  requireCenterAgentOrganizationDocumentOperationRequestMatch(input);
  if (input.operation.status === "pending") {
    throw createCoreRpcHttpError({
      code: "organization_document.operation_in_progress",
      reason:
        "This Organization document operation is still in progress. Retry the same operation ID.",
      status: 409,
    });
  }
  if (input.operation.responseJson === null) {
    throw new Error(
      "Completed Center Agent Organization document operation is missing its response."
    );
  }
  return parseResponse(JSON.parse(input.operation.responseJson));
}

async function readCompletedOperationReplayAfterAuthorizationFailure(input: {
  operationRequest: Awaited<ReturnType<typeof prepareOperationRequest>>;
  prepared: PreparedCenterAgentDocumentRequest;
}): Promise<CenterAgentManageOrganizationDocumentsResponse | null> {
  const operation = await readCenterAgentOrganizationDocumentOperation({
    db: input.prepared.db,
    scope: input.operationRequest.scope,
  });
  if (!operation) {
    return null;
  }
  requireCenterAgentOrganizationDocumentOperationRequestMatch({
    operation,
    requestSignature: input.operationRequest.requestSignature,
  });
  return operation.status === "completed"
    ? resolveExistingOperation({
        operation,
        requestSignature: input.operationRequest.requestSignature,
      })
    : null;
}

async function completeOperation(input: {
  action: CenterAgentAction;
  operation: CenterAgentOrganizationDocumentOperationRecord;
  prepared: PreparedCenterAgentDocumentRequest;
  resource: { id: string; type: string };
  response: CenterAgentManageOrganizationDocumentsResponse;
}): Promise<CenterAgentManageOrganizationDocumentsResponse> {
  if (!input.operation.claimId) {
    throw new Error(
      "Claimed Center Agent Organization document operation is missing its claim ID."
    );
  }
  const nowMs = Date.now();
  const results = await input.prepared.db.batch([
    prepareCenterAgentAuditJournalEntryIfMissingStatement({
      action: input.action,
      actorProfileId: input.prepared.actorProfileId,
      attribution: {
        actorProfileId: input.prepared.actorProfileId,
        onBehalfOf: {
          displayName: input.prepared.representedHuman.displayName,
          profileId: input.prepared.representedHuman.profileId,
          userId: input.prepared.representedHuman.userId,
        },
      },
      db: input.prepared.db,
      id: `audit_${input.operation.id}`,
      nowMs,
      organizationId: input.prepared.actor.organizationId,
      resource: input.resource,
      sourceNativeDeliveryId: input.prepared.sourceNativeDeliveryId,
    }),
    prepareCompleteCenterAgentOrganizationDocumentOperationStatement({
      db: input.prepared.db,
      claimId: input.operation.claimId,
      nowMs,
      operationRecordId: input.operation.id,
      responseJson: JSON.stringify(input.response),
    }),
  ]);
  const completion = results[1];
  if (Number(completion?.meta?.changes ?? 0) === 1) {
    return input.response;
  }
  const current = await readCenterAgentOrganizationDocumentOperation({
    db: input.prepared.db,
    scope: input.operation,
  });
  if (!current) {
    throw new Error(
      "Center Agent Organization document operation disappeared during completion."
    );
  }
  requireCenterAgentOrganizationDocumentOperationRequestMatch({
    operation: current,
    requestSignature: input.operation.requestSignature,
  });
  if (current.status !== "completed") {
    throw createCoreRpcHttpError({
      code: "organization_document.operation_claim_lost",
      reason:
        "This Organization document operation is being recovered by another request. Retry the same operation ID.",
      status: 409,
    });
  }
  return resolveExistingOperation({
    operation: current,
    requestSignature: input.operation.requestSignature,
  });
}

function operationPayload(
  request: CenterAgentManageOrganizationDocumentsRpcInput
): unknown {
  const {
    context: _context,
    operationId: _operationId,
    speakerMember: _speakerMember,
    ...payload
  } = request;
  return payload;
}

function parseRequest<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.message,
      status: 400,
    });
  }
  return parsed.data;
}

function parseResponse(
  value: unknown
): CenterAgentManageOrganizationDocumentsResponse {
  const parsed =
    centerAgentManageOrganizationDocumentsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Failed to build a valid Center Agent Organization document response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function toProjection(document: OrganizationDocument) {
  return {
    content: document.content,
    folderId: document.folderId,
    id: document.id,
    kind: document.kind,
    title: document.title,
    updatedAt: document.updatedAt,
  };
}
