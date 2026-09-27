import {
  beginOrganizationSkillImportBatchResponseSchema,
  beginOrganizationSkillImportBatchRpcInputSchema,
  createOrganizationSkillResponseSchema,
  createOrganizationSkillRpcInputSchema,
  deleteOrganizationSkillResponseSchema,
  deleteOrganizationSkillRpcInputSchema,
  getOrganizationSkillImportBatchResponseSchema,
  getOrganizationSkillImportBatchRpcInputSchema,
  getOrganizationSkillResponseSchema,
  getOrganizationSkillRpcInputSchema,
  importOrganizationSkillFromFilesResponseSchema,
  importOrganizationSkillFromFilesRpcInputSchema,
  importOrganizationSkillFromGitHubResponseSchema,
  importOrganizationSkillFromGitHubRpcInputSchema,
  listOrganizationSkillsResponseSchema,
  listOrganizationSkillsRpcInputSchema,
  organizationSkillRuntimeCatalogResponseSchema,
  organizationSkillRuntimeSnapshotResponseSchema,
  previewOrganizationSkillFromFilesResponseSchema,
  previewOrganizationSkillFromFilesRpcInputSchema,
  previewOrganizationSkillFromGitHubResponseSchema,
  previewOrganizationSkillFromGitHubRpcInputSchema,
  previewOrganizationSkillRepositoryResponseSchema,
  previewOrganizationSkillRepositoryRpcInputSchema,
  readOrganizationSkillRuntimeCatalogRpcInputSchema,
  readOrganizationSkillRuntimeResourceResponseSchema,
  readOrganizationSkillRuntimeResourceRpcInputSchema,
  readOrganizationSkillRuntimeSnapshotRpcInputSchema,
  recordOrganizationSkillActivationResponseSchema,
  recordOrganizationSkillActivationRpcInputSchema,
  setOrganizationSkillEnabledResponseSchema,
  setOrganizationSkillEnabledRpcInputSchema,
  setOrganizationSkillMaintainersResponseSchema,
  setOrganizationSkillMaintainersRpcInputSchema,
  updateOrganizationSkillResponseSchema,
  updateOrganizationSkillRpcInputSchema,
} from "@openmeld/schemas";
import type {
  BeginOrganizationSkillImportBatchResponse,
  BeginOrganizationSkillImportBatchRpcInput,
  CreateOrganizationSkillResponse,
  CreateOrganizationSkillRpcInput,
  DeleteOrganizationSkillResponse,
  DeleteOrganizationSkillRpcInput,
  GetOrganizationSkillImportBatchResponse,
  GetOrganizationSkillImportBatchRpcInput,
  GetOrganizationSkillResponse,
  GetOrganizationSkillRpcInput,
  ImportOrganizationSkillFromFilesResponse,
  ImportOrganizationSkillFromFilesRpcInput,
  ImportOrganizationSkillFromGitHubResponse,
  ImportOrganizationSkillFromGitHubRpcInput,
  ListOrganizationSkillsResponse,
  ListOrganizationSkillsRpcInput,
  OpenMeldRequestContext,
  OrganizationSkillRuntimeCatalogResponse,
  OrganizationSkillRuntimeReleaseSelection,
  OrganizationSkillRuntimeSnapshotResponse,
  PreviewOrganizationSkillFromFilesResponse,
  PreviewOrganizationSkillFromFilesRpcInput,
  PreviewOrganizationSkillFromGitHubResponse,
  PreviewOrganizationSkillFromGitHubRpcInput,
  PreviewOrganizationSkillRepositoryResponse,
  PreviewOrganizationSkillRepositoryRpcInput,
  ReadOrganizationSkillRuntimeCatalogRpcInput,
  ReadOrganizationSkillRuntimeResourceResponse,
  ReadOrganizationSkillRuntimeResourceRpcInput,
  ReadOrganizationSkillRuntimeSnapshotRpcInput,
  RecordOrganizationSkillActivationResponse,
  RecordOrganizationSkillActivationRpcInput,
  SetOrganizationSkillEnabledResponse,
  SetOrganizationSkillEnabledRpcInput,
  SetOrganizationSkillMaintainersResponse,
  SetOrganizationSkillMaintainersRpcInput,
  UpdateOrganizationSkillResponse,
  UpdateOrganizationSkillRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, organizationSkillsDb } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  beginOrganizationSkillImportBatch,
  readOrganizationSkillImportBatch,
  recordOrganizationSkillImportBatchResult,
  requireBatchCandidate,
  selectionMatches,
} from "./organization-skill-import-batch";
import {
  beginOrganizationSkillOperation,
  buildHumanOrganizationSkillImportOperationKey,
  buildOrganizationSkillRequestSignature,
  deletePendingOrganizationSkillOperation,
  prepareCompleteOrganizationSkillOperationStatement,
  readOrganizationSkillOperation,
} from "./organization-skill-operation-repository";
import {
  createOrganizationSkillService,
  type OrganizationSkillActor,
  readEnabledOrganizationSkillReleaseSelection,
} from "./organization-skill-service";

export async function rpcListOrganizationSkills(
  env: CoreBindings,
  input: ListOrganizationSkillsRpcInput
): Promise<ListOrganizationSkillsResponse> {
  const request = parseRequest(listOrganizationSkillsRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(env, request.context);
  return parseResponse(listOrganizationSkillsResponseSchema, {
    canManage: actor.role === "owner" || actor.role === "admin",
    organizationId: actor.organizationId,
    skills: await service.list(actor),
  });
}

export async function rpcGetOrganizationSkill(
  env: CoreBindings,
  input: GetOrganizationSkillRpcInput
): Promise<GetOrganizationSkillResponse> {
  const request = parseRequest(getOrganizationSkillRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(
    env,
    request.context,
    request.releaseId !== undefined
  );
  const skill = await service.get(actor, request.skillId);
  return parseResponse(getOrganizationSkillResponseSchema, {
    skill:
      request.context.actorContext.profileKind === "agent"
        ? { ...skill, permissions: { canEdit: false, canManage: false } }
        : skill,
    ...(request.releaseId === undefined
      ? {}
      : {
          selectedRelease: await service.getEnabledRelease(
            actor,
            request.skillId,
            request.releaseId
          ),
        }),
  });
}

export async function rpcCreateOrganizationSkill(
  env: CoreBindings,
  input: CreateOrganizationSkillRpcInput
): Promise<CreateOrganizationSkillResponse> {
  const request = parseRequest(createOrganizationSkillRpcInputSchema, input);
  const { context, expectedOrganizationId, ...body } = request;
  const { actor, service } = await prepareHumanRequest(env, context);
  requireExpectedOrganization(actor.organizationId, expectedOrganizationId);
  return parseResponse(createOrganizationSkillResponseSchema, {
    skill: await service.create(actor, body),
  });
}

export async function rpcImportOrganizationSkillFromGitHub(
  env: CoreBindings,
  input: ImportOrganizationSkillFromGitHubRpcInput
): Promise<ImportOrganizationSkillFromGitHubResponse> {
  const request = parseRequest(
    importOrganizationSkillFromGitHubRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  if (request.batchId !== undefined) {
    return await importGitHubSkillInBatch({ actor, env, request });
  }
  if (request.operationId !== undefined) {
    return await importGitHubSkillWithOperation({ actor, env, request });
  }
  return parseResponse(importOrganizationSkillFromGitHubResponseSchema, {
    skill: await service.importFromGitHub(
      actor,
      request.url,
      request.expectedCommitSha
    ),
  });
}

export async function rpcBeginOrganizationSkillImportBatch(
  env: CoreBindings,
  input: BeginOrganizationSkillImportBatchRpcInput
): Promise<BeginOrganizationSkillImportBatchResponse> {
  const request = parseRequest(
    beginOrganizationSkillImportBatchRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  requireManagerActor(actor);
  const { db } = requireStores(env);
  const existing = await readOrganizationSkillImportBatch({
    batchId: request.batchId,
    db,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
  if (existing) {
    if (
      existing.sourceUrl !== request.url &&
      `${existing.preview.repository}/tree/${existing.preview.commitSha}` !==
        request.url
    ) {
      throw batchInputConflict();
    }
    if (
      request.expectedCommitSha &&
      request.expectedCommitSha !== existing.preview.commitSha
    ) {
      throw batchInputConflict();
    }
    if (!selectionMatches(existing, request.selectedPaths)) {
      throw batchInputConflict();
    }
    return parseResponse(beginOrganizationSkillImportBatchResponseSchema, {
      batch: existing,
    });
  }
  const preview = await service.previewRepositoryFromGitHub(actor, request.url);
  if (
    request.expectedCommitSha &&
    request.expectedCommitSha !== preview.commitSha
  ) {
    throw createCoreRpcHttpError({
      code: "organization_skill.github_source_changed",
      reason:
        "The GitHub source changed after it was previewed. Review it again before installing.",
      status: 409,
    });
  }
  const batch = await beginOrganizationSkillImportBatch({
    batchId: request.batchId,
    db,
    organizationId: actor.organizationId,
    preview,
    selectedPaths: request.selectedPaths,
    sourceUrl: request.url,
    userId: actor.userId,
  });
  return parseResponse(beginOrganizationSkillImportBatchResponseSchema, {
    batch,
  });
}

export async function rpcGetOrganizationSkillImportBatch(
  env: CoreBindings,
  input: GetOrganizationSkillImportBatchRpcInput
): Promise<GetOrganizationSkillImportBatchResponse> {
  const request = parseRequest(
    getOrganizationSkillImportBatchRpcInputSchema,
    input
  );
  const { actor } = await prepareHumanRequest(env, request.context);
  requireManagerActor(actor);
  const { db } = requireStores(env);
  const batch = await readOrganizationSkillImportBatch({
    batchId: request.batchId,
    db,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
  if (!batch) {
    throw batchNotFound();
  }
  return parseResponse(getOrganizationSkillImportBatchResponseSchema, {
    batch,
  });
}

async function importGitHubSkillInBatch(input: {
  actor: OrganizationSkillActor;
  env: CoreBindings;
  request: ImportOrganizationSkillFromGitHubRpcInput;
}): Promise<ImportOrganizationSkillFromGitHubResponse> {
  const { actor, env, request } = input;
  requireManagerActor(actor);
  const { db } = requireStores(env);
  const batch = await readOrganizationSkillImportBatch({
    batchId: request.batchId as string,
    db,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
  if (!batch) {
    throw batchNotFound();
  }
  const index = requireBatchCandidate({
    batch,
    expectedCommitSha: request.expectedCommitSha ?? "",
    url: request.url,
  });
  const item = batch.preview.skills[index];
  if (!item) {
    throw batchInputConflict();
  }
  const operationId = await buildOrganizationSkillRequestSignature({
    batchId: batch.batchId,
    path: item.path,
  });
  if (
    request.operationId !== undefined &&
    request.operationId !== operationId
  ) {
    throw batchInputConflict();
  }
  try {
    const response = await importGitHubSkillWithOperation({
      actor,
      env,
      request: { ...request, operationId },
    });
    await recordOrganizationSkillImportBatchResult({
      batchId: batch.batchId,
      db,
      index,
      organizationId: actor.organizationId,
      result: {
        path: item.path,
        releaseId: response.skill.activeRelease.id,
        selected: true,
        skillId: response.skill.id,
        status: "installed",
      },
      userId: actor.userId,
    });
    return response;
  } catch (error) {
    await recordOrganizationSkillImportBatchResult({
      batchId: batch.batchId,
      db,
      index,
      organizationId: actor.organizationId,
      result: {
        path: item.path,
        selected: true,
        status: "failed",
        error: batchFailureMessage(error),
      },
      userId: actor.userId,
    });
    throw error;
  }
}

function batchFailureMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message.slice(0, 2048);
  }
  return "This Skill could not be installed. Try again.";
}

function requireManagerActor(actor: OrganizationSkillActor): void {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw createCoreRpcHttpError({
      code: "organization_skill.manage_forbidden",
      reason: "Only Organization owners and admins can manage Skills.",
      status: 403,
    });
  }
}

function batchInputConflict(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.batch_conflict",
    reason: "This batch ID belongs to a different Skill install plan.",
    status: 409,
  });
}

function batchNotFound(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.batch_missing",
    reason: "This Skill install batch was not found.",
    status: 404,
  });
}

async function importGitHubSkillWithOperation(input: {
  actor: OrganizationSkillActor;
  env: CoreBindings;
  request: ImportOrganizationSkillFromGitHubRpcInput;
}): Promise<ImportOrganizationSkillFromGitHubResponse> {
  const { actor, env, request } = input;
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw createCoreRpcHttpError({
      code: "organization_skill.manage_forbidden",
      reason: "Only Organization owners and admins can manage Skills.",
      status: 403,
    });
  }
  if (
    request.operationId === undefined ||
    request.expectedCommitSha === undefined
  ) {
    throw new Error(
      "A retryable GitHub Skill import needs an operation ID and pinned commit."
    );
  }
  const { bucket, db } = requireStores(env);
  const operationKey = await buildHumanOrganizationSkillImportOperationKey({
    actorProfileId: request.context.actorContext.openMeldProfileId,
    operationId: request.operationId,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });
  const requestSignature = await buildOrganizationSkillRequestSignature({
    actorProfileId: request.context.actorContext.openMeldProfileId,
    expectedCommitSha: request.expectedCommitSha,
    url: request.url,
    userId: actor.userId,
  });
  const begin = await beginOrganizationSkillOperation({
    db,
    kind: "human_import",
    nowMs: Date.now(),
    operationKey,
    organizationId: actor.organizationId,
    requestSignature,
  });
  if (begin.outcome === "completed_replay") {
    return await readCompletedGitHubImport({
      actor,
      env,
      responseJson: begin.operation.responseJson,
    });
  }
  if (begin.outcome === "pending_in_progress") {
    throw createCoreRpcHttpError({
      code: "organization_skill.operation_in_progress",
      reason:
        "This Skill installation is still in progress. Retry the same operation ID.",
      status: 409,
    });
  }
  const idDigest = await buildOrganizationSkillRequestSignature(operationKey);
  const skillId = `org_skill_${idDigest.slice(0, 32)}`;
  const releaseId = `org_skill_release_${idDigest.slice(32)}`;
  const ids = [skillId, releaseId];
  const service = createOrganizationSkillService({
    bucket,
    db,
    fileBackedWritesEnabled: env.OPENMELD_SKILL_FILE_BACKED_WRITES === "true",
    githubToken: env.GITHUB_OPENMELD_API_TOKEN,
    newId: () => {
      const id = ids.shift();
      if (!id) {
        throw new Error("Skill import exhausted its deterministic IDs.");
      }
      return id;
    },
  });
  let skill: Awaited<ReturnType<typeof service.importFromGitHub>>;
  try {
    skill = await service.importFromGitHub(
      actor,
      request.url,
      request.expectedCommitSha
    );
  } catch (error) {
    const recovered = await service.get(actor, skillId).catch(() => null);
    if (recovered?.activeRelease.id !== releaseId) {
      await deletePendingOrganizationSkillOperation({
        db,
        kind: "human_import",
        operation: begin.operation,
      });
      throw error;
    }
    skill = recovered;
  }
  const response = parseResponse(
    importOrganizationSkillFromGitHubResponseSchema,
    { skill }
  );
  const completed = await prepareCompleteOrganizationSkillOperationStatement({
    db,
    kind: "human_import",
    nowMs: Date.now(),
    operation: begin.operation,
    responseJson: JSON.stringify({ skillId, releaseId }),
  }).run();
  if (Number(completed.meta.changes ?? 0) === 1) {
    return response;
  }
  const current = await readOrganizationSkillOperation({
    db,
    kind: "human_import",
    operationKey,
    organizationId: actor.organizationId,
  });
  if (current?.completedAt !== null && current?.responseJson) {
    return await readCompletedGitHubImport({
      actor,
      env,
      responseJson: current.responseJson,
    });
  }
  throw createCoreRpcHttpError({
    code: "organization_skill.operation_in_progress",
    reason:
      "This Skill installation is still in progress. Retry the same operation ID.",
    status: 409,
  });
}

async function readCompletedGitHubImport(input: {
  actor: OrganizationSkillActor;
  env: CoreBindings;
  responseJson: string | null;
}): Promise<ImportOrganizationSkillFromGitHubResponse> {
  const result = JSON.parse(input.responseJson ?? "null") as {
    releaseId?: string;
    skillId?: string;
  } | null;
  if (!(result?.skillId && result.releaseId)) {
    throw new Error("Completed Skill import is missing its identity.");
  }
  const { bucket, db } = requireStores(input.env);
  const service = createOrganizationSkillService({ bucket, db });
  const skill = await service.get(input.actor, result.skillId);
  if (!skill.releases.some((release) => release.id === result.releaseId)) {
    throw new Error("Completed Skill import is missing its release.");
  }
  return parseResponse(importOrganizationSkillFromGitHubResponseSchema, {
    skill,
  });
}

export async function rpcImportOrganizationSkillFromFiles(
  env: CoreBindings,
  input: ImportOrganizationSkillFromFilesRpcInput
): Promise<ImportOrganizationSkillFromFilesResponse> {
  const request = parseRequest(
    importOrganizationSkillFromFilesRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(importOrganizationSkillFromFilesResponseSchema, {
    skill: await service.importFromFiles(actor, request.files),
  });
}

export async function rpcPreviewOrganizationSkillFromFiles(
  env: CoreBindings,
  input: PreviewOrganizationSkillFromFilesRpcInput
): Promise<PreviewOrganizationSkillFromFilesResponse> {
  const request = parseRequest(
    previewOrganizationSkillFromFilesRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(previewOrganizationSkillFromFilesResponseSchema, {
    organizationId: actor.organizationId,
    preview: await service.previewFromFiles(actor, request.files),
  });
}

export async function rpcPreviewOrganizationSkillFromGitHub(
  env: CoreBindings,
  input: PreviewOrganizationSkillFromGitHubRpcInput
): Promise<PreviewOrganizationSkillFromGitHubResponse> {
  const request = parseRequest(
    previewOrganizationSkillFromGitHubRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(previewOrganizationSkillFromGitHubResponseSchema, {
    organizationId: actor.organizationId,
    preview: await service.previewFromGitHub(actor, request.url),
  });
}

export async function rpcPreviewOrganizationSkillRepository(
  env: CoreBindings,
  input: PreviewOrganizationSkillRepositoryRpcInput
): Promise<PreviewOrganizationSkillRepositoryResponse> {
  const request = parseRequest(
    previewOrganizationSkillRepositoryRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(previewOrganizationSkillRepositoryResponseSchema, {
    organizationId: actor.organizationId,
    preview: await service.previewRepositoryFromGitHub(actor, request.url),
  });
}

export async function rpcUpdateOrganizationSkill(
  env: CoreBindings,
  input: UpdateOrganizationSkillRpcInput
): Promise<UpdateOrganizationSkillResponse> {
  const request = parseRequest(updateOrganizationSkillRpcInputSchema, input);
  const {
    bundle,
    context,
    expectedActiveReleaseId,
    expectedOrganizationId,
    expectedVersion,
    skillId,
  } = request;
  const { actor, service } = await prepareHumanRequest(env, context);
  requireExpectedOrganization(actor.organizationId, expectedOrganizationId);
  return parseResponse(updateOrganizationSkillResponseSchema, {
    skill: await service.update(actor, skillId, {
      bundle,
      expectedActiveReleaseId,
      expectedVersion,
    }),
  });
}

export async function rpcSetOrganizationSkillEnabled(
  env: CoreBindings,
  input: SetOrganizationSkillEnabledRpcInput
): Promise<SetOrganizationSkillEnabledResponse> {
  const request = parseRequest(
    setOrganizationSkillEnabledRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(setOrganizationSkillEnabledResponseSchema, {
    skill: await service.setEnabled(
      actor,
      request.skillId,
      request.enabled,
      request.expectedVersion
    ),
  });
}

export async function rpcSetOrganizationSkillMaintainers(
  env: CoreBindings,
  input: SetOrganizationSkillMaintainersRpcInput
): Promise<SetOrganizationSkillMaintainersResponse> {
  const request = parseRequest(
    setOrganizationSkillMaintainersRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  return parseResponse(setOrganizationSkillMaintainersResponseSchema, {
    skill: await service.setMaintainers(
      actor,
      request.skillId,
      request.maintainerUserIds,
      request.expectedVersion
    ),
  });
}

export async function rpcDeleteOrganizationSkill(
  env: CoreBindings,
  input: DeleteOrganizationSkillRpcInput
): Promise<DeleteOrganizationSkillResponse> {
  const request = parseRequest(deleteOrganizationSkillRpcInputSchema, input);
  const { actor, service } = await prepareHumanRequest(env, request.context);
  requireExpectedOrganization(
    actor.organizationId,
    request.expectedOrganizationId
  );
  await service.remove(actor, request.skillId, request.expectedVersion);
  return parseResponse(deleteOrganizationSkillResponseSchema, {
    deleted: true,
    organizationId: actor.organizationId,
    skillId: request.skillId,
  });
}

export async function rpcReadOrganizationSkillRuntimeSnapshot(
  env: CoreBindings,
  input: ReadOrganizationSkillRuntimeSnapshotRpcInput
): Promise<OrganizationSkillRuntimeSnapshotResponse> {
  const request = parseRequest(
    readOrganizationSkillRuntimeSnapshotRpcInputSchema,
    input
  );
  const authorization = await authorizeRuntimeSelection(env, request);
  const { db, bucket } = requireStores(env);
  return parseResponse(
    organizationSkillRuntimeSnapshotResponseSchema,
    await createOrganizationSkillService({ bucket, db }).readRuntimeSnapshot(
      authorization.activeOrganization.organizationId,
      request.releases
    )
  );
}

export async function rpcReadOrganizationSkillRuntimeCatalog(
  env: CoreBindings,
  input: ReadOrganizationSkillRuntimeCatalogRpcInput
): Promise<OrganizationSkillRuntimeCatalogResponse> {
  const request = parseRequest(
    readOrganizationSkillRuntimeCatalogRpcInputSchema,
    input
  );
  const authorization = await authorizeRuntimeSelection(env, request);
  const { db, bucket } = requireStores(env);
  await readEnabledOrganizationSkillReleaseSelection({
    db,
    organizationId: authorization.activeOrganization.organizationId,
    selectedReleases: request.releases,
  });
  return parseResponse(
    organizationSkillRuntimeCatalogResponseSchema,
    await createOrganizationSkillService({ bucket, db }).readRuntimeCatalog(
      authorization.activeOrganization.organizationId,
      request.releases
    )
  );
}

async function authorizeRuntimeSelection(
  env: CoreBindings,
  request: {
    context: OpenMeldRequestContext;
    preparationIdempotencyKey?: string;
    releases: OrganizationSkillRuntimeReleaseSelection[];
  }
) {
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
    skillPreparationKey: request.preparationIdempotencyKey,
  });
  if ("personalExecution" in authorization) {
    const selected =
      authorization.personalExecution.request.organizationSkillReleases ?? [];
    if (
      request.releases.length !== selected.length ||
      request.releases.some(
        (release) =>
          !selected.some(
            (frozen) =>
              frozen.skillId === release.skillId &&
              frozen.releaseId === release.releaseId &&
              frozen.digest === release.digest &&
              frozen.name === release.name
          )
      )
    ) {
      throw new Error("organization_skill.prepared_release_mismatch");
    }
  }
  return authorization;
}

export async function rpcReadOrganizationSkillRuntimeResource(
  env: CoreBindings,
  input: ReadOrganizationSkillRuntimeResourceRpcInput
): Promise<ReadOrganizationSkillRuntimeResourceResponse> {
  const request = parseRequest(
    readOrganizationSkillRuntimeResourceRpcInputSchema,
    input
  );
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
    skillPreparationKey: request.preparationIdempotencyKey,
  });
  if (
    "personalExecution" in authorization &&
    !(
      authorization.personalExecution.request.organizationSkillReleases ?? []
    ).some(
      (frozen) =>
        frozen.skillId === request.release.skillId &&
        frozen.releaseId === request.release.releaseId &&
        frozen.digest === request.release.digest &&
        frozen.name === request.release.name
    )
  ) {
    throw new Error("organization_skill.prepared_release_mismatch");
  }
  const { db, bucket } = requireStores(env);
  await readEnabledOrganizationSkillReleaseSelection({
    db,
    organizationId: authorization.activeOrganization.organizationId,
    selectedReleases: [request.release],
  });
  return parseResponse(readOrganizationSkillRuntimeResourceResponseSchema, {
    file: await createOrganizationSkillService({
      bucket,
      db,
    }).readRuntimeResource(
      authorization.activeOrganization.organizationId,
      request.release,
      request.path
    ),
  });
}

export async function rpcRecordOrganizationSkillActivation(
  env: CoreBindings,
  input: RecordOrganizationSkillActivationRpcInput
): Promise<RecordOrganizationSkillActivationResponse> {
  const request = parseRequest(
    recordOrganizationSkillActivationRpcInputSchema,
    input
  );
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
  });
  if (request.context.agentControllerConversationId !== request.submissionId) {
    throw createCoreRpcHttpError({
      code: "organization_skill.organization_context_changed",
      reason: "Organization Skill activation submission identity changed.",
      status: 403,
    });
  }
  const { db } = requireStores(env);
  const release = await db
    .prepare(
      `
        SELECT 1
        FROM organization_skill_releases
        WHERE organization_id = ?
          AND skill_id = ?
          AND id = ?
          AND digest = ?
        LIMIT 1
      `
    )
    .bind(
      authorization.activeOrganization.organizationId,
      request.skillId,
      request.releaseId,
      request.digest
    )
    .first();
  if (!release) {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_missing",
      reason: "The activated Organization Skill release is unavailable.",
      status: 404,
    });
  }
  const result = await db
    .prepare(
      `
        INSERT OR IGNORE INTO organization_skill_activations (
          activated_at,
          digest,
          organization_id,
          release_id,
          routine_run_id,
          skill_id,
          submission_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      Date.now(),
      request.digest,
      authorization.activeOrganization.organizationId,
      request.releaseId,
      request.routineRunId,
      request.skillId,
      request.submissionId
    )
    .run();
  return recordOrganizationSkillActivationResponseSchema.parse({
    recorded: Number(result.meta.changes ?? 0) === 1,
  });
}

async function prepareHumanRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  allowAgentReleaseRead = false
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
    !(allowAgentReleaseRead && context.actorContext.profileKind === "agent")
  ) {
    throw createCoreRpcHttpError({
      code: "organization_skill.human_actor_required",
      reason: "Organization Skills must be managed by a human profile.",
      status: 403,
    });
  }
  const { db, bucket } = requireStores(env);
  const profile = await db
    .prepare(
      `
        SELECT 1
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND owner_user_id = ?
          AND profile_kind = ?
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(
      context.actorContext.openMeldProfileId,
      membership.userId,
      context.actorContext.profileKind
    )
    .first();
  if (!profile) {
    throw createCoreRpcHttpError({
      code: "organization_skill.human_actor_required",
      reason: "Organization Skills must be managed by your human profile.",
      status: 403,
    });
  }
  const actor: OrganizationSkillActor = {
    organizationId: membership.organizationId,
    role:
      context.actorContext.profileKind === "agent" ? "member" : membership.role,
    userId: membership.userId,
  };
  return {
    actor,
    service: createOrganizationSkillService({
      bucket,
      db,
      fileBackedWritesEnabled: env.OPENMELD_SKILL_FILE_BACKED_WRITES === "true",
      githubToken: env.GITHUB_OPENMELD_API_TOKEN,
    }),
  };
}

function requireStores(env: CoreBindings): {
  bucket: R2Bucket;
  db: D1Database;
} {
  const db = organizationSkillsDb(env);
  const bucket = env.OPENMELD_ORGANIZATION_SKILLS;
  if (!(db && bucket)) {
    throw createCoreRpcHttpError({
      code: "organization_skill.store_unavailable",
      reason: "Organization Skills are temporarily unavailable.",
      status: 503,
    });
  }
  return { bucket, db };
}

function requireExpectedOrganization(
  activeOrganizationId: string,
  expectedOrganizationId: string
): void {
  requireExpectedOrganizationContext({
    actualOrganizationId: activeOrganizationId,
    errorCode: "organization_skill.organization_context_changed",
    expectedOrganizationId,
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
      reason: "Organization Skill request is invalid.",
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
    throw new Error("Failed to build a valid Organization Skill response.");
  }
  return parsed.data;
}
