import type {
  ContinueCenterAgentTaskBody,
  GetCenterAgentTaskResponse,
  ListCenterAgentTasksQuery,
  ListCenterAgentTasksResponse,
  MutateCenterAgentTaskResponse,
  OpenMeldRequestContext,
  RetryCenterAgentTaskBody,
  StopCenterAgentTaskBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type CenterAgentTaskRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ListCenterAgentTasksInput = CenterAgentTaskRequestInput &
  ListCenterAgentTasksQuery;
export type GetCenterAgentTaskInput = CenterAgentTaskRequestInput & {
  taskId: string;
};
export type ContinueCenterAgentTaskInput = CenterAgentTaskRequestInput &
  ContinueCenterAgentTaskBody & { taskId: string };
export type StopCenterAgentTaskInput = CenterAgentTaskRequestInput &
  StopCenterAgentTaskBody & { taskId: string };
export type RetryCenterAgentTaskInput = CenterAgentTaskRequestInput &
  RetryCenterAgentTaskBody & { taskId: string };

export type CenterAgentTasksApi = {
  list: (
    input?: ListCenterAgentTasksInput
  ) => Promise<ListCenterAgentTasksResponse>;
  get: (input: GetCenterAgentTaskInput) => Promise<GetCenterAgentTaskResponse>;
  continue: (
    input: ContinueCenterAgentTaskInput
  ) => Promise<MutateCenterAgentTaskResponse>;
  stop: (
    input: StopCenterAgentTaskInput
  ) => Promise<MutateCenterAgentTaskResponse>;
  retry: (
    input: RetryCenterAgentTaskInput
  ) => Promise<MutateCenterAgentTaskResponse>;
};

export type CreateCenterAgentTasksApi = (
  client: OpenMeldApiClientFoundation
) => CenterAgentTasksApi;
