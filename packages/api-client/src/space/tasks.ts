import {
  createSpaceTaskBodySchema,
  listSpaceTasksResponseSchema,
  mutateSpaceTaskBodySchema,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
  spaceTaskMutationReceiptSchema,
  spaceTaskResponseSchema,
} from "@openmeld/schemas";
import type {
  CreateSpaceTaskBody,
  MutateSpaceTaskBody,
  SpaceTaskDetailOptions,
  SpaceTaskPhase,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export async function listSpaceTasks(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { phase?: SpaceTaskPhase }
) {
  const query = new URLSearchParams({
    taskContractVersion: String(SPACE_TASK_WORKFLOW_CONTRACT_VERSION),
    ...(input.phase ? { phase: input.phase } : {}),
  }).toString();
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/tasks?${query}`,
    operation: "space.tasks.list",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: listSpaceTasksResponseSchema,
    invalidMessage: "Invalid Space Tasks response.",
  });
}

export async function getSpaceTask(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & SpaceTaskDetailOptions & { taskId: string }
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/tasks/${encodeURIComponent(input.taskId)}?${new URLSearchParams(
      {
        taskContractVersion: String(SPACE_TASK_WORKFLOW_CONTRACT_VERSION),
        ...(input.includeAffordances ? { includeAffordances: "1" } : {}),
      }
    ).toString()}`,
    operation: "space.tasks.get",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceTaskResponseSchema,
    invalidMessage: "Invalid Space Task response.",
  });
}

export async function createSpaceTask(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { body: CreateSpaceTaskBody }
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/tasks?taskContractVersion=${SPACE_TASK_WORKFLOW_CONTRACT_VERSION}`,
    operation: "space.tasks.create",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createSpaceTaskBodySchema.parse(input.body)),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceTaskMutationReceiptSchema,
    invalidMessage: "Invalid Space Task creation response.",
  });
}

export async function mutateSpaceTask(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    taskId: string;
    body: MutateSpaceTaskBody;
  }
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/tasks/${encodeURIComponent(input.taskId)}?taskContractVersion=${SPACE_TASK_WORKFLOW_CONTRACT_VERSION}`,
    operation: "space.tasks.mutate",
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mutateSpaceTaskBodySchema.parse(input.body)),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceTaskMutationReceiptSchema,
    invalidMessage: "Invalid Space Task change response.",
  });
}
