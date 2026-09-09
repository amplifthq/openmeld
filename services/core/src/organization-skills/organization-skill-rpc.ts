import {
  createOrganizationSkillResponseSchema,
  createOrganizationSkillRpcInputSchema,
  deleteOrganizationSkillResponseSchema,
  deleteOrganizationSkillRpcInputSchema,
  getOrganizationSkillResponseSchema,
  getOrganizationSkillRpcInputSchema,
  importOrganizationSkillFromGitHubResponseSchema,
  importOrganizationSkillFromGitHubRpcInputSchema,
  listOrganizationSkillsResponseSchema,
  listOrganizationSkillsRpcInputSchema,
  organizationSkillRuntimeSnapshotResponseSchema,
  previewOrganizationSkillFromGitHubResponseSchema,
  previewOrganizationSkillFromGitHubRpcInputSchema,
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
  CreateOrganizationSkillResponse,
  CreateOrganizationSkillRpcInput,
  DeleteOrganizationSkillResponse,
  DeleteOrganizationSkillRpcInput,
  GetOrganizationSkillResponse,
  GetOrganizationSkillRpcInput,
  ImportOrganizationSkillFromGitHubResponse,
  ImportOrganizationSkillFromGitHubRpcInput,
  ListOrganizationSkillsResponse,
  ListOrganizationSkillsRpcInput,
  OpenMeldRequestContext,
  OrganizationSkillRuntimeSnapshotResponse,
  PreviewOrganizationSkillFromGitHubResponse,
  PreviewOrganizationSkillFromGitHubRpcInput,
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
  createOrganizationSkillService,
  type OrganizationSkillActor,
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
  const { actor, service } = await prepareHumanRequest(env, request.context);
  return parseResponse(getOrganizationSkillResponseSchema, {
    skill: await service.get(actor, request.skillId),
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
  return parseResponse(importOrganizationSkillFromGitHubResponseSchema, {
    skill: await service.importFromGitHub(
      actor,
      request.url,
      request.expectedCommitSha
    ),
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
  const { db, bucket } = requireStores(env);
  return parseResponse(
    organizationSkillRuntimeSnapshotResponseSchema,
    await createOrganizationSkillService({ bucket, db }).readRuntimeSnapshot(
      authorization.activeOrganization.organizationId,
      request.releases
    )
  );
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
          AND profile_kind = 'human'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(context.actorContext.openMeldProfileId, membership.userId)
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
    role: membership.role,
    userId: membership.userId,
  };
  return {
    actor,
    service: createOrganizationSkillService({
      bucket,
      db,
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
