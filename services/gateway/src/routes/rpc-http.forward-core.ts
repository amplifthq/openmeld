import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
} from "@openmeld/gateway-contract";
import type { Context } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { resolveGatewayStructuredRpcErrorResponse } from "./rpc-http.helpers";

export async function forwardCoreHttp(
  c: Context<HonoBindings>,
  route: string
): Promise<Response> {
  const context = c.var.openMeldRequestContext;
  const method = c.req.method;
  const startedAt = c.var.startedAt;
  const headers = applyOpenMeldRequestContextHeaders(new Headers(), {
    requestContext: context,
  });
  for (const name of ["accept", "content-type", "range", "if-range"] as const) {
    const value = c.req.raw.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  try {
    const response = await c.var.coreRpc.fetch(
      new Request(c.req.url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? null : c.req.raw.body,
      })
    );
    logAuditEvent({
      event: "http.forward",
      route,
      method,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      ...contextAuditFields(context),
    });
    return new Response(response.body, response);
  } catch (error) {
    const structured = resolveGatewayStructuredRpcErrorResponse({
      err: error,
      requestId: context.actorContext.requestId,
    });
    if (structured) {
      return jsonErrorResponse(structured);
    }
    logAuditEvent({
      event: "http.forward.error",
      route,
      method,
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
