import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeDataPath } from "../../config/daemon-state";

const CATALOG_SYNC_SIGNAL_FILE = "catalog-sync-signal.json";
const CATALOG_SYNC_SIGNAL_SCHEMA = "openmeld-daemon-catalog-sync-signal-v1";

export type DaemonCatalogSyncSignal = {
  updatedAt: string;
  updatedAtMs: number;
  reason: string;
};

type DaemonCatalogSyncSignalFile = {
  v: 1;
  schema: string;
  updatedAt: string;
  reason: string;
};

export async function touchDaemonCatalogSyncSignal(input: {
  reason: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const signalPath = daemonCatalogSyncSignalPath();
  await mkdir(daemonRuntimeDataPath(), { recursive: true });
  const next: DaemonCatalogSyncSignalFile = {
    v: 1,
    schema: CATALOG_SYNC_SIGNAL_SCHEMA,
    updatedAt: now,
    reason: normalizeReason(input.reason),
  };

  const tempPath = `${signalPath}.tmp-${process.pid}-${Date.now()}`;
  let shouldCleanupTemp = true;
  try {
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tempPath, signalPath);
    shouldCleanupTemp = false;
  } finally {
    if (shouldCleanupTemp) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

export async function readDaemonCatalogSyncSignal(): Promise<DaemonCatalogSyncSignal | null> {
  const raw = await readFile(daemonCatalogSyncSignalPath(), "utf8").catch(
    () => null
  );
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DaemonCatalogSyncSignalFile>;
    if (parsed.v !== 1) {
      return null;
    }
    if (
      parsed.schema !== CATALOG_SYNC_SIGNAL_SCHEMA ||
      typeof parsed.updatedAt !== "string" ||
      parsed.updatedAt.trim().length === 0 ||
      typeof parsed.reason !== "string"
    ) {
      return null;
    }
    const updatedAt = parsed.updatedAt.trim();
    const updatedAtMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
      return null;
    }
    return {
      updatedAt,
      updatedAtMs,
      reason: normalizeReason(parsed.reason),
    };
  } catch {
    return null;
  }
}

function daemonCatalogSyncSignalPath(): string {
  return join(daemonRuntimeDataPath(), CATALOG_SYNC_SIGNAL_FILE);
}

function normalizeReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return "local_state_changed";
}
