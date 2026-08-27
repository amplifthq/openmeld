import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../config/lock";
import {
  openMeldBinDir,
  openMeldManagedBinaryPath,
  openMeldManagedVersionBinaryPath,
  openMeldManagedVersionDir,
  openMeldVersionsDir,
} from "../config/paths";
import { compareSemver } from "../config/version-state";
import { OPENMELD_VERSION } from "../runtime/version";

export type CliInstallSelfResult =
  | "installed"
  | "noop_same_version"
  | "noop_newer_present";

const MANAGED_VERSION_DIRECTORY_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MANAGED_INSTALL_LOCK_PROFILE = "managed-cli";
const MANAGED_INSTALL_LOCK_KEY = "install";
const MANAGED_INSTALL_LOCK_RETRY_DELAY_MS = 100;
const MANAGED_INSTALL_LOCK_TIMEOUT_MS = 30_000;

/**
 * Result of installing this binary into the managed layout. This is the shape
 * `openmeld install-self --json` emits and the seam Desktop consumes, so it is
 * treated as a frozen contract (covered by shape tests).
 */
export type CliInstallSelfOutcome = {
  result: CliInstallSelfResult;
  version: string;
  platform: string;
  // Absolute path of the versioned binary: <root>/versions/<version>/openmeld.
  managedBinaryPath: string;
  // Absolute path of the current-version pointer: <root>/bin/openmeld.
  currentPointerPath: string;
  // Version the current pointer resolved to before this run, if any.
  previousVersion: string | null;
  forced: boolean;
};

export function resolveCliPlatformToken(): string {
  return `${process.platform}-${process.arch}`;
}

export function resolveCliSelfVersion(): string {
  return OPENMELD_VERSION;
}

async function isUsableManagedBinary(target: string): Promise<boolean> {
  const stats = await stat(target).catch((error) => {
    if (isErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (!stats?.isFile()) {
    return false;
  }
  return await access(target, fsConstants.X_OK).then(
    () => true,
    (error) => {
      if (
        isErrorWithCode(error, "EACCES") ||
        isErrorWithCode(error, "ENOENT")
      ) {
        return false;
      }
      throw error;
    }
  );
}

// The version the current pointer resolves to, read from its symlink target's
// versions/<version>/ segment. Returns null when there is no pointer yet or it
// does not resolve into the managed layout.
async function readCurrentPointerVersion(): Promise<string | null> {
  const pointerPath = openMeldManagedBinaryPath();
  const target = await readlink(pointerPath).catch(() => null);
  if (!target) {
    return null;
  }
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(pointerPath), target);
  const version = path.basename(path.dirname(resolved));
  return version.length > 0 ? version : null;
}

/**
 * Install the currently-running binary (process.execPath) into the managed
 * layout and point bin/openmeld at it. Idempotent with semver arbitration:
 * a same-or-newer pointer is left in place (install only goes up), unless
 * `force` is set. Both the versioned binary and the pointer are swapped in
 * atomically via a temp name + rename.
 */
export async function performManagedInstall(input?: {
  force?: boolean;
  // Defaults to process.execPath (this running binary); injectable for tests.
  sourceBinaryPath?: string;
}): Promise<CliInstallSelfOutcome> {
  return await withManagedInstallLock(async () =>
    performManagedInstallLocked(input)
  );
}

async function performManagedInstallLocked(input?: {
  force?: boolean;
  sourceBinaryPath?: string;
}): Promise<CliInstallSelfOutcome> {
  const force = input?.force ?? false;
  const version = resolveCliSelfVersion();
  const platform = resolveCliPlatformToken();
  const currentPointerPath = openMeldManagedBinaryPath();
  const managedBinaryPath = openMeldManagedVersionBinaryPath(version);
  const previousVersion = await readCurrentPointerVersion();

  const baseOutcome = {
    version,
    platform,
    managedBinaryPath,
    currentPointerPath,
    previousVersion,
    forced: force,
  };

  if (previousVersion !== null) {
    const comparison = compareSemver(version, previousVersion);
    if (
      !force &&
      comparison === 0 &&
      (await isUsableManagedBinary(managedBinaryPath))
    ) {
      await pruneManagedVersions({ currentVersion: previousVersion });
      return { ...baseOutcome, result: "noop_same_version" };
    }
    if (comparison < 0 && !force) {
      if (!(await isUsableManagedBinary(managedBinaryPath))) {
        await placeVersionedBinary(
          input?.sourceBinaryPath ?? process.execPath,
          version,
          managedBinaryPath
        );
      }
      await pruneManagedVersions({
        currentVersion: previousVersion,
        preferredRollbackVersion: version,
      });
      return { ...baseOutcome, result: "noop_newer_present" };
    }
  }

  await placeVersionedBinary(
    input?.sourceBinaryPath ?? process.execPath,
    version,
    managedBinaryPath
  );
  await pruneManagedVersions({
    currentVersion: version,
    preferredRollbackVersion: previousVersion,
  });
  await swapCurrentPointer(currentPointerPath, managedBinaryPath);

  return { ...baseOutcome, result: "installed" };
}

async function withManagedInstallLock<T>(run: () => Promise<T>): Promise<T> {
  const startedAtMs = Date.now();

  for (;;) {
    try {
      const lock = await acquireLock({
        openMeldProfileId: MANAGED_INSTALL_LOCK_PROFILE,
        key: MANAGED_INSTALL_LOCK_KEY,
        meta: { component: "managed_cli.install" },
      });
      return await runWithHeldLock({
        lock,
        run,
        releaseContext: {
          component: "managed_cli.install",
          lockKey: MANAGED_INSTALL_LOCK_KEY,
          openMeldProfileId: MANAGED_INSTALL_LOCK_PROFILE,
        },
      });
    } catch (error) {
      if (
        !isOpenMeldLockError(error) ||
        isOpenMeldOrphanedLockError(error) ||
        Date.now() - startedAtMs >= MANAGED_INSTALL_LOCK_TIMEOUT_MS
      ) {
        throw error;
      }
      await delay(MANAGED_INSTALL_LOCK_RETRY_DELAY_MS);
    }
  }
}

async function pruneManagedVersions(input: {
  currentVersion: string;
  preferredRollbackVersion?: string | null;
}): Promise<void> {
  const versionsDir = openMeldVersionsDir();
  const entries = await readdir(versionsDir, { withFileTypes: true });
  const managedVersions = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        MANAGED_VERSION_DIRECTORY_PATTERN.test(entry.name)
    )
    .map((entry) => entry.name);
  const usableManagedVersions = new Set(
    (
      await Promise.all(
        managedVersions.map(async (version) => ({
          usable: await isUsableManagedVersion(version),
          version,
        }))
      )
    )
      .filter((entry) => entry.usable)
      .map((entry) => entry.version)
  );
  const retainedVersions = new Set([input.currentVersion]);

  if (
    input.preferredRollbackVersion &&
    input.preferredRollbackVersion !== input.currentVersion &&
    usableManagedVersions.has(input.preferredRollbackVersion)
  ) {
    retainedVersions.add(input.preferredRollbackVersion);
  }

  if (retainedVersions.size === 1) {
    const rollbackVersion = [...usableManagedVersions]
      .filter((version) => compareSemver(version, input.currentVersion) < 0)
      .sort((left, right) => compareSemver(right, left))[0];
    if (rollbackVersion) {
      retainedVersions.add(rollbackVersion);
    }
  }

  await Promise.all(
    managedVersions
      .filter((version) => !retainedVersions.has(version))
      .map((version) =>
        rm(path.join(versionsDir, version), { recursive: true })
      )
  );
}

async function isUsableManagedVersion(version: string): Promise<boolean> {
  return await isUsableManagedBinary(
    path.join(openMeldVersionsDir(), version, "openmeld")
  );
}

async function placeVersionedBinary(
  sourceBinary: string,
  version: string,
  managedBinaryPath: string
): Promise<void> {
  await mkdir(openMeldManagedVersionDir(version), { recursive: true });
  const tmpPath = `${managedBinaryPath}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmpPath, { force: true }).catch(() => undefined);
  await copyFile(sourceBinary, tmpPath);
  await chmod(tmpPath, 0o755);
  const existingTarget = await lstat(managedBinaryPath).catch((error) => {
    if (isErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (existingTarget?.isDirectory()) {
    await rm(managedBinaryPath, { recursive: true });
  }
  await rename(tmpPath, managedBinaryPath);
}

async function swapCurrentPointer(
  currentPointerPath: string,
  managedBinaryPath: string
): Promise<void> {
  await mkdir(openMeldBinDir(), { recursive: true });
  const relativeTarget = path.relative(
    path.dirname(currentPointerPath),
    managedBinaryPath
  );
  const tmpPath = `${currentPointerPath}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmpPath, { force: true }).catch(() => undefined);
  await symlink(relativeTarget, tmpPath);
  await rename(tmpPath, currentPointerPath);
}

export function buildInstallSelfJsonPayload(outcome: CliInstallSelfOutcome) {
  return {
    schemaVersion: 1 as const,
    type: "cli.install_self" as const,
    result: outcome.result,
    version: outcome.version,
    platform: outcome.platform,
    managedBinaryPath: outcome.managedBinaryPath,
    currentPointerPath: outcome.currentPointerPath,
    previousVersion: outcome.previousVersion,
    forced: outcome.forced,
  };
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
