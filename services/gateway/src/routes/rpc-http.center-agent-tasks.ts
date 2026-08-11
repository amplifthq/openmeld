import {
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER,
  centerAgentTaskResponseContractVersionHeaderSchema,
  centerAgentTaskRouteParamsSchema,
  continueCenterAgentTaskBodySchema,
  getCenterAgentTaskResponseSchema,
  getCenterAgentTaskResponseV1Schema,
  listCenterAgentTasksQuerySchema,
  listCenterAgentTasksResponseSchema,
  listCenterAgentTasksResponseV1Schema,
  mutateCenterAgentTaskResponseSchema,
  mutateCenterAgentTaskResponseV1Schema,
  retryCenterAgentTaskBodySchema,
  stopCenterAgentTaskBodySchema,
} from "@openmeld/schemas";
import type { CenterAgentTaskResponseContractVersion } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const TASKS_ROUTE = "/v1/organizations/current/center-agent/tasks";
const TASK_ROUTE = `${TASKS_ROUTE}/:taskId`;
const TASK_MESSAGES_ROUTE = `${TASK_ROUTE}/messages`;
const TASK_STOP_ROUTE = `${TASK_ROUTE}/stop`;
const TASK_RETRY_ROUTE = `${TASK_ROUTE}/retry`;

export function registerCenterAgentTaskRoutes(app: Hono<HonoBindings>): void {
  app.get(TASKS_ROUTE, (c) => {
    const query = listCenterAgentTasksQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(c, TASKS_ROUTE, "GET", query.error);
    }
    const responseContract = parseResponseContract(c, TASKS_ROUTE, "GET");
    if (!responseContract.ok) {
      return responseContract.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listCenterAgentTasks({
          ...query.data,
          context: buildCoreRpcContext(c),
          ...(responseContract.data
            ? { responseContractVersion: responseContract.data }
            : {}),
        }),
      method: "GET",
      responseSchema: responseContract.data
        ? listCenterAgentTasksResponseSchema
        : listCenterAgentTasksResponseV1Schema,
      route: TASKS_ROUTE,
    });
  });

  app.get(TASK_ROUTE, (c) => {
    const params = parseTaskParams(c, TASK_ROUTE, "GET");
    if (!params.ok) {
      return params.response;
    }
    const responseContract = parseResponseContract(c, TASK_ROUTE, "GET");
    if (!responseContract.ok) {
      return responseContract.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentTask({
          context: buildCoreRpcContext(c),
          ...(responseContract.data
            ? { responseContractVersion: responseContract.data }
            : {}),
          taskId: params.data.taskId,
        }),
      method: "GET",
      responseSchema: responseContract.data
        ? getCenterAgentTaskResponseSchema
        : getCenterAgentTaskResponseV1Schema,
      route: TASK_ROUTE,
    });
  });

  registerTaskMutation({
    app,
    bodySchema: continueCenterAgentTaskBodySchema,
    execute: (c, taskId, body, responseContractVersion) =>
      c.var.coreRpc.continueCenterAgentTask({
        ...body,
        context: buildCoreRpcContext(c),
        ...(responseContractVersion ? { responseContractVersion } : {}),
        taskId,
      }),
    route: TASK_MESSAGES_ROUTE,
  });
  registerTaskMutation({
    app,
    bodySchema: stopCenterAgentTaskBodySchema,
    execute: (c, taskId, body, responseContractVersion) =>
      c.var.coreRpc.stopCenterAgentTask({
        ...body,
        context: buildCoreRpcContext(c),
        ...(responseContractVersion ? { responseContractVersion } : {}),
        taskId,
      }),
    route: TASK_STOP_ROUTE,
  });
  registerTaskMutation({
    app,
    bodySchema: retryCenterAgentTaskBodySchema,
    execute: (c, taskId, body, responseContractVersion) =>
      c.var.coreRpc.retryCenterAgentTask({
        ...body,
        context: buildCoreRpcContext(c),
        ...(responseContractVersion ? { responseContractVersion } : {}),
        taskId,
      }),
    route: TASK_RETRY_ROUTE,
  });
}

function registerTaskMutation<T>(input: {
  app: Hono<HonoBindings>;
  bodySchema: z.ZodType<T>;
  execute: (
    c: Context<HonoBindings>,
    taskId: string,
    body: T,
    responseContractVersion: CenterAgentTaskResponseContractVersion | undefined
  ) => Promise<unknown>;
  route: string;
}): void {
  input.app.post(input.route, async (c) => {
    const params = parseTaskParams(c, input.route, "POST");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseTaskBody(c, input.route, input.bodySchema);
    if (!body.ok) {
      return body.response;
    }
    const responseContract = parseResponseContract(c, input.route, "POST");
    if (!responseContract.ok) {
      return responseContract.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await input.execute(
          c,
          params.data.taskId,
          body.data,
          responseContract.data
        ),
      method: "POST",
      responseSchema: responseContract.data
        ? mutateCenterAgentTaskResponseSchema
        : mutateCenterAgentTaskResponseV1Schema,
      route: input.route,
    });
  });
}

type ParseResult<T> = { data: T; ok: true } | { ok: false; response: Response };

function parseResponseContract(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<CenterAgentTaskResponseContractVersion | undefined> {
  const value = c.req.header(
    CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER
  );
  if (value === undefined) {
    return { data: undefined, ok: true };
  }
  const parsed =
    centerAgentTaskResponseContractVersionHeaderSchema.safeParse(value);
  return parsed.success
    ? { data: parsed.data, ok: true }
    : {
        ok: false,
        response: invalidPayloadResponse(c, route, method, parsed.error),
      };
}

function parseTaskParams(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<{ taskId: string }> {
  const parsed = centerAgentTaskRouteParamsSchema.safeParse({
    taskId: c.req.param("taskId"),
  });
  return parsed.success
    ? { data: parsed.data, ok: true }
    : {
        ok: false,
        response: invalidPayloadResponse(c, route, method, parsed.error),
      };
}

async function parseTaskBody<T>(
  c: Context<HonoBindings>,
  route: string,
  schema: z.ZodType<T>
): Promise<ParseResult<T>> {
  const body = await readJsonRequestBody(c.req.raw);
  if (!body.ok) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method: "POST",
        route,
      }),
    };
  }
  const parsed = schema.safeParse(body.value);
  return parsed.success
    ? { data: parsed.data, ok: true }
    : {
        ok: false,
        response: invalidPayloadResponse(c, route, "POST", parsed.error),
      };
}

function invalidPayloadResponse(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  error: z.ZodError
): Response {
  return respondBadRequest({
    c,
    code: "invalid_payload",
    message: error.issues[0]?.message ?? "Invalid Center Agent Task request.",
    method,
    route,
  });
}
