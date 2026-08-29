import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { daemonRuntimeRootPath } from "./daemon-state";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "./paths";

const MANAGED_VERSION_FROM_EXECUTABLE_PATTERN =
  /[\\/]versions[\\/](v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)[\\/]openmeld(?:\.exe)?/gu;
const SELF_CONTAINED_BUNDLE_FROM_EXECUTABLE_PATTERN =
  /[\\/]runtime[\\/]daemon[\\/]bundles[\\/]([0-9A-Za-z._-]+)[\\/]/gu;

export type DaemonServiceUpdateWorkerIdentity = {
  launchdLabel: string;
  serviceName: string;
  windowsDisplayName: string;
  windowsServiceName: string;
};

export function resolveDaemonServiceUpdateWorkerIdentity(
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonServiceUpdateWorkerIdentity {
  const preset = resolveOpenMeldEnvPreset(pathInput);
  const suffix = preset === "prod" ? "" : `-${preset}`;
  const dotSuffix = preset === "prod" ? "" : `.${preset}`;
  return {
    launchdLabel: `com.openmeld.openmeld-service-update${dotSuffix}`,
    serviceName: `openmeld-service-update${suffix}`,
    windowsDisplayName: `OpenMeld Service Update${
      preset === "prod" ? "" : ` (${preset})`
    }`,
    windowsServiceName: `OpenMeld-Service-Update${suffix}`,
  };
}

export function resolveDaemonServiceUpdateWorkerLaunchdPlistPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    pathInput.homeDir ?? homedir(),
    "Library",
    "LaunchAgents",
    `${resolveDaemonServiceUpdateWorkerIdentity(pathInput).launchdLabel}.plist`
  );
}

export function resolveDaemonServiceUpdateWorkerSystemdUnitPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    pathInput.homeDir ?? homedir(),
    ".config",
    "systemd",
    "user",
    `${resolveDaemonServiceUpdateWorkerIdentity(pathInput).serviceName}.service`
  );
}

export function resolveDaemonServiceUpdateWorkerSystemdPathUnitPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    pathInput.homeDir ?? homedir(),
    ".config",
    "systemd",
    "user",
    `${resolveDaemonServiceUpdateWorkerIdentity(pathInput).serviceName}.path`
  );
}

export function resolveDaemonServiceUpdateWorkerWindowsScriptPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "service-update-worker.bat");
}

export async function readDaemonServiceUpdateWorkerProtectedManagedVersions(
  pathInput: OpenMeldPathResolutionInput = {},
  platform: NodeJS.Platform = process.platform
): Promise<Set<string>> {
  const contents = await readDaemonServiceUpdateWorkerRegistration(
    pathInput,
    platform
  );
  return contents === null
    ? new Set()
    : readManagedVersionsFromUpdateWorkerRegistration(contents);
}

export async function readDaemonServiceUpdateWorkerProtectedBundleIds(
  pathInput: OpenMeldPathResolutionInput = {},
  platform: NodeJS.Platform = process.platform
): Promise<Set<string>> {
  const contents = await readDaemonServiceUpdateWorkerRegistration(
    pathInput,
    platform
  );
  return contents === null
    ? new Set()
    : readBundleIdsFromUpdateWorkerRegistration(contents);
}

export function readManagedVersionsFromUpdateWorkerRegistration(
  contents: string
): Set<string> {
  const versions = new Set<string>();
  for (const match of contents.matchAll(
    MANAGED_VERSION_FROM_EXECUTABLE_PATTERN
  )) {
    const version = match[1];
    if (version) {
      versions.add(version);
    }
  }
  return versions;
}

export function readBundleIdsFromUpdateWorkerRegistration(
  contents: string
): Set<string> {
  const bundleIds = new Set<string>();
  for (const match of contents.matchAll(
    SELF_CONTAINED_BUNDLE_FROM_EXECUTABLE_PATTERN
  )) {
    const bundleId = match[1];
    if (bundleId) {
      bundleIds.add(bundleId);
    }
  }
  return bundleIds;
}

export function resolveDaemonServiceUpdateWorkerRegistrationPath(
  pathInput: OpenMeldPathResolutionInput,
  platform: NodeJS.Platform
): string | null {
  if (platform === "darwin") {
    return resolveDaemonServiceUpdateWorkerLaunchdPlistPath(pathInput);
  }
  if (platform === "linux") {
    return resolveDaemonServiceUpdateWorkerSystemdUnitPath(pathInput);
  }
  if (platform === "win32") {
    return resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput);
  }
  return null;
}

async function readDaemonServiceUpdateWorkerRegistration(
  pathInput: OpenMeldPathResolutionInput,
  platform: NodeJS.Platform
): Promise<string | null> {
  const registrationPath = resolveDaemonServiceUpdateWorkerRegistrationPath(
    pathInput,
    platform
  );
  if (registrationPath === null) {
    return null;
  }
  return await readFile(registrationPath, "utf8").catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
}

function getErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}
