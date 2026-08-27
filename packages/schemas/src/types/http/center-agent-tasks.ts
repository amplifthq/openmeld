import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/center-agent-tasks");

export type CenterAgentTaskStatus = z.infer<
  Schemas["centerAgentTaskStatusSchema"]
>;
export type CenterAgentTaskState = z.infer<
  Schemas["centerAgentTaskStateSchema"]
>;
export type CenterAgentTaskPhase = z.infer<
  Schemas["centerAgentTaskPhaseSchema"]
>;
export type CenterAgentTaskOutcome = z.infer<
  Schemas["centerAgentTaskOutcomeSchema"]
>;
export type CenterAgentTaskExecutionEvidence = z.infer<
  Schemas["centerAgentTaskExecutionEvidenceSchema"]
>;
export type CenterAgentTaskResponseContractVersion = z.infer<
  Schemas["centerAgentTaskResponseContractVersionSchema"]
>;
export type CenterAgentTaskOrigin = z.infer<
  Schemas["centerAgentTaskOriginSchema"]
>;
export type CenterAgentTask = z.infer<Schemas["centerAgentTaskSchema"]>;
export type CenterAgentTaskResponseV1 = z.infer<
  Schemas["centerAgentTaskResponseV1Schema"]
>;
export type CenterAgentTaskResponseV2 = z.infer<
  Schemas["centerAgentTaskResponseV2Schema"]
>;
export type CenterAgentTaskAttempt = z.infer<
  Schemas["centerAgentTaskAttemptSchema"]
>;
export type CenterAgentTaskEventKind = z.infer<
  Schemas["centerAgentTaskEventKindSchema"]
>;
export type CenterAgentTaskEventActor = z.infer<
  Schemas["centerAgentTaskEventActorSchema"]
>;
export type CenterAgentTaskEvent = z.infer<
  Schemas["centerAgentTaskEventSchema"]
>;
export type CenterAgentTaskDetail = z.infer<
  Schemas["centerAgentTaskDetailSchema"]
>;
export type CenterAgentTaskDetailResponseV1 = z.infer<
  Schemas["centerAgentTaskDetailResponseV1Schema"]
>;
export type CenterAgentTaskDetailResponseV2 = z.infer<
  Schemas["centerAgentTaskDetailResponseV2Schema"]
>;
export type CenterAgentCreateTaskToolRpcInput = z.infer<
  Schemas["centerAgentCreateTaskToolRpcInputSchema"]
>;
export type CenterAgentListTasksToolRpcInput = z.infer<
  Schemas["centerAgentListTasksToolRpcInputSchema"]
>;
export type CenterAgentGetTaskToolRpcInput = z.infer<
  Schemas["centerAgentGetTaskToolRpcInputSchema"]
>;
export type CreateCenterAgentTaskResponse = z.infer<
  Schemas["createCenterAgentTaskResponseSchema"]
>;
export type ListCenterAgentTasksQuery = z.infer<
  Schemas["listCenterAgentTasksQuerySchema"]
>;
export type ListCenterAgentTasksResponse = z.infer<
  Schemas["listCenterAgentTasksResponseSchema"]
>;
export type ListCenterAgentTasksResponseV1 = z.infer<
  Schemas["listCenterAgentTasksResponseV1Schema"]
>;
export type ListCenterAgentTasksResponseV2 = z.infer<
  Schemas["listCenterAgentTasksResponseV2Schema"]
>;
export type ListCenterAgentTasksRpcResponse =
  | ListCenterAgentTasksResponse
  | ListCenterAgentTasksResponseV1
  | ListCenterAgentTasksResponseV2;
export type CenterAgentTaskRouteParams = z.infer<
  Schemas["centerAgentTaskRouteParamsSchema"]
>;
export type GetCenterAgentTaskResponse = z.infer<
  Schemas["getCenterAgentTaskResponseSchema"]
>;
export type CenterAgentTaskDetailRpcResponse =
  | CenterAgentTaskDetail
  | CenterAgentTaskDetailResponseV1
  | CenterAgentTaskDetailResponseV2;
export type ContinueCenterAgentTaskBody = z.infer<
  Schemas["continueCenterAgentTaskBodySchema"]
>;
export type StopCenterAgentTaskBody = z.infer<
  Schemas["stopCenterAgentTaskBodySchema"]
>;
export type RetryCenterAgentTaskBody = z.infer<
  Schemas["retryCenterAgentTaskBodySchema"]
>;
export type MutateCenterAgentTaskResponse = z.infer<
  Schemas["mutateCenterAgentTaskResponseSchema"]
>;
export type ListCenterAgentTasksRpcInput = z.infer<
  Schemas["listCenterAgentTasksRpcInputSchema"]
>;
export type GetCenterAgentTaskRpcInput = z.infer<
  Schemas["getCenterAgentTaskRpcInputSchema"]
>;
export type ContinueCenterAgentTaskRpcInput = z.infer<
  Schemas["continueCenterAgentTaskRpcInputSchema"]
>;
export type StopCenterAgentTaskRpcInput = z.infer<
  Schemas["stopCenterAgentTaskRpcInputSchema"]
>;
export type RetryCenterAgentTaskRpcInput = z.infer<
  Schemas["retryCenterAgentTaskRpcInputSchema"]
>;
