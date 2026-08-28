import { constants as fsConstants } from "node:fs";
import { access, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  type OpenMeldPathResolutionInput,
  openMeldVersionsDir,
} from "../config/paths";
import { compareSemver } from "../config/version-state";

const MANAGED_VERSION_DIRECTORY_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function pruneManagedVersions(input: {
  currentVersion: string;
  pathInput?: OpenMeldPathResolutionInput;
  preferredRollbackVersion?: string | null;
  protectedVersions?: Iterable<string>;
}): Promise<void> {
  const versionsDir = openMeldVersionsDir(input.pathInput);
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
          usable: await isUsableManagedVersion(version, versionsDir),
          version,
        }))
      )
    )
      .filter((entry) => entry.usable)
      .map((entry) => entry.version)
  );
  const retainedVersions = new Set([input.currentVersion]);
  let rollbackVersion: string | null = null;

  if (
    input.preferredRollbackVersion &&
    input.preferredRollbackVersion !== input.currentVersion &&
    usableManagedVersions.has(input.preferredRollbackVersion)
  ) {
    rollbackVersion = input.preferredRollbackVersion;
  }

  rollbackVersion ??=
    [...usableManagedVersions]
      .filter((version) => compareSemver(version, input.currentVersion) < 0)
      .sort((left, right) => compareSemver(right, left))[0] ?? null;

  if (rollbackVersion) {
    retainedVersions.add(rollbackVersion);
  }

  // A legacy worker can still point at a versioned binary until its service
  // registration is rewritten to the stable carrier. Protect that executable
  // independently from the last-known-good rollback selection; the worker
  // manager prunes again after the stable registration is active.
  for (const protectedVersion of input.protectedVersions ?? []) {
    if (usableManagedVersions.has(protectedVersion)) {
      retainedVersions.add(protectedVersion);
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

async function isUsableManagedVersion(
  version: string,
  versionsDir: string
): Promise<boolean> {
  const target = path.join(versionsDir, version, "openmeld");
  const stats = await stat(target).catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
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
        getErrorCode(error) === "EACCES" ||
        getErrorCode(error) === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  );
}

function getErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}
