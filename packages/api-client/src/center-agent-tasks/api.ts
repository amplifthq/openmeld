import {
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION,
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER,
  centerAgentTaskRouteParamsSchema,
  continueCenterAgentTaskBodySchema,
  getCenterAgentTaskResponseSchema,
  listCenterAgentTasksQuerySchema,
  listCenterAgentTasksResponseSchema,
  mutateCenterAgentTaskResponseSchema,
  retryCenterAgentTaskBodySchema,
  stopCenterAgentTaskBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCenterAgentTaskMessagesPath,
  buildCenterAgentTaskPath,
  buildCenterAgentTaskRetryPath,
  buildCenterAgentTaskStopPath,
  buildCenterAgentTasksPath,
} from "./routes";
import type {
  CenterAgentTaskRequestInput,
  CreateCenterAgentTasksApi,
} from "./types";

export const createCenterAgentTasksApi: CreateCenterAgentTasksApi = (
  client: OpenMeldApiClientFoundation
) => ({
  list: async (input = {}) => {
    const query = requireValidInput(
      listCenterAgentTasksQuerySchema,
      {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      "Center Agent Task list request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      headers: responseContractHeaders(),
      invalidMessage: "invalid Center Agent Task list response",
      method: "GET",
      operation: "center_agent_task.list",
      schema: listCenterAgentTasksResponseSchema,
      url: buildCenterAgentTasksPath(query),
    });
  },
  get: async (input) => {
    const taskId = requireTaskId(input.taskId);
    return await client.requestJson({
      ...requestOptions(input),
      headers: responseContractHeaders(),
      invalidMessage: "invalid Center Agent Task response",
      method: "GET",
      operation: "center_agent_task.get",
      schema: getCenterAgentTaskResponseSchema,
      url: buildCenterAgentTaskPath(taskId),
    });
  },
  continue: async (input) => {
    const taskId = requireTaskId(input.taskId);
    const body = requireValidInput(
      continueCenterAgentTaskBodySchema,
      {
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        text: input.text,
      },
      "Center Agent Task message request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: responseContractHeaders("application/json"),
      invalidMessage: "invalid Center Agent Task response",
      method: "POST",
      operation: "center_agent_task.continue",
      schema: mutateCenterAgentTaskResponseSchema,
      url: buildCenterAgentTaskMessagesPath(taskId),
    });
  },
  stop: async (input) => {
    const taskId = requireTaskId(input.taskId);
    const body = requireValidInput(
      stopCenterAgentTaskBodySchema,
      { expectedVersion: input.expectedVersion },
      "Center Agent Task stop request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: responseContractHeaders("application/json"),
      invalidMessage: "invalid Center Agent Task response",
      method: "POST",
      operation: "center_agent_task.stop",
      schema: mutateCenterAgentTaskResponseSchema,
      url: buildCenterAgentTaskStopPath(taskId),
    });
  },
  retry: async (input) => {
    const taskId = requireTaskId(input.taskId);
    const body = requireValidInput(
      retryCenterAgentTaskBodySchema,
      {
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      },
      "Center Agent Task retry request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: responseContractHeaders("application/json"),
      invalidMessage: "invalid Center Agent Task response",
      method: "POST",
      operation: "center_agent_task.retry",
      schema: mutateCenterAgentTaskResponseSchema,
      url: buildCenterAgentTaskRetryPath(taskId),
    });
  },
});

function requireTaskId(value: string): string {
  return requireValidInput(
    centerAgentTaskRouteParamsSchema,
    { taskId: value },
    "Center Agent Task identifier is invalid."
  ).taskId;
}

function responseContractHeaders(contentType?: string): Record<string, string> {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    [CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER]: String(
      CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION
    ),
  };
}

function requestOptions(input: CenterAgentTaskRequestInput): {
  requestContext?: CenterAgentTaskRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid value."}`
    );
  }
  return parsed.data;
}
