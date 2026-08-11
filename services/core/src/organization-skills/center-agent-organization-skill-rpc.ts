import {
  CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
  centerAgentInstallOrganizationSkillResponseSchema,
  centerAgentInstallOrganizationSkillRpcInputSchema,
  centerAgentReadOrganizationSkillsResponseSchema,
  centerAgentReadOrganizationSkillsRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentInstallOrganizationSkillResponse,
  CenterAgentInstallOrganizationSkillRpcInput,
  CenterAgentReadOrganizationSkillsResponse,
  CenterAgentReadOrganizationSkillsRpcInput,
  CenterAgentToolSpeaker,
  OrganizationSkill,
} from "@openmeld/schemas/types";
import {
  type CenterAgentOrganizationMember,
  prepareCenterAgentOrganizationMemberRequest,
} from "../center-agent/application/anonymous-member-request";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { writeCenterAgentAuditEntry } from "../center-agent/center-agent-audit";
import { prepareCenterAgentAuditJournalEntryIfMissingStatement } from "../center-agent/center-agent-repository";
import { type CoreBindings, organizationSkillsDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  beginCenterAgentOrganizationSkillOperation,
  buildCenterAgentOrganizationSkillOperationKey,
  buildCenterAgentOrganizationSkillRequestSignature,
  type CenterAgentOrganizationSkillOperationRecord,
  deletePendingCenterAgentOrganizationSkillOperation,
  prepareCompleteCenterAgentOrganizationSkillOperationStatement,
  readCenterAgentOrganizationSkillOperation,
} from "./center-agent-organization-skill-operation-repository";
import {
  createOrganizationSkillService,
  type OrganizationSkillActor,
  type OrganizationSkillReadActor,
} from "./organization-skill-service";

type PreparedCenterAgentOrganizationSkillRequest = {
  actor: OrganizationSkillActor;
  actorProfileId: string;
  authorization: Awaited<
    ReturnType<typeof prepareCenterAgentRepresentedMemberRequest>
  >["authorization"];
  bucket: R2Bucket;
  db: D1Database;
  representedHuman: Awaited<
    ReturnType<typeof prepareCenterAgentRepresentedMemberRequest>
  >["representedHuman"];
  sourceNativeDeliveryId: string | null;
};

export async function rpcCenterAgentReadOrganizationSkills(
  env: CoreBindings,
  input: CenterAgentReadOrganizationSkillsRpcInput
): Promise<CenterAgentReadOrganizationSkillsResponse> {
  const request = parseRequest(
    centerAgentReadOrganizationSkillsRpcInputSchema,
    input
  );
  const prepared = await prepareReadRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  if (request.action === "preview_github" && !prepared.member.profileId) {
    throw openMeldIdentityRequiredError();
  }
  const service = createOrganizationSkillService({
    bucket: prepared.bucket,
    db: prepared.db,
    githubToken: env.GITHUB_OPENMELD_API_TOKEN,
  });
  if (request.action === "list") {
    const skills = await service.list(prepared.actor);
    await writeCenterAgentAuditEntry({
      action: "read_org_skills",
      authorization: prepared.authorization,
      onBehalfOfProfileId: prepared.member.profileId,
      resource: {
        id: prepared.actor.organizationId,
        type: "organization_skill_catalog",
      },
      sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
    });
    return parseReadResponse({
      action: "list",
      canManage: isManager(prepared.actor),
      organizationId: prepared.actor.organizationId,
      skills,
    });
  }
  if (request.action === "get") {
    const skill = await service.get(prepared.actor, request.skillId);
    await writeCenterAgentAuditEntry({
      action: "read_org_skills",
      authorization: prepared.authorization,
      onBehalfOfProfileId: prepared.member.profileId,
      resource: { id: skill.id, type: "organization_skill" },
      sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
    });
    return parseReadResponse({
      action: "get",
      organizationId: prepared.actor.organizationId,
      skill,
    });
  }
  const preview = await service.previewFromGitHub(
    requireOpenMeldIdentity(prepared.actor),
    request.url
  );
  await writeCenterAgentAuditEntry({
    action: "preview_org_skill",
    authorization: prepared.authorization,
    onBehalfOfProfileId: prepared.member.profileId,
    resource: {
      id: preview.source.commitSha,
      type: "organization_skill_github_preview",
    },
    sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
  });
  return parseReadResponse({
    action: "preview_github",
    organizationId: prepared.actor.organizationId,
    preview,
  });
}

export async function rpcCenterAgentInstallOrganizationSkill(
  env: CoreBindings,
  input: CenterAgentInstallOrganizationSkillRpcInput
): Promise<CenterAgentInstallOrganizationSkillResponse> {
  const request = parseRequest(
    centerAgentInstallOrganizationSkillRpcInputSchema,
    input
  );
  const prepared = await prepareRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  requireManager(prepared.actor);
  const operationKey = await buildCenterAgentOrganizationSkillOperationKey({
    action: request.action,
    actorProfileId: prepared.actorProfileId,
    operationId: request.operationId,
    organizationId: prepared.actor.organizationId,
    representedUserId: prepared.representedHuman.userId,
  });
  const requestSignature =
    await buildCenterAgentOrganizationSkillRequestSignature({
      action: request.action,
      actorProfileId: prepared.actorProfileId,
      payload: installPayload(request),
      representedUserId: prepared.representedHuman.userId,
    });
  const begin = await beginCenterAgentOrganizationSkillOperation({
    db: prepared.db,
    nowMs: Date.now(),
    operationKey,
    organizationId: prepared.actor.organizationId,
    requestSignature,
  });
  if (begin.outcome === "completed_replay") {
    return parseCompletedResponse(begin.operation);
  }
  if (begin.outcome === "pending_in_progress") {
    throw operationInProgressError();
  }

  const skillId = `org_skill_${requestSignature.slice(0, 32)}`;
  const releaseId = `org_skill_release_${requestSignature.slice(32)}`;
  const ids = [skillId, releaseId];
  const service = createOrganizationSkillService({
    bucket: prepared.bucket,
    db: prepared.db,
    githubToken: env.GITHUB_OPENMELD_API_TOKEN,
    newId: () => {
      const id = ids.shift();
      if (!id) {
        throw new Error(
          "Center Agent Organization Skill installation exhausted its deterministic IDs."
        );
      }
      return id;
    },
  });
  let skill: OrganizationSkill;
  try {
    skill =
      request.action === "create"
        ? await service.installBundle(prepared.actor, {
            bundle: request.bundle,
            source: { kind: "created" },
          })
        : await service.importFromGitHub(
            prepared.actor,
            request.url,
            request.expectedCommitSha
          );
  } catch (error) {
    const recovered = await service
      .get(prepared.actor, skillId)
      .catch(() => null);
    if (recovered?.activeRelease.id !== releaseId) {
      await deletePendingCenterAgentOrganizationSkillOperation({
        db: prepared.db,
        operation: begin.operation,
      });
      throw error;
    }
    skill = recovered;
  }

  const response = parseInstallResponse({
    action: request.action,
    organizationId: prepared.actor.organizationId,
    skill: toSkillSummary(skill),
  });
  return await completeOperation({
    operation: begin.operation,
    prepared,
    response,
    skillId,
  });
}

async function prepareRequest(input: {
  context: CenterAgentReadOrganizationSkillsRpcInput["context"];
  env: CoreBindings;
  speakerMember: CenterAgentReadOrganizationSkillsRpcInput["speakerMember"];
}): Promise<PreparedCenterAgentOrganizationSkillRequest> {
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    input.env,
    input.context,
    input.speakerMember,
    {
      code: "organization_skill.human_actor_required",
      reason:
        "Organization Skills require a verified active human Organization member.",
    }
  );
  const db = organizationSkillsDb(input.env);
  const bucket = input.env.OPENMELD_ORGANIZATION_SKILLS;
  if (!(db && bucket)) {
    throw createCoreRpcHttpError({
      code: "organization_skill.store_unavailable",
      reason: "Organization Skills are temporarily unavailable.",
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
    authorization: represented.authorization,
    bucket,
    db,
    representedHuman: represented.representedHuman,
    sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
  };
}

async function prepareReadRequest(input: {
  context: CenterAgentReadOrganizationSkillsRpcInput["context"];
  env: CoreBindings;
  speakerMember: CenterAgentToolSpeaker;
}): Promise<
  Omit<
    PreparedCenterAgentOrganizationSkillRequest,
    "actor" | "representedHuman" | "sourceNativeDeliveryId"
  > & {
    actor: OrganizationSkillReadActor;
    member: CenterAgentOrganizationMember;
  }
> {
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    input.env,
    input.context,
    input.speakerMember
  );
  const db = organizationSkillsDb(input.env);
  const bucket = input.env.OPENMELD_ORGANIZATION_SKILLS;
  if (!(db && bucket)) {
    throw createCoreRpcHttpError({
      code: "organization_skill.store_unavailable",
      reason: "Organization Skills are temporarily unavailable.",
      status: 503,
    });
  }
  return {
    actor: {
      organizationId: prepared.authorization.activeOrganization.organizationId,
      role: prepared.member.role,
      userId: prepared.member.userId,
    },
    actorProfileId: prepared.authorization.actorProfileId,
    authorization: prepared.authorization,
    bucket,
    db,
    member: prepared.member,
  };
}

function openMeldIdentityRequiredError(): Error {
  return createCoreRpcHttpError({
    code: CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
    reason:
      "This action requires your OpenMeld identity. Join or link your account so OpenMeld can verify your permissions and record who performed the action.",
    status: 403,
  });
}

async function completeOperation(input: {
  operation: CenterAgentOrganizationSkillOperationRecord;
  prepared: PreparedCenterAgentOrganizationSkillRequest;
  response: CenterAgentInstallOrganizationSkillResponse;
  skillId: string;
}): Promise<CenterAgentInstallOrganizationSkillResponse> {
  const nowMs = Date.now();
  const results = await input.prepared.db.batch([
    prepareCenterAgentAuditJournalEntryIfMissingStatement({
      action: "install_org_skill",
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
      id: `audit_${input.operation.operationKey}`,
      nowMs,
      organizationId: input.prepared.actor.organizationId,
      resource: { id: input.skillId, type: "organization_skill" },
      sourceNativeDeliveryId: input.prepared.sourceNativeDeliveryId,
    }),
    prepareCompleteCenterAgentOrganizationSkillOperationStatement({
      db: input.prepared.db,
      nowMs,
      operation: input.operation,
      responseJson: JSON.stringify(input.response),
    }),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) === 1) {
    return input.response;
  }
  const current = await readCenterAgentOrganizationSkillOperation({
    db: input.prepared.db,
    operationKey: input.operation.operationKey,
    organizationId: input.operation.organizationId,
  });
  if (current?.completedAt !== null && current?.responseJson) {
    return parseCompletedResponse(current);
  }
  throw operationInProgressError();
}

function installPayload(
  request: CenterAgentInstallOrganizationSkillRpcInput
): unknown {
  const {
    context: _context,
    operationId: _operationId,
    speakerMember: _speakerMember,
    ...payload
  } = request;
  return payload;
}

function toSkillSummary(skill: OrganizationSkill) {
  const {
    bundle: _bundle,
    maintainerUserIds: _maintainerUserIds,
    releases: _releases,
    ...summary
  } = skill;
  return summary;
}

function isManager(actor: Pick<OrganizationSkillActor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

function requireOpenMeldIdentity(
  actor: OrganizationSkillReadActor
): OrganizationSkillActor {
  if (actor.userId) {
    return { ...actor, userId: actor.userId };
  }
  throw openMeldIdentityRequiredError();
}

function requireManager(actor: OrganizationSkillActor): void {
  if (isManager(actor)) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_skill.manage_forbidden",
    reason:
      "Only Organization owners and admins can install Organization Skills.",
    status: 403,
  });
}

function parseRequest<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { message: string }; success: false };
  },
  value: unknown
): T {
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

function parseReadResponse(
  value: unknown
): CenterAgentReadOrganizationSkillsResponse {
  const parsed =
    centerAgentReadOrganizationSkillsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Failed to build a valid Center Agent Organization Skill read response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function parseInstallResponse(
  value: unknown
): CenterAgentInstallOrganizationSkillResponse {
  const parsed =
    centerAgentInstallOrganizationSkillResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Failed to build a valid Center Agent Organization Skill install response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function parseCompletedResponse(
  operation: CenterAgentOrganizationSkillOperationRecord
): CenterAgentInstallOrganizationSkillResponse {
  if (!operation.responseJson) {
    throw new Error(
      "Completed Center Agent Organization Skill operation is missing its response."
    );
  }
  return parseInstallResponse(JSON.parse(operation.responseJson));
}

function operationInProgressError(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.operation_in_progress",
    reason:
      "This Organization Skill installation is still in progress. Retry the same operation ID.",
    status: 409,
  });
}
