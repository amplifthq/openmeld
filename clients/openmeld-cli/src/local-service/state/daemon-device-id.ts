import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeRootPath } from "../../config/daemon-state";
import { systemDir } from "../../config/paths";
import {
  CONTEXT_STORE_FILE,
  DAEMON_DEVICE_ID_FILE,
  DAEMON_RUNTIME_CONTRACT_META_FILE,
  DAEMON_RUNTIME_CONTRACT_REPAIR_REPORT_FILE,
  LEDGER_DIR_NAME,
} from "../core/constants";
import { dirnamePath, normalizeOptionalText } from "../core/logger";
import type { DaemonRuntimePaths, LedgerPaths } from "../core/types";

export function resolvePreferredDaemonDeviceId(input: {
  explicitDeviceId?: string;
  contractDeviceId?: string | null;
}): string | undefined {
  return (
    normalizeOptionalText(input.explicitDeviceId) ??
    normalizeOptionalText(input.contractDeviceId) ??
    undefined
  );
}

export async function resolveDaemonDeviceId(input: {
  deviceId?: string;
  deviceIdPath: string;
  shouldDiscardPersistedDeviceId?: (deviceId: string) => boolean;
}): Promise<string> {
  const explicit = normalizeOptionalText(input.deviceId);
  if (explicit) {
    await persistDaemonDeviceIdIfNeeded({
      deviceId: explicit,
      deviceIdPath: input.deviceIdPath,
    });
    return explicit;
  }

  const persisted = normalizeOptionalText(
    await readFile(input.deviceIdPath, "utf8").catch(() => "")
  );
  if (
    persisted &&
    !(input.shouldDiscardPersistedDeviceId?.(persisted) ?? false)
  ) {
    return persisted;
  }

  const generated = randomUUID();
  await writeDaemonDeviceId({
    deviceId: generated,
    deviceIdPath: input.deviceIdPath,
  });
  return generated;
}

export async function ensureDaemonRuntimePaths(): Promise<DaemonRuntimePaths> {
  const dataRootPath = join(daemonRuntimeRootPath(), "data");
  const contextStorePath = join(dataRootPath, CONTEXT_STORE_FILE);
  const deviceIdPath = daemonDeviceIdPath();
  const legacyDeviceIdPath = join(dataRootPath, DAEMON_DEVICE_ID_FILE);
  const ledgerRootPath = join(dataRootPath, LEDGER_DIR_NAME);
  await mkdir(dataRootPath, {
    recursive: true,
  });
  await mkdir(ledgerRootPath, {
    recursive: true,
  });
  await mkdir(dirnamePath(deviceIdPath), { recursive: true });
  await migrateLegacyDaemonDeviceId({ deviceIdPath, legacyDeviceIdPath });
  return {
    contractMetaPath: join(dataRootPath, DAEMON_RUNTIME_CONTRACT_META_FILE),
    contractRepairReportPath: join(
      dataRootPath,
      DAEMON_RUNTIME_CONTRACT_REPAIR_REPORT_FILE
    ),
    contextStorePath,
    dataRootPath,
    deviceIdPath,
    ledgerRootPath,
  };
}

export function daemonDeviceIdPath(): string {
  return join(systemDir(), DAEMON_DEVICE_ID_FILE);
}

export function buildLedgerPaths(ledgerRootPath: string): LedgerPaths {
  return {
    backupStateFilePath: join(ledgerRootPath, "state.backup.json"),
    historyFilePath: join(ledgerRootPath, "history.ndjson"),
    historyTempFilePath: join(ledgerRootPath, "history.tmp"),
    rootDirPath: ledgerRootPath,
    stateFilePath: join(ledgerRootPath, "state.json"),
    stateTempFilePath: join(ledgerRootPath, "state.tmp"),
  };
}

async function persistDaemonDeviceIdIfNeeded(input: {
  deviceId: string;
  deviceIdPath: string;
}): Promise<void> {
  const persisted = normalizeOptionalText(
    await readFile(input.deviceIdPath, "utf8").catch(() => "")
  );
  if (persisted === input.deviceId) {
    return;
  }
  await writeDaemonDeviceId(input);
}

async function writeDaemonDeviceId(input: {
  deviceId: string;
  deviceIdPath: string;
}): Promise<void> {
  await mkdir(dirnamePath(input.deviceIdPath), { recursive: true });
  await writeFile(input.deviceIdPath, `${input.deviceId}\n`, "utf8");
}

async function migrateLegacyDaemonDeviceId(input: {
  deviceIdPath: string;
  legacyDeviceIdPath: string;
}): Promise<void> {
  const current = normalizeOptionalText(
    await readFile(input.deviceIdPath, "utf8").catch(() => "")
  );
  if (current) {
    return;
  }
  const legacy = normalizeOptionalText(
    await readFile(input.legacyDeviceIdPath, "utf8").catch(() => "")
  );
  if (!legacy) {
    return;
  }
  await writeDaemonDeviceId({
    deviceId: legacy,
    deviceIdPath: input.deviceIdPath,
  });
}
