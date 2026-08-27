import {
  centerAgentCreateTaskToolRpcInputSchema,
  centerAgentGetTaskToolRpcInputSchema,
  centerAgentListTasksToolRpcInputSchema,
  centerAgentTaskResponseV1Schema,
  centerAgentTaskResponseV2Schema,
  continueCenterAgentTaskRpcInputSchema,
  createCenterAgentTaskResponseSchema,
  getCenterAgentTaskResponseSchema,
  getCenterAgentTaskResponseV1Schema,
  getCenterAgentTaskResponseV2Schema,
  getCenterAgentTaskRpcInputSchema,
  listCenterAgentTasksResponseSchema,
  listCenterAgentTasksResponseV1Schema,
  listCenterAgentTasksResponseV2Schema,
  listCenterAgentTasksRpcInputSchema,
  mutateCenterAgentTaskResponseSchema,
  retryCenterAgentTaskRpcInputSchema,
  stopCenterAgentTaskRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentCreateTaskToolRpcInput,
  CenterAgentGetTaskToolRpcInput,
  CenterAgentListTasksToolRpcInput,
  CenterAgentTask,
  CenterAgentTaskDetail,
  CenterAgentTaskDetailRpcResponse,
  CenterAgentTaskResponseContractVersion,
  CenterAgentTaskResponseV1,
  CenterAgentTaskResponseV2,
  ContinueCenterAgentTaskRpcInput,
  CreateCenterAgentTaskResponse,
  GetCenterAgentTaskRpcInput,
  ListCenterAgentTasksResponse,
  ListCenterAgentTasksRpcInput,
  ListCenterAgentTasksRpcResponse,
  RetryCenterAgentTaskRpcInput,
  StopCenterAgentTaskRpcInput,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../../../center-agent/application/represented-member-request";
import { writeCenterAgentAuditEntry } from "../../../center-agent/center-agent-audit";
import {
  type CoreBindings,
  inboxDb,
  localStateDb,
  wakeEvidenceDb,
} from "../../../lib/bindings";
import { resolveActiveOrganizationMembership } from "../../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import {
  CenterAgentTaskApplicationError,
  createCenterAgentTaskService,
} from "../../application/center-agent-task-service";
import { createCenterAgentTaskNativeRuntimePort } from "../../infrastructure/remote-agent/center-agent-task-native-runtime";

export async function rpcListCenterAgentTasks(
  env: CoreBindings,
  input: ListCenterAgentTasksRpcInput
): Promise<ListCenterAgentTasksRpcResponse> {
  const request = listCenterAgentTasksRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task list query is invalid.");
  }
  const membership = await requireWebMembership(env, request.data.context);
  try {
    const response = listCenterAgentTasksResponseSchema.parse(
      await createTaskService(env).list({
        ...(request.data.cursor ? { cursor: request.data.cursor } : {}),
        limit: request.data.limit,
        organizationId: membership.organizationId,
        requesterUserId: membership.userId,
        status: request.data.status,
      })
    );
    if (request.data.responseContractVersion === 3) {
      return response;
    }
    if (request.data.responseContractVersion === 2) {
      return listCenterAgentTasksResponseV2Schema.parse({
        ...response,
        tasks: response.tasks.map(projectTaskResponseV2),
      });
    }
    return listCenterAgentTasksResponseV1Schema.parse({
      ...response,
      tasks: response.tasks.map(projectTaskResponseV1),
    });
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

export async function rpcGetCenterAgentTask(
  env: CoreBindings,
  input: GetCenterAgentTaskRpcInput
): Promise<CenterAgentTaskDetailRpcResponse> {
  const request = getCenterAgentTaskRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task request is invalid.");
  }
  const membership = await requireWebMembership(env, request.data.context);
  try {
    const response = getCenterAgentTaskResponseSchema.parse(
      await createTaskService(env).get({
        organizationId: membership.organizationId,
        requesterUserId: membership.userId,
        taskId: request.data.taskId,
      })
    );
    return projectTaskDetailResponse(
      response,
      request.data.responseContractVersion
    );
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

export async function rpcContinueCenterAgentTask(
  env: CoreBindings,
  input: ContinueCenterAgentTaskRpcInput
): Promise<CenterAgentTaskDetailRpcResponse> {
  const request = continueCenterAgentTaskRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task continuation is invalid.");
  }
  const membership = await requireWebMembership(env, request.data.context);
  try {
    const response = mutateCenterAgentTaskResponseSchema.parse(
      await createTaskService(env).continue({
        expectedVersion: request.data.expectedVersion,
        idempotencyKey: request.data.idempotencyKey,
        organizationId: membership.organizationId,
        requesterUserId: membership.userId,
        taskId: request.data.taskId,
        text: request.data.text,
      })
    );
    return projectTaskDetailResponse(
      response,
      request.data.responseContractVersion
    );
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

export async function rpcStopCenterAgentTask(
  env: CoreBindings,
  input: StopCenterAgentTaskRpcInput
): Promise<CenterAgentTaskDetailRpcResponse> {
  const request = stopCenterAgentTaskRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task stop request is invalid.");
  }
  const membership = await requireWebMembership(env, request.data.context);
  try {
    const response = mutateCenterAgentTaskResponseSchema.parse(
      await createTaskService(env).stop({
        expectedVersion: request.data.expectedVersion,
        organizationId: membership.organizationId,
        requesterUserId: membership.userId,
        taskId: request.data.taskId,
      })
    );
    return projectTaskDetailResponse(
      response,
      request.data.responseContractVersion
    );
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

export async function rpcRetryCenterAgentTask(
  env: CoreBindings,
  input: RetryCenterAgentTaskRpcInput
): Promise<CenterAgentTaskDetailRpcResponse> {
  const request = retryCenterAgentTaskRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task retry request is invalid.");
  }
  const membership = await requireWebMembership(env, request.data.context);
  try {
    const response = mutateCenterAgentTaskResponseSchema.parse(
      await createTaskService(env).retry({
        expectedVersion: request.data.expectedVersion,
        idempotencyKey: request.data.idempotencyKey,
        organizationId: membership.organizationId,
        requesterUserId: membership.userId,
        taskId: request.data.taskId,
      })
    );
    return projectTaskDetailResponse(
      response,
      request.data.responseContractVersion
    );
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

/**
 * Read-only model-visible canonical Task list for the verified represented
 * member. Requester-private Phase 1 semantics: only the requester's own Tasks.
 */
export async function rpcCenterAgentListTasksTool(
  env: CoreBindings,
  input: CenterAgentListTasksToolRpcInput
): Promise<ListCenterAgentTasksResponse> {
  const request = centerAgentListTasksToolRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task list request is invalid.");
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      request.data.context,
      request.data.speakerMember
    );
  try {
    const response = listCenterAgentTasksResponseSchema.parse(
      await createTaskService(env).list({
        ...(request.data.cursor ? { cursor: request.data.cursor } : {}),
        limit: request.data.limit,
        organizationId: authorization.activeOrganization.organizationId,
        requesterUserId: representedHuman.userId,
        status: request.data.status,
      })
    );
    await writeCenterAgentAuditEntry({
      action: "read_agent_tasks",
      authorization,
      onBehalfOfProfileId: representedHuman.profileId,
      resource: null,
    });
    return response;
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

/** Read-only model-visible canonical Task detail/history projection. */
export async function rpcCenterAgentGetTaskTool(
  env: CoreBindings,
  input: CenterAgentGetTaskToolRpcInput
): Promise<CenterAgentTaskDetail> {
  const request = centerAgentGetTaskToolRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task request is invalid.");
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      request.data.context,
      request.data.speakerMember
    );
  try {
    const response = getCenterAgentTaskResponseSchema.parse(
      await createTaskService(env).get({
        organizationId: authorization.activeOrganization.organizationId,
        requesterUserId: representedHuman.userId,
        taskId: request.data.taskId,
      })
    );
    await writeCenterAgentAuditEntry({
      action: "read_agent_tasks",
      authorization,
      onBehalfOfProfileId: representedHuman.profileId,
      resource: { type: "center_agent_task", id: request.data.taskId },
    });
    return response;
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

export async function rpcCenterAgentCreateTask(
  env: CoreBindings,
  input: CenterAgentCreateTaskToolRpcInput
): Promise<CreateCenterAgentTaskResponse> {
  const request = centerAgentCreateTaskToolRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw invalidInput("Task creation is invalid.");
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      request.data.context,
      request.data.speakerMember
    );
  try {
    const detail = await createTaskService(env).create({
      goal: request.data.goal,
      idempotencyKey: request.data.idempotencyKey,
      organizationId: authorization.activeOrganization.organizationId,
      parentSubmissionId: request.data.submissionId,
      requesterUserId: representedHuman.userId,
      title: request.data.title,
    });
    return createCenterAgentTaskResponseSchema.parse({ task: detail.task });
  } catch (error) {
    throwTaskApplicationError(error);
  }
}

function createTaskService(env: CoreBindings) {
  const taskDb = requireTaskDb(env);
  const deliveryDb = wakeEvidenceDb(env);
  const taskInboxDb = inboxDb(env);
  if (!(deliveryDb && taskInboxDb)) {
    throw createCoreRpcHttpError({
      code: "center_agent_task.store_unavailable",
      reason: "Center Agent Tasks are unavailable.",
      status: 503,
    });
  }
  return createCenterAgentTaskService({
    db: taskDb,
    inboxDb: taskInboxDb,
    runtime: createCenterAgentTaskNativeRuntimePort({ deliveryDb, env }),
  });
}

function projectTaskDetailResponse(
  response: CenterAgentTaskDetail,
  responseContractVersion: CenterAgentTaskResponseContractVersion | undefined
): CenterAgentTaskDetailRpcResponse {
  if (responseContractVersion === 3) {
    return response;
  }
  if (responseContractVersion === 2) {
    return getCenterAgentTaskResponseV2Schema.parse({
      ...response,
      task: projectTaskResponseV2(response.task),
    });
  }
  return getCenterAgentTaskResponseV1Schema.parse({
    ...response,
    task: projectTaskResponseV1(response.task),
  });
}

function projectTaskResponseV1(
  task: CenterAgentTask
): CenterAgentTaskResponseV1 {
  const versionTwoTask = projectTaskResponseV2(task);
  const {
    executionEvidence: _,
    outcome: _outcome,
    phase: _phase,
    state: _state,
    ...versionOneTask
  } = versionTwoTask;
  return centerAgentTaskResponseV1Schema.parse(versionOneTask);
}

function projectTaskResponseV2(
  task: CenterAgentTask
): CenterAgentTaskResponseV2 {
  const origin =
    task.origin.kind === "message_channel"
      ? {
          destination: task.origin.destination,
          kind: task.origin.kind,
        }
      : { kind: task.origin.kind };
  return centerAgentTaskResponseV2Schema.parse({ ...task, origin });
}

async function requireWebMembership(
  env: CoreBindings,
  context: ListCenterAgentTasksRpcInput["context"]
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
  return membership;
}

function requireTaskDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "center_agent_task.store_unavailable",
      reason: "Center Agent Tasks are unavailable.",
      status: 503,
    });
  }
  return db;
}

function invalidInput(reason: string): Error {
  return createCoreRpcHttpError({
    code: "invalid_payload",
    reason,
    status: 400,
  });
}

function throwTaskApplicationError(error: unknown): never {
  if (error instanceof CenterAgentTaskApplicationError) {
    throw createCoreRpcHttpError({
      code: error.code,
      reason: error.message,
      status: error.status,
    });
  }
  throw error;
}
