import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { daemonDispatchJournalPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { resolveOpenMeldEnvPreset } from "../../config/paths";
import { resolveCliContextId } from "../../config/session-profile";

const DAEMON_DISPATCH_EVENT_TYPES = [
  "dispatch.deliver.received",
  "dispatch.local.phase",
  "dispatch.reply_reconsideration",
  "dispatch.lifecycle.sent",
  "dispatch.lifecycle.send_failed",
  "dispatch.result.queued",
  "dispatch.result.sent",
  "dispatch.result.send_failed",
  "dispatch.result.accepted",
] as const;

export type DaemonDispatchEventType =
  (typeof DAEMON_DISPATCH_EVENT_TYPES)[number];

export type DaemonDispatchJournalEvent = {
  schema: "openmeld-daemon-dispatch-event-v1";
  v: 1;
  type: DaemonDispatchEventType;
  timestamp: string;
  lane: string;
  pid: number;
  sessionId: string | null;
  attemptId: string | null;
  connectionGeneration: number | null;
  daemonSessionId: string | null;
  dispatchId: string;
  leaseEpoch: number | null;
  profileId: string | null;
  result: string | null;
  taskId: string | null;
  metadata?: Record<string, unknown>;
};

export function emitDaemonDispatchJournalEvent(input: {
  attemptId?: string | null;
  connectionGeneration?: number | null;
  daemonSessionId?: string | null;
  dispatchId: string;
  leaseEpoch?: number | null;
  metadata?: Record<string, unknown>;
  pathInput?: OpenMeldPathResolutionInput;
  profileId?: string | null;
  result?: string | null;
  taskId?: string | null;
  type: DaemonDispatchEventType;
}): void {
  const event: DaemonDispatchJournalEvent = {
    schema: "openmeld-daemon-dispatch-event-v1",
    v: 1,
    type: input.type,
    timestamp: new Date().toISOString(),
    lane: resolveOpenMeldEnvPreset(input.pathInput),
    pid: process.pid,
    sessionId: resolveCliContextId(),
    attemptId: normalizeOptionalString(input.attemptId),
    connectionGeneration: normalizeOptionalInteger(input.connectionGeneration),
    daemonSessionId: normalizeOptionalString(input.daemonSessionId),
    dispatchId: input.dispatchId,
    leaseEpoch: normalizeOptionalInteger(input.leaseEpoch),
    profileId: normalizeOptionalString(input.profileId),
    result: normalizeOptionalString(input.result),
    taskId: normalizeOptionalString(input.taskId),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  if (!isDaemonDispatchJournalEvent(event)) {
    console.warn(
      `[openmeld:dispatch-journal] rejected invalid event ${input.type}`
    );
    return;
  }

  try {
    const journalPath = daemonDispatchJournalPath(input.pathInput);
    mkdirSync(dirname(journalPath), { recursive: true });
    appendFileSync(journalPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.warn(
      `[openmeld:dispatch-journal] failed to append event ${input.type}: ${toJournalErrorMessage(error)}`
    );
  }
}

export function readRecentDaemonDispatchJournalEvents(input: {
  dispatchId: string;
  limit?: number;
  pathInput?: OpenMeldPathResolutionInput;
}): DaemonDispatchJournalEvent[] {
  const normalizedDispatchId = normalizeOptionalString(input.dispatchId);
  if (!normalizedDispatchId) {
    return [];
  }
  const limit = Math.max(1, Math.min(100, input.limit ?? 20));
  const journalPath = daemonDispatchJournalPath(input.pathInput);
  if (!existsSync(journalPath)) {
    return [];
  }

  try {
    return readFileSync(journalPath, "utf8")
      .split("\n")
      .reverse()
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return [];
        }
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          return isDaemonDispatchJournalEvent(parsed) &&
            parsed.dispatchId === normalizedDispatchId
            ? [parsed]
            : [];
        } catch {
          return [];
        }
      })
      .slice(0, limit)
      .reverse();
  } catch {
    return [];
  }
}

function isDaemonDispatchJournalEvent(
  value: unknown
): value is DaemonDispatchJournalEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DaemonDispatchJournalEvent>;
  return (
    candidate.schema === "openmeld-daemon-dispatch-event-v1" &&
    candidate.v === 1 &&
    DAEMON_DISPATCH_EVENT_TYPES.includes(
      candidate.type as DaemonDispatchEventType
    ) &&
    typeof candidate.timestamp === "string" &&
    candidate.timestamp.length > 0 &&
    typeof candidate.lane === "string" &&
    candidate.lane.length > 0 &&
    typeof candidate.pid === "number" &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    (candidate.sessionId === null ||
      (typeof candidate.sessionId === "string" &&
        candidate.sessionId.length > 0)) &&
    (candidate.attemptId === null ||
      (typeof candidate.attemptId === "string" &&
        candidate.attemptId.length > 0)) &&
    (candidate.connectionGeneration === null ||
      (typeof candidate.connectionGeneration === "number" &&
        Number.isInteger(candidate.connectionGeneration))) &&
    (candidate.daemonSessionId === null ||
      (typeof candidate.daemonSessionId === "string" &&
        candidate.daemonSessionId.length > 0)) &&
    typeof candidate.dispatchId === "string" &&
    candidate.dispatchId.length > 0 &&
    (candidate.leaseEpoch === null ||
      (typeof candidate.leaseEpoch === "number" &&
        Number.isInteger(candidate.leaseEpoch))) &&
    (candidate.profileId === null ||
      (typeof candidate.profileId === "string" &&
        candidate.profileId.length > 0)) &&
    (candidate.result === null ||
      (typeof candidate.result === "string" && candidate.result.length > 0)) &&
    (candidate.taskId === null ||
      (typeof candidate.taskId === "string" && candidate.taskId.length > 0))
  );
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalInteger(
  value: number | null | undefined
): number | null {
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isInteger(value)) {
    return null;
  }
  return value;
}

function toJournalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
