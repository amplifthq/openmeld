import { randomUUID } from "node:crypto";
import type { ServiceConnectionEvidenceEvent } from "@openmeld/schemas/types";
import type { WsClient } from "../../transport/ws";
import {
  createServiceConnectionEvidenceRecorder,
  readServiceConnectionFailureEvidence,
} from "./service-connection-evidence";

export function createServiceConnectionEvidenceObserver(
  input: Parameters<typeof createServiceConnectionEvidenceRecorder>[0] & {
    getRecovery: () => { recoveryId: string; disconnectedAt: number } | null;
    isStopping: () => boolean;
  }
) {
  const recorder = createServiceConnectionEvidenceRecorder(input);
  let connectionId = randomUUID();
  let phase: ServiceConnectionEvidenceEvent["phase"] = "credentials";
  let lastHeartbeatAckAtMs: number | undefined;
  let attemptStartedAtMs = Date.now();
  let retryDueAtMs: number | undefined;
  const record = (
    event: Omit<
      ServiceConnectionEvidenceEvent,
      "connectionId" | "firstAtMs" | "lastAtMs" | "count" | "phase"
    >
  ) => {
    const atMs = Date.now();
    recorder.record({
      recovery: input.getRecovery(),
      event: {
        ...event,
        connectionId,
        phase,
        firstAtMs: atMs,
        lastAtMs: atMs,
        count: 1,
        ...(lastHeartbeatAckAtMs === undefined ? {} : { lastHeartbeatAckAtMs }),
      },
    });
  };
  return {
    get connectionDiagnosticId() {
      return connectionId;
    },
    beginAttempt() {
      connectionId = randomUUID();
      phase = "credentials";
      attemptStartedAtMs = Date.now();
      record({
        kind: "connecting",
        reason: "unknown",
        ...(retryDueAtMs === undefined
          ? {}
          : {
              eventLoopDelayMs: Math.max(0, attemptStartedAtMs - retryDueAtMs),
            }),
      });
      retryDueAtMs = undefined;
    },
    opening() {
      phase = "opening";
    },
    opened(socket: WsClient) {
      phase = "registering";
      record({ kind: "transport_open", reason: "unknown" });
      const openedId = connectionId;
      socket.onClose((closeCode) => {
        if (openedId === connectionId) {
          record({
            kind: "disconnected",
            reason: input.isStopping() ? "stopped" : "socket_closed",
            closeCode,
          });
        }
      });
    },
    acknowledged(heartbeatAt: string, transitioned: boolean) {
      const timestamp = Date.parse(heartbeatAt);
      if (Number.isFinite(timestamp)) {
        lastHeartbeatAckAtMs = timestamp;
      }
      phase = "online";
      if (transitioned) {
        record({
          kind: "registered",
          reason: "recovered",
          durationMs: Math.max(
            0,
            Date.now() -
              (input.getRecovery()?.disconnectedAt ?? attemptStartedAtMs)
          ),
        });
      }
      recorder.setOnline(true);
    },
    retry(error: unknown, connectionReason: string | null, backoffMs: number) {
      recorder.setOnline(false);
      const evidence = readServiceConnectionFailureEvidence(error);
      const reason =
        connectionReason === "auth_unavailable" ||
        connectionReason === "auth_rejected"
          ? connectionReason
          : evidence.reason;
      record({
        kind: "disconnected",
        ...evidence,
        reason,
        durationMs: Math.max(0, Date.now() - attemptStartedAtMs),
      });
      phase = "waiting";
      retryDueAtMs = Date.now() + backoffMs;
      record({ kind: "retry_scheduled", reason, retryAtMs: retryDueAtMs });
    },
    credential(reason: ServiceConnectionEvidenceEvent["reason"]) {
      record({ kind: "credential_cache", reason });
    },
    dispose: recorder.dispose,
  };
}
