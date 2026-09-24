import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  WINDOWS_PROCESS_HELPER_FILENAME,
  windowsManagedCliInstallationSchema,
} from "@openmeld/schemas";

const INSTALLATION_RECORD = "cli-installation.json";
const CLI_FILENAME = "openmeld.exe";
const RETIRED_LAUNCHER = /^\.retired-launcher-[a-f0-9-]{36}\.exe$/u;
const STAGING_VERSION = /^\.install-[A-Za-z0-9]{6}$/u;

export async function readWindowsManagedCliVersion(
  root: string
): Promise<string | null> {
  const serialized = await readFile(
    join(root, "bin", INSTALLATION_RECORD),
    "utf8"
  ).catch((error) => {
    if (hasCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (serialized === null) {
    return null;
  }
  const parsed = windowsManagedCliInstallationSchema.safeParse(
    JSON.parse(serialized)
  );
  if (!parsed.success) {
    throw new Error(
      "The managed Windows CLI installation record is invalid. No version was selected."
    );
  }
  return parsed.data.version;
}

/** Publish the complete immutable directory, never overwrite an in-use image. */
export async function placeWindowsManagedVersion(input: {
  root: string;
  version: string;
  sourceBinary: string;
}): Promise<void> {
  const { version } = windowsManagedCliInstallationSchema.parse({
    schemaVersion: 1,
    version: input.version,
  });
  const versions = join(input.root, "versions");
  const destination = join(versions, version);
  const sources = [
    { source: input.sourceBinary, name: CLI_FILENAME },
    {
      source: join(
        dirname(input.sourceBinary),
        WINDOWS_PROCESS_HELPER_FILENAME
      ),
      name: WINDOWS_PROCESS_HELPER_FILENAME,
    },
  ];
  if (await entryExists(destination)) {
    for (const { source, name } of sources) {
      if (!(await sameFileBytes(source, join(destination, name)))) {
        throw new Error(
          `The installed Windows CLI ${version} differs from the selected artifact. Published versions are immutable; acquire a new release instead of overwriting this installation.`
        );
      }
    }
    return;
  }
  await mkdir(versions, { recursive: true });
  // No executable is ever launched from staging. The shared install lock makes
  // these exact installer-owned leftovers from interrupted copies safe to remove.
  for (const entry of await readdir(versions, { withFileTypes: true })) {
    if (entry.isDirectory() && STAGING_VERSION.test(entry.name)) {
      await rm(join(versions, entry.name), { recursive: true });
    }
  }
  const staging = await mkdtemp(join(versions, ".install-"));
  try {
    for (const { source, name } of sources) {
      await copyFile(source, join(staging, name));
    }
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The caller holds the shared managed-install lock. Record replacement is the commit. */
export async function activateWindowsManagedCli(
  root: string,
  version: string
): Promise<void> {
  const record = windowsManagedCliInstallationSchema.parse({
    schemaVersion: 1,
    version,
  });
  await reconcileWindowsManagedLauncher(root, version);
  const destination = join(root, "bin", INSTALLATION_RECORD);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(record)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Repair from the authoritative version record. An interrupted launcher swap
 * can leave bin/openmeld.exe absent; install/maintenance restore it from the
 * immutable version without changing account data or selecting another version.
 */
export async function reconcileWindowsManagedLauncher(
  root: string,
  version: string
): Promise<void> {
  windowsManagedCliInstallationSchema.parse({ schemaVersion: 1, version });
  const source = join(
    root,
    "versions",
    version,
    WINDOWS_PROCESS_HELPER_FILENAME
  );
  const bin = join(root, "bin");
  const launcher = join(bin, CLI_FILENAME);
  await mkdir(bin, { recursive: true });
  for (const entry of await readdir(bin, { withFileTypes: true })) {
    if (entry.isFile() && RETIRED_LAUNCHER.test(entry.name)) {
      await removeRetiredLauncher(join(bin, entry.name));
    }
  }
  if (await sameFileBytes(source, launcher)) {
    return;
  }
  const temporary = join(bin, `.launcher-${randomUUID()}.tmp`);
  const retired = join(bin, `.retired-launcher-${randomUUID()}.exe`);
  await copyFile(source, temporary);
  let movedPrevious = false;
  try {
    if (await entryExists(launcher)) {
      await rename(launcher, retired);
      movedPrevious = true;
    }
    try {
      await rename(temporary, launcher);
    } catch (error) {
      if (movedPrevious) {
        await rename(retired, launcher);
      }
      throw error;
    }
    // A running launcher retains its renamed image until it exits. Only this
    // transaction's retired image is considered here; never remove by process name.
    if (movedPrevious) {
      await removeRetiredLauncher(retired);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function removeRetiredLauncher(file: string): Promise<void> {
  await rm(file).catch((error) => {
    if (hasCode(error, "EPERM") || hasCode(error, "EBUSY")) {
      return;
    }
    throw error;
  });
}

async function entryExists(file: string): Promise<boolean> {
  return await lstat(file).then(
    () => true,
    (error) => {
      if (hasCode(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  );
}

async function sameFileBytes(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([
    lstat(left),
    lstat(right).catch((error) => {
      if (hasCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }),
  ]);
  if (
    !(leftStat.isFile() && rightStat?.isFile()) ||
    leftStat.size !== rightStat.size
  ) {
    return false;
  }
  const hash = async (file: string) => {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) {
      digest.update(chunk);
    }
    return digest.digest("hex");
  };
  const [leftHash, rightHash] = await Promise.all([hash(left), hash(right)]);
  return leftHash === rightHash;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
