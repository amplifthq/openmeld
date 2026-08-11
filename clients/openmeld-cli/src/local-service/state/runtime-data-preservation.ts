import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonRuntimeDataPath } from "../../config/daemon-state";

const DAEMON_RUNTIME_DATA_BACKUP_PREFIX = "openmeld-daemon-runtime-data-";
const DAEMON_RUNTIME_DATA_DIR_NAME = "data";

export type DaemonRuntimeDataBackup = {
  backupRootPath: string;
  backupDataPath: string;
  sourceDataPath: string;
};

export async function backupDaemonRuntimeDataForReinstall(): Promise<DaemonRuntimeDataBackup | null> {
  const sourceDataPath = daemonRuntimeDataPath();
  const sourceStats = await stat(sourceDataPath).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    return null;
  }

  const backupRootPath = await mkdtemp(
    join(tmpdir(), DAEMON_RUNTIME_DATA_BACKUP_PREFIX)
  );
  const backupDataPath = join(backupRootPath, DAEMON_RUNTIME_DATA_DIR_NAME);
  await cp(sourceDataPath, backupDataPath, {
    recursive: true,
  });
  return {
    backupRootPath,
    backupDataPath,
    sourceDataPath,
  };
}

export async function restoreDaemonRuntimeDataForReinstall(
  backup: DaemonRuntimeDataBackup
): Promise<void> {
  const backupStats = await stat(backup.backupDataPath).catch(() => null);
  if (!backupStats?.isDirectory()) {
    throw new Error(
      `daemon runtime data backup is missing: ${backup.backupDataPath}`
    );
  }
  await cp(backup.backupDataPath, backup.sourceDataPath, {
    recursive: true,
  });
}

export async function cleanupDaemonRuntimeDataBackup(
  backup: DaemonRuntimeDataBackup | null
): Promise<void> {
  if (!backup) {
    return;
  }
  await rm(backup.backupRootPath, {
    recursive: true,
    force: true,
  });
}

export async function cleanupStaleDaemonRuntimeDataBackups(
  input: { retainBackupRootPaths?: readonly string[] } = {}
): Promise<void> {
  const retainBackupRootPaths = new Set(input.retainBackupRootPaths ?? []);
  const tempEntries = await readdir(tmpdir(), {
    withFileTypes: true,
  }).catch(() => []);
  for (const entry of tempEntries) {
    if (
      !(
        entry.isDirectory() &&
        entry.name.startsWith(DAEMON_RUNTIME_DATA_BACKUP_PREFIX)
      )
    ) {
      continue;
    }
    const candidateRootPath = join(tmpdir(), entry.name);
    if (retainBackupRootPaths.has(candidateRootPath)) {
      continue;
    }
    await rm(candidateRootPath, {
      recursive: true,
      force: true,
    });
  }
}
