import {
  centerAgentCreateRoutineToolRpcInputSchema,
  centerAgentDeleteRoutineToolRpcInputSchema,
  centerAgentListRoutinesToolRpcInputSchema,
  centerAgentPauseRoutineToolRpcInputSchema,
  centerAgentResumeRoutineToolRpcInputSchema,
  centerAgentUpdateRoutineToolRpcInputSchema,
  createCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineResponseSchema,
  listCenterAgentRoutinesResponseSchema,
  pauseCenterAgentRoutineResponseSchema,
  resumeCenterAgentRoutineResponseSchema,
  updateCenterAgentRoutineResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentCreateRoutineToolRpcInput,
  CenterAgentDeleteRoutineToolRpcInput,
  CenterAgentListRoutinesToolRpcInput,
  CenterAgentPauseRoutineToolRpcInput,
  CenterAgentResumeRoutineToolRpcInput,
  CenterAgentUpdateRoutineToolRpcInput,
  CreateCenterAgentRoutineResponse,
  DeleteCenterAgentRoutineResponse,
  ListCenterAgentRoutinesResponse,
  PauseCenterAgentRoutineResponse,
  ResumeCenterAgentRoutineResponse,
  UpdateCenterAgentRoutineResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { prepareCenterAgentRoutineRequest } from "./routine-request-preparation";
import {
  parseRoutinePayload,
  parseRoutineResponse,
} from "./routine-rpc-contract";

export async function rpcCenterAgentListRoutines(
  env: CoreBindings,
  input: CenterAgentListRoutinesToolRpcInput
): Promise<ListCenterAgentRoutinesResponse> {
  const request = parseRoutinePayload(
    centerAgentListRoutinesToolRpcInputSchema,
    input
  );
  const { actor, service } = await prepareCenterAgentRoutineRequest(
    env,
    request.context,
    request.speakerMember
  );
  return parseRoutineResponse(
    listCenterAgentRoutinesResponseSchema,
    await service.list(actor)
  );
}

export async function rpcCenterAgentCreateRoutine(
  env: CoreBindings,
  input: CenterAgentCreateRoutineToolRpcInput
): Promise<CreateCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    centerAgentCreateRoutineToolRpcInputSchema,
    input
  );
  const { context, speakerMember, ...body } = request;
  const { actor, representedHuman, service } =
    await prepareCenterAgentRoutineRequest(env, context, speakerMember);
  return parseRoutineResponse(createCenterAgentRoutineResponseSchema, {
    routine: await service.create(actor, representedHuman, body),
  });
}

export async function rpcCenterAgentUpdateRoutine(
  env: CoreBindings,
  input: CenterAgentUpdateRoutineToolRpcInput
): Promise<UpdateCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    centerAgentUpdateRoutineToolRpcInputSchema,
    input
  );
  const { context, routineId, speakerMember, ...body } = request;
  const { actor, representedHuman, service } =
    await prepareCenterAgentRoutineRequest(env, context, speakerMember);
  return parseRoutineResponse(updateCenterAgentRoutineResponseSchema, {
    routine: await service.update(actor, representedHuman, routineId, body),
  });
}

export async function rpcCenterAgentPauseRoutine(
  env: CoreBindings,
  input: CenterAgentPauseRoutineToolRpcInput
): Promise<PauseCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    centerAgentPauseRoutineToolRpcInputSchema,
    input
  );
  const { actor, service } = await prepareCenterAgentRoutineRequest(
    env,
    request.context,
    request.speakerMember
  );
  return parseRoutineResponse(pauseCenterAgentRoutineResponseSchema, {
    routine: await service.pause(actor, request.routineId),
  });
}

export async function rpcCenterAgentResumeRoutine(
  env: CoreBindings,
  input: CenterAgentResumeRoutineToolRpcInput
): Promise<ResumeCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    centerAgentResumeRoutineToolRpcInputSchema,
    input
  );
  const { actor, representedHuman, service } =
    await prepareCenterAgentRoutineRequest(
      env,
      request.context,
      request.speakerMember
    );
  return parseRoutineResponse(resumeCenterAgentRoutineResponseSchema, {
    routine: await service.resume(actor, representedHuman, request.routineId),
  });
}

export async function rpcCenterAgentDeleteRoutine(
  env: CoreBindings,
  input: CenterAgentDeleteRoutineToolRpcInput
): Promise<DeleteCenterAgentRoutineResponse> {
  const request = parseRoutinePayload(
    centerAgentDeleteRoutineToolRpcInputSchema,
    input
  );
  const { actor, service } = await prepareCenterAgentRoutineRequest(
    env,
    request.context,
    request.speakerMember
  );
  return parseRoutineResponse(
    deleteCenterAgentRoutineResponseSchema,
    await service.delete(actor, request.routineId)
  );
}
