import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeDataPath } from "../../config/daemon-state";
import { OPENMELD_HOME_ENV_KEY } from "../../config/paths";

const CATALOG_SYNC_SIGNAL_FILE = "catalog-sync-signal.json";
const CATALOG_SYNC_SIGNAL_SCHEMA = "openmeld-daemon-catalog-sync-signal-v1";

export type DaemonCatalogSyncSignal = {
  signalId?: string;
  updatedAt: string;
  updatedAtMs: number;
  reason: string;
};

type DaemonCatalogSyncSignalFile = {
  signalId?: string;
  v: 1;
  schema: string;
  updatedAt: string;
  reason: string;
};

export async function touchDaemonCatalogSyncSignal(input: {
  reason: string;
  rootDir?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const runtimeDataPath = resolveDaemonRuntimeDataPath(input.rootDir);
  const signalPath = daemonCatalogSyncSignalPath(runtimeDataPath);
  await mkdir(runtimeDataPath, { recursive: true });
  const next: DaemonCatalogSyncSignalFile = {
    signalId: randomUUID(),
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

export async function readDaemonCatalogSyncSignal(
  input: { rootDir?: string } = {}
): Promise<DaemonCatalogSyncSignal | null> {
  const raw = await readFile(
    daemonCatalogSyncSignalPath(resolveDaemonRuntimeDataPath(input.rootDir)),
    "utf8"
  ).catch(() => null);
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
      ...(typeof parsed.signalId === "string" && parsed.signalId.trim()
        ? { signalId: parsed.signalId.trim() }
        : {}),
      updatedAt,
      updatedAtMs,
      reason: normalizeReason(parsed.reason),
    };
  } catch {
    return null;
  }
}

function daemonCatalogSyncSignalPath(runtimeDataPath: string): string {
  return join(runtimeDataPath, CATALOG_SYNC_SIGNAL_FILE);
}

function resolveDaemonRuntimeDataPath(rootDir: string | undefined): string {
  if (!rootDir) {
    return daemonRuntimeDataPath();
  }
  return daemonRuntimeDataPath({
    env: { ...process.env, [OPENMELD_HOME_ENV_KEY]: rootDir },
  });
}

function normalizeReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return "local_state_changed";
}
