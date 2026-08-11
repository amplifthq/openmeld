import {
  applyOpenMeldRequestContextHeaders,
  jsonErrorResponse,
  toErrorMessage,
  wsErrorFrame,
} from "@openmeld/gateway-contract";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];
type WebSocketFrame = string | ArrayBuffer;

const PREPARE_TOKEN_HEADER = "x-openmeld-prepare-token";

const createWebSocketPair = (): AcceptableWebSocketPair => {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
};

export function registerPrepareSessionStreamRoute(
  app: Hono<HonoBindings>
): void {
  app.get("/v1/prepare/sessions/:prepareSessionId/stream", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonErrorResponse({
        status: 400,
        code: "bad_request",
        message: "expected websocket",
        requestId: c.var.ingressOpenMeldContext.requestId,
      });
    }

    const role = c.req.query("role");
    if (role !== "web" && role !== "terminal") {
      return jsonErrorResponse({
        status: 400,
        code: "invalid_payload",
        message: "invalid prepare session stream role",
        requestId: c.var.ingressOpenMeldContext.requestId,
      });
    }

    const prepareSessionId = String(
      c.req.param("prepareSessionId") ?? ""
    ).trim();
    if (!prepareSessionId) {
      return jsonErrorResponse({
        status: 400,
        code: "invalid_payload",
        message: "invalid prepare session id",
        requestId: c.var.ingressOpenMeldContext.requestId,
      });
    }

    let closed = false;
    let upstream: AcceptableWebSocket | null = null;
    const pendingClientFrames: Array<string | ArrayBuffer> = [];
    const closeBoth = (code: number, reason: string): void => {
      if (closed) {
        return;
      }
      closed = true;
      safeClose(server, code, reason);
      if (upstream) {
        safeClose(upstream, code, reason);
      }
    };

    const [client, server] = createWebSocketPair();
    server.accept();
    server.addEventListener("message", (event) => {
      const frame = readWebSocketFrame(event.data);
      if (!frame) {
        return;
      }
      if (!upstream) {
        pendingClientFrames.push(frame);
        return;
      }
      if (!sendWebSocketFrame(upstream, frame)) {
        closeBoth(1011, "upstream_send_failed");
      }
    });
    server.addEventListener("close", () => closeBoth(1000, "client_closed"));
    server.addEventListener("error", () => closeBoth(1011, "client_error"));

    const upstreamUrl = new URL(c.req.url);
    upstreamUrl.pathname = `/v1/prepare/sessions/${encodeURIComponent(
      prepareSessionId
    )}/stream`;
    upstreamUrl.search = `?role=${encodeURIComponent(role)}`;

    const upstreamHeaders =
      role === "web"
        ? applyOpenMeldRequestContextHeaders(
            new Headers({ Upgrade: "websocket" }),
            {
              requestContext: c.var.openMeldRequestContext,
            }
          )
        : new Headers({
            Upgrade: "websocket",
            [PREPARE_TOKEN_HEADER]: c.req.header(PREPARE_TOKEN_HEADER) ?? "",
          });

    const upstreamResponse = await Promise.resolve(
      c.var.coreRpc.fetch(
        new Request(upstreamUrl.toString(), {
          headers: upstreamHeaders,
          method: "GET",
        })
      )
    ).catch((error) => {
      server.send(
        wsErrorFrame({
          code: "upstream_unreachable",
          message: toErrorMessage(error),
          requestId: c.var.ingressOpenMeldContext.requestId,
        })
      );
      closeBoth(1011, "upstream_unreachable");
      return null;
    });

    if (!upstreamResponse) {
      return new Response(null, { status: 101, webSocket: client });
    }

    if (upstreamResponse.status !== 101 || !upstreamResponse.webSocket) {
      closeBoth(1011, "upstream_http_rejected");
      return upstreamResponse;
    }

    upstream = upstreamResponse.webSocket as AcceptableWebSocket;
    upstream.addEventListener("message", (event) => {
      const frame = readWebSocketFrame(event.data);
      if (!frame) {
        return;
      }
      if (!sendWebSocketFrame(server, frame)) {
        closeBoth(1011, "client_send_failed");
      }
    });
    upstream.addEventListener("close", (event) =>
      closeBoth(event.code, event.reason || "upstream_closed")
    );
    upstream.addEventListener("error", () => closeBoth(1011, "upstream_error"));
    upstream.accept();

    flushPendingFrames({
      frames: pendingClientFrames,
      isClosed: () => closed,
      onSendFailure: () => closeBoth(1011, "upstream_send_failed"),
      target: upstream,
    });

    return new Response(null, { status: 101, webSocket: client });
  });
}

function safeClose(webSocket: WebSocket, code: number, reason: string): void {
  try {
    webSocket.close(code, reason);
  } catch {
    // Socket may already be closed.
  }
}

function readWebSocketFrame(data: unknown): WebSocketFrame | null {
  if (typeof data === "string" || data instanceof ArrayBuffer) {
    return data;
  }
  return null;
}

function sendWebSocketFrame(
  webSocket: WebSocket,
  frame: WebSocketFrame
): boolean {
  try {
    webSocket.send(frame);
    return true;
  } catch {
    return false;
  }
}

function flushPendingFrames(input: {
  frames: WebSocketFrame[];
  isClosed: () => boolean;
  onSendFailure: () => void;
  target: WebSocket;
}): void {
  while (input.frames.length > 0 && !input.isClosed()) {
    const frame = input.frames.shift();
    if (frame && !sendWebSocketFrame(input.target, frame)) {
      input.onSendFailure();
    }
  }
}
