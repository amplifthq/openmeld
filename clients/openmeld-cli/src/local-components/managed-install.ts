import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { readDaemonServiceUpdateWorkerProtectedManagedVersions } from "../config/daemon-service-update-worker-registration";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../config/lock";
import {
  type OpenMeldPathResolutionInput,
  openMeldBinDir,
  openMeldManagedBinaryPath,
  openMeldManagedVersionBinaryPath,
  openMeldManagedVersionDir,
} from "../config/paths";
import { assertNoPublishedProductionMutationDuringTests } from "../config/published-production-safety";
import { compareSemver } from "../config/version-state";
import { readPendingDaemonServiceUpdate } from "../local-service/lifecycle/daemon-service-update-state";
import { OPENMELD_VERSION } from "../runtime/version";
import { pruneManagedVersions } from "./managed-version-pruning";

export type CliInstallSelfResult =
  | "installed"
  | "noop_same_version"
  | "noop_newer_present";

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
async function readCurrentPointerVersion(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string | null> {
  const pointerPath = openMeldManagedBinaryPath(pathInput);
  const target = await readlink(pointerPath).catch((error) => {
    if (isErrorWithCode(error, "ENOENT") || isErrorWithCode(error, "EINVAL")) {
      return null;
    }
    throw error;
  });
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
  return await withManagedInstallTransaction(async () =>
    performManagedInstallLocked(input)
  );
}

export async function withManagedInstallTransaction<T>(
  run: () => Promise<T>,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<T> {
  const startedAtMs = Date.now();

  for (;;) {
    try {
      const lock = await acquireLock({
        openMeldProfileId: MANAGED_INSTALL_LOCK_PROFILE,
        key: MANAGED_INSTALL_LOCK_KEY,
        meta: { component: "managed_cli.install" },
        pathResolution: pathInput,
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

/**
 * Prune managed CLI versions only while holding the install transaction lock.
 * The current pointer and every durable Service update target are re-read in
 * the lock, so cleanup cannot race an install or use a stale pending snapshot.
 */
export async function pruneManagedInstallVersions(input: {
  pathInput: OpenMeldPathResolutionInput;
  preferredRollbackVersion?: string | null;
}): Promise<void> {
  const pathInput = input.pathInput;
  assertNoPublishedProductionMutationDuringTests(
    pathInput,
    "managed CLI versions"
  );
  await withManagedInstallTransaction(async () => {
    const currentVersion = await readCurrentPointerVersion(pathInput);
    if (currentVersion === null) {
      return;
    }
    const protectedVersions =
      await readManagedInstallProtectedVersions(pathInput);
    await pruneManagedVersions({
      currentVersion,
      pathInput,
      preferredRollbackVersion: input.preferredRollbackVersion,
      protectedVersions,
    });
  }, pathInput);
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
  const protectedVersions = await readManagedInstallProtectedVersions();

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
      await pruneManagedVersions({
        currentVersion: previousVersion,
        protectedVersions,
      });
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
        protectedVersions,
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
    protectedVersions,
  });
  await swapCurrentPointer(currentPointerPath, managedBinaryPath);

  return { ...baseOutcome, result: "installed" };
}

async function readManagedInstallProtectedVersions(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<Set<string>> {
  const [protectedVersions, pendingServiceUpdate] = await Promise.all([
    readDaemonServiceUpdateWorkerProtectedManagedVersions(pathInput),
    readPendingDaemonServiceUpdate(pathInput),
  ]);
  if (pendingServiceUpdate?.preparedBundle.bundleFormat === "binary_v1") {
    protectedVersions.add(pendingServiceUpdate.preparedBundle.daemonVersion);
  }
  return protectedVersions;
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
