import {
  CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT,
  centerAgentRoutineMutationLegacyV1ResponseSchema,
  createCenterAgentRoutineResponseSchema,
  createCenterAgentRoutineRpcInputSchema,
  deleteCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineRpcInputSchema,
  listCenterAgentRoutineRunsLegacyV1ResponseSchema,
  listCenterAgentRoutineRunsResponseSchema,
  listCenterAgentRoutineRunsRpcInputSchema,
  listCenterAgentRoutinesLegacyV1ResponseSchema,
  listCenterAgentRoutinesManagementResponseSchema,
  listCenterAgentRoutinesResponseSchema,
  listCenterAgentRoutinesRpcInputSchema,
  listCenterAgentRoutineTargetSpacesResponseSchema,
  listCenterAgentRoutineTargetSpacesRpcInputSchema,
  pauseCenterAgentRoutineRpcInputSchema,
  resumeCenterAgentRoutineRpcInputSchema,
  updateCenterAgentRoutineRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentRoutine,
  CenterAgentRoutineContract,
  CenterAgentRoutineRun,
  CreateCenterAgentRoutineRpcInput as CreateRoutineInput,
  DeleteCenterAgentRoutineResponse,
  DeleteCenterAgentRoutineRpcInput as DeleteRoutineInput,
  ListCenterAgentRoutineTargetSpacesResponse,
  ListCenterAgentRoutineRunsRpcInput as ListRoutineRunsInput,
  ListCenterAgentRoutinesRpcInput as ListRoutinesInput,
  ListCenterAgentRoutineTargetSpacesRpcInput as ListRoutineTargetSpacesInput,
  PauseCenterAgentRoutineRpcInput as PauseRoutineInput,
  ResumeCenterAgentRoutineRpcInput as ResumeRoutineInput,
  UpdateCenterAgentRoutineRpcInput as UpdateRoutineInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { prepareHumanRoutineRequest } from "./routine-request-preparation";
import {
  parseRoutinePayload,
  parseRoutineResponse,
} from "./routine-rpc-contract";
import type { RoutineActor, RoutineService } from "./routine-service";

export type {
  CreateRoutineInput,
  DeleteRoutineInput,
  ListRoutineRunsInput,
  ListRoutinesInput,
  ListRoutineTargetSpacesInput,
  PauseRoutineInput,
  ResumeRoutineInput,
  UpdateRoutineInput,
};

export async function rpcListRoutines(
  env: CoreBindings,
  input: ListRoutinesInput
) {
  const request = parseRoutinePayload(
    listCenterAgentRoutinesRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRoutineRequest(
    env,
    request.context
  );
  if (request.contract === CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT) {
    return parseRoutineResponse(
      listCenterAgentRoutinesManagementResponseSchema,
      await service.listManagement(actor)
    );
  }
  const response = await service.list(actor);
  if (isPracticalRoutineContract(request.contract)) {
    return parseRoutineResponse(
      listCenterAgentRoutinesResponseSchema,
      response
    );
  }
  return parseRoutineResponse(listCenterAgentRoutinesLegacyV1ResponseSchema, {
    ...response,
    routines: response.routines
      .filter(isLegacyV1Routine)
      .map(projectLegacyV1Routine),
  });
}

export async function rpcListRoutineTargetSpaces(
  env: CoreBindings,
  input: ListRoutineTargetSpacesInput
): Promise<ListCenterAgentRoutineTargetSpacesResponse> {
  const request = parseRoutinePayload(
    listCenterAgentRoutineTargetSpacesRpcInputSchema,
    input
  );
  const { actor, representedHuman, service } = await prepareHumanRoutineRequest(
    env,
    request.context
  );
  return parseRoutineResponse(
    listCenterAgentRoutineTargetSpacesResponseSchema,
    await service.listTargetSpaces(actor, representedHuman)
  );
}

export async function rpcCreateRoutine(
  env: CoreBindings,
  input: CreateRoutineInput
) {
  const request = parseRoutinePayload(
    createCenterAgentRoutineRpcInputSchema,
    input
  );
  const { context, contract, ...body } = request;
  const { actor, representedHuman, service } = await prepareHumanRoutineRequest(
    env,
    context
  );
  return projectRoutineMutationResponse(
    {
      routine: await service.create(actor, representedHuman, body),
    },
    contract
  );
}

export async function rpcUpdateRoutine(
  env: CoreBindings,
  input: UpdateRoutineInput
) {
  const request = parseRoutinePayload(
    updateCenterAgentRoutineRpcInputSchema,
    input
  );
  const { context, contract, routineId, ...body } = request;
  const { actor, representedHuman, service } = await prepareHumanRoutineRequest(
    env,
    context
  );
  await requireLegacyClientCanManageRoutine({
    actor,
    contract,
    routineId,
    service,
  });
  return projectRoutineMutationResponse(
    {
      routine: await service.update(actor, representedHuman, routineId, body),
    },
    contract
  );
}

export async function rpcPauseRoutine(
  env: CoreBindings,
  input: PauseRoutineInput
) {
  const request = parseRoutinePayload(
    pauseCenterAgentRoutineRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRoutineRequest(
    env,
    request.context
  );
  await requireLegacyClientCanManageRoutine({
    actor,
    contract: request.contract,
    routineId: request.routineId,
    service,
  });
  return projectRoutineMutationResponse(
    { routine: await service.pause(actor, request.routineId) },
    request.contract
  );
}

export async function rpcResumeRoutine(
  env: CoreBindings,
  input: ResumeRoutineInput
) {
  const request = parseRoutinePayload(
    resumeCenterAgentRoutineRpcInputSchema,
    input
  );
  const { actor, representedHuman, service } = await prepareHumanRoutineRequest(
    env,
    request.context
  );
  await requireLegacyClientCanManageRoutine({
    actor,
    contract: request.contract,
    routineId: request.routineId,
    service,
  });
  return projectRoutineMutationResponse(
    {
      routine: await service.resume(actor, representedHuman, request.routineId),
    },
    request.contract
  );
}

export async function rpcDeleteRoutine(
  env: CoreBindings,
  input: DeleteRoutineInput
): Promise<DeleteCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    deleteCenterAgentRoutineRpcInputSchema,
    input
  );
  const { actor, service } = await prepareHumanRoutineRequest(
    env,
    request.context
  );
  await requireLegacyClientCanManageRoutine({
    actor,
    contract: request.contract,
    routineId: request.routineId,
    service,
  });
  return parseRoutineResponse(
    deleteCenterAgentRoutineResponseSchema,
    await service.delete(actor, request.routineId)
  );
}

export async function rpcListRoutineRuns(
  env: CoreBindings,
  input: ListRoutineRunsInput
) {
  const request = parseRoutinePayload(
    listCenterAgentRoutineRunsRpcInputSchema,
    input
  );
  const { context, contract, routineId, ...query } = request;
  const { actor, service } = await prepareHumanRoutineRequest(env, context);
  await requireLegacyClientCanManageRoutine({
    actor,
    contract,
    routineId,
    service,
  });
  const response = await service.listRuns(actor, routineId, query);
  if (isPracticalRoutineContract(contract)) {
    return parseRoutineResponse(
      listCenterAgentRoutineRunsResponseSchema,
      response
    );
  }
  return parseRoutineResponse(
    listCenterAgentRoutineRunsLegacyV1ResponseSchema,
    { ...response, runs: response.runs.map(projectLegacyV1RoutineRun) }
  );
}

function isPracticalRoutineContract(
  contract: CenterAgentRoutineContract | undefined
): boolean {
  return contract === "practical-v2";
}

function isLegacyV1Routine(routine: CenterAgentRoutine): boolean {
  return (
    routine.scheduleKind === "cron" &&
    routine.destinationKind === "space" &&
    routine.status !== "completed" &&
    routine.cronExpression !== null &&
    routine.targetSpaceId !== null &&
    routine.timezone !== null
  );
}

function projectLegacyV1Routine(routine: CenterAgentRoutine) {
  return {
    canManage: routine.canManage,
    createdAtMs: routine.createdAtMs,
    createdByUserId: routine.createdByUserId,
    cronExpression: routine.cronExpression,
    id: routine.id,
    instructions: routine.instructions,
    lastRun: routine.lastRun,
    name: routine.name,
    nextDueAt: routine.nextDueAt,
    organizationId: routine.organizationId,
    scheduleKind: routine.scheduleKind,
    status: routine.status,
    targetSpaceId: routine.targetSpaceId,
    timezone: routine.timezone,
    updatedAtMs: routine.updatedAtMs,
    updatedByUserId: routine.updatedByUserId,
  };
}

function projectLegacyV1RoutineRun(run: CenterAgentRoutineRun) {
  return {
    failureCode: run.failureCode,
    failureDetail: run.failureDetail,
    finishedAtMs: run.finishedAtMs,
    id: run.id,
    nativeDeliveryId: run.nativeDeliveryId,
    organizationId: run.organizationId,
    publishedSignalId: run.publishedSignalId,
    routineId: run.routineId,
    scheduledFor: run.scheduledFor,
    startedAtMs: run.startedAtMs,
    status: run.status,
  };
}

function projectRoutineMutationResponse(
  response: { routine: CenterAgentRoutine },
  contract: CenterAgentRoutineContract | undefined
) {
  if (isPracticalRoutineContract(contract)) {
    return parseRoutineResponse(
      createCenterAgentRoutineResponseSchema,
      response
    );
  }
  return parseRoutineResponse(
    centerAgentRoutineMutationLegacyV1ResponseSchema,
    {
      routine: projectLegacyV1Routine(response.routine),
    }
  );
}

async function requireLegacyClientCanManageRoutine(input: {
  actor: RoutineActor;
  contract: CenterAgentRoutineContract | undefined;
  routineId: string;
  service: RoutineService;
}): Promise<void> {
  if (isPracticalRoutineContract(input.contract)) {
    return;
  }
  const routine = (await input.service.list(input.actor)).routines.find(
    (candidate) => candidate.id === input.routineId
  );
  if (routine && !isLegacyV1Routine(routine)) {
    throw createCoreRpcHttpError({
      code: "routine.client_update_required",
      reason:
        "Update OpenMeld before managing a one-time or Slack-thread Routine.",
      status: 409,
    });
  }
}
