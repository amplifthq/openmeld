import type {
  CreateCenterAgentRoutineBody,
  CreateCenterAgentRoutineResponse,
  DeleteCenterAgentRoutineResponse,
  ListCenterAgentRoutineRunsQuery,
  ListCenterAgentRoutineRunsResponse,
  ListCenterAgentRoutinesManagementResponse,
  ListCenterAgentRoutinesResponse,
  ListCenterAgentRoutineTargetSpacesResponse,
  OpenMeldRequestContext,
  PauseCenterAgentRoutineResponse,
  ResumeCenterAgentRoutineResponse,
  UpdateCenterAgentRoutineBody,
  UpdateCenterAgentRoutineResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type RoutineRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ListRoutinesInput = RoutineRequestInput;
export type ListRoutineTargetSpacesInput = RoutineRequestInput;
export type CreateRoutineInput = RoutineRequestInput &
  CreateCenterAgentRoutineBody;
export type UpdateRoutineInput = RoutineRequestInput &
  UpdateCenterAgentRoutineBody & { routineId: string };
export type RoutineMutationInput = RoutineRequestInput & { routineId: string };
export type ListRoutineRunsInput = RoutineRequestInput &
  ListCenterAgentRoutineRunsQuery & { routineId: string };

export type RoutinesApi = {
  listRoutines: (
    input?: ListRoutinesInput
  ) => Promise<ListCenterAgentRoutinesResponse>;
  listRoutineManagement: (
    input?: ListRoutinesInput
  ) => Promise<ListCenterAgentRoutinesManagementResponse>;
  listRoutineTargetSpaces: (
    input?: ListRoutineTargetSpacesInput
  ) => Promise<ListCenterAgentRoutineTargetSpacesResponse>;
  createRoutine: (
    input: CreateRoutineInput
  ) => Promise<CreateCenterAgentRoutineResponse>;
  updateRoutine: (
    input: UpdateRoutineInput
  ) => Promise<UpdateCenterAgentRoutineResponse>;
  pauseRoutine: (
    input: RoutineMutationInput
  ) => Promise<PauseCenterAgentRoutineResponse>;
  resumeRoutine: (
    input: RoutineMutationInput
  ) => Promise<ResumeCenterAgentRoutineResponse>;
  deleteRoutine: (
    input: RoutineMutationInput
  ) => Promise<DeleteCenterAgentRoutineResponse>;
  listRoutineRuns: (
    input: ListRoutineRunsInput
  ) => Promise<ListCenterAgentRoutineRunsResponse>;
};

export type CreateRoutinesApi = (
  client: OpenMeldApiClientFoundation
) => RoutinesApi;
