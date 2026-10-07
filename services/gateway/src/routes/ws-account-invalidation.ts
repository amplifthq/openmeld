import {
  applyOpenMeldRequestContextHeaders,
  jsonErrorResponse,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";

type AcceptedWebSocket = WebSocket & { accept(): void };

export function registerAccountInvalidationStreamRoute(
  app: Hono<HonoBindings>
): void {
  app.get("/v1/account/invalidation-stream", async (c) => {
    const context = c.var.openMeldRequestContext;
    const requestId = context.actorContext.requestId;
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonErrorResponse({
        status: 400,
        code: "bad_request",
        message: "expected websocket",
        requestId,
      });
    }
    const upstreamHeaders = applyOpenMeldRequestContextHeaders(
      new Headers({ Upgrade: "websocket" }),
      { requestContext: context }
    );
    const upstream = await Promise.resolve(
      c.var.coreRpc.fetch(new Request(c.req.url, { headers: upstreamHeaders }))
    );
    if (upstream.status !== 101) {
      return withRequestIdHeader(upstream, requestId);
    }
    const upstreamSocket = upstream.webSocket as AcceptedWebSocket | null;
    if (!upstreamSocket) {
      return jsonErrorResponse({
        status: 502,
        code: "upstream_error",
        message: "upstream did not upgrade websocket",
        requestId,
      });
    }
    // biome-ignore lint/correctness/noUndeclaredVariables: Provided by Workers.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    upstreamSocket.accept();
    let closed = false;
    const close = (code: number, reason: string) => {
      if (closed) {
        return;
      }
      closed = true;
      // Reserved local-only codes cannot be sent in a Close frame.
      const wireCode = [1004, 1005, 1006, 1015].includes(code) ? 1011 : code;
      try {
        server.close(wireCode, reason);
      } catch {
        // Both endpoints may already have closed.
      }
      try {
        upstreamSocket.close(wireCode, reason);
      } catch {
        // Both endpoints may already have closed.
      }
    };
    server.addEventListener("message", (event) => {
      if (event.data !== "ping") {
        close(1003, "Only keepalive pings are accepted");
        return;
      }
      try {
        upstreamSocket.send("ping");
      } catch {
        close(1011, "upstream send failed");
      }
    });
    upstreamSocket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        close(1003, "Only text frames are accepted");
        return;
      }
      try {
        server.send(event.data);
      } catch {
        close(1011, "client send failed");
      }
    });
    server.addEventListener("close", (event) =>
      close(event.code, event.reason || "client closed")
    );
    upstreamSocket.addEventListener("close", (event) =>
      close(event.code, event.reason || "upstream closed")
    );
    server.addEventListener("error", () => close(1011, "client error"));
    upstreamSocket.addEventListener("error", () =>
      close(1011, "upstream error")
    );
    return new Response(null, { status: 101, webSocket: client });
  });
}
