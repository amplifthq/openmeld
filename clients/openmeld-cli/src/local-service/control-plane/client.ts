import { createConnection } from "node:net";
import type {
  OpenMeldDaemonControlPlaneRequest,
  OpenMeldDaemonConversationExecutionStatusPayload,
  OpenMeldDaemonConversationExecutionStatusRequestPayload,
  OpenMeldDaemonRequestAgentActivitySyncPayload,
  OpenMeldDaemonRequestAgentActivitySyncRequestPayload,
  OpenMeldDaemonServiceUpdateReadinessPayload,
  OpenMeldDaemonSetLocalAgentEnabledPayload,
  OpenMeldDaemonSetLocalAgentEnabledRequestPayload,
  OpenMeldDaemonShutdownRequestPayload,
  OpenMeldDaemonSyncRouteCatalogPayload,
  OpenMeldDaemonSyncRouteCatalogRequestPayload,
} from "@openmeld/schemas";
import {
  OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
  openMeldDaemonControlPlaneResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldDaemonControlPlaneResponse } from "@openmeld/schemas/types";
import {
  readDaemonControlPlaneToken,
  resolveDaemonControlPlaneEndpoint,
} from "../../config/daemon-state";

const DEFAULT_LOCAL_DAEMON_CONTROL_PLANE_TIMEOUT_MS = 5000;

export class LocalDaemonControlPlaneClientError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function sendLocalDaemonControlPlaneRequest(input: {
  endpoint?: string;
  request: OpenMeldDaemonControlPlaneRequest;
  timeoutMs?: number;
}): Promise<OpenMeldDaemonControlPlaneResponse> {
  const endpoint = input.endpoint ?? resolveDaemonControlPlaneEndpoint();
  const authToken = await readDaemonControlPlaneToken();
  if (!authToken) {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.auth_token_missing",
      "daemon control token is missing"
    );
  }

  const request = {
    ...input.request,
    authToken,
  } satisfies OpenMeldDaemonControlPlaneRequest;

  const rawResponse = await writeControlPlaneRequest({
    endpoint,
    request,
    timeoutMs: input.timeoutMs ?? DEFAULT_LOCAL_DAEMON_CONTROL_PLANE_TIMEOUT_MS,
  });
  const parsed =
    openMeldDaemonControlPlaneResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an invalid response"
    );
  }
  if (parsed.data.code === "service.error") {
    throw new LocalDaemonControlPlaneClientError(
      parsed.data.payload.errorCode,
      parsed.data.payload.errorMessage
    );
  }
  return parsed.data;
}

export async function requestLocalConversationExecutionStatus(input: {
  endpoint?: string;
  payload: OpenMeldDaemonConversationExecutionStatusRequestPayload;
  timeoutMs?: number;
}): Promise<OpenMeldDaemonConversationExecutionStatusPayload> {
  let response: OpenMeldDaemonControlPlaneResponse;
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "conversation_execution_status",
        payload: input.payload,
      },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.conversation_execution_status") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for conversation execution status"
    );
  }
  return response.payload;
}

export async function requestLocalSyncRouteCatalog(input: {
  endpoint?: string;
  payload: OpenMeldDaemonSyncRouteCatalogRequestPayload;
  timeoutMs?: number;
}): Promise<OpenMeldDaemonSyncRouteCatalogPayload> {
  let response: OpenMeldDaemonControlPlaneResponse;
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "sync_route_catalog",
        payload: input.payload,
      },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.sync_route_catalog") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for route catalog sync"
    );
  }
  return response.payload;
}

export async function requestLocalAgentActivitySync(input: {
  endpoint?: string;
  payload: OpenMeldDaemonRequestAgentActivitySyncRequestPayload;
  timeoutMs?: number;
}): Promise<OpenMeldDaemonRequestAgentActivitySyncPayload> {
  let response: OpenMeldDaemonControlPlaneResponse;
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "request_agent_activity_sync",
        payload: input.payload,
      },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.agent_activity_sync_requested") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for Agent Activity sync"
    );
  }
  return response.payload;
}

export async function requestLocalSetLocalAgentEnabled(input: {
  endpoint?: string;
  payload: OpenMeldDaemonSetLocalAgentEnabledRequestPayload;
  timeoutMs?: number;
}): Promise<OpenMeldDaemonSetLocalAgentEnabledPayload> {
  let response: OpenMeldDaemonControlPlaneResponse;
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "set_local_agent_enabled",
        payload: input.payload,
      },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.set_local_agent_enabled") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for local agent enablement"
    );
  }
  return response.payload;
}

export async function requestLocalDaemonShutdown(input: {
  endpoint?: string;
  onlyIfIdle?: true;
  payload: OpenMeldDaemonShutdownRequestPayload;
  timeoutMs?: number;
}): Promise<
  Extract<
    OpenMeldDaemonControlPlaneResponse,
    { code: "service.shutdown" }
  >["payload"]
> {
  let response: OpenMeldDaemonControlPlaneResponse;
  if (
    input.onlyIfIdle &&
    (input.payload.mode !== "graceful" || input.payload.accountAdmissionId)
  ) {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_request",
      "An idle update cannot force shutdown or change account ownership."
    );
  }
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: input.onlyIfIdle
        ? {
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            command: "shutdown_if_idle",
            payload: { gracePeriodMs: input.payload.gracePeriodMs },
          }
        : {
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            command: "shutdown",
            payload: input.payload,
          },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.shutdown") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for shutdown"
    );
  }
  return response.payload;
}

export async function requestLocalDaemonServiceUpdateReadiness(
  input: { endpoint?: string; timeoutMs?: number } = {}
): Promise<OpenMeldDaemonServiceUpdateReadinessPayload> {
  let response: OpenMeldDaemonControlPlaneResponse;
  try {
    response = await sendLocalDaemonControlPlaneRequest({
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "service_update_readiness",
      },
    });
  } catch (error) {
    throw rewriteDaemonControlPlaneContractMismatch(error);
  }
  if (response.code !== "service.update_readiness") {
    throw new LocalDaemonControlPlaneClientError(
      "daemon.control.invalid_response",
      "local daemon control returned an unexpected response for service update readiness"
    );
  }
  return response.payload;
}

function rewriteDaemonControlPlaneContractMismatch(error: unknown): unknown {
  if (
    error instanceof LocalDaemonControlPlaneClientError &&
    error.code === "service.invalid_request"
  ) {
    return new LocalDaemonControlPlaneClientError(
      "daemon.control.contract_mismatch",
      "local OpenMeld Service must be restarted because the daemon control-plane contract changed on this device"
    );
  }
  return error;
}

async function writeControlPlaneRequest(input: {
  endpoint: string;
  request: OpenMeldDaemonControlPlaneRequest;
  timeoutMs: number;
}): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(input.endpoint);
    let responseBuffer = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(deadline);
      socket.off("connect", handleConnect);
      socket.off("data", handleData);
      socket.off("end", handleEnd);
      socket.off("error", handleError);
    };
    const settle = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };
    const fail = (error: LocalDaemonControlPlaneClientError) => {
      settle(() => {
        socket.destroy();
        reject(error);
      });
    };

    const handleConnect = () => {
      socket.write(`${JSON.stringify(input.request)}\n`);
    };
    const handleData = (chunk: string) => {
      if (!responseBuffer && chunk.trim().length === 0) {
        return;
      }
      responseBuffer += chunk;
    };
    const handleEnd = () => {
      settle(() => {
        const rawResponse = responseBuffer.trim();
        if (!rawResponse) {
          reject(
            new LocalDaemonControlPlaneClientError(
              "daemon.control.empty_response",
              "local daemon control returned an empty response"
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(rawResponse) as unknown);
        } catch {
          reject(
            new LocalDaemonControlPlaneClientError(
              "daemon.control.invalid_json",
              "local daemon control returned malformed JSON"
            )
          );
        }
      });
    };
    const handleError = (error: Error | NodeJS.ErrnoException) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "daemon.control.connection_failed";
      fail(
        new LocalDaemonControlPlaneClientError(
          code === "ENOENT" || code === "ECONNREFUSED"
            ? "daemon.control.endpoint_missing"
            : code,
          error instanceof Error
            ? error.message
            : "failed to connect to local daemon control"
        )
      );
    };
    const handleTimeout = () => {
      fail(
        new LocalDaemonControlPlaneClientError(
          "daemon.control.timeout",
          `local daemon control timed out after ${String(input.timeoutMs)}ms`
        )
      );
    };

    socket.setEncoding("utf8");
    // This bounds the caller, not the admitted operation. Progress bytes must
    // not restart an inactivity timer and keep a stopped CLI waiting forever.
    const deadline = setTimeout(handleTimeout, input.timeoutMs);
    socket.once("connect", handleConnect);
    socket.on("data", handleData);
    socket.once("end", handleEnd);
    socket.once("error", handleError);
  });
}
