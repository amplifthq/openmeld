import {
  daemonStreamFrameSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportHeartbeatResponseSchema,
  runtimeTransportRegisterSessionResponseSchema,
} from "@openmeld/schemas";
import type {
  RuntimeTransportHeartbeatRequest,
  RuntimeTransportRegisterSessionRequest,
} from "@openmeld/schemas/types";
import { formatOpenMeldCliTextBlock } from "../../runtime/cli-entry-command";
import type { Presenter } from "../../runtime/presenter/types";
import { asRecord, emitRunLine, normalizeText } from "../core/logger";
import type {
  DaemonFrameSink,
  ParsedDaemonFrame,
  PendingFrameWaiters,
} from "../core/types";

// Transport acknowledgements must not import the execution graph. In particular,
// registration and heartbeat remain usable without loading an Agent adapter.
export function parseDaemonFrame(raw: string): ParsedDaemonFrame | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsedFrame = daemonStreamFrameSchema.safeParse(parsedJson);
  return parsedFrame.success ? parsedFrame.data : null;
}

export function resolveRegisterResponseFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters: PendingFrameWaiters;
}): void {
  if (!input.waiters.registerResolver) {
    return;
  }
  const registerPayload =
    runtimeTransportRegisterSessionResponseSchema.safeParse(input.payload);
  if (!registerPayload.success) {
    return;
  }
  const resolver = input.waiters.registerResolver;
  input.waiters.registerResolver = null;
  input.waiters.registerRejecter = null;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.register_response_received",
    text: `register accepted; connection generation=${String(registerPayload.data.connectionGeneration)}`,
    payload: {
      acceptedLeaseCount: registerPayload.data.acceptedLeases.length,
      connectionGeneration: registerPayload.data.connectionGeneration,
      ok: registerPayload.data.ok,
      rejectedProfileCount: registerPayload.data.rejectedProfiles.length,
    },
  });
  resolver(registerPayload.data);
}

export function resolveHeartbeatResponseFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters: PendingFrameWaiters;
}): void {
  if (!input.waiters.heartbeatResolver) {
    return;
  }
  const heartbeatPayload = runtimeTransportHeartbeatResponseSchema.safeParse(
    input.payload
  );
  if (!heartbeatPayload.success) {
    return;
  }
  const resolver = input.waiters.heartbeatResolver;
  input.waiters.heartbeatResolver = null;
  input.waiters.heartbeatRejecter = null;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.heartbeat_response_received",
    text: `heartbeat response received; stale leases=${String(heartbeatPayload.data.staleLeases.length)}`,
    payload: {
      ok: heartbeatPayload.data.ok,
      staleLeaseCount: heartbeatPayload.data.staleLeases.length,
    },
  });
  resolver(heartbeatPayload.data);
}

export function emitDaemonErrorFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters?: PendingFrameWaiters;
}): void {
  const errorPayload = asRecord(input.payload) ?? {};
  const errorCode = normalizeText(errorPayload.code);
  const errorMessage = normalizeText(errorPayload.message);
  const isRegisterContractMismatch =
    errorCode === "schema.invalid" &&
    errorMessage.toLowerCase().includes("invalid register payload");
  const isHeartbeatContractMismatch =
    errorCode === "schema.invalid" &&
    errorMessage.toLowerCase().includes("invalid heartbeat payload");

  if (isRegisterContractMismatch) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.register_contract_mismatch",
      text: formatOpenMeldCliTextBlock(
        "OpenMeld service is out of sync with this CLI version.\n" +
          "Please restart the service:\n" +
          "1) `openmeld service stop --force`\n" +
          "2) `openmeld service start`"
      ),
      payload: { code: errorCode, message: errorMessage },
    });
    const rejecter = input.waiters?.registerRejecter;
    if (rejecter && input.waiters) {
      input.waiters.registerRejecter = null;
      input.waiters.registerResolver = null;
      rejecter(buildDaemonFrameError({ errorCode, errorMessage }));
    }
    return;
  }

  if (isHeartbeatContractMismatch) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.heartbeat_contract_mismatch",
      text: `heartbeat rejected: ${errorCode || "daemon.error"} ${errorMessage}`.trim(),
      payload: { code: errorCode, message: errorMessage },
    });
    const rejecter = input.waiters?.heartbeatRejecter;
    if (rejecter && input.waiters) {
      input.waiters.heartbeatRejecter = null;
      input.waiters.heartbeatResolver = null;
      rejecter(buildDaemonFrameError({ errorCode, errorMessage }));
    }
    return;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.daemon_error",
    text: `daemon error frame: ${errorCode || "unknown"} ${errorMessage || ""}`.trim(),
  });
}

function buildDaemonFrameError(input: {
  errorCode: string;
  errorMessage: string;
}): Error {
  const message = [input.errorCode || "daemon.error", input.errorMessage]
    .filter((value) => value.length > 0)
    .join(": ");
  return new Error(message || "daemon.error");
}

export function sendDaemonFrame(
  sink: DaemonFrameSink,
  input: {
    code:
      | "daemon.dispatch.result"
      | "daemon.dispatch.interaction_delivered"
      | "daemon.dispatch.interaction_request"
      | "daemon.local_agent_control.result"
      | "daemon.openmeld_tools_control.result"
      | "daemon.execution_recovery.resume_controller_conversation_result"
      | "daemon.session.heartbeat"
      | "daemon.session.register";
    payload:
      | RuntimeTransportHeartbeatRequest
      | RuntimeTransportRegisterSessionRequest
      | Record<string, unknown>;
  }
): void {
  sink.send(
    JSON.stringify({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: input.code,
      payload: input.payload,
    })
  );
}
