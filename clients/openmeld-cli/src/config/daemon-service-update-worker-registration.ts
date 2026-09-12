import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DAEMON_SERVICE_RUNTIME_AUTO_START_ENV,
  DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV,
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
  DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV,
  daemonRuntimeRootPath,
} from "./daemon-state";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
  resolveOpenMeldServiceScope,
} from "./paths";

const MANAGED_VERSION_FROM_EXECUTABLE_PATTERN =
  /[\\/]versions[\\/](v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)[\\/]openmeld(?:\.exe)?/gu;
const SELF_CONTAINED_BUNDLE_FROM_EXECUTABLE_PATTERN =
  /[\\/]runtime[\\/]daemon[\\/]bundles[\\/]([0-9A-Za-z._-]+)[\\/]/gu;

export const INDEPENDENT_MAINTENANCE_REGISTRATION =
  "openmeld-independent-maintenance-v1";

// Maintenance may call normal Service commands, but it is never the main
// Service process. Also normalize registrations written by older versions.
export function configureDaemonMaintenanceEnvironment(
  env: NodeJS.ProcessEnv
): void {
  for (const key of [
    DAEMON_SERVICE_RUNTIME_AUTO_START_ENV,
    DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV,
    DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
    DAEMON_SERVICE_RUNTIME_MODE_ENV,
    DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV,
  ]) {
    delete env[key];
  }
  env.OPENMELD_INTERNAL_MAINTENANCE_WORKER = "1";
}
const NPM_ENTRY_IMPORT_PATTERN = /^await import\((".*")\);$/mu;

export function daemonServiceUpdateWorkerNpmEntryPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "service-update-worker.mjs");
}

export async function hasIndependentMaintenanceRegistration(
  pathInput: OpenMeldPathResolutionInput = {},
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (platform === "win32") {
    const { runWindowsUserTask, readWindowsTaskAction } = await import(
      "../local-service/lifecycle/windows-user-task"
    );
    const task = await runWindowsUserTask({
      name: resolveDaemonServiceUpdateWorkerIdentity(pathInput)
        .windowsServiceName,
      legacyScript:
        resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput),
      operation: "status",
    });
    return Boolean(
      task.installed &&
        !task.legacy &&
        task.actionArguments &&
        resolveOpenMeldRootDir({
          env: readWindowsTaskAction(task.actionArguments).env,
        }) === resolveOpenMeldRootDir(pathInput)
    );
  }
  const registration = await readDaemonServiceUpdateWorkerRegistration(
    pathInput,
    platform
  );
  if (!registration?.includes(INDEPENDENT_MAINTENANCE_REGISTRATION)) {
    return false;
  }
  const { parseDaemonServiceEnvironmentFromDefinition } = await import(
    "../local-service/lifecycle/daemon-service-manager"
  );
  const env = parseDaemonServiceEnvironmentFromDefinition({
    controller: platform === "darwin" ? "launchd" : "systemd",
    definition: registration,
  });
  return resolveOpenMeldRootDir({ env }) === resolveOpenMeldRootDir(pathInput);
}

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
  const scope = resolveOpenMeldServiceScope(pathInput);
  const suffix =
    (preset === "prod" ? "" : `-${preset}`) + (scope ? `-${scope}` : "");
  const dotSuffix =
    (preset === "prod" ? "" : `.${preset}`) + (scope ? `.${scope}` : "");
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

export function resolveDaemonServiceUpdateWorkerSystemdTimerUnitPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    pathInput.homeDir ?? homedir(),
    ".config",
    "systemd",
    "user",
    `${resolveDaemonServiceUpdateWorkerIdentity(pathInput).serviceName}.timer`
  );
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
  const protectedIds =
    contents === null
      ? new Set<string>()
      : readBundleIdsFromUpdateWorkerRegistration(contents);
  const launcherPath = daemonServiceUpdateWorkerNpmEntryPath(pathInput);
  const launcher = await readFile(launcherPath, "utf8").catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (launcher !== null) {
    const importLine = launcher.trim().match(NPM_ENTRY_IMPORT_PATTERN);
    if (!importLine?.[1]) {
      throw new Error(
        "OpenMeld maintenance launcher is invalid; bundle cleanup was stopped."
      );
    }
    const entryPath = fileURLToPath(JSON.parse(importLine[1]) as string);
    for (const id of readBundleIdsFromUpdateWorkerRegistration(entryPath)) {
      protectedIds.add(id);
    }
  }
  return protectedIds;
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
