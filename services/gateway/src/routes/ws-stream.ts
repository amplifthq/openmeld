import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  OPENMELD_HEADER_SPACE_PASSWORD,
  toErrorMessage,
  withRequestIdHeader,
  wsErrorFrame,
} from "@openmeld/gateway-contract";
import { buildProfileDisplay } from "@openmeld/protocol";
import type { Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { createInitialState, handleClientFrame } from "../session";
import { readSpacePasswordHeader } from "./rpc-http.helpers";

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

const createWebSocketPair = (): AcceptableWebSocketPair => {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
};

export function registerWebSocketRoute(app: Hono<HonoBindings>): void {
  app.get("/v1/spaces/:spaceId/stream", async (c) => {
    const spaceId = c.req.param("spaceId");
    const context = c.var.openMeldRequestContext;
    const enforcedProfile = buildProfileDisplay({
      openMeldProfileId: c.var.resolvedProfile.openMeldProfileId,
      profileName: c.var.resolvedProfile.profileName,
      profileKind: c.var.resolvedProfile.profileKind,
      ownerUserId: c.var.resolvedProfile.ownerUserId,
      ownerName: c.var.resolvedProfile.ownerName,
      agentControllerRef: c.var.resolvedProfile.agentControllerRef,
      agentControllerConversationId:
        c.var.openMeldRequestContext.agentControllerConversationId,
    });
    const resolvedProfileKind = c.var.resolvedProfile.profileKind;

    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonErrorResponse({
        status: 400,
        code: "bad_request",
        message: "expected websocket",
        requestId: context.actorContext.requestId,
      });
    }

    const upstreamUrl = new URL(c.req.url);
    upstreamUrl.pathname = `/v1/spaces/${encodeURIComponent(spaceId)}/stream`;

    logAuditEvent({
      event: "ws.open",
      route: "/v1/spaces/:spaceId/stream",
      method: "GET",
      spaceId,
      profileKind: resolvedProfileKind,
      ...contextAuditFields(context),
    });

    const upstreamHeaders = applyOpenMeldRequestContextHeaders(
      new Headers({ Upgrade: "websocket" }),
      {
        requestContext: context,
      }
    );
    const password = readSpacePasswordHeader(c.req.raw.headers);
    if (password !== undefined) {
      upstreamHeaders.set(OPENMELD_HEADER_SPACE_PASSWORD, password);
    }

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: "GET",
      headers: upstreamHeaders,
    });

    // Stream is intentionally the exception: keep HTTP upgrade proxying via
    // coreRpc.fetch while non-stream routes use pure typed RPC methods.
    let upstreamResp: Response;
    try {
      upstreamResp = await Promise.resolve(
        c.var.coreRpc.fetch(upstreamRequest)
      );
    } catch (err) {
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/spaces/:spaceId/stream",
        method: "GET",
        spaceId,
        status: 502,
        errorCode: "upstream_unreachable",
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      return jsonErrorResponse({
        status: 502,
        code: "upstream_unreachable",
        message: toErrorMessage(err),
        requestId: context.actorContext.requestId,
      });
    }

    if (upstreamResp.status !== 101) {
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/spaces/:spaceId/stream",
        method: "GET",
        spaceId,
        status: upstreamResp.status,
        errorCode: `upstream_http_${upstreamResp.status}`,
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      return withRequestIdHeader(upstreamResp, context.actorContext.requestId);
    }

    const upstream = upstreamResp.webSocket as AcceptableWebSocket | null;
    if (!upstream) {
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/spaces/:spaceId/stream",
        method: "GET",
        spaceId,
        status: 502,
        errorCode: "upstream_no_websocket",
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      return jsonErrorResponse({
        status: 502,
        code: "upstream_error",
        message: "upstream did not upgrade websocket",
        requestId: context.actorContext.requestId,
      });
    }

    const [client, server] = createWebSocketPair();
    server.accept();
    upstream.accept();

    const state = createInitialState();
    let isClosed = false;

    const closeOnce = (code: number, reason: string) => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      logAuditEvent({
        event: "ws.close",
        route: "/v1/spaces/:spaceId/stream",
        method: "GET",
        spaceId,
        closeCode: code,
        reason,
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      try {
        server.close(code, reason);
      } catch {
        // ignore
      }
      try {
        upstream.close(code, reason);
      } catch {
        // ignore
      }
    };

    const sendToServer = (payload: string | ArrayBuffer): void => {
      if (isClosed) {
        return;
      }
      try {
        server.send(payload);
      } catch {
        closeOnce(1011, "client_send_failed");
      }
    };

    const sendToUpstream = (payload: string): void => {
      if (isClosed) {
        return;
      }
      try {
        upstream.send(payload);
      } catch {
        closeOnce(1011, "upstream_send_failed");
      }
    };

    server.addEventListener("message", (evt) => {
      if (typeof evt.data !== "string") {
        logAuditEvent({
          event: "ws.reject",
          route: "/v1/spaces/:spaceId/stream",
          method: "GET",
          spaceId,
          errorCode: "binary frame payload is not supported",
          profileKind: resolvedProfileKind,
          ...contextAuditFields(context),
        });
        sendToServer(
          wsErrorFrame({
            code: "invalid_payload",
            message: "binary frames are not supported",
            requestId: context.actorContext.requestId,
          })
        );
        return;
      }

      const raw = evt.data;
      const action = handleClientFrame(state, raw, {
        enforcedHelloProfile: enforcedProfile,
      });

      if (action.kind === "forward") {
        sendToUpstream(action.payload);
        return;
      }

      if (action.kind === "close") {
        logAuditEvent({
          event: "ws.reject",
          route: "/v1/spaces/:spaceId/stream",
          method: "GET",
          spaceId,
          errorCode: action.reason,
          profileKind: resolvedProfileKind,
          ...contextAuditFields(context),
        });
        // `handleClientFrame` currently emits `kind: "close"` only for the
        // mandatory first-frame hello violation (`hello_required`).
        // Keep this explicit payload for protocol compatibility; if new close
        // reasons are introduced, update this frame mapping together.
        sendToServer(
          wsErrorFrame({
            code: "hello_required",
            message: "first frame must be hello",
            requestId: context.actorContext.requestId,
          })
        );
        closeOnce(action.code, action.reason);
        return;
      }

      logAuditEvent({
        event: "ws.reject",
        route: "/v1/spaces/:spaceId/stream",
        method: "GET",
        spaceId,
        errorCode: action.error,
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      sendToServer(
        wsErrorFrame({
          code:
            action.error === "invalid_json"
              ? "invalid_json"
              : "invalid_payload",
          message: action.error,
          requestId: context.actorContext.requestId,
        })
      );
    });

    upstream.addEventListener("message", (evt) => {
      if (typeof evt.data !== "string") {
        logAuditEvent({
          event: "ws.reject",
          route: "/v1/spaces/:spaceId/stream",
          method: "GET",
          spaceId,
          errorCode: "upstream_binary_frame_ignored",
          profileKind: resolvedProfileKind,
          ...contextAuditFields(context),
        });
        sendToServer(
          wsErrorFrame({
            code: "invalid_payload",
            message: "binary frames are not supported",
            requestId: context.actorContext.requestId,
          })
        );
        return;
      }

      sendToServer(evt.data);
    });

    server.addEventListener("close", () => closeOnce(1000, "client_closed"));
    upstream.addEventListener("close", (evt) =>
      closeOnce(evt.code, evt.reason || "upstream_closed")
    );

    server.addEventListener("error", () => closeOnce(1011, "client_error"));
    upstream.addEventListener("error", () => closeOnce(1011, "upstream_error"));

    return new Response(null, { status: 101, webSocket: client });
  });
}
