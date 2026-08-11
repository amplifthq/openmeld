import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import type { Context, Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { resolveGatewayStructuredRpcErrorResponse } from "./rpc-http.helpers";

const DAEMON_ROUTE_OBSERVATION_ROUTE = "/v1/daemon/routes/:profileId";

export function registerDaemonRouteObservationRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(DAEMON_ROUTE_OBSERVATION_ROUTE, (c) =>
    proxyDaemonRouteObservationRequest({
      c,
      route: DAEMON_ROUTE_OBSERVATION_ROUTE,
    })
  );
}

async function proxyDaemonRouteObservationRequest(input: {
  c: Context<HonoBindings>;
  route: string;
}): Promise<Response> {
  const { c, route } = input;
  const context = c.var.openMeldRequestContext;
  const startedAt = c.var.startedAt;

  const upstreamHeaders = applyOpenMeldRequestContextHeaders(new Headers(), {
    requestContext: context,
  });
  const accept = c.req.raw.headers.get("accept");
  if (accept) {
    upstreamHeaders.set("accept", accept);
  }

  const upstreamRequest = new Request(c.req.url, {
    method: "GET",
    headers: upstreamHeaders,
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await c.var.coreRpc.fetch(upstreamRequest);
  } catch (error) {
    const structuredError = resolveGatewayStructuredRpcErrorResponse({
      err: error,
      requestId: context.actorContext.requestId,
    });
    if (structuredError) {
      logAuditEvent({
        event: "http.forward",
        route,
        method: "GET",
        status: structuredError.status,
        latencyMs: Date.now() - startedAt,
        ...contextAuditFields(context),
      });

      return jsonErrorResponse(structuredError);
    }

    logAuditEvent({
      event: "http.forward.error",
      route,
      method: "GET",
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

  logAuditEvent({
    event: "http.forward",
    route,
    method: "GET",
    status: upstreamResponse.status,
    latencyMs: Date.now() - startedAt,
    ...contextAuditFields(context),
  });

  return withRequestIdHeader(upstreamResponse, context.actorContext.requestId);
}
