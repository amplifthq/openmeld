import {
  centerAgentCreateProjectToolResponseSchema,
  centerAgentCreateProjectToolRpcInputSchema,
  centerAgentListProjectsToolResponseSchema,
  centerAgentListProjectsToolRpcInputSchema,
  centerAgentPrepareRemoveProjectToolResponseSchema,
  centerAgentPrepareRemoveProjectToolRpcInputSchema,
  centerAgentRemoveProjectToolResponseSchema,
  centerAgentRemoveProjectToolRpcInputSchema,
  centerAgentSetAgentProfileDefaultProjectToolResponseSchema,
  centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema,
  centerAgentUpdateProjectToolResponseSchema,
  centerAgentUpdateProjectToolRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAction,
  CenterAgentCreateProjectToolResponse,
  CenterAgentCreateProjectToolRpcInput,
  CenterAgentListProjectsToolResponse,
  CenterAgentListProjectsToolRpcInput,
  CenterAgentPrepareRemoveProjectToolResponse,
  CenterAgentPrepareRemoveProjectToolRpcInput,
  CenterAgentProject,
  CenterAgentRemoveProjectToolResponse,
  CenterAgentRemoveProjectToolRpcInput,
  CenterAgentSetAgentProfileDefaultProjectToolResponse,
  CenterAgentSetAgentProfileDefaultProjectToolRpcInput,
  CenterAgentUpdateProjectToolResponse,
  CenterAgentUpdateProjectToolRpcInput,
  Project,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { prepareCenterAgentAuditJournalEntryStatement } from "../center-agent/center-agent-repository";
import { type CoreBindings, projectDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { updateAgentProfileDefaultProjectForAuthority } from "./agent-profile-default-project-service";
import {
  beginCenterAgentProjectOperation,
  buildCenterAgentProjectRequestSignature,
  type CenterAgentProjectOperationKind,
  type CenterAgentProjectOperationRecord,
  type CenterAgentProjectOperationScope,
  claimCenterAgentProjectRemoveConfirmation,
  createCenterAgentProjectRemoveConfirmation,
  invalidRemoveConfirmationError,
  prepareCompleteCenterAgentProjectOperationStatement,
  readCenterAgentProjectRemoveConfirmation,
} from "./center-agent-project-operation-repository";
import type {
  ProjectAuthority,
  ProjectReadAuthority,
} from "./project-authority";
import { createProjectService, type ProjectService } from "./project-service";

type PreparedCenterAgentProjectRequest = {
  actorProfileId: string;
  authority: ProjectAuthority;
  db: D1Database;
  representedHuman: {
    displayName: string;
    profileId: string;
    userId: string;
  };
  service: ProjectService;
  sourceNativeDeliveryId: string | null;
};

type PreparedCenterAgentProjectListRequest = {
  actorProfileId: string;
  attribution: {
    actorProfileId: string;
    onBehalfOf: {
      displayName: string;
      profileId: string;
      userId: string;
    } | null;
  };
  authority: ProjectReadAuthority;
  db: D1Database;
  service: ProjectService;
  sourceNativeDeliveryId: string | null;
};

type RuntimeSchema<T> = {
  safeParse: (value: unknown) =>
    | { data: T; success: true }
    | {
        error: {
          issues: Array<{ message?: string }>;
          message: string;
        };
        success: false;
      };
};

export async function rpcCenterAgentListProjects(
  env: CoreBindings,
  input: CenterAgentListProjectsToolRpcInput
): Promise<CenterAgentListProjectsToolResponse> {
  const request = parseRequest(
    centerAgentListProjectsToolRpcInputSchema,
    input
  );
  const prepared = await prepareProjectListRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const listed = await prepared.service.list(prepared.authority);
  const normalizedQuery = request.query?.trim().toLocaleLowerCase("en-US");
  const filtered = normalizedQuery
    ? listed.projects.filter((project) =>
        [project.name, project.slug, project.repositoryUrl]
          .filter((value): value is string => Boolean(value))
          .some((value) =>
            value.toLocaleLowerCase("en-US").includes(normalizedQuery)
          )
      )
    : listed.projects;
  const limit = request.limit ?? 20;
  const response = parseResponse(centerAgentListProjectsToolResponseSchema, {
    hasMore: filtered.length > limit,
    projects: filtered.slice(0, limit).map(toCenterAgentProject),
  });
  await prepareCenterAgentAuditJournalEntryStatement({
    action: "read_projects",
    actorProfileId: prepared.actorProfileId,
    attribution: prepared.attribution,
    db: prepared.db,
    id: crypto.randomUUID(),
    nowMs: Date.now(),
    organizationId: prepared.authority.organizationId,
    resource: null,
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  }).run();
  return response;
}

export async function rpcCenterAgentCreateProject(
  env: CoreBindings,
  input: CenterAgentCreateProjectToolRpcInput
): Promise<CenterAgentCreateProjectToolResponse> {
  const request = parseRequest(
    centerAgentCreateProjectToolRpcInputSchema,
    input
  );
  const prepared = await prepareProjectRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const operation = await beginOperation({
    kind: "create_project",
    operationId: request.operationId,
    payload: {
      name: request.name,
      repositoryUrl: request.repositoryUrl,
      slug: request.slug,
    },
    prepared,
    targetResourceId: `project_${crypto.randomUUID()}`,
  });
  const replay = parseReplay(
    centerAgentCreateProjectToolResponseSchema,
    operation
  );
  if (replay) {
    return replay;
  }

  let project: Project;
  try {
    project = await createProjectService({
      db: prepared.db,
      generateId: () => operation.targetResourceId,
    }).create(prepared.authority, {
      name: request.name,
      ...(request.repositoryUrl === undefined
        ? {}
        : { repositoryUrl: request.repositoryUrl }),
      ...(request.slug === undefined ? {} : { slug: request.slug }),
    });
  } catch (error) {
    const existing = await readExistingOperationProject(prepared, operation);
    if (!existing) {
      throw error;
    }
    project = existing;
  }
  const response = parseResponse(centerAgentCreateProjectToolResponseSchema, {
    outcome: "created",
    project: toCenterAgentProject(project),
  });
  await completeOperation({
    action: "create_project",
    operation,
    prepared,
    resource: { id: project.id, type: "project" },
    response,
  });
  return response;
}

export async function rpcCenterAgentUpdateProject(
  env: CoreBindings,
  input: CenterAgentUpdateProjectToolRpcInput
): Promise<CenterAgentUpdateProjectToolResponse> {
  const request = parseRequest(
    centerAgentUpdateProjectToolRpcInputSchema,
    input
  );
  const prepared = await prepareProjectRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const operation = await beginOperation({
    kind: "update_project",
    operationId: request.operationId,
    payload: {
      name: request.name,
      projectId: request.projectId,
      repositoryUrl: request.repositoryUrl,
      slug: request.slug,
    },
    prepared,
    targetResourceId: request.projectId,
  });
  const replay = parseReplay(
    centerAgentUpdateProjectToolResponseSchema,
    operation
  );
  if (replay) {
    return replay;
  }

  const project = await prepared.service.update(
    prepared.authority,
    operation.targetResourceId,
    {
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.repositoryUrl === undefined
        ? {}
        : { repositoryUrl: request.repositoryUrl }),
      ...(request.slug === undefined ? {} : { slug: request.slug }),
    }
  );
  const response = parseResponse(centerAgentUpdateProjectToolResponseSchema, {
    outcome: "updated",
    project: toCenterAgentProject(project),
  });
  await completeOperation({
    action: "update_project",
    operation,
    prepared,
    resource: { id: project.id, type: "project" },
    response,
  });
  return response;
}

export async function rpcCenterAgentSetAgentProfileDefaultProject(
  env: CoreBindings,
  input: CenterAgentSetAgentProfileDefaultProjectToolRpcInput
): Promise<CenterAgentSetAgentProfileDefaultProjectToolResponse> {
  const request = parseRequest(
    centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema,
    input
  );
  const prepared = await prepareProjectRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const operation = await beginOperation({
    kind: "set_agent_profile_default_project",
    operationId: request.operationId,
    payload: {
      agentProfileId: request.agentProfileId,
      projectId: request.projectId,
    },
    prepared,
    targetResourceId: request.agentProfileId,
  });
  const replay = parseReplay(
    centerAgentSetAgentProfileDefaultProjectToolResponseSchema,
    operation
  );
  if (replay) {
    return replay;
  }

  const updated = await updateAgentProfileDefaultProjectForAuthority({
    agentProfileId: request.agentProfileId,
    authority: prepared.authority,
    defaultProjectId: request.projectId,
    env,
    service: prepared.service,
  });
  const project = request.projectId
    ? toCenterAgentProject(
        await prepared.service.read(prepared.authority, request.projectId)
      )
    : null;
  const response = parseResponse(
    centerAgentSetAgentProfileDefaultProjectToolResponseSchema,
    {
      agentProfile: {
        defaultProjectId: updated.profile.defaultProjectId ?? null,
        id: updated.profile.openMeldProfileId,
        name: updated.profile.profileName,
      },
      outcome: "updated",
      project,
    }
  );
  await completeOperation({
    action: "set_agent_profile_default_project",
    operation,
    prepared,
    resource: { id: request.agentProfileId, type: "agent_profile" },
    response,
  });
  return response;
}

export async function rpcCenterAgentPrepareRemoveProject(
  env: CoreBindings,
  input: CenterAgentPrepareRemoveProjectToolRpcInput
): Promise<CenterAgentPrepareRemoveProjectToolResponse> {
  const request = parseRequest(
    centerAgentPrepareRemoveProjectToolRpcInputSchema,
    input
  );
  requireInteractiveProjectRemoval(request.executionMode);
  const prepared = await prepareProjectRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const project = await prepared.service.prepareArchive(
    prepared.authority,
    request.projectId
  );
  const nowMs = Date.now();
  const confirmation = await createCenterAgentProjectRemoveConfirmation({
    actorProfileId: prepared.actorProfileId,
    db: prepared.db,
    nowMs,
    organizationId: prepared.authority.organizationId,
    preparedRequestId: request.context.actorContext.requestId,
    projectId: project.id,
    projectUpdatedAtMs: project.updatedAtMs,
    representedProfileId: prepared.representedHuman.profileId,
    representedUserId: prepared.representedHuman.userId,
  });
  await prepared.db.batch([
    confirmation.statement,
    prepareAuditStatement({
      action: "prepare_remove_project",
      id: crypto.randomUUID(),
      nowMs,
      prepared,
      resource: { id: project.id, type: "project" },
    }),
  ]);
  return parseResponse(centerAgentPrepareRemoveProjectToolResponseSchema, {
    confirmation: {
      expiresAtMs: confirmation.confirmation.expiresAtMs,
      token: confirmation.token,
    },
    project: toCenterAgentProject(project),
    warning:
      "Removing this Project is permanent. Existing Agent Activity remains available under its normal retention.",
  });
}

export async function rpcCenterAgentRemoveProject(
  env: CoreBindings,
  input: CenterAgentRemoveProjectToolRpcInput
): Promise<CenterAgentRemoveProjectToolResponse> {
  const request = parseRequest(
    centerAgentRemoveProjectToolRpcInputSchema,
    input
  );
  requireInteractiveProjectRemoval(request.executionMode);
  const prepared = await prepareProjectRequest({
    context: request.context,
    env,
    speakerMember: request.speakerMember,
  });
  const confirmation = await readCenterAgentProjectRemoveConfirmation({
    db: prepared.db,
    token: request.confirmationToken,
  });
  if (
    !confirmation ||
    confirmation.organizationId !== prepared.authority.organizationId ||
    confirmation.actorProfileId !== prepared.actorProfileId ||
    confirmation.representedUserId !== prepared.representedHuman.userId ||
    confirmation.representedProfileId !== prepared.representedHuman.profileId ||
    (request.executionMode === "interactive" &&
      confirmation.preparedRequestId === request.context.actorContext.requestId)
  ) {
    throw invalidRemoveConfirmationError();
  }

  const operation = await beginOperation({
    kind: "remove_project",
    operationId: request.operationId,
    payload: {
      confirmationTokenHash: confirmation.tokenHash,
      projectId: confirmation.projectId,
    },
    prepared,
    targetResourceId: confirmation.projectId,
  });
  const replay = parseReplay(
    centerAgentRemoveProjectToolResponseSchema,
    operation
  );
  if (replay) {
    return replay;
  }
  if (
    (confirmation.consumedOperationId !== null &&
      confirmation.consumedOperationId !== request.operationId) ||
    (confirmation.consumedOperationId === null &&
      confirmation.expiresAtMs <= Date.now())
  ) {
    throw invalidRemoveConfirmationError();
  }

  const current = await prepared.service.read(
    prepared.authority,
    confirmation.projectId
  );
  let removed: Project;
  if (current.archivedAtMs === null) {
    if (current.updatedAtMs !== confirmation.projectUpdatedAtMs) {
      throw createCoreRpcHttpError({
        code: "project.remove_confirmation_stale",
        reason:
          "This Project changed after removal was prepared. Review it again before removing it.",
        status: 409,
      });
    }
    await claimCenterAgentProjectRemoveConfirmation({
      confirmation,
      db: prepared.db,
      nowMs: Date.now(),
      operationId: request.operationId,
    });
    removed = await prepared.service.archive(
      prepared.authority,
      confirmation.projectId
    );
  } else {
    if (confirmation.consumedOperationId !== request.operationId) {
      throw invalidRemoveConfirmationError();
    }
    removed = current;
  }
  const response = parseResponse(centerAgentRemoveProjectToolResponseSchema, {
    outcome: "removed",
    project: toCenterAgentProject(removed),
  });
  await completeOperation({
    action: "remove_project",
    operation,
    prepared,
    resource: { id: removed.id, type: "project" },
    response,
  });
  return response;
}

async function prepareProjectRequest(input: {
  context:
    | CenterAgentListProjectsToolRpcInput["context"]
    | CenterAgentCreateProjectToolRpcInput["context"];
  env: CoreBindings;
  speakerMember: CenterAgentListProjectsToolRpcInput["speakerMember"];
}): Promise<PreparedCenterAgentProjectRequest> {
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    input.env,
    input.context,
    input.speakerMember,
    {
      code: "project.member_actor_required",
      reason: "A verified active human Organization member is required.",
    }
  );
  const db = projectDb(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project storage is unavailable.",
      status: 503,
    });
  }
  const authority = {
    organizationId: represented.authorization.activeOrganization.organizationId,
    role: represented.representedHuman.role,
    userId: represented.representedHuman.userId,
  };
  return {
    actorProfileId: represented.authorization.actorProfileId,
    authority,
    db,
    representedHuman: represented.representedHuman,
    service: createProjectService({ db }),
    sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
  };
}

async function prepareProjectListRequest(input: {
  context: CenterAgentListProjectsToolRpcInput["context"];
  env: CoreBindings;
  speakerMember: CenterAgentListProjectsToolRpcInput["speakerMember"];
}): Promise<PreparedCenterAgentProjectListRequest> {
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    input.env,
    input.context,
    input.speakerMember
  );
  const db = projectDb(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project storage is unavailable.",
      status: 503,
    });
  }
  const { member } = prepared;
  const sourceNativeDeliveryId = member.sourceNativeDeliveryId;
  const verifiedAttribution =
    member.profileId && member.userId
      ? {
          displayName: member.displayName,
          profileId: member.profileId,
          userId: member.userId,
        }
      : null;
  if (!(verifiedAttribution || sourceNativeDeliveryId)) {
    throw createCoreRpcHttpError({
      code: "project.member_actor_required",
      reason: "An active Organization member is required.",
      status: 403,
    });
  }
  const authority = {
    organizationId: prepared.authorization.activeOrganization.organizationId,
    role: member.role,
    userId: member.userId,
  };
  return {
    actorProfileId: prepared.authorization.actorProfileId,
    attribution: {
      actorProfileId: prepared.authorization.actorProfileId,
      onBehalfOf: verifiedAttribution,
    },
    authority,
    db,
    service: createProjectService({ db }),
    sourceNativeDeliveryId,
  };
}

async function beginOperation(input: {
  kind: CenterAgentProjectOperationKind;
  operationId: string;
  payload: unknown;
  prepared: PreparedCenterAgentProjectRequest;
  targetResourceId: string;
}): Promise<CenterAgentProjectOperationRecord> {
  const scope = {
    actorProfileId: input.prepared.actorProfileId,
    operationId: input.operationId,
    operationKind: input.kind,
    organizationId: input.prepared.authority.organizationId,
    representedUserId: input.prepared.representedHuman.userId,
  } satisfies CenterAgentProjectOperationScope;
  return await beginCenterAgentProjectOperation({
    db: input.prepared.db,
    nowMs: Date.now(),
    requestSignature: await buildCenterAgentProjectRequestSignature(
      input.payload
    ),
    scope,
    targetResourceId: input.targetResourceId,
  });
}

async function completeOperation(input: {
  action: CenterAgentAction;
  operation: CenterAgentProjectOperationRecord;
  prepared: PreparedCenterAgentProjectRequest;
  resource: { id: string; type: string };
  response: unknown;
}): Promise<void> {
  const nowMs = Date.now();
  await input.prepared.db.batch([
    prepareCenterAgentAuditJournalEntryStatement({
      action: input.action,
      actorProfileId: input.prepared.actorProfileId,
      attribution: buildAttribution(input.prepared),
      db: input.prepared.db,
      id: `audit_${input.operation.id}`,
      nowMs,
      organizationId: input.prepared.authority.organizationId,
      resource: input.resource,
      sourceNativeDeliveryId: input.prepared.sourceNativeDeliveryId,
    }),
    prepareCompleteCenterAgentProjectOperationStatement({
      db: input.prepared.db,
      nowMs,
      operationId: input.operation.id,
      responseJson: JSON.stringify(input.response),
    }),
  ]);
}

function prepareAuditStatement(input: {
  action: CenterAgentAction;
  id: string;
  nowMs: number;
  prepared: PreparedCenterAgentProjectRequest;
  resource: { id: string; type: string } | null;
}): D1PreparedStatement {
  return prepareCenterAgentAuditJournalEntryStatement({
    action: input.action,
    actorProfileId: input.prepared.actorProfileId,
    attribution: buildAttribution(input.prepared),
    db: input.prepared.db,
    id: input.id,
    nowMs: input.nowMs,
    organizationId: input.prepared.authority.organizationId,
    resource: input.resource,
    sourceNativeDeliveryId: input.prepared.sourceNativeDeliveryId,
  });
}

function buildAttribution(prepared: PreparedCenterAgentProjectRequest) {
  return {
    actorProfileId: prepared.actorProfileId,
    onBehalfOf: {
      displayName: prepared.representedHuman.displayName,
      profileId: prepared.representedHuman.profileId,
      userId: prepared.representedHuman.userId,
    },
  };
}

async function readExistingOperationProject(
  prepared: PreparedCenterAgentProjectRequest,
  operation: CenterAgentProjectOperationRecord
): Promise<Project | null> {
  try {
    return await prepared.service.read(
      prepared.authority,
      operation.targetResourceId
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === "project.not_found"
    ) {
      return null;
    }
    throw error;
  }
}

function requireInteractiveProjectRemoval(
  executionMode: "interactive" | "routine"
): void {
  if (executionMode === "interactive") {
    return;
  }
  throw createCoreRpcHttpError({
    code: "routine_destructive_action_unsupported",
    reason: "Routines do not currently support deleting or removing Projects.",
    status: 403,
  });
}

function toCenterAgentProject(project: Project): CenterAgentProject {
  return {
    canArchive: project.canArchive,
    canManage: project.canManage,
    id: project.id,
    name: project.name,
    repositoryUrl: project.repositoryUrl ?? null,
    slug: project.slug,
  };
}

function parseRequest<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "project.invalid_input",
      reason:
        parsed.error.issues[0]?.message ??
        "Center Agent Project request is invalid.",
      status: 400,
    });
  }
  return parsed.data;
}

function parseResponse<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Failed to build a valid Center Agent Project response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function parseReplay<T>(
  schema: RuntimeSchema<T>,
  operation: CenterAgentProjectOperationRecord
): T | null {
  if (operation.status !== "completed" || operation.responseJson === null) {
    return null;
  }
  const stored = JSON.parse(operation.responseJson) as Record<string, unknown>;
  return parseResponse(schema, { ...stored, outcome: "replayed" });
}
