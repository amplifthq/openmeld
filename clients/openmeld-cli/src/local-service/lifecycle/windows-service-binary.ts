import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pruneWindowsBinaryBundle } from "@openmeld/adapter-core/windows-system";
import { WINDOWS_PROCESS_HELPER_FILENAME } from "@openmeld/schemas";
import { daemonRuntimeBundlesPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import type { CliBinaryReleaseInfo } from "../../config/version-state";
import type { DaemonActiveBundleState } from "./daemon-service-bundle";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

export function windowsMaintenanceBinaryPath(
  bundle: DaemonActiveBundleState,
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  if (
    !(
      bundle.sourceDistFingerprint &&
      FINGERPRINT_PATTERN.test(bundle.sourceDistFingerprint)
    )
  ) {
    throw new Error(
      "OpenMeld maintenance needs a verified Windows Service bundle."
    );
  }
  return join(
    daemonRuntimeBundlesPath(pathInput),
    `maintenance-${bundle.sourceDistFingerprint}`,
    "openmeld.exe"
  );
}

export async function prepareWindowsMaintenanceBinary(
  bundle: DaemonActiveBundleState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string> {
  const target = windowsMaintenanceBinaryPath(bundle, pathInput);
  const expected = bundle.sourceDistFingerprint;
  if (
    (await hashBinaryServiceBundle(target, true).catch(() => null)) === expected
  ) {
    return target;
  }
  if (
    (await hashBinaryServiceBundle(bundle.sourceEntryScriptPath, true)) !==
    expected
  ) {
    throw new Error(
      "The Windows maintenance source no longer matches its verified bundle."
    );
  }
  const directory = dirname(target);
  if (
    await stat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    })
  ) {
    const result = await pruneWindowsBinaryBundle(directory);
    if (result !== "removed" && result !== "absent") {
      throw new Error(
        "The existing Windows maintenance copy is still in use or contains unrecognized files."
      );
    }
  }
  await mkdir(daemonRuntimeBundlesPath(pathInput), { recursive: true });
  const temporary = await mkdtemp(
    join(daemonRuntimeBundlesPath(pathInput), ".maintenance-")
  );
  try {
    for (const name of ["openmeld.exe", WINDOWS_PROCESS_HELPER_FILENAME]) {
      await copyFile(
        name === "openmeld.exe"
          ? bundle.sourceEntryScriptPath
          : join(dirname(bundle.sourceEntryScriptPath), name),
        join(temporary, name)
      );
    }
    if (
      (await hashBinaryServiceBundle(join(temporary, "openmeld.exe"), true)) !==
      expected
    ) {
      throw new Error(
        "The prepared Windows maintenance copy failed verification."
      );
    }
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return target;
}

// Windows binary_v1 bundles contain two indivisible, independently signed files.
// Keep one bundle fingerprint for inventory, update jobs, and maintenance copies.
export function expectedBinaryServiceFingerprint(
  release: CliBinaryReleaseInfo
): string {
  if (!release.platform.startsWith("windows-")) {
    return release.sha256.toLowerCase();
  }
  if (!release.windows) {
    throw new Error(
      "The selected Windows Service has no native helper metadata."
    );
  }
  return fingerprint(release.sha256, release.windows.processHelper.sha256);
}

export async function hashBinaryServiceBundle(
  executablePath: string,
  windows: boolean = process.platform === "win32"
): Promise<string> {
  const executableHash = await hashFile(executablePath);
  return windows
    ? fingerprint(
        executableHash,
        await hashFile(
          join(dirname(executablePath), WINDOWS_PROCESS_HELPER_FILENAME)
        )
      )
    : executableHash;
}

function fingerprint(executableHash: string, helperHash: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([executableHash.toLowerCase(), helperHash.toLowerCase()])
    )
    .digest("hex");
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** A valid signature does not establish the required console-free PE subsystem. */
export async function verifyWindowsServiceSubsystem(
  file: string
): Promise<void> {
  const handle = await open(file, "r");
  try {
    const dos = Buffer.alloc(64);
    const first = await handle.read(dos, 0, dos.length, 0);
    if (
      first.bytesRead !== dos.length ||
      dos.toString("ascii", 0, 2) !== "MZ"
    ) {
      throw new Error("The Windows Service artifact is not a PE executable.");
    }
    const header = Buffer.alloc(94);
    const second = await handle.read(
      header,
      0,
      header.length,
      dos.readUInt32LE(0x3c)
    );
    if (
      second.bytesRead !== header.length ||
      header.toString("ascii", 0, 4) !== "PE\0\0" ||
      header.readUInt16LE(4) !== 0x86_64 ||
      header.readUInt16LE(24 + 68) !== 2
    ) {
      throw new Error(
        "The selected Windows Service must be a console-free x64 executable."
      );
    }
  } finally {
    await handle.close();
  }
}
