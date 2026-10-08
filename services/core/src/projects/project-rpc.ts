import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  archiveProjectResponseSchema,
  archiveProjectRpcInputSchema,
  createProjectResponseSchema,
  createProjectRpcInputSchema,
  listProjectsResponseSchema,
  listProjectsRpcInputSchema,
  listSpaceTasksResponseSchema,
  readProjectCommonAgentsResponseSchema,
  readProjectCommonAgentsRpcInputSchema,
  readProjectIssueRoutingResponseSchema,
  readProjectIssueRoutingRpcInputSchema,
  readProjectRecentTasksResponseSchema,
  readProjectRecentTasksRpcInputSchema,
  readProjectRepositorySettingsResponseSchema,
  readProjectRepositorySettingsRpcInputSchema,
  resolveProjectIssueActionResponseSchema,
  resolveProjectIssueActionRpcInputSchema,
  updateProjectCommonAgentsResponseSchema,
  updateProjectCommonAgentsRpcInputSchema,
  updateProjectIssueRoutingResponseSchema,
  updateProjectIssueRoutingRpcInputSchema,
  updateProjectRepositorySettingsResponseSchema,
  updateProjectRepositorySettingsRpcInputSchema,
  updateProjectResponseSchema,
  updateProjectRpcInputSchema,
} from "@openmeld/schemas";
import type {
  ArchiveProjectResponse,
  ArchiveProjectRpcInput,
  CreateProjectResponse,
  CreateProjectRpcInput,
  ListProjectsResponse,
  ListProjectsRpcInput,
  ReadProjectCommonAgentsResponse,
  ReadProjectCommonAgentsRpcInput,
  ReadProjectIssueRoutingResponse,
  ReadProjectIssueRoutingRpcInput,
  ReadProjectRecentTasksResponse,
  ReadProjectRecentTasksRpcInput,
  ReadProjectRepositorySettingsResponse,
  ReadProjectRepositorySettingsRpcInput,
  ResolveProjectIssueActionResponse,
  ResolveProjectIssueActionRpcInput,
  UpdateProjectCommonAgentsResponse,
  UpdateProjectCommonAgentsRpcInput,
  UpdateProjectIssueRoutingResponse,
  UpdateProjectIssueRoutingRpcInput,
  UpdateProjectRepositorySettingsResponse,
  UpdateProjectRepositorySettingsRpcInput,
  UpdateProjectResponse,
  UpdateProjectRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { authorizeRemoteAgentExecutionAccess } from "../remote-agent/application/remote-agent-execution-access";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import { resolveSpaceStub } from "../rpc/space-ref";
import { listSpaceTaskProjectCandidates } from "../space/infrastructure/postgresql/space-task-project-link-repo";
import { resolveProjectIssueAction } from "./project-issue-action-routing";
import { listProjectIssueRoutingCandidates } from "./project-repository";
import {
  prepareExpectedHumanProjectRequest,
  prepareHumanProjectRequest,
} from "./project-request-preparation";
import {
  parseProjectPayload,
  parseProjectResponse,
} from "./project-rpc-contract";

export async function rpcListProjects(
  env: CoreBindings,
  input: ListProjectsRpcInput
): Promise<ListProjectsResponse> {
  const request = parseProjectPayload(listProjectsRpcInputSchema, input);
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  return parseProjectResponse(
    listProjectsResponseSchema,
    await service.list(authority)
  );
}

export async function rpcReadProjectIssueRouting(
  env: CoreBindings,
  input: ReadProjectIssueRoutingRpcInput
): Promise<ReadProjectIssueRoutingResponse> {
  const request = parseProjectPayload(
    readProjectIssueRoutingRpcInputSchema,
    input
  );
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  return parseProjectResponse(readProjectIssueRoutingResponseSchema, {
    routing: await service.readIssueRouting(authority, request.projectId),
  });
}

export async function rpcReadProjectRepositorySettings(
  env: CoreBindings,
  input: ReadProjectRepositorySettingsRpcInput
): Promise<ReadProjectRepositorySettingsResponse> {
  const request = parseProjectPayload(
    readProjectRepositorySettingsRpcInputSchema,
    input
  );
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  return parseProjectResponse(readProjectRepositorySettingsResponseSchema, {
    settings: await service.readRepositorySettings(
      authority,
      request.projectId
    ),
  });
}

export async function rpcUpdateProjectRepositorySettings(
  env: CoreBindings,
  input: UpdateProjectRepositorySettingsRpcInput
): Promise<UpdateProjectRepositorySettingsResponse> {
  const request = parseProjectPayload(
    updateProjectRepositorySettingsRpcInputSchema,
    input
  );
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return parseProjectResponse(updateProjectRepositorySettingsResponseSchema, {
    settings: await service.updateRepositorySettings(
      authority,
      request.projectId,
      {
        defaultRepositoryUrl: request.defaultRepositoryUrl,
        expectedRevision: request.expectedRevision,
        repositoryUrls: request.repositoryUrls,
      }
    ),
  });
}

export async function rpcReadProjectCommonAgents(
  env: CoreBindings,
  input: ReadProjectCommonAgentsRpcInput
): Promise<ReadProjectCommonAgentsResponse> {
  const request = parseProjectPayload(
    readProjectCommonAgentsRpcInputSchema,
    input
  );
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  return parseProjectResponse(readProjectCommonAgentsResponseSchema, {
    commonAgents: await service.readCommonAgents(authority, request.projectId),
  });
}

export async function rpcReadProjectRecentTasks(
  env: CoreBindings,
  input: ReadProjectRecentTasksRpcInput
): Promise<ReadProjectRecentTasksResponse> {
  const request = parseProjectPayload(
    readProjectRecentTasksRpcInputSchema,
    input
  );
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  await service.read(authority, request.projectId);
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project work is unavailable.",
      status: 503,
    });
  }
  const candidates = await listSpaceTaskProjectCandidates({
    db,
    organizationId: authority.organizationId,
    projectId: request.projectId,
    limit: 40,
  });
  const tasks: ReadProjectRecentTasksResponse["tasks"] = [];
  for (
    let offset = 0;
    offset < candidates.length && tasks.length < 20;
    offset += 5
  ) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 5).map(async (candidate) => {
        const stub = resolveSpaceStub(env.OPENMELD_SPACES, candidate.spaceId);
        if (!stub) {
          return null;
        }
        try {
          const detail = await stub.rpcGetTask({
            context: request.context,
            spaceId: candidate.spaceId,
            taskId: candidate.taskId,
          });
          const task = detail.task;
          if (
            task.spaceId !== candidate.spaceId ||
            task.taskId !== candidate.taskId ||
            !task.projectIds.includes(request.projectId)
          ) {
            return null;
          }
          return {
            spaceId: task.spaceId,
            taskId: task.taskId,
            title: task.title,
            phase: task.phase,
            updatedAt: task.updatedAt,
          };
        } catch (error) {
          const status = readCoreRpcHttpStatus(error);
          if (status === 401 || status === 403 || status === 404) {
            return null;
          }
          throw error;
        }
      })
    );
    for (const task of batch) {
      if (task && tasks.length < 20) {
        tasks.push(task);
      }
    }
  }
  return parseProjectResponse(readProjectRecentTasksResponseSchema, { tasks });
}

export async function rpcUpdateProjectCommonAgents(
  env: CoreBindings,
  input: UpdateProjectCommonAgentsRpcInput
): Promise<UpdateProjectCommonAgentsResponse> {
  const request = parseProjectPayload(
    updateProjectCommonAgentsRpcInputSchema,
    input
  );
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return parseProjectResponse(updateProjectCommonAgentsResponseSchema, {
    commonAgents: await service.updateCommonAgents(
      authority,
      request.projectId,
      {
        agentProfileIds: request.agentProfileIds,
        expectedRevision: request.expectedRevision,
      }
    ),
  });
}

export async function rpcResolveProjectIssueAction(
  env: CoreBindings,
  input: ResolveProjectIssueActionRpcInput
): Promise<ResolveProjectIssueActionResponse> {
  const request = parseProjectPayload(
    resolveProjectIssueActionRpcInputSchema,
    input
  );
  const submissionId = request.context.agentControllerConversationId;
  if (!submissionId) {
    throw createCoreRpcHttpError({
      code: "project.issue_request_unavailable",
      reason: "An active Agent request is required to route this issue.",
      status: 403,
    });
  }
  await authorizeRemoteAgentExecutionAccess(env, {
    context: request.context,
    submissionId,
    effect: "write",
  });
  const db = getPostgresDatabase(env);
  const deliveryDb = db;
  if (!(deliveryDb && db)) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project routing is unavailable.",
      status: 503,
    });
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: deliveryDb,
    submissionId,
  });
  if (
    !delivery ||
    delivery.organizationId !== request.context.activeOrganizationId ||
    delivery.profileId !== request.context.actorContext.openMeldProfileId
  ) {
    throw createCoreRpcHttpError({
      code: "project.issue_request_unavailable",
      reason: "The original issue request could not be verified.",
      status: 403,
    });
  }
  const sourceText =
    delivery.triggerText ??
    (delivery.routineRunId !== null
      ? (delivery.workerSubmitRequest?.messages[0]?.content ?? null)
      : null);
  const turnEnvelope =
    delivery.executionRecoverySubmitRequest?.turnEnvelope ??
    delivery.workerSubmitRequest?.turnEnvelope;
  const requesterCanOverride =
    (turnEnvelope?.sender.kind === "member" &&
      ["web_dm", "space_wake", "slack", "message_channel"].includes(
        turnEnvelope.trigger.source
      )) ||
    (turnEnvelope?.sender.kind === "routine" &&
      turnEnvelope.trigger.source === "routine" &&
      !turnEnvelope.trigger.continuation);
  return parseProjectResponse(
    resolveProjectIssueActionResponseSchema,
    resolveProjectIssueAction({
      projects: await listProjectIssueRoutingCandidates({
        db,
        organizationId: delivery.organizationId,
      }),
      proposedDestination: request.proposedDestination,
      requestText: sourceText ?? "",
      requesterCanOverride,
      taskProjectIds: await readSourceTaskProjectIds({
        context: request.context,
        delivery,
        env,
      }),
    })
  );
}

async function readSourceTaskProjectIds(input: {
  context: ResolveProjectIssueActionRpcInput["context"];
  delivery: NonNullable<
    Awaited<ReturnType<typeof readRemoteAgentNativeDeliveryBySubmissionId>>
  >;
  env: CoreBindings;
}): Promise<string[]> {
  const envelope =
    input.delivery.executionRecoverySubmitRequest?.turnEnvelope ??
    input.delivery.workerSubmitRequest?.turnEnvelope;
  if (
    input.delivery.conversationKind !== "space" ||
    envelope?.space.kind !== "space"
  ) {
    return [];
  }
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.delivery.spaceId
  );
  if (!stub) {
    throw createCoreRpcHttpError({
      code: "project.issue_task_context_unavailable",
      reason: "The Space Task context could not be checked for this issue.",
      status: 503,
    });
  }
  const listed = listSpaceTasksResponseSchema.parse(
    await stub.rpcListTasks({
      context: input.context,
      spaceId: input.delivery.spaceId,
    })
  );
  const matching = listed.tasks.filter(
    (task) => task.sourceSignalId === input.delivery.triggerMessageId
  );
  if (matching.length > 1 || (listed.truncated && matching.length === 0)) {
    throw createCoreRpcHttpError({
      code: "project.issue_task_context_ambiguous",
      reason:
        "The source Task could not be identified uniquely. Choose the Project and exact issue destination.",
      status: 409,
    });
  }
  return matching[0]?.projectIds ?? [];
}

export async function rpcUpdateProjectIssueRouting(
  env: CoreBindings,
  input: UpdateProjectIssueRoutingRpcInput
): Promise<UpdateProjectIssueRoutingResponse> {
  const request = parseProjectPayload(
    updateProjectIssueRoutingRpcInputSchema,
    input
  );
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return parseProjectResponse(updateProjectIssueRoutingResponseSchema, {
    routing: await service.updateIssueRouting(authority, request.projectId, {
      destination: request.destination,
      expectedRevision: request.expectedRevision,
    }),
  });
}

export async function rpcCreateProject(
  env: CoreBindings,
  input: CreateProjectRpcInput
): Promise<CreateProjectResponse> {
  const request = parseProjectPayload(createProjectRpcInputSchema, input);
  const { context, expectedOrganizationId, ...body } = request;
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context,
    expectedOrganizationId,
  });
  return parseProjectResponse(createProjectResponseSchema, {
    project: await service.create(authority, body),
  });
}

export async function rpcUpdateProject(
  env: CoreBindings,
  input: UpdateProjectRpcInput
): Promise<UpdateProjectResponse> {
  const request = parseProjectPayload(updateProjectRpcInputSchema, input);
  const { context, expectedOrganizationId, projectId, ...body } = request;
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context,
    expectedOrganizationId,
  });
  return parseProjectResponse(updateProjectResponseSchema, {
    project: await service.update(authority, projectId, body),
  });
}

export async function rpcArchiveProject(
  env: CoreBindings,
  input: ArchiveProjectRpcInput
): Promise<ArchiveProjectResponse> {
  const request = parseProjectPayload(archiveProjectRpcInputSchema, input);
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return parseProjectResponse(archiveProjectResponseSchema, {
    project: await service.archive(authority, request.projectId),
  });
}
