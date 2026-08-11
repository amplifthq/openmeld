import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import {
  type DaemonLifecycleIntent,
  daemonLifecycleJournalPath,
  readDaemonServiceLifecycleLockMeta,
} from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { resolveOpenMeldEnvPreset } from "../../config/paths";
import { assertNoPublishedProductionMutationDuringTests } from "../../config/published-production-safety";
import { resolveCliContextId } from "../../config/session-profile";

const DAEMON_LIFECYCLE_EVENT_TYPES = [
  "connection.state",
  "daemon.crash",
  "lifecycle.command.begin",
  "lifecycle.command.end",
  "owner.snapshot",
  "route_catalog.initial_load",
  "runtime_state.takeover",
  "stop.controlled_drain",
  "stop.strategy.selected",
  "service_manager.action",
  "service_manager.registration_reconcile",
  "process_stop.action",
  "service_contract.write",
  "stop.signal.observed",
] as const;

const DAEMON_STOP_CAUSES = [
  "user_stop",
  "controlled_service_update",
  "service_crash",
  "network_disconnect",
  "unknown",
] as const;

export type DaemonLifecycleEvent = {
  schema: "openmeld-daemon-lifecycle-event-v1";
  v: 1;
  type: DaemonLifecycleEventType;
  timestamp: string;
  lane: string;
  intent: string;
  command: string;
  pid: number;
  sessionId: string | null;
  stopCause?: DaemonStopCause;
  result: string;
  metadata?: Record<string, unknown>;
};

export type DaemonStopCause =
  | "user_stop"
  | "controlled_service_update"
  | "service_crash"
  | "network_disconnect"
  | "unknown";

export type DaemonLifecycleAttribution = {
  command: string;
  intent: DaemonLifecycleIntent | "unknown";
  lane: string;
  pid: number;
  sessionId: string | null;
};

type DaemonLifecycleEventType = (typeof DAEMON_LIFECYCLE_EVENT_TYPES)[number];

function toJournalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSessionId(value: string | undefined | null): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function resolveDaemonStopCause(input: {
  explicitCause?: DaemonStopCause;
  intent: DaemonLifecycleIntent | "unknown";
  result: string;
  type: DaemonLifecycleEventType;
}): DaemonStopCause {
  if (input.explicitCause) {
    return input.explicitCause;
  }
  if (input.type === "daemon.crash") {
    return "service_crash";
  }
  if (input.intent === "stop") {
    return "user_stop";
  }
  if (
    input.intent === "upgrade_reconcile" ||
    input.intent === "reinstall" ||
    input.intent === "startup_check" ||
    input.intent === "status_cleanup"
  ) {
    return "controlled_service_update";
  }
  if (
    input.type === "connection.state" &&
    input.result !== "connected" &&
    input.result !== "stopping"
  ) {
    return "network_disconnect";
  }
  return "unknown";
}

function isDaemonLifecycleEvent(event: unknown): event is DaemonLifecycleEvent {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const candidate = event as Partial<DaemonLifecycleEvent>;
  return (
    candidate.schema === "openmeld-daemon-lifecycle-event-v1" &&
    candidate.v === 1 &&
    DAEMON_LIFECYCLE_EVENT_TYPES.includes(
      candidate.type as DaemonLifecycleEventType
    ) &&
    typeof candidate.timestamp === "string" &&
    candidate.timestamp.length > 0 &&
    typeof candidate.lane === "string" &&
    candidate.lane.length > 0 &&
    typeof candidate.intent === "string" &&
    candidate.intent.length > 0 &&
    typeof candidate.command === "string" &&
    candidate.command.length > 0 &&
    typeof candidate.pid === "number" &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    (candidate.sessionId === null ||
      (typeof candidate.sessionId === "string" &&
        candidate.sessionId.length > 0)) &&
    (candidate.stopCause === undefined ||
      DAEMON_STOP_CAUSES.includes(candidate.stopCause)) &&
    typeof candidate.result === "string" &&
    candidate.result.length > 0
  );
}

async function resolveDaemonLifecycleAttribution(input: {
  command?: string;
  intent?: DaemonLifecycleIntent | "unknown";
  pathInput?: OpenMeldPathResolutionInput;
}): Promise<DaemonLifecycleAttribution> {
  const lockMeta = await readDaemonServiceLifecycleLockMeta().catch(() => null);
  const command =
    input.command?.trim() ||
    (typeof lockMeta?.command === "string" ? lockMeta.command.trim() : "") ||
    "unknown";
  const intent =
    input.intent ??
    (typeof lockMeta?.intent === "string" ? lockMeta.intent : "unknown");
  return {
    command,
    intent,
    lane: resolveOpenMeldEnvPreset(input.pathInput),
    pid:
      typeof lockMeta?.pid === "number" && lockMeta.pid > 0
        ? lockMeta.pid
        : process.pid,
    sessionId: normalizeSessionId(lockMeta?.sessionId) ?? resolveCliContextId(),
  };
}

export async function emitDaemonLifecycleEvent(input: {
  type: DaemonLifecycleEventType;
  result: string;
  metadata?: Record<string, unknown>;
  pathInput?: OpenMeldPathResolutionInput;
  command?: string;
  intent?: DaemonLifecycleIntent | "unknown";
  stopCause?: DaemonStopCause;
}): Promise<void> {
  assertNoPublishedProductionMutationDuringTests(
    input.pathInput ?? {},
    "OpenMeld Service lifecycle journal"
  );
  const journalPath = daemonLifecycleJournalPath(input.pathInput);
  const attribution = await resolveDaemonLifecycleAttribution(input);
  const event: DaemonLifecycleEvent = {
    schema: "openmeld-daemon-lifecycle-event-v1",
    v: 1,
    type: input.type,
    timestamp: new Date().toISOString(),
    lane: attribution.lane,
    intent: attribution.intent,
    command: attribution.command,
    pid: attribution.pid,
    sessionId: attribution.sessionId,
    stopCause: resolveDaemonStopCause({
      explicitCause: input.stopCause,
      intent: attribution.intent,
      result: input.result,
      type: input.type,
    }),
    result: input.result,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  if (!isDaemonLifecycleEvent(event)) {
    console.warn(
      `[openmeld:lifecycle-journal] rejected invalid event ${input.type}`
    );
    return;
  }

  try {
    await mkdir(dirname(journalPath), { recursive: true });
    await appendFile(journalPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.warn(
      `[openmeld:lifecycle-journal] failed to append event ${input.type}: ${toJournalErrorMessage(error)}`
    );
  }
}

export async function runWithDaemonLifecycleCommandJournal<T>(input: {
  command: string;
  intent: DaemonLifecycleIntent;
  /**
   * Stamps the begin event with `processUptimeMs`, the milliseconds this
   * process has been running when the command begins. It is opt-in because it
   * is only meaningful for the long-lived daemon run: `begin timestamp -
   * processUptimeMs` recovers the process spawn moment, which splits the gap
   * between the previous `service_manager.action start` and this begin into
   * launchd/BTM spawn-decision latency versus daemon early initialization.
   * Local diagnostic evidence only; it must never feed readiness decisions.
   */
  includeProcessUptime?: boolean;
  metadata?: Record<string, unknown>;
  pathInput?: OpenMeldPathResolutionInput;
  resolveResult?: (result: T) => {
    metadata?: Record<string, unknown>;
    result: string;
  };
  run: () => Promise<T>;
}): Promise<T> {
  await emitDaemonLifecycleEvent({
    type: "lifecycle.command.begin",
    result: "started",
    metadata: input.includeProcessUptime
      ? {
          ...input.metadata,
          processUptimeMs: Math.round(process.uptime() * 1000),
        }
      : input.metadata,
    pathInput: input.pathInput,
    command: input.command,
    intent: input.intent,
  });

  try {
    const result = await input.run();
    const resolvedResult = input.resolveResult?.(result) ?? {
      result: "completed",
    };
    await emitDaemonLifecycleEvent({
      type: "lifecycle.command.end",
      result: resolvedResult.result,
      metadata: resolvedResult.metadata,
      pathInput: input.pathInput,
      command: input.command,
      intent: input.intent,
    });
    return result;
  } catch (error) {
    await emitDaemonLifecycleEvent({
      type: "lifecycle.command.end",
      result: "failed",
      metadata: {
        errorMessage: toJournalErrorMessage(error),
      },
      pathInput: input.pathInput,
      command: input.command,
      intent: input.intent,
    });
    throw error;
  }
}

export async function runDaemonServiceManagerAction<T>(input: {
  action:
    | "deactivate"
    | "install"
    | "start"
    | "stop"
    | "uninstall"
    | "wait_running";
  command?: string;
  controller: string;
  intent?: DaemonLifecycleIntent | "unknown";
  metadata?: Record<string, unknown>;
  pathInput?: OpenMeldPathResolutionInput;
  /**
   * Extracts structured failure evidence from the thrown error so the
   * journal entry alone carries the diagnosis (e.g. launchd job state on a
   * wait_running timeout). Extraction failures are swallowed: journaling
   * must never change the thrown error.
   */
  resolveErrorMetadata?: (error: unknown) => Record<string, unknown> | null;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAtMs = Date.now();
  try {
    const result = await input.run();
    await emitDaemonLifecycleEvent({
      type: "service_manager.action",
      result: "completed",
      metadata: {
        action: input.action,
        controller: input.controller,
        durationMs: Date.now() - startedAtMs,
        ...(input.metadata ?? {}),
      },
      pathInput: input.pathInput,
      command: input.command,
      intent: input.intent,
    });
    return result;
  } catch (error) {
    let errorMetadata: Record<string, unknown> | null = null;
    try {
      errorMetadata = input.resolveErrorMetadata?.(error) ?? null;
    } catch {
      errorMetadata = null;
    }
    await emitDaemonLifecycleEvent({
      type: "service_manager.action",
      result: "failed",
      metadata: {
        action: input.action,
        controller: input.controller,
        durationMs: Date.now() - startedAtMs,
        errorMessage: toJournalErrorMessage(error),
        ...(errorMetadata ?? {}),
        ...(input.metadata ?? {}),
      },
      pathInput: input.pathInput,
      command: input.command,
      intent: input.intent,
    });
    throw error;
  }
}

const DAEMON_LIFECYCLE_ORIGIN_EVENT_TYPES = new Set<DaemonLifecycleEventType>([
  "daemon.crash",
  "lifecycle.command.end",
  "process_stop.action",
  "runtime_state.takeover",
  "service_contract.write",
  "service_manager.action",
]);

export async function readLatestDaemonLifecycleOriginEvent(
  input: { pathInput?: OpenMeldPathResolutionInput } = {}
): Promise<DaemonLifecycleEvent | null> {
  return await readLatestDaemonLifecycleEvent({
    pathInput: input.pathInput,
    typeFilter: DAEMON_LIFECYCLE_ORIGIN_EVENT_TYPES,
  });
}

export async function readLatestDaemonLifecycleConnectionStateEvent(
  input: { pathInput?: OpenMeldPathResolutionInput } = {}
): Promise<DaemonLifecycleEvent | null> {
  return await readLatestDaemonLifecycleEvent({
    pathInput: input.pathInput,
    typeFilter: new Set<DaemonLifecycleEventType>(["connection.state"]),
  });
}

async function readLatestDaemonLifecycleEvent(input: {
  pathInput?: OpenMeldPathResolutionInput;
  typeFilter: ReadonlySet<DaemonLifecycleEventType>;
}): Promise<DaemonLifecycleEvent | null> {
  const journalPath = daemonLifecycleJournalPath(input.pathInput);
  let content: string;
  try {
    content = await readFile(journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isDaemonLifecycleEvent(parsed) && input.typeFilter.has(parsed.type)) {
        return parsed;
      }
    } catch {
      // Ignore malformed journal lines and keep scanning older entries.
    }
  }

  return null;
}

export async function readRecentDaemonLifecycleEvents(input: {
  maxEntries: number;
  pathInput?: OpenMeldPathResolutionInput;
}): Promise<DaemonLifecycleEvent[]> {
  if (input.maxEntries <= 0) {
    return [];
  }
  const journalPath = daemonLifecycleJournalPath(input.pathInput);
  let content: string;
  try {
    content = await readFile(journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const recent: DaemonLifecycleEvent[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isDaemonLifecycleEvent(parsed)) {
        recent.push(parsed);
        if (recent.length >= input.maxEntries) {
          break;
        }
      }
    } catch {
      // Ignore malformed journal lines and keep scanning older entries.
    }
  }

  return recent.reverse();
}

export async function resolveRecentDaemonSignalStopCause(
  input: { maxAgeMs?: number; pathInput?: OpenMeldPathResolutionInput } = {}
): Promise<
  | Extract<DaemonStopCause, "user_stop" | "controlled_service_update">
  | "unknown"
> {
  const nowMs = Date.now();
  const maxAgeMs = input.maxAgeMs ?? 30_000;
  const events = await readRecentDaemonLifecycleEvents({
    maxEntries: 32,
    pathInput: input.pathInput,
  });
  for (const event of events.toReversed()) {
    const eventAtMs = Date.parse(event.timestamp);
    if (
      !Number.isFinite(eventAtMs) ||
      nowMs - eventAtMs < 0 ||
      nowMs - eventAtMs > maxAgeMs
    ) {
      continue;
    }
    if (
      event.stopCause === "user_stop" ||
      event.stopCause === "controlled_service_update"
    ) {
      return event.stopCause;
    }
  }
  return "unknown";
}

export function formatDaemonLifecycleOriginSummary(
  event: DaemonLifecycleEvent
): string {
  const intent = formatDaemonLifecycleIntent(event.intent);
  return `${event.result} ${intent} from ${event.command} at ${event.timestamp} (pid ${event.pid})`;
}

function formatDaemonLifecycleIntent(intent: string): string {
  if (intent === "unknown") {
    return "OpenMeld Service task";
  }
  return intent.replaceAll("_", " ");
}
