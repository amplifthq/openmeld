import {
  applyOpenMeldRequestContextHeaders,
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";

const DAEMON_STREAM_UPSTREAM_CONNECT_TIMEOUT_MS = 15_000;

export function registerDaemonStreamRoute(app: Hono<HonoBindings>): void {
  app.get("/v1/daemon/stream", async (c) => {
    const context = c.var.openMeldRequestContext;
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
    upstreamUrl.pathname = "/v1/daemon/stream";

    const upstreamConnectAbortController = new AbortController();

    const upstreamHeaders = applyOpenMeldRequestContextHeaders(
      new Headers({ Upgrade: "websocket" }),
      {
        requestContext: context,
      }
    );
    forwardRecognizedLocalCapabilityHeaders({
      source: c.req.raw.headers,
      target: upstreamHeaders,
    });

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: "GET",
      headers: upstreamHeaders,
      signal: upstreamConnectAbortController.signal,
    });

    let upstreamResp: Response;
    try {
      upstreamResp = await withTimeout(
        () => Promise.resolve(c.var.coreRpc.fetch(upstreamRequest)),
        {
          timeoutMs: DAEMON_STREAM_UPSTREAM_CONNECT_TIMEOUT_MS,
          timeoutMessage: `core daemon stream upgrade timeout after ${String(
            DAEMON_STREAM_UPSTREAM_CONNECT_TIMEOUT_MS
          )}ms`,
          onTimeout: (timeoutMessage) => {
            if (!upstreamConnectAbortController.signal.aborted) {
              upstreamConnectAbortController.abort(new Error(timeoutMessage));
            }
          },
        }
      );
    } catch (err) {
      const isTimeout = isTimeoutError(err);
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/daemon/stream",
        method: "GET",
        status: isTimeout ? 504 : 502,
        errorCode: isTimeout ? "upstream_timeout" : "upstream_unreachable",
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      return jsonErrorResponse({
        status: isTimeout ? 504 : 502,
        code: "upstream_unreachable",
        message: toErrorMessage(err),
        requestId: context.actorContext.requestId,
      });
    }

    if (upstreamResp.status !== 101) {
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/daemon/stream",
        method: "GET",
        status: upstreamResp.status,
        errorCode: `upstream_http_${upstreamResp.status}`,
        profileKind: resolvedProfileKind,
        ...contextAuditFields(context),
      });
      return withRequestIdHeader(upstreamResp, context.actorContext.requestId);
    }

    if (!upstreamResp.webSocket) {
      logAuditEvent({
        event: "ws.reject",
        route: "/v1/daemon/stream",
        method: "GET",
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

    logAuditEvent({
      event: "ws.open",
      route: "/v1/daemon/stream",
      method: "GET",
      profileKind: resolvedProfileKind,
      ...contextAuditFields(context),
    });

    return upstreamResp;
  });
}

function forwardRecognizedLocalCapabilityHeaders(input: {
  source: Headers;
  target: Headers;
}): void {
  if (
    input.source.get(OPENMELD_RUNTIME_CAPABILITIES_HEADER) ===
    COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
  ) {
    input.target.set(
      OPENMELD_RUNTIME_CAPABILITIES_HEADER,
      COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
    );
  }
  if (
    input.source.get(OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER) ===
    LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
  ) {
    input.target.set(
      OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
      LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
    );
  }
}

type TimeoutOptions = {
  timeoutMs: number;
  timeoutMessage: string;
  onTimeout?: (timeoutMessage: string) => void;
};

const withTimeout = async <T>(
  runPromise: () => Promise<T>,
  { timeoutMs, timeoutMessage, onTimeout }: TimeoutOptions
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const promise = runPromise();
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout?.(timeoutMessage);
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const isTimeoutError = (error: unknown): boolean => {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("timeout");
};
