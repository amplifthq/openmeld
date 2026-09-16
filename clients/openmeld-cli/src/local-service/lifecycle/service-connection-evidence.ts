import { createHash } from "node:crypto";
import { join } from "node:path";
import { createServiceConnectionEvidenceApi } from "@openmeld/api-client";
import {
  serviceConnectionEvidenceEventSchema,
  serviceConnectionEvidenceJournalSchema,
} from "@openmeld/schemas";
import type {
  ServiceConnectionEvidenceEvent,
  ServiceConnectionEvidenceJournal,
  ServiceConnectionIncident,
  ServiceConnectionIncidentReceipt,
  ServiceConnectionIncidentReport,
} from "@openmeld/schemas/types";
import {
  readDaemonLocalStateFile,
  writeDaemonLocalStateFile,
} from "../../config/daemon-local-state-file";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import { createCliApiClientFoundation } from "../../space/api-client-foundation";
import { WebSocketConnectionError } from "../../transport/ws";

const LOCAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_PENDING_EVENT_WRITES = 128;

// A bounded diagnostic journal derived from carrier events. It cannot change
// transport state, retry policy, readiness, credentials, or execution ownership.
export function createServiceConnectionEvidenceRecorder(input: {
  ownerUserId: string;
  gatewayUrl: string;
  identity: Pick<
    ServiceConnectionIncident,
    "deviceId" | "runtimeLane" | "serviceSessionId" | "serviceVersion"
  >;
  sendIncident?: (
    report: ServiceConnectionIncidentReport
  ) => Promise<ServiceConnectionIncidentReceipt>;
}) {
  const ownerKey = createHash("sha256").update(input.ownerUserId).digest("hex");
  const path = join(
    daemonRuntimeStateRootPath(),
    `connection-evidence-${ownerKey}.json`
  );
  const send =
    input.sendIncident ??
    createServiceConnectionEvidenceApi(
      createCliApiClientFoundation(input.gatewayUrl, {
        expectedOwnerUserId: input.ownerUserId,
      })
    ).report;
  let journal: ServiceConnectionEvidenceJournal | null = null;
  let writes: Promise<void> = Promise.resolve();
  let prelude: ServiceConnectionEvidenceEvent[] = [];
  let online = false;
  let disposed = false;
  let uploading = false;
  let failureCount = 0;
  let uploadTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEventWrites = 0;
  const truncatedRecoveryIds = new Set<string>();
  let writeFailureReported = false;

  function mutate(update: (state: ServiceConnectionEvidenceJournal) => void) {
    writes = writes
      .then(async () => {
        journal ??= (await readDaemonLocalStateFile({
          path,
          schema: serviceConnectionEvidenceJournalSchema,
        })) ?? { v: 1, entries: [] };
        update(journal);
        journal.entries = journal.entries.filter(
          (entry) => entry.incident.endedAtMs >= Date.now() - LOCAL_RETENTION_MS
        );
        while (
          journal.entries.length > 32 ||
          Buffer.byteLength(JSON.stringify(journal, null, 2), "utf8") + 1 >
            MAX_JOURNAL_BYTES
        ) {
          journal.entries.shift();
        }
        await writeDaemonLocalStateFile({
          path,
          value: journal,
          schema: serviceConnectionEvidenceJournalSchema,
          mode: 0o600,
        });
        writeFailureReported = false;
      })
      .catch(() => {
        // Diagnostics never interrupt heartbeat or recover credentials themselves.
        if (!writeFailureReported) {
          writeFailureReported = true;
          console.warn(
            "[openmeld:connection-evidence] Local connection history could not be saved."
          );
        }
      });
    return writes;
  }

  function scheduleUpload(delayMs = 0) {
    if (disposed || !online || uploading || uploadTimer) {
      return;
    }
    uploadTimer = setTimeout(() => {
      uploadTimer = null;
      uploadPending().catch(() => undefined);
    }, delayMs);
    uploadTimer.unref();
  }

  async function uploadPending() {
    if (!online || disposed || uploading) {
      return;
    }
    uploading = true;
    try {
      await mutate(() => undefined);
      const entry = journal?.entries.find(
        (item) =>
          item.uploadedAtMs === null &&
          (item.incident.outcome === "recovered" ||
            item.incident.serviceSessionId !== input.identity.serviceSessionId)
      );
      if (!entry) {
        return;
      }
      const receipt = await send({
        uploaderServiceSessionId: input.identity.serviceSessionId,
        incident: entry.incident,
      });
      if (receipt.incidentId !== entry.incident.incidentId) {
        throw new Error("connection_incident_receipt_mismatch");
      }
      await mutate((state) => {
        const saved = state.entries.find(
          (item) => item.incident.incidentId === receipt.incidentId
        );
        if (saved) {
          saved.uploadedAtMs = receipt.receivedAtMs;
        }
      });
      failureCount = 0;
    } catch {
      failureCount += 1;
    } finally {
      uploading = false;
      if (
        journal?.entries.some(
          (item) =>
            item.uploadedAtMs === null &&
            (item.incident.outcome === "recovered" ||
              item.incident.serviceSessionId !==
                input.identity.serviceSessionId)
        )
      ) {
        scheduleUpload(
          failureCount
            ? Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failureCount - 1, 5))
            : 1000
        );
      }
    }
  }

  function record(inputEvent: {
    recovery: { recoveryId: string; disconnectedAt: number } | null;
    event: ServiceConnectionEvidenceEvent;
  }): void {
    if (disposed) {
      return;
    }
    const parsed = serviceConnectionEvidenceEventSchema.safeParse(
      inputEvent.event
    );
    if (!parsed.success) {
      return;
    }
    const event = parsed.data;
    if (!inputEvent.recovery) {
      prelude = [...prelude, event]
        .filter((item) => item.lastAtMs >= event.lastAtMs - 5 * 60_000)
        .slice(-10);
      return;
    }
    const recovery = inputEvent.recovery;
    // A stalled filesystem must not turn diagnostic promises into an unbounded
    // in-memory queue. The persisted incident explicitly records lost detail.
    if (pendingEventWrites >= MAX_PENDING_EVENT_WRITES) {
      if (truncatedRecoveryIds.size < 32) {
        truncatedRecoveryIds.add(recovery.recoveryId);
      }
      return;
    }
    const precedingEvents = prelude;
    prelude = [];
    pendingEventWrites += 1;
    mutate((state) => {
      let entry = state.entries.find(
        (item) => item.incident.incidentId === recovery.recoveryId
      );
      if (!entry) {
        entry = {
          uploadedAtMs: null,
          incident: {
            v: 1,
            ...input.identity,
            incidentId: recovery.recoveryId,
            startedAtMs: recovery.disconnectedAt,
            endedAtMs: Math.max(recovery.disconnectedAt, event.lastAtMs),
            outcome: "interrupted",
            evidenceTruncated: false,
            events: precedingEvents,
          },
        };
        state.entries.push(entry);
      }
      const incident = entry.incident;
      if (truncatedRecoveryIds.delete(recovery.recoveryId)) {
        incident.evidenceTruncated = true;
      }
      appendEvent(incident, event);
      incident.endedAtMs = Math.max(incident.endedAtMs, event.lastAtMs);
      if (event.kind === "registered" && event.reason === "recovered") {
        incident.outcome = "recovered";
      }
    })
      .then(() => scheduleUpload())
      .finally(() => {
        pendingEventWrites -= 1;
      })
      .catch(() => undefined);
  }

  return {
    record,
    setOnline(value: boolean) {
      if (online === value) {
        return;
      }
      online = value;
      if (uploadTimer) {
        clearTimeout(uploadTimer);
        uploadTimer = null;
      }
      if (value) {
        scheduleUpload();
      }
    },
    flush: () => writes,
    dispose() {
      disposed = true;
      online = false;
      if (uploadTimer) {
        clearTimeout(uploadTimer);
        uploadTimer = null;
      }
    },
  };
}

function appendEvent(
  incident: ServiceConnectionIncident,
  event: ServiceConnectionEvidenceEvent
) {
  const previous = incident.events.at(-1);
  if (
    previous &&
    previous.kind === event.kind &&
    previous.reason === event.reason &&
    previous.phase === event.phase &&
    previous.connectionId === event.connectionId &&
    previous.nativeErrorCode === event.nativeErrorCode &&
    previous.closeCode === event.closeCode
  ) {
    incident.events[incident.events.length - 1] = {
      ...event,
      firstAtMs: previous.firstAtMs,
      count: Math.min(10_000_000, previous.count + event.count),
    };
  } else {
    incident.events.push(event);
  }
  if (incident.events.length > 100) {
    incident.events.splice(10, incident.events.length - 100);
    incident.evidenceTruncated = true;
  }
}

export function readServiceConnectionFailureEvidence(
  error: unknown
): Pick<
  ServiceConnectionEvidenceEvent,
  "reason" | "nativeErrorCode" | "requestId"
> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const nativeCode =
    serviceConnectionEvidenceEventSchema.shape.nativeErrorCode.safeParse(code);
  const requestId =
    serviceConnectionEvidenceEventSchema.shape.requestId.safeParse(
      error instanceof WebSocketConnectionError ? error.requestId : undefined
    );
  let reason: ServiceConnectionEvidenceEvent["reason"] = "unknown";
  if (error instanceof WebSocketConnectionError) {
    if (error.kind === "open_timeout") {
      reason = "open_timeout";
    } else if (error.kind === "closed_before_open") {
      reason = "socket_closed";
    } else if (error.status === 401) {
      reason = "auth_rejected";
    }
  }
  return {
    reason,
    ...(nativeCode.success && nativeCode.data
      ? { nativeErrorCode: nativeCode.data }
      : {}),
    ...(requestId.success && requestId.data
      ? { requestId: requestId.data }
      : {}),
  };
}
