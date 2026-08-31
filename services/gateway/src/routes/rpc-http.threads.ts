import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_SPACE_ADDRESSING_VERSION,
  toErrorMessage,
} from "@openmeld/gateway-contract";
import {
  getSpaceThreadResponseSchema,
  listSpaceThreadEventsResponseSchema,
  listSpaceThreadSignalsQuerySchema,
  listSpaceThreadSignalsResponseSchema,
  listSpaceThreadsResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  formatAuditValue,
  readSpacePasswordHeader,
  resolveGatewayStructuredRpcErrorResponse,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";

const THREAD_ROUTES = [
  "/v1/spaces/:spaceId/threads",
  "/v1/spaces/:spaceId/threads/:threadId",
  "/v1/spaces/:spaceId/threads/:threadId/events",
  "/v1/spaces/:spaceId/threads/:threadId/signals",
] as const;

export function registerThreadRoutes(app: Hono<HonoBindings>): void {
  app.get(THREAD_ROUTES[0], (c) => handleListThreads(c));
  app.post(THREAD_ROUTES[0], (c) => proxyThreadRequest(c, THREAD_ROUTES[0]));
  app.get(THREAD_ROUTES[1], (c) => handleGetThread(c));
  app.get(THREAD_ROUTES[2], (c) => handleListThreadEvents(c));
  app.get(THREAD_ROUTES[3], (c) => handleListThreadSignals(c));
  app.post(THREAD_ROUTES[3], (c) => proxyThreadRequest(c, THREAD_ROUTES[3]));
}

function handleListThreads(c: Context<HonoBindings>): Promise<Response> {
  const parsed = readSpaceRoute(c, THREAD_ROUTES[0], "GET");
  if (!parsed.ok) {
    return Promise.resolve(parsed.response);
  }
  const { spaceId } = parsed;
  return executePublicRpcRoute({
    c,
    route: THREAD_ROUTES[0],
    method: "GET",
    includeLegacySpaceAddressingWireFields: true,
    execute: async () =>
      await c.var.coreRpc.listSpaceThreads(
        {
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        },
        OPENMELD_SPACE_ADDRESSING_VERSION
      ),
    responseSchema: listSpaceThreadsResponseSchema,
  });
}

function handleGetThread(c: Context<HonoBindings>): Promise<Response> {
  const parsed = readSpaceThreadRoute(c, THREAD_ROUTES[1], "GET");
  if (!parsed.ok) {
    return Promise.resolve(parsed.response);
  }
  const { spaceId, threadId } = parsed;
  return executePublicRpcRoute({
    c,
    route: THREAD_ROUTES[1],
    method: "GET",
    includeLegacySpaceAddressingWireFields: true,
    execute: async () =>
      await c.var.coreRpc.getSpaceThread(
        {
          spaceId,
          threadId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        },
        OPENMELD_SPACE_ADDRESSING_VERSION
      ),
    responseSchema: getSpaceThreadResponseSchema,
  });
}

function handleListThreadEvents(c: Context<HonoBindings>): Promise<Response> {
  const parsed = readSpaceThreadRoute(c, THREAD_ROUTES[2], "GET");
  if (!parsed.ok) {
    return Promise.resolve(parsed.response);
  }
  const { spaceId, threadId } = parsed;
  return executePublicRpcRoute({
    c,
    route: THREAD_ROUTES[2],
    method: "GET",
    includeLegacySpaceAddressingWireFields: true,
    execute: async () =>
      await c.var.coreRpc.listSpaceThreadEvents({
        spaceId,
        threadId,
        spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
      }),
    responseSchema: listSpaceThreadEventsResponseSchema,
  });
}

function handleListThreadSignals(c: Context<HonoBindings>): Promise<Response> {
  const parsed = readSpaceThreadRoute(c, THREAD_ROUTES[3], "GET");
  if (!parsed.ok) {
    return Promise.resolve(parsed.response);
  }
  const { spaceId, threadId } = parsed;
  const parsedQuery = listSpaceThreadSignalsQuerySchema.safeParse({
    afterSignalId: c.req.query("afterSignalId"),
    limit: c.req.query("limit"),
  });
  if (!parsedQuery.success) {
    return Promise.resolve(
      respondPublicBadRequest({
        c,
        route: THREAD_ROUTES[3],
        method: "GET",
        code: "invalid_payload",
        message:
          parsedQuery.error.issues[0]?.message ??
          "thread signals query is invalid",
      })
    );
  }
  return executePublicRpcRoute({
    c,
    route: THREAD_ROUTES[3],
    method: "GET",
    includeLegacySpaceAddressingWireFields: true,
    execute: async () =>
      await c.var.coreRpc.listSpaceThreadSignals(
        {
          ...parsedQuery.data,
          spaceId,
          threadId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        },
        OPENMELD_SPACE_ADDRESSING_VERSION
      ),
    responseSchema: listSpaceThreadSignalsResponseSchema,
  });
}

function readSpaceRoute(
  c: Context<HonoBindings>,
  route: string,
  method: "GET"
): { ok: true; spaceId: string } | { ok: false; response: Response } {
  const rawSpaceId = c.req.param("spaceId");
  const parsedSpace = parseSpaceRouteParams(rawSpaceId);
  if (!parsedSpace.ok) {
    return {
      ok: false,
      response: respondPublicBadRequest({
        c,
        route,
        method,
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      }),
    };
  }
  return { ok: true, spaceId: parsedSpace.value.spaceId };
}

function readSpaceThreadRoute(
  c: Context<HonoBindings>,
  route: string,
  method: "GET"
):
  | { ok: true; spaceId: string; threadId: string }
  | { ok: false; response: Response } {
  const parsedSpace = readSpaceRoute(c, route, method);
  if (!parsedSpace.ok) {
    return parsedSpace;
  }
  const threadId = String(c.req.param("threadId") ?? "").trim();
  if (!threadId) {
    return {
      ok: false,
      response: respondPublicBadRequest({
        c,
        route,
        method,
        code: "invalid_payload",
        message: "threadId is required",
      }),
    };
  }
  return { ok: true, spaceId: parsedSpace.spaceId, threadId };
}

async function proxyThreadRequest(
  c: Context<HonoBindings>,
  route: string
): Promise<Response> {
  const context = c.var.openMeldRequestContext;
  const startedAt = c.var.startedAt;
  const method = c.req.method;
  const spaceId = c.req.param("spaceId");
  const headers = applyOpenMeldRequestContextHeaders(
    new Headers(c.req.raw.headers),
    {
      requestContext: context,
    }
  );
  const spacePassword = readSpacePasswordHeader(c.req.raw.headers);
  if (spacePassword !== undefined) {
    headers.set(OPENMELD_HEADER_SPACE_PASSWORD, spacePassword);
  }

  const upstreamRequest = new Request(c.req.url, {
    body: method === "GET" || method === "HEAD" ? null : c.req.raw.body,
    headers,
    method,
  });

  try {
    const response = await c.var.coreRpc.fetch(upstreamRequest);
    logAuditEvent({
      event: "http.forward",
      route,
      method,
      spaceId,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      ...contextAuditFields(context),
    });
    return new Response(response.body, response);
  } catch (error) {
    const structuredError = resolveGatewayStructuredRpcErrorResponse({
      err: error,
      requestId: context.actorContext.requestId,
    });
    if (structuredError) {
      return jsonErrorResponse(structuredError);
    }
    logAuditEvent({
      event: "http.forward.error",
      route,
      method,
      spaceId,
      status: 502,
      errorCode: "upstream_unreachable",
      latencyMs: Date.now() - startedAt,
      ...contextAuditFields(context),
    });
    return jsonErrorResponse({
      status: 502,
      code: "upstream_unreachable",
      message: toErrorMessage(error),
      requestId: context.actorContext.requestId,
    });
  }
}
