import type { z } from "zod/v4";

type SchemaModule = typeof import("../../schemas/http/space-tasks");

export type SpaceTaskId = z.infer<SchemaModule["spaceTaskIdSchema"]>;
export type SpaceTaskPhase = z.infer<SchemaModule["spaceTaskPhaseSchema"]>;
export type SpaceTaskAction = z.infer<SchemaModule["spaceTaskActionSchema"]>;
export type SpaceTaskActor = z.infer<SchemaModule["spaceTaskActorSchema"]>;
export type SpaceTaskRequesterRepresentation = z.infer<
  SchemaModule["spaceTaskRequesterRepresentationSchema"]
>;
export type SpaceTaskResult = z.infer<SchemaModule["spaceTaskResultSchema"]>;
export type SpaceTaskReview = z.infer<SchemaModule["spaceTaskReviewSchema"]>;
export type SpaceTaskEventType = z.infer<
  SchemaModule["spaceTaskEventTypeSchema"]
>;
export type SpaceTaskEvent = z.infer<SchemaModule["spaceTaskEventSchema"]>;
export type SpaceTaskExternalWorkItem = z.infer<
  SchemaModule["spaceTaskExternalWorkItemSchema"]
>;
export type SpaceTask = z.infer<SchemaModule["spaceTaskSchema"]>;
export type CreateSpaceTaskBody = z.infer<
  SchemaModule["createSpaceTaskBodySchema"]
>;
export type MutateSpaceTaskBody = z.infer<
  SchemaModule["mutateSpaceTaskBodySchema"]
>;
export type SpaceTaskResponse = z.infer<
  SchemaModule["spaceTaskResponseSchema"]
>;
export type SpaceTaskDetailOptions = z.infer<
  SchemaModule["spaceTaskDetailOptionsSchema"]
>;
export type ListSpaceTasksQuery = z.infer<
  SchemaModule["listSpaceTasksQuerySchema"]
>;
export type ListSpaceTasksResponse = z.infer<
  SchemaModule["listSpaceTasksResponseSchema"]
>;
export type SpaceTaskMutationReceipt = z.infer<
  SchemaModule["spaceTaskMutationReceiptSchema"]
>;
export type SpaceTaskErrorCode = z.infer<
  SchemaModule["spaceTaskErrorCodeSchema"]
>;
