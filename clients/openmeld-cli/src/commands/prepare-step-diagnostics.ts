import os from "node:os";
import process from "node:process";
import {
  PREPARE_STEP_DIAGNOSTICS_MAX_CHARS,
  prepareStepDiagnosticsBundleSchema,
  redactPrepareStepDiagnosticsBundle,
  redactPrepareStepDiagnosticsText,
  redactPrepareStepDiagnosticsValue,
} from "@openmeld/schemas";
import type { PrepareStepDiagnosticsBundle } from "@openmeld/schemas/types";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  type DaemonLifecycleEvent,
  readRecentDaemonLifecycleEvents,
} from "../local-service/lifecycle/daemon-lifecycle-journal";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import {
  type DaemonServiceJobDiagnostics,
  isDaemonServiceJobNeverSpawned,
  readDaemonServiceJobCrashExitCode,
  resolveDaemonServiceManager,
} from "../local-service/lifecycle/daemon-service-manager";
import { readDaemonIncidentLogTail } from "../local-service/lifecycle/daemon-start-failure-log";
import { getCliVersionInfo } from "../runtime/cli-version";
import { collectLocalOperationFailure } from "../system/local-operation-diagnostics";
import { readMacOSVersion } from "../system/macos-version";

// Serialized payload budget. Stays below the schema cap
// (PREPARE_STEP_DIAGNOSTICS_MAX_CHARS) so the bundle can never be rejected
// for size alone.
export const PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS = Math.min(
  16_000,
  PREPARE_STEP_DIAGNOSTICS_MAX_CHARS
);
export const OPENMELD_NO_DIAGNOSTICS_ENV = "OPENMELD_NO_DIAGNOSTICS";

// Additive v3 evidence: incident window, native operation and macOS versions.
const PREPARE_STEP_DIAGNOSTICS_BUNDLE_VERSION = 3;
const INCIDENT_WINDOW_MS = 15 * 60 * 1000;

const LIFECYCLE_JOURNAL_TAIL_MAX_ENTRIES = 10;
const SERVICE_LOG_TAIL_MAX_LINES = 30;
const SERVICE_LOG_LINE_MAX_CHARS = 320;
const JOURNAL_ENTRY_MAX_CHARS = 700;
const SOURCE_TIMEOUT_MS = 2000;
const OS_STATUS_PATTERN = /OSStatus (-?\d+)/u;

// Only these lifecycle journal metadata keys survive into the bundle. The
// launchd wait_running failure event carries the highest-value evidence here
// (errorMessage plus the jobDiagnostics launchd probe); everything else is
// dropped so the entry stays small and free of unvetted local content.
// `processUptimeMs` is the daemon-run begin marker used to separate launchd
// spawn-decision latency from daemon early init when a remote report explains
// a slow startup.
const LIFECYCLE_JOURNAL_METADATA_WHITELIST = [
  "action",
  "ok",
  "errorMessage",
  "jobDiagnostics",
  "durationMs",
  "reason",
  "failureStage",
  "reasonCodes",
  "processUptimeMs",
  "operation",
  "distribution",
  "actorPid",
  "parentPid",
  "targetCategory",
  "operationFailure",
] as const;

// jobDiagnostics is the heaviest whitelisted field, and the failure
// errorMessage already embeds the same launchd evidence in prose. When a
// whitelisted entry still exceeds the per-entry budget, jobDiagnostics is the
// most redundant field to shed while keeping errorMessage intact.
const LIFECYCLE_JOURNAL_METADATA_COMPACT_WHITELIST =
  LIFECYCLE_JOURNAL_METADATA_WHITELIST.filter(
    (key) => key !== "jobDiagnostics"
  );

// The whole daemon-system-service.log is unreadable/absent (never-spawned) or
// empty. Kept separate from the collected line array so the bundle can carry
// serviceLogTail: null plus an explicit reason instead of an ambiguous [].
export type PrepareStepServiceLogTail = {
  lines: string[];
  note: "file_missing" | "file_empty" | null;
  window?: PrepareStepDiagnosticsBundle["serviceLogWindow"];
};

// The bundle is whitelist-only: every field is either derived from the failed
// step itself, from CLI/package metadata, or from OpenMeld-owned runtime files
// (daemon lifecycle journal, daemon-system-service.log, service contract) and
// structured service-manager probes. It must never carry env vars, tokens, or
// content from files outside those sources.
export type PrepareStepDiagnosticsSources = {
  readLifecycleJournalTail?: () => Promise<DaemonLifecycleEvent[]>;
  readServiceLogTail?: () => Promise<PrepareStepServiceLogTail>;
  readInventoryAnomalyCodes?: () => Promise<string[]>;
  readServiceJobDiagnostics?: () => Promise<DaemonServiceJobDiagnostics | null>;
  readDeviceId?: () => Promise<string | null>;
  readMacOSVersion?: typeof readMacOSVersion;
};

export function isPrepareStepDiagnosticsOptedOut(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return String(env[OPENMELD_NO_DIAGNOSTICS_ENV] ?? "").trim() === "1";
}

export async function collectPrepareStepDiagnostics(input: {
  stepId: string;
  supportCode: string;
  error?: unknown;
  env?: NodeJS.ProcessEnv;
  sources?: PrepareStepDiagnosticsSources;
  now?: Date;
}): Promise<string | null> {
  try {
    if (isPrepareStepDiagnosticsOptedOut(input.env)) {
      return null;
    }
    const sources = input.sources ?? {};
    const now = input.now ?? new Date();
    const evidenceWindow = {
      startedAt: new Date(now.getTime() - INCIDENT_WINDOW_MS).toISOString(),
      endedAt: now.toISOString(),
    };
    const collectionErrors: string[] = [];
    const [
      lifecycleJournalTail,
      serviceLog,
      inventoryAnomalies,
      serviceJob,
      deviceId,
      macOSVersion,
    ] = await Promise.all([
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "lifecycle_journal",
        read:
          sources.readLifecycleJournalTail ??
          (() =>
            readRecentDaemonLifecycleEvents({
              maxEntries: 100,
            })),
      }),
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "service_log",
        read:
          sources.readServiceLogTail ??
          (() =>
            readDaemonIncidentLogTail({
              ...evidenceWindow,
              maxLines: SERVICE_LOG_TAIL_MAX_LINES,
            })),
      }),
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "inventory_anomalies",
        read: sources.readInventoryAnomalyCodes ?? readInventoryAnomalyCodes,
      }),
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "service_job",
        read: sources.readServiceJobDiagnostics ?? readServiceJobDiagnostics,
      }),
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "device_id",
        read: sources.readDeviceId ?? readDaemonServiceContractDeviceId,
      }),
      collectDiagnosticsSource({
        collectionErrors,
        sourceName: "macos_version",
        read: sources.readMacOSVersion ?? readMacOSVersion,
      }),
    ]);
    // A note (file_missing/file_empty) or a failed collection both leave
    // serviceLogTail null; the note carries the reason without polluting
    // collectionErrors, which stays reserved for genuine collection failures.
    const serviceLogNote = serviceLog?.note ?? null;
    const serviceLogTail =
      serviceLog === null || serviceLogNote !== null
        ? null
        : serviceLog.lines.map(boundServiceLogLine);
    const cliVersion = getCliVersionInfo().version;
    const nativeFailure = resolveNativeFailure(input.error);
    const operationFailure = collectLocalOperationFailure(input.error);
    const bundle: PrepareStepDiagnosticsBundle = {
      bundleVersion: PREPARE_STEP_DIAGNOSTICS_BUNDLE_VERSION,
      collectedAt: now.toISOString(),
      supportCode: input.supportCode,
      ...(nativeFailure ? { nativeFailure } : {}),
      ...(operationFailure ? { operationFailure } : {}),
      evidenceWindow,
      ...(serviceLog?.window ? { serviceLogWindow: serviceLog.window } : {}),
      stepId: input.stepId,
      ...(deviceId ? { deviceId } : {}),
      cliVersion,
      os: {
        platform: process.platform,
        release: os.release(),
        ...macOSVersion,
      },
      inventoryAnomalies,
      serviceJob,
      lifecycleJournalTail:
        lifecycleJournalTail === null
          ? null
          : lifecycleJournalTail
              .filter((entry) => {
                const timestamp = Date.parse(entry.timestamp);
                return (
                  timestamp >= Date.parse(evidenceWindow.startedAt) &&
                  timestamp <= now.getTime()
                );
              })
              .map(boundLifecycleJournalEntry),
      serviceLogTail,
      ...(serviceLogNote ? { serviceLogNote } : {}),
      collectionErrors,
      truncated: false,
    };
    return serializeBoundedPrepareStepDiagnostics(bundle);
  } catch {
    // Diagnostics are strictly best-effort: collection failures must never
    // affect the setup flow or the base failure report.
    return null;
  }
}

function resolveNativeFailure(error: unknown): { osStatus: number } | null {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const match = OS_STATUS_PATTERN.exec(current.message);
    if (match && Number.isSafeInteger(Number(match[1]))) {
      return { osStatus: Number(match[1]) };
    }
    current = current.cause;
  }
  return null;
}

export function serializeBoundedPrepareStepDiagnostics(
  bundle: PrepareStepDiagnosticsBundle
): string | null {
  const cappedForSchema =
    (bundle.inventoryAnomalies?.length ?? 0) > 32 ||
    (bundle.lifecycleJournalTail?.length ?? 0) >
      LIFECYCLE_JOURNAL_TAIL_MAX_ENTRIES ||
    (bundle.serviceLogTail?.length ?? 0) > SERVICE_LOG_TAIL_MAX_LINES ||
    bundle.collectionErrors.length > 8;
  let candidate = redactPrepareStepDiagnosticsBundle({
    ...bundle,
    inventoryAnomalies:
      bundle.inventoryAnomalies === null
        ? null
        : bundle.inventoryAnomalies.slice(-32),
    lifecycleJournalTail:
      bundle.lifecycleJournalTail === null
        ? null
        : bundle.lifecycleJournalTail.slice(
            -LIFECYCLE_JOURNAL_TAIL_MAX_ENTRIES
          ),
    serviceLogTail:
      bundle.serviceLogTail === null
        ? null
        : bundle.serviceLogTail
            .slice(-SERVICE_LOG_TAIL_MAX_LINES)
            .map(boundServiceLogLine),
    collectionErrors: bundle.collectionErrors.slice(-8),
    truncated: bundle.truncated || cappedForSchema,
  });
  let serialized = JSON.stringify(candidate);
  if (serialized.length <= PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS) {
    return finalizePrepareStepDiagnosticsSerialization(candidate);
  }

  candidate = { ...candidate, truncated: true };
  serialized = JSON.stringify(candidate);
  while (serialized.length > PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS) {
    const serviceLogTail = candidate.serviceLogTail;
    const lifecycleJournalTail = candidate.lifecycleJournalTail;
    if (serviceLogTail && serviceLogTail.length > 0) {
      // Drop the oldest filtered log line first; the newest lines carry the
      // failure evidence.
      candidate = { ...candidate, serviceLogTail: serviceLogTail.slice(1) };
    } else if (lifecycleJournalTail && lifecycleJournalTail.length > 0) {
      candidate = {
        ...candidate,
        lifecycleJournalTail: lifecycleJournalTail.slice(1),
      };
    } else {
      // Every remaining field is already bounded; drop the tails entirely as
      // a final guarantee.
      candidate = {
        ...candidate,
        lifecycleJournalTail: null,
        serviceLogTail: null,
      };
      serialized = JSON.stringify(candidate);
      break;
    }
    serialized = JSON.stringify(candidate);
  }
  return finalizePrepareStepDiagnosticsSerialization(candidate);
}

async function collectDiagnosticsSource<T>(input: {
  collectionErrors: string[];
  sourceName: string;
  read: () => Promise<T>;
}): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      input.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("diagnostics source timed out")),
          SOURCE_TIMEOUT_MS
        );
      }),
    ]);
  } catch {
    // Record only the source name: error text could echo local details that
    // are not part of the whitelist.
    input.collectionErrors.push(input.sourceName);
    return null;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

async function readInventoryAnomalyCodes(): Promise<string[]> {
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: await resolveCurrentDaemonExpectedVersion(),
  });
  return inventory.anomalies.map((anomaly) => anomaly.code);
}

async function readServiceJobDiagnostics(): Promise<DaemonServiceJobDiagnostics | null> {
  const manager = await resolveDaemonServiceManager();
  return (await manager?.readJobDiagnostics?.()) ?? null;
}

export type PrepareServiceJobVerdict = "never_spawned" | "crashed";

// Best-effort launchd job-state verdict for a failed service startup so the
// human-facing setup message can name the root cause — a job macOS never
// spawned (Login Items / Background Task Management blocked) versus a crash
// loop. Diagnostic evidence only: it must never gate any setup decision.
export async function resolvePrepareServiceJobVerdict(): Promise<PrepareServiceJobVerdict | null> {
  const diagnostics = await readServiceJobDiagnostics().catch(() => null);
  if (!diagnostics) {
    return null;
  }
  if (isDaemonServiceJobNeverSpawned(diagnostics)) {
    return "never_spawned";
  }
  if (readDaemonServiceJobCrashExitCode(diagnostics) !== null) {
    return "crashed";
  }
  return null;
}

// Reads the OpenMeld-internal device UUID from the local service contract. Returns
// null (rather than throwing) for the common never-set-up case where the
// contract file is absent, so the bundle simply omits deviceId.
async function readDaemonServiceContractDeviceId(): Promise<string | null> {
  const contract = await readDaemonServiceContract();
  return contract?.deviceId ?? null;
}

function selectWhitelistedJournalMetadata(
  metadata: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(metadata, key)) {
      selected[key] = metadata[key];
    }
  }
  return selected;
}

function boundLifecycleJournalEntry(
  entry: DaemonLifecycleEvent
): DaemonLifecycleEvent {
  if (!entry.metadata) {
    return redactPrepareStepDiagnosticsValue(entry) as DaemonLifecycleEvent;
  }
  const whitelisted = redactPrepareStepDiagnosticsValue({
    ...entry,
    metadata: selectWhitelistedJournalMetadata(
      entry.metadata,
      LIFECYCLE_JOURNAL_METADATA_WHITELIST
    ),
  }) as DaemonLifecycleEvent;
  // Carrier errors can embed exact source/destination paths. The local journal
  // retains those; the uploaded operation evidence uses path categories.
  if (
    entry.command === "openmeld service carrier mutation" &&
    whitelisted.metadata
  ) {
    whitelisted.metadata.errorMessage = undefined;
  }
  if (JSON.stringify(whitelisted).length <= JOURNAL_ENTRY_MAX_CHARS) {
    return whitelisted;
  }
  // Still over the per-entry budget after whitelisting (the real launchd
  // failure entry does this because errorMessage already embeds the job
  // evidence): keep the compact human-readable metadata and shed the heaviest
  // structured field, marking the partial loss so log readers know evidence
  // was dropped.
  const compact = redactPrepareStepDiagnosticsValue({
    ...entry,
    metadata: {
      ...selectWhitelistedJournalMetadata(
        whitelisted.metadata ?? {},
        LIFECYCLE_JOURNAL_METADATA_COMPACT_WHITELIST
      ),
      truncated: true,
    },
  }) as DaemonLifecycleEvent;
  if (JSON.stringify(compact).length <= JOURNAL_ENTRY_MAX_CHARS) {
    return compact;
  }
  return { ...whitelisted, metadata: { truncated: true } };
}

function boundServiceLogLine(line: string): string {
  const redactedLine = redactPrepareStepDiagnosticsText(line);
  if (redactedLine.length <= SERVICE_LOG_LINE_MAX_CHARS) {
    return redactedLine;
  }
  return `${redactedLine.slice(0, SERVICE_LOG_LINE_MAX_CHARS - 1).trimEnd()}…`;
}

function finalizePrepareStepDiagnosticsSerialization(
  bundle: PrepareStepDiagnosticsBundle
): string | null {
  const parsed = prepareStepDiagnosticsBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    return null;
  }
  return JSON.stringify(parsed.data);
}
