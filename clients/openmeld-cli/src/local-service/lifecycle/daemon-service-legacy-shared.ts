import {
  type DaemonServiceRuntimeStatus,
  type DaemonStatus,
  getDaemonRuntimeStatus,
  getDaemonStatus,
  uninstallDaemon,
} from "../../config/daemon-state";
import {
  OPENMELD_HOME_ENV_KEY,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "../../config/paths";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "./daemon-service-manager";
import { resolveDaemonServiceManager } from "./daemon-service-manager";
import { matchesExpectedDaemonServiceManagerCommand } from "./daemon-service-manager-command-match";
import type { DaemonOwnedProcess } from "./daemon-service-process-inventory";
import { listDaemonOwnedProcesses } from "./daemon-service-process-inventory";

export type LegacySharedDaemonServiceInspection = {
  present: boolean;
  pathInput: OpenMeldPathResolutionInput;
  installStatus: DaemonStatus;
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  ownedProcesses: DaemonOwnedProcess[];
};

const PROD_ENV_PRESET = "prod";

export function shouldInspectLegacySharedDaemonService(
  input: OpenMeldPathResolutionInput = {}
): boolean {
  const env = input.env ?? process.env;
  if (String(env[OPENMELD_HOME_ENV_KEY] ?? "").trim()) {
    return false;
  }
  return resolveOpenMeldEnvPreset(input) !== PROD_ENV_PRESET;
}

export function resolveLegacySharedDaemonPathInput(
  input: OpenMeldPathResolutionInput = {}
): OpenMeldPathResolutionInput | null {
  if (!shouldInspectLegacySharedDaemonService(input)) {
    return null;
  }
  return {
    ...input,
    env: {
      ...(input.env ?? process.env),
      OPENMELD_ENV_PRESET: PROD_ENV_PRESET,
    },
  };
}

export function requiresLegacySharedDaemonServiceMigration(input: {
  pathInput: OpenMeldPathResolutionInput;
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  ownedProcesses: DaemonOwnedProcess[];
}): boolean {
  if (hasLegacySharedServiceManagerResidual(input)) {
    return true;
  }
  return hasLegacyDetachedResidual(input);
}

export async function inspectLegacySharedDaemonService(
  input: OpenMeldPathResolutionInput = {}
): Promise<LegacySharedDaemonServiceInspection | null> {
  const pathInput = resolveLegacySharedDaemonPathInput(input);
  if (!pathInput) {
    return null;
  }

  const [installStatus, runtimeStatus, serviceManager, ownedProcesses] =
    await Promise.all([
      getDaemonStatus(pathInput),
      getDaemonRuntimeStatus(pathInput),
      resolveDaemonServiceManager(undefined, pathInput).catch(() => null),
      listDaemonOwnedProcesses({ pathInput }).catch(() => []),
    ]);

  const serviceManagerStatus = serviceManager
    ? await serviceManager
        .status()
        .catch<DaemonServiceManagerRuntimeStatus | null>(() => null)
    : null;

  const present = requiresLegacySharedDaemonServiceMigration({
    pathInput,
    runtimeStatus,
    serviceManager,
    serviceManagerStatus,
    ownedProcesses,
  });

  return {
    present,
    pathInput,
    installStatus,
    runtimeStatus,
    serviceManager,
    serviceManagerStatus,
    ownedProcesses,
  };
}

function hasLegacySharedServiceManagerResidual(input: {
  pathInput: OpenMeldPathResolutionInput;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): boolean {
  if (!input.serviceManagerStatus?.installed) {
    return false;
  }
  if (!input.serviceManagerStatus.commandSummary) {
    return true;
  }
  return !matchesExpectedDaemonServiceManagerCommand({
    controller: input.serviceManager?.controller ?? null,
    commandSummary: input.serviceManagerStatus.commandSummary,
    definitionPath: input.serviceManagerStatus.definitionPath ?? null,
    includeLegacyExecutableWrappers: true,
    pathInput: input.pathInput,
  });
}

function hasLegacyDetachedResidual(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  ownedProcesses: DaemonOwnedProcess[];
}): boolean {
  if (input.runtimeStatus.serviceController === "legacy-detached") {
    return true;
  }
  return input.ownedProcesses.some(
    (processInfo) => processInfo.ownership === "legacy_detached"
  );
}

export async function cleanupLegacySharedDaemonServiceState(
  input: OpenMeldPathResolutionInput = {}
): Promise<{ removed: boolean }> {
  const pathInput = resolveLegacySharedDaemonPathInput(input);
  if (!pathInput) {
    return { removed: false };
  }
  const legacySharedService = await inspectLegacySharedDaemonService(input);
  let removedServiceManager = false;
  if (
    legacySharedService?.present &&
    legacySharedService.serviceManager &&
    legacySharedService.serviceManagerStatus?.installed
  ) {
    await legacySharedService.serviceManager.uninstall();
    await legacySharedService.serviceManager.waitUntilAbsent();
    removedServiceManager = true;
  }
  const uninstallResult = await uninstallDaemon(pathInput);
  return {
    removed: removedServiceManager || uninstallResult.removed,
  };
}
