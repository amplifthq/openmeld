import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { OpenMeldDaemonControlPlaneContext } from "@openmeld/local-execution";
import { buildAuthenticatedControlPlaneResponse } from "@openmeld/local-execution";
import {
  OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
  openMeldDaemonControlPlaneResponseSchema,
} from "@openmeld/schemas";
import { resolveDaemonControlPlaneEndpoint } from "../../config/daemon-state";

const MAX_CONTROL_PLANE_REQUEST_SIZE_BYTES = 64 * 1024;

type DaemonControlPlaneTokenSource =
  | {
      expectedToken: string;
      resolveExpectedToken?: never;
    }
  | {
      expectedToken?: never;
      resolveExpectedToken: () => Promise<string> | string;
    };

export async function startLocalDaemonControlPlaneServer(
  input: DaemonControlPlaneTokenSource & {
    endpoint?: string;
    getContext: () =>
      | Promise<OpenMeldDaemonControlPlaneContext>
      | OpenMeldDaemonControlPlaneContext;
  }
): Promise<{
  close: () => Promise<void>;
  endpoint: string;
}> {
  const endpoint = input.endpoint ?? resolveDaemonControlPlaneEndpoint();
  const resolveExpectedToken = buildExpectedTokenResolver(input);
  if (process.platform !== "win32") {
    await rm(endpoint, { force: true }).catch(() => undefined);
  }

  const server = createServer((socket) => {
    let buffer = "";
    let handled = false;

    const respond = (request: unknown) => {
      const requestId = readOptionalRequestId(request);
      buildResponse({
        getContext: input.getContext,
        request,
        requestId,
        resolveExpectedToken,
      }).then((response) => {
        socket.end(`${JSON.stringify(response)}\n`);
      });
    };

    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      const normalizedChunk =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (handled) {
        return;
      }
      if (wouldExceedMaxControlPlaneRequestSize(buffer, normalizedChunk)) {
        handled = true;
        respondInvalidRequest(socket);
        return;
      }
      buffer += normalizedChunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      handled = true;
      const rawRequest = buffer.slice(0, newlineIndex).trim();
      if (!rawRequest) {
        respondInvalidRequest(socket);
        return;
      }
      respond(parseJsonRequest(rawRequest));
    });
    socket.on("end", () => {
      if (handled) {
        return;
      }
      handled = true;
      // `data` already rejects oversized requests before appending to `buffer`.
      // Keep this end-path guard as a defensive last check for unexpected edge
      // cases where the stream closes without going through the normal newline path.
      if (isOversizedControlPlaneRequest(buffer)) {
        respondInvalidRequest(socket);
        return;
      }
      const rawRequest = buffer.trim();
      if (!rawRequest) {
        respondInvalidRequest(socket);
        return;
      }
      respond(parseJsonRequest(rawRequest));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    endpoint,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).finally(async () => {
        if (process.platform !== "win32") {
          await rm(endpoint, { force: true }).catch(() => undefined);
        }
      });
    },
  };
}

function buildExpectedTokenResolver(
  input: DaemonControlPlaneTokenSource
): () => Promise<string> | string {
  if (input.resolveExpectedToken) {
    return input.resolveExpectedToken;
  }
  return () => input.expectedToken;
}

async function buildResponse(input: {
  getContext: () =>
    | Promise<OpenMeldDaemonControlPlaneContext>
    | OpenMeldDaemonControlPlaneContext;
  request: unknown;
  requestId?: string;
  resolveExpectedToken: () => Promise<string> | string;
}) {
  try {
    const expectedToken = await input.resolveExpectedToken();
    const context = await input.getContext();
    return await buildAuthenticatedControlPlaneResponse({
      context,
      expectedToken,
      request: input.request,
    });
  } catch (error) {
    return buildControlPlaneErrorResponse({
      errorCode: resolveControlPlaneErrorCode(error),
      errorMessage:
        error instanceof Error ? error.message : "local daemon control failed",
      requestId: input.requestId,
    });
  }
}

function respondInvalidRequest(socket: import("node:net").Socket) {
  const response = buildControlPlaneErrorResponse({
    errorCode: "service.invalid_request",
    errorMessage: "invalid daemon control-plane request",
  });
  socket.end(`${JSON.stringify(response)}\n`);
}

function wouldExceedMaxControlPlaneRequestSize(
  buffer: string,
  chunk: string
): boolean {
  return (
    Buffer.byteLength(buffer, "utf8") + Buffer.byteLength(chunk, "utf8") >
    MAX_CONTROL_PLANE_REQUEST_SIZE_BYTES
  );
}

function isOversizedControlPlaneRequest(buffer: string): boolean {
  return (
    Buffer.byteLength(buffer, "utf8") > MAX_CONTROL_PLANE_REQUEST_SIZE_BYTES
  );
}

function parseJsonRequest(rawRequest: string): unknown {
  try {
    return JSON.parse(rawRequest) as unknown;
  } catch {
    return null;
  }
}

function readOptionalRequestId(request: unknown): string | undefined {
  if (!request || typeof request !== "object") {
    return undefined;
  }
  const requestId = (request as { requestId?: unknown }).requestId;
  if (typeof requestId !== "string") {
    return undefined;
  }
  const normalized = requestId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function buildControlPlaneErrorResponse(input: {
  errorCode: string;
  errorMessage: string;
  requestId?: string;
}) {
  const parsed = openMeldDaemonControlPlaneResponseSchema.safeParse({
    v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    code: "service.error",
    payload: {
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    },
  });
  if (!parsed.success) {
    throw new Error("invalid daemon control-plane error response");
  }
  return parsed.data;
}

function resolveControlPlaneErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return String((error as { code?: string }).code);
  }
  if (error instanceof Error && error.message === "auth.unauthenticated") {
    return "auth.unauthenticated";
  }
  if (
    error instanceof Error &&
    error.message === "invalid daemon control-plane request"
  ) {
    return "service.invalid_request";
  }
  if (
    error instanceof Error &&
    error.message === "invalid daemon control-plane response"
  ) {
    return "service.invalid_response";
  }
  return "service.internal";
}
