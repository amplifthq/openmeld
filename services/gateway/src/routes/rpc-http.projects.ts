import {
  archiveProjectBodySchema,
  archiveProjectResponseSchema,
  createProjectBodySchema,
  createProjectResponseSchema,
  listProjectsQuerySchema,
  listProjectsResponseSchema,
  localProjectControlConnectCandidateRequestSchema,
  localProjectControlConnectDeclaredPathRequestSchema,
  localProjectControlConnectOutcomeSchema,
  localProjectControlDiscoverProjectsRequestSchema,
  localProjectControlDiscoverProjectsResponseSchema,
  localProjectControlRemoveConnectionRequestSchema,
  localProjectControlRemoveConnectionResponseSchema,
  localProjectControlRemoveMissingConnectionsRequestSchema,
  localProjectControlRemoveMissingConnectionsResponseSchema,
  localProjectControlSetDefaultConnectionRequestSchema,
  localProjectControlSetDefaultConnectionResponseSchema,
  projectRouteParamsSchema,
  updateProjectBodySchema,
  updateProjectResponseSchema,
} from "@openmeld/schemas";
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

const PROJECTS_ROUTE = "/v1/organizations/current/projects";
const PROJECT_ROUTE = `${PROJECTS_ROUTE}/:projectId`;
const CURRENT_PROJECTS_ROUTE = "/v1/local-runtimes/current/projects";
const DISCOVER_PROJECTS_ROUTE = `${CURRENT_PROJECTS_ROUTE}/discover`;
const CONNECT_CANDIDATE_ROUTE = `${CURRENT_PROJECTS_ROUTE}/connect-candidate`;
const CONNECT_DECLARED_PATH_ROUTE = `${CURRENT_PROJECTS_ROUTE}/connect-declared-path`;
const SET_DEFAULT_CONNECTION_ROUTE = `${CURRENT_PROJECTS_ROUTE}/connections/set-default`;
const REMOVE_CONNECTION_ROUTE = `${CURRENT_PROJECTS_ROUTE}/connections/remove`;
const REMOVE_MISSING_CONNECTIONS_ROUTE = `${CURRENT_PROJECTS_ROUTE}/connections/remove-missing`;

export function registerProjectRoutes(app: Hono<HonoBindings>): void {
  app.post(DISCOVER_PROJECTS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      DISCOVER_PROJECTS_ROUTE,
      "POST",
      localProjectControlDiscoverProjectsRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.discoverProjects({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlDiscoverProjectsResponseSchema,
      route: DISCOVER_PROJECTS_ROUTE,
    });
  });

  app.post(CONNECT_CANDIDATE_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      CONNECT_CANDIDATE_ROUTE,
      "POST",
      localProjectControlConnectCandidateRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.connectCandidate({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlConnectOutcomeSchema,
      route: CONNECT_CANDIDATE_ROUTE,
    });
  });

  app.post(CONNECT_DECLARED_PATH_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      CONNECT_DECLARED_PATH_ROUTE,
      "POST",
      localProjectControlConnectDeclaredPathRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.connectDeclaredPath({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlConnectOutcomeSchema,
      route: CONNECT_DECLARED_PATH_ROUTE,
    });
  });

  app.post(SET_DEFAULT_CONNECTION_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      SET_DEFAULT_CONNECTION_ROUTE,
      "POST",
      localProjectControlSetDefaultConnectionRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setDefaultConnection({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlSetDefaultConnectionResponseSchema,
      route: SET_DEFAULT_CONNECTION_ROUTE,
    });
  });

  app.post(REMOVE_CONNECTION_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      REMOVE_CONNECTION_ROUTE,
      "POST",
      localProjectControlRemoveConnectionRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.removeConnection({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlRemoveConnectionResponseSchema,
      route: REMOVE_CONNECTION_ROUTE,
    });
  });

  app.post(REMOVE_MISSING_CONNECTIONS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      REMOVE_MISSING_CONNECTIONS_ROUTE,
      "POST",
      localProjectControlRemoveMissingConnectionsRequestSchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.removeMissingConnections({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localProjectControlRemoveMissingConnectionsResponseSchema,
      route: REMOVE_MISSING_CONNECTIONS_ROUTE,
    });
  });

  app.get(PROJECTS_ROUTE, (c) => {
    const query = listProjectsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(c, PROJECTS_ROUTE, "GET", query.error);
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listProjects({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: listProjectsResponseSchema,
      route: PROJECTS_ROUTE,
    });
  });

  app.post(PROJECTS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      PROJECTS_ROUTE,
      "POST",
      createProjectBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createProject({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: createProjectResponseSchema,
      route: PROJECTS_ROUTE,
      successStatus: 201,
    });
  });

  app.patch(PROJECT_ROUTE, async (c) => {
    const params = parseProjectParams(c, PROJECT_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      PROJECT_ROUTE,
      "PATCH",
      updateProjectBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateProject({
          ...body.data,
          context: buildCoreRpcContext(c),
          projectId: params.data.projectId,
        }),
      method: "PATCH",
      responseSchema: updateProjectResponseSchema,
      route: PROJECT_ROUTE,
    });
  });

  app.delete(PROJECT_ROUTE, async (c) => {
    const params = parseProjectParams(c, PROJECT_ROUTE, "DELETE");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      PROJECT_ROUTE,
      "DELETE",
      archiveProjectBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.archiveProject({
          ...body.data,
          context: buildCoreRpcContext(c),
          projectId: params.data.projectId,
        }),
      method: "DELETE",
      responseSchema: archiveProjectResponseSchema,
      route: PROJECT_ROUTE,
    });
  });
}

type ParseResult<T> = { data: T; ok: true } | { ok: false; response: Response };

async function parseBody<T>(
  c: Context<HonoBindings>,
  route: string,
  method: "DELETE" | "PATCH" | "POST",
  schema: z.ZodType<T>,
  acceptMissingBody = false
): Promise<ParseResult<T>> {
  const body = await readJsonRequestBody(c.req.raw);
  if (!body.ok) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method,
        route,
      }),
    };
  }
  const value = acceptMissingBody && body.value === undefined ? {} : body.value;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function parseProjectParams(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<{ projectId: string }> {
  const parsed = projectRouteParamsSchema.safeParse({
    projectId: c.req.param("projectId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
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
    message: error.issues[0]?.message ?? "Invalid Project request.",
    method,
    route,
  });
}
