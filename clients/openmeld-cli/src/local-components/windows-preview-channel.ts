import { join, normalize } from "node:path";
import process from "node:process";
import { WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL } from "@openmeld/schemas";
import { resolveOpenMeldRootDir } from "../config/paths";
import { isBinaryDistribution } from "../runtime/distribution";
import { readWindowsManagedCliInstallation } from "./windows-managed-install";

/** Restore the verified install choice before loading command modules. */
export async function restoreWindowsPreviewChannel(
  runtime: {
    platform: string;
    execPath: string;
    env: NodeJS.ProcessEnv;
    binaryDistribution: boolean;
    root: string;
  } = {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
    binaryDistribution: isBinaryDistribution(),
    root: resolveOpenMeldRootDir(),
  }
): Promise<void> {
  if (runtime.platform !== "win32" || !runtime.binaryDistribution) {
    return;
  }
  const installation = await readWindowsManagedCliInstallation(runtime.root);
  if (installation?.releaseChannel !== "windows-preview") {
    return;
  }
  const selectedBinary = join(
    runtime.root,
    "versions",
    installation.version,
    "openmeld.exe"
  );
  if (
    normalize(runtime.execPath).toLowerCase() !==
    normalize(selectedBinary).toLowerCase()
  ) {
    // A downloaded bootstrap or an unrelated CLI must not inherit this account's
    // unsigned channel just because an older preview is installed.
    return;
  }
  if (
    runtime.env.OPENMELD_ENV_PRESET &&
    runtime.env.OPENMELD_ENV_PRESET !== "prod"
  ) {
    return;
  }
  if (runtime.env.OPENMELD_CLI_BINARY_MANIFEST_URL) {
    return;
  }
  runtime.env.OPENMELD_ENV_PRESET = "prod";
  runtime.env.OPENMELD_CLI_BINARY_MANIFEST_URL =
    WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL;
  runtime.env.OPENMELD_WINDOWS_INTERNAL_PREVIEW = "1";
}
