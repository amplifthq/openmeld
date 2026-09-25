import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
} from "@openmeld/gateway-contract";
import type { Context, Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { resolveGatewayStructuredRpcErrorResponse } from "./rpc-http.helpers";

const ROOT_ROUTE = "/v1/organizations/current/files/:location";
const MULTIPART_ROUTE = `${ROOT_ROUTE}/file-uploads/:uploadId`;
const FOLDERS_ROUTE = `${ROOT_ROUTE}/folders`;
const ENTRY_ROUTE = `${ROOT_ROUTE}/:entryId`;
const CONTENT_ROUTE = `${ENTRY_ROUTE}/content`;
const REVISIONS_ROUTE = `${ENTRY_ROUTE}/revisions`;
const RESTORE_ROUTE = `${ENTRY_ROUTE}/restore`;

export function registerFileRootRoutes(app: Hono<HonoBindings>): void {
  app.get(ROOT_ROUTE, (c) => forward(c, ROOT_ROUTE));
  app.post(ROOT_ROUTE, (c) => forward(c, ROOT_ROUTE));
  app.post(MULTIPART_ROUTE, (c) => forward(c, MULTIPART_ROUTE));
  app.post(FOLDERS_ROUTE, (c) => forward(c, FOLDERS_ROUTE));
  app.get(REVISIONS_ROUTE, (c) => forward(c, REVISIONS_ROUTE));
  app.get(CONTENT_ROUTE, (c) => forward(c, CONTENT_ROUTE));
  app.on("HEAD", CONTENT_ROUTE, (c) => forward(c, CONTENT_ROUTE));
  app.put(CONTENT_ROUTE, (c) => forward(c, CONTENT_ROUTE));
  app.get(ENTRY_ROUTE, (c) => forward(c, ENTRY_ROUTE));
  app.patch(ENTRY_ROUTE, (c) => forward(c, ENTRY_ROUTE));
  app.delete(ENTRY_ROUTE, (c) => forward(c, ENTRY_ROUTE));
  app.post(RESTORE_ROUTE, (c) => forward(c, RESTORE_ROUTE));
}

async function forward(
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
