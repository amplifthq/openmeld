import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  daemonRuntimeStateRootPath,
  daemonServiceRepairJournalPath,
} from "../../config/daemon-state";
import type { DaemonServiceCleanupAction } from "./daemon-service-hygiene";

const DAEMON_SERVICE_REPAIR_JOURNAL_SCHEMA =
  "openmeld-daemon-repair-journal-v1";
const DAEMON_SERVICE_REPAIR_MAX_FAILURES = 3;
const DAEMON_SERVICE_REPAIR_COOLDOWN_MS = 5 * 60 * 1000;

type DaemonServiceRepairJournalRecord = {
  actionKey: string;
  consecutiveFailures: number;
  lastAttemptAt: string;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  cooldownUntil: string | null;
  lastErrorMessage: string | null;
};

type DaemonServiceRepairJournalState = {
  v: 1;
  schema: typeof DAEMON_SERVICE_REPAIR_JOURNAL_SCHEMA;
  records: Record<string, DaemonServiceRepairJournalRecord>;
};

export type DaemonServiceRepairBudgetState = {
  actionKey: string;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  lastErrorMessage: string | null;
  status: "ready" | "cooldown";
};

export function buildDaemonServiceRepairActionKey(
  actions: readonly DaemonServiceCleanupAction[]
): string {
  const normalized = [...new Set(actions)].sort((left, right) =>
    left.localeCompare(right)
  );
  return normalized.join("+");
}

export async function getDaemonServiceRepairBudgetState(input: {
  actions: readonly DaemonServiceCleanupAction[];
  now?: Date;
}): Promise<DaemonServiceRepairBudgetState | null> {
  const actionKey = buildDaemonServiceRepairActionKey(input.actions);
  if (actionKey.length === 0) {
    return null;
  }
  const state = await readDaemonServiceRepairJournal();
  const record = state.records[actionKey];
  if (!record) {
    return {
      actionKey,
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastErrorMessage: null,
      status: "ready",
    };
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const cooldownUntilMs = record.cooldownUntil
    ? Date.parse(record.cooldownUntil)
    : Number.NaN;
  return {
    actionKey,
    consecutiveFailures: record.consecutiveFailures,
    cooldownUntil: record.cooldownUntil,
    lastErrorMessage: record.lastErrorMessage,
    status:
      Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs
        ? "cooldown"
        : "ready",
  };
}

export async function recordDaemonServiceRepairSuccess(input: {
  actions: readonly DaemonServiceCleanupAction[];
  now?: Date;
}): Promise<void> {
  const actionKey = buildDaemonServiceRepairActionKey(input.actions);
  if (actionKey.length === 0) {
    return;
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  await updateDaemonServiceRepairJournal((state) => {
    state.records[actionKey] = {
      actionKey,
      consecutiveFailures: 0,
      lastAttemptAt: nowIso,
      lastFailureAt: null,
      lastSuccessAt: nowIso,
      cooldownUntil: null,
      lastErrorMessage: null,
    };
    return state;
  });
}

export async function recordDaemonServiceRepairFailure(input: {
  actions: readonly DaemonServiceCleanupAction[];
  errorMessage: string;
  now?: Date;
}): Promise<void> {
  const actionKey = buildDaemonServiceRepairActionKey(input.actions);
  if (actionKey.length === 0) {
    return;
  }
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  await updateDaemonServiceRepairJournal((state) => {
    const previousRecord = state.records[actionKey];
    const nextFailures = (previousRecord?.consecutiveFailures ?? 0) + 1;
    const cooldownUntil =
      nextFailures >= DAEMON_SERVICE_REPAIR_MAX_FAILURES
        ? new Date(
            now.getTime() + DAEMON_SERVICE_REPAIR_COOLDOWN_MS
          ).toISOString()
        : null;
    state.records[actionKey] = {
      actionKey,
      consecutiveFailures: nextFailures,
      lastAttemptAt: nowIso,
      lastFailureAt: nowIso,
      lastSuccessAt: previousRecord?.lastSuccessAt ?? null,
      cooldownUntil,
      lastErrorMessage: input.errorMessage,
    };
    return state;
  });
}

async function readDaemonServiceRepairJournal(): Promise<DaemonServiceRepairJournalState> {
  const raw = await readFile(daemonServiceRepairJournalPath(), "utf8").catch(
    (error: unknown) => {
      if (getErrorCode(error) === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return createEmptyDaemonServiceRepairJournalState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonServiceRepairJournalState>;
    if (
      parsed.v !== 1 ||
      parsed.schema !== DAEMON_SERVICE_REPAIR_JOURNAL_SCHEMA ||
      !parsed.records ||
      typeof parsed.records !== "object"
    ) {
      return createEmptyDaemonServiceRepairJournalState();
    }
    const normalizedRecords = Object.fromEntries(
      Object.entries(parsed.records).flatMap(([key, value]) => {
        if (!isDaemonServiceRepairJournalRecord(value)) {
          return [];
        }
        return [[key, value]];
      })
    );
    return {
      v: 1,
      schema: DAEMON_SERVICE_REPAIR_JOURNAL_SCHEMA,
      records: normalizedRecords,
    };
  } catch {
    return createEmptyDaemonServiceRepairJournalState();
  }
}

async function updateDaemonServiceRepairJournal(
  updater: (
    state: DaemonServiceRepairJournalState
  ) => DaemonServiceRepairJournalState
): Promise<void> {
  const state = updater(await readDaemonServiceRepairJournal());
  await mkdir(daemonRuntimeStateRootPath(), { recursive: true });
  await writeFile(
    daemonServiceRepairJournalPath(),
    `${JSON.stringify(state, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

function createEmptyDaemonServiceRepairJournalState(): DaemonServiceRepairJournalState {
  return {
    v: 1,
    schema: DAEMON_SERVICE_REPAIR_JOURNAL_SCHEMA,
    records: {},
  };
}

function isDaemonServiceRepairJournalRecord(
  value: unknown
): value is DaemonServiceRepairJournalRecord {
  return (
    !!value &&
    typeof value === "object" &&
    "actionKey" in value &&
    typeof value.actionKey === "string" &&
    "consecutiveFailures" in value &&
    typeof value.consecutiveFailures === "number" &&
    "lastAttemptAt" in value &&
    typeof value.lastAttemptAt === "string" &&
    "lastFailureAt" in value &&
    (typeof value.lastFailureAt === "string" || value.lastFailureAt === null) &&
    "lastSuccessAt" in value &&
    (typeof value.lastSuccessAt === "string" || value.lastSuccessAt === null) &&
    "cooldownUntil" in value &&
    (typeof value.cooldownUntil === "string" || value.cooldownUntil === null) &&
    "lastErrorMessage" in value &&
    (typeof value.lastErrorMessage === "string" ||
      value.lastErrorMessage === null)
  );
}

function getErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : null;
  }
  return null;
}
