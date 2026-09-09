import { stat } from "node:fs/promises";
import process from "node:process";
import { readDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import type {
  DaemonLifecycleIntent,
  DaemonRunMode,
  DaemonServiceController,
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../../config/daemon-state";
import {
  getDaemonStatus,
  readDaemonServiceLifecycleLockMetaWithCleanup,
} from "../../config/daemon-state";
import type { OpenMeldLockMeta } from "../../config/lock";
import { OPENMELD_HOME_ENV_KEY } from "../../config/paths";
import {
  type DaemonRuntimeContractCompatibility,
  resolveDaemonRuntimeContractCompatibility,
} from "./daemon-runtime-contract-compatibility";
import { resolveDaemonServiceArtifact } from "./daemon-service-artifact";
import {
  readDaemonActiveBundleState,
  resolveCurrentDaemonSourceDistFingerprint,
  resolveDaemonBundleEntryPathFromState,
} from "./daemon-service-bundle";
import { normalizeDaemonCommandPath } from "./daemon-service-command-path";
import {
  inspectLegacySharedDaemonService,
  type LegacySharedDaemonServiceInspection,
} from "./daemon-service-legacy-shared";
import {
  type DaemonServiceManager,
  type DaemonServiceManagerRuntimeStatus,
  resolveDaemonServiceManager,
} from "./daemon-service-manager";
import { matchesExpectedDaemonServiceManagerDefinition } from "./daemon-service-manager-command-match";
import {
  buildDaemonOwnerSnapshotFromObservedState,
  formatDaemonOwnerKinds,
} from "./daemon-service-owner-snapshot";
import {
  type DaemonOwnedProcess,
  listDaemonOwnedProcesses,
} from "./daemon-service-process-inventory";
import { getEffectiveDaemonRuntimeStatus } from "./daemon-service-runtime";
import {
  resolveObservedDaemonRuntimeStatus,
  resolveObservedRuntimeCommandEntryPath,
} from "./daemon-service-runtime-observer";
import { resolveVersionChangeDirection } from "./version-change-direction";

export type DaemonServiceAnomalyCode =
  | "not_installed"
  | "legacy_shared_service_present"
  | "version_outdated"
  | "downgrade_blocked"
  | "runtime_stale"
  | "runtime_contract_missing"
  | "runtime_contract_mismatch"
  | "runtime_contract_unavailable"
  | "manager_running_without_runtime"
  | "multiple_active_owners"
  | "legacy_detached_runtime"
  | "runtime_bundle_mismatch"
  | "bundle_missing"
  | "bundle_content_drift"
  | "bundle_id_drift"
  | "bundle_version_drift"
  | "bundle_lane_drift"
  | "bundle_strategy_legacy"
  | "bundle_provenance_drift"
  | "bundle_path_invalid"
  | "service_manager_path_drift"
  | "service_manager_environment_drift"
  | "service_manager_startup_policy_drift"
  | "duplicate_owned_processes"
  | "foreground_background_conflict"
  | "background_foreground_conflict"
  | "lifecycle_locked";

export type DaemonServiceAnomaly = {
  code: DaemonServiceAnomalyCode;
  message: string;
};

export type DaemonServiceInventory = {
  expectedVersion: string;
  installStatus: DaemonStatus;
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceContract?: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  runtimeLease?: Awaited<ReturnType<typeof readDaemonRuntimeLease>>;
  legacySharedService: LegacySharedDaemonServiceInspection | null;
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>;
  activeBundleSourceAvailable: boolean | null;
  activeBundleEntryPath: string | null;
  runtimeCommandEntryPath: string | null;
  runtimeCommandPathExists: boolean | null;
  runtimeContractCompatibility?: DaemonRuntimeContractCompatibility;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  ownedProcesses: DaemonOwnedProcess[];
  lifecycleLock: OpenMeldLockMeta | null;
  anomalies: DaemonServiceAnomaly[];
};

export async function inspectDaemonServiceInventory(input: {
  expectedVersion: string;
  intendedMode?: DaemonRunMode;
  intent?: DaemonLifecycleIntent;
  cliScriptPath?: string;
  readDaemonStatus?: typeof getDaemonStatus;
  resolveServiceManager?: typeof resolveDaemonServiceManager;
  listOwnedProcesses?: typeof listDaemonOwnedProcesses;
}): Promise<DaemonServiceInventory> {
  // OPENMELD_SERVICE_THIN_CORE: lifecycle/diagnostic inventory.
  // This describes the local service installation and process state. It may
  // guide repair, but must not decide final Agent readiness or Wake outcome.
  const readDaemonStatus = input.readDaemonStatus ?? getDaemonStatus;
  const resolveServiceManager =
    input.resolveServiceManager ?? resolveDaemonServiceManager;
  const listOwnedProcesses =
    input.listOwnedProcesses ?? listDaemonOwnedProcesses;
  const ignoredInventoryProcessIds = [process.pid, process.ppid].filter(
    (pid): pid is number => Number.isInteger(pid) && pid > 0
  );

  const [
    installStatus,
    runtimeLease,
    serviceContract,
    legacySharedService,
    activeBundle,
    lifecycleLock,
    ownedProcesses,
  ] = await Promise.all([
    readDaemonStatus(),
    readDaemonRuntimeLease().catch(() => null),
    readDaemonServiceContract().catch(() => null),
    inspectLegacySharedDaemonService(),
    readDaemonActiveBundleState(),
    readDaemonServiceLifecycleLockMetaWithCleanup(),
    listOwnedProcesses({
      ignoreProcessIds: ignoredInventoryProcessIds,
    }),
  ]);
  const activeBundleSourceAvailable =
    await resolveActiveBundleSourceAvailability(activeBundle);
  const runtimeStatus = resolveObservedDaemonRuntimeStatus({
    runtimeLease,
    ownedProcesses,
  });
  const runtimeContractCompatibility =
    await resolveDaemonRuntimeContractCompatibility({
      runtimeStatus,
    });
  const activeBundleEntryPath = await resolveDaemonBundleEntryPathFromState(
    activeBundle
  ).catch(() => null);
  const runtimeCommandEntryPath = resolveObservedRuntimeCommandEntryPath({
    ownedProcesses,
    runtimeStatus,
  });
  const runtimeCommandPathExists = runtimeCommandEntryPath
    ? await pathExists(runtimeCommandEntryPath).catch(() => null)
    : null;
  const currentSourceDistFingerprint =
    activeBundle?.bundleFormat === "self_contained_v1"
      ? await resolveCurrentDaemonSourceDistFingerprint({
          cliScriptPath: input.cliScriptPath,
        }).catch(() => null)
      : null;
  const resolvedArtifact = resolveDaemonServiceArtifact({
    expectedVersion: input.expectedVersion,
    installStatus,
    serviceContract,
    activeBundle,
    activeBundleSourceAvailable,
    activeBundleEntryPath,
    currentSourceDistFingerprint,
  });
  const mergedOwnedProcesses = mergeOwnedProcesses(
    ownedProcesses,
    legacySharedService?.present ? legacySharedService.ownedProcesses : []
  );

  const shouldReadServiceManager =
    installStatus.installed ||
    runtimeStatus.managedBySystemService ||
    runtimeStatus.serviceController !== "unknown" ||
    isKnownServiceController(serviceContract?.serviceController);
  const observedServiceManager = shouldReadServiceManager
    ? await resolveServiceManager(
        resolvePreferredServiceManagerController({
          runtimeStatus,
          serviceContract,
        }) ?? undefined
      )
    : null;
  const observedServiceManagerStatus = observedServiceManager
    ? await observedServiceManager.status().catch(() => null)
    : null;
  const scopedServiceManager = scopeServiceManagerToCurrentRoot({
    runtimeStatus,
    serviceManager: observedServiceManager,
    serviceManagerStatus: observedServiceManagerStatus,
    serviceManagerDefinitionMatchesCurrentRoot:
      observedServiceManager &&
      observedServiceManagerStatus?.installed &&
      observedServiceManagerStatus.definitionPath
        ? await matchesExpectedDaemonServiceManagerDefinition({
            controller: observedServiceManager.controller,
            definitionPath: observedServiceManagerStatus.definitionPath,
            commandSpec: observedServiceManagerStatus.commandSpec,
          }).catch(() => false)
        : null,
  });

  const anomalies = buildDaemonServiceAnomalies({
    activeBundle,
    activeBundleSourceAvailable,
    activeBundleEntryPath,
    activeBundleSourceEntryPath: activeBundle?.sourceEntryScriptPath ?? null,
    runtimeCommandEntryPath,
    runtimeCommandPathExists,
    runtimeContractCompatibility,
    resolvedArtifact,
    expectedVersion: input.expectedVersion,
    installStatus,
    intendedMode: input.intendedMode,
    legacySharedService,
    lifecycleLock,
    ownedProcesses: mergedOwnedProcesses,
    runtimeStatus,
    effectiveRuntimeStatus: getEffectiveDaemonRuntimeStatus({
      runtimeState: runtimeStatus,
      serviceManagerStatus: scopedServiceManager.serviceManagerStatus,
    }),
    serviceContract,
    serviceManager: scopedServiceManager.serviceManager,
    serviceManagerStatus: scopedServiceManager.serviceManagerStatus,
    serviceManagerDefinitionMatchesCurrentRoot:
      scopedServiceManager.serviceManagerDefinitionMatchesCurrentRoot,
  });

  return {
    expectedVersion: input.expectedVersion,
    installStatus,
    runtimeStatus,
    ...(serviceContract ? { serviceContract } : {}),
    ...(runtimeLease ? { runtimeLease } : {}),
    legacySharedService,
    activeBundle,
    activeBundleSourceAvailable,
    activeBundleEntryPath,
    runtimeCommandEntryPath,
    runtimeCommandPathExists,
    runtimeContractCompatibility,
    serviceManager: scopedServiceManager.serviceManager,
    serviceManagerStatus: scopedServiceManager.serviceManagerStatus,
    ownedProcesses: mergedOwnedProcesses,
    lifecycleLock,
    anomalies,
  };
}

async function resolveActiveBundleSourceAvailability(
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>
): Promise<boolean | null> {
  if (activeBundle?.bundleFormat !== "legacy_linked_v1") {
    return null;
  }
  return await pathExists(activeBundle.sourcePackageRootPath).catch(() => null);
}

function scopeServiceManagerToCurrentRoot(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  serviceManagerDefinitionMatchesCurrentRoot: boolean | null;
}): {
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  serviceManagerDefinitionMatchesCurrentRoot: boolean | null;
} {
  if (!hasExplicitOpenMeldHomeOverride()) {
    return {
      serviceManager: input.serviceManager,
      serviceManagerStatus: input.serviceManagerStatus,
      serviceManagerDefinitionMatchesCurrentRoot:
        input.serviceManagerDefinitionMatchesCurrentRoot,
    };
  }

  if (
    input.runtimeStatus.managedBySystemService ||
    input.runtimeStatus.serviceController !== "unknown"
  ) {
    return {
      serviceManager: input.serviceManager,
      serviceManagerStatus: input.serviceManagerStatus,
      serviceManagerDefinitionMatchesCurrentRoot:
        input.serviceManagerDefinitionMatchesCurrentRoot,
    };
  }

  if (!input.serviceManagerStatus?.installed) {
    return {
      serviceManager: input.serviceManager,
      serviceManagerStatus: input.serviceManagerStatus,
      serviceManagerDefinitionMatchesCurrentRoot:
        input.serviceManagerDefinitionMatchesCurrentRoot,
    };
  }

  if (input.serviceManagerDefinitionMatchesCurrentRoot === true) {
    return {
      serviceManager: input.serviceManager,
      serviceManagerStatus: input.serviceManagerStatus,
      serviceManagerDefinitionMatchesCurrentRoot:
        input.serviceManagerDefinitionMatchesCurrentRoot,
    };
  }

  return {
    serviceManager: null,
    serviceManagerStatus: null,
    serviceManagerDefinitionMatchesCurrentRoot: null,
  };
}

function hasExplicitOpenMeldHomeOverride(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return String(env[OPENMELD_HOME_ENV_KEY] ?? "").trim().length > 0;
}

function buildDaemonServiceAnomalies(input: {
  expectedVersion: string;
  installStatus: DaemonStatus;
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  legacySharedService: LegacySharedDaemonServiceInspection | null;
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>;
  activeBundleSourceAvailable: boolean | null;
  activeBundleEntryPath: string | null;
  activeBundleSourceEntryPath: string | null;
  runtimeCommandEntryPath: string | null;
  runtimeCommandPathExists: boolean | null;
  runtimeContractCompatibility: DaemonRuntimeContractCompatibility;
  resolvedArtifact: ReturnType<typeof resolveDaemonServiceArtifact>;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  serviceManagerDefinitionMatchesCurrentRoot: boolean | null;
  ownedProcesses: DaemonOwnedProcess[];
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  lifecycleLock: OpenMeldLockMeta | null;
  intendedMode?: DaemonRunMode;
}): DaemonServiceAnomaly[] {
  if (!input.installStatus.installed) {
    if (input.legacySharedService?.present) {
      return [
        {
          code: "legacy_shared_service_present",
          message:
            "A legacy shared OpenMeld Service from the pre-lane release is still installed and must be migrated to this lane.",
        },
      ];
    }
    return [
      {
        code: "not_installed",
        message: "OpenMeld Service is not installed on this device.",
      },
    ];
  }

  const anomalies: DaemonServiceAnomaly[] = [];
  if (input.legacySharedService?.present) {
    anomalies.push({
      code: "legacy_shared_service_present",
      message:
        "A legacy shared OpenMeld Service from the pre-lane release is still installed and should be cleaned up during this lane migration.",
    });
  }
  const versionAnomaly = resolveVersionAnomaly({
    expectedVersion: input.expectedVersion,
    installStatus: input.installStatus,
    serviceContract: input.serviceContract,
  });
  if (versionAnomaly) {
    anomalies.push(versionAnomaly);
  }
  const runtimeAnomalies = buildRuntimeHealthAnomalies(input);
  const bundleAnomalies = buildBundleAnomalies({
    expectedVersion: input.expectedVersion,
    serviceContract: input.serviceContract,
    activeBundle: input.activeBundle,
    resolvedArtifact: input.resolvedArtifact,
  });
  const processAnomalies = buildProcessAnomalies(input);
  anomalies.push(...runtimeAnomalies, ...bundleAnomalies, ...processAnomalies);

  if (input.lifecycleLock && input.lifecycleLock.pid !== process.pid) {
    anomalies.push({
      code: "lifecycle_locked",
      message: buildLifecycleLockedMessage(input.lifecycleLock),
    });
  }

  return anomalies;
}

function resolveVersionAnomaly(input: {
  expectedVersion: string;
  installStatus: DaemonStatus;
  serviceContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
}): DaemonServiceAnomaly | null {
  const observedVersion =
    input.serviceContract?.daemonVersion ??
    input.installStatus.state?.daemonVersion ??
    null;
  if (!observedVersion) {
    return null;
  }
  const versionDirection = resolveVersionChangeDirection({
    fromVersion: observedVersion,
    toVersion: input.expectedVersion,
  });
  if (versionDirection === "upgrade") {
    return {
      code: "version_outdated",
      message: `Configured OpenMeld Service version is v${observedVersion}, expected v${input.expectedVersion}.`,
    };
  }
  if (versionDirection === "downgrade") {
    return {
      code: "downgrade_blocked",
      message: `Configured OpenMeld Service version v${observedVersion} is newer than current CLI v${input.expectedVersion}.`,
    };
  }
  return null;
}

function buildRuntimeHealthAnomalies(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  activeBundleEntryPath: string | null;
  activeBundleSourceEntryPath: string | null;
  runtimeCommandEntryPath: string | null;
  runtimeCommandPathExists: boolean | null;
  runtimeContractCompatibility: DaemonRuntimeContractCompatibility;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  serviceManagerDefinitionMatchesCurrentRoot: boolean | null;
  ownedProcesses: DaemonOwnedProcess[];
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
}): DaemonServiceAnomaly[] {
  const anomalies: DaemonServiceAnomaly[] = [];
  const ownerSnapshot = buildDaemonOwnerSnapshotFromObservedState({
    runtimeStatus: input.runtimeStatus,
    serviceManager: input.serviceManager,
    serviceManagerStatus: input.serviceManagerStatus,
    effectiveRuntimeStatus: input.effectiveRuntimeStatus,
    ownedProcesses: input.ownedProcesses,
  });

  if (
    input.serviceManagerStatus?.installed &&
    input.serviceManagerStatus.startupPolicyCurrent === false
  ) {
    anomalies.push({
      code: "service_manager_startup_policy_drift",
      message:
        "The installed macOS Service still uses an outdated scheduling policy.",
    });
  }

  if (input.runtimeStatus.status === "stale") {
    anomalies.push({
      code: "runtime_stale",
      message: `Runtime state is stale (${input.runtimeStatus.reason ?? "unknown"}).`,
    });
  }
  if (
    input.serviceManagerStatus?.running &&
    input.runtimeStatus.status !== "running"
  ) {
    anomalies.push({
      code: "manager_running_without_runtime",
      message:
        "The OS service manager reports OpenMeld Service as running, but runtime state is not healthy.",
    });
  }
  if (ownerSnapshot.ownerSetSummary === "multiple_owners") {
    anomalies.push({
      code: "multiple_active_owners",
      message: `Multiple OpenMeld Service owners are active on this device: ${formatDaemonOwnerKinds(ownerSnapshot.activeOwnerKinds)}.`,
    });
  }
  if (
    input.runtimeStatus.status === "running" &&
    input.runtimeStatus.serviceController === "legacy-detached"
  ) {
    anomalies.push({
      code: "legacy_detached_runtime",
      message:
        "OpenMeld Service is still using the legacy detached runtime instead of the managed system service path.",
    });
  }
  if (
    input.serviceManagerStatus?.installed &&
    input.serviceManagerDefinitionMatchesCurrentRoot === false
  ) {
    anomalies.push({
      code: "service_manager_path_drift",
      message:
        "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
    });
  }
  if (
    (input.runtimeStatus.status === "running" ||
      input.runtimeStatus.status === "stale") &&
    // An exited process has no live command to compare. Its stale lease is
    // restart evidence, not evidence that service files or registration broke.
    (input.runtimeStatus.reason !== "process_not_alive" ||
      input.ownedProcesses.some(
        (processInfo) => processInfo.pid === input.runtimeStatus.pid
      )) &&
    hasRuntimeBundleMismatch({
      activeBundleEntryPath: input.activeBundleEntryPath,
      activeBundleSourceEntryPath: input.activeBundleSourceEntryPath,
      runtimeCommandEntryPath: input.runtimeCommandEntryPath,
      runtimeCommandPathExists: input.runtimeCommandPathExists,
    })
  ) {
    anomalies.push({
      code: "runtime_bundle_mismatch",
      message: buildRuntimeBundleMismatchMessage({
        activeBundleEntryPath: input.activeBundleEntryPath,
        activeBundleSourceEntryPath: input.activeBundleSourceEntryPath,
        runtimeCommandEntryPath: input.runtimeCommandEntryPath,
        runtimeCommandPathExists: input.runtimeCommandPathExists,
      }),
    });
  }
  const runtimeContractAnomaly = buildRuntimeContractCompatibilityAnomaly(
    input.runtimeContractCompatibility
  );
  if (runtimeContractAnomaly) {
    anomalies.push(runtimeContractAnomaly);
  }
  return anomalies;
}

function buildRuntimeContractCompatibilityAnomaly(
  compatibility: DaemonRuntimeContractCompatibility
): DaemonServiceAnomaly | null {
  switch (compatibility.status) {
    case "missing":
      return {
        code: "runtime_contract_missing",
        message:
          "OpenMeld Service runtime contract metadata is missing for the active daemon.",
      };
    case "mismatch":
      return {
        code: "runtime_contract_mismatch",
        message: `OpenMeld Service runtime contract epoch is ${compatibility.observedEpoch ?? "unknown"}, but the current CLI expects ${compatibility.expectedEpoch}.`,
      };
    case "unavailable":
      return {
        code: "runtime_contract_unavailable",
        message: `OpenMeld Service runtime contract metadata could not be read: ${compatibility.errorMessage ?? "unknown error"}.`,
      };
    case "compatible":
    case "not_observed":
      return null;
    default:
      return null;
  }
}

function buildBundleAnomalies(input: {
  expectedVersion: string;
  serviceContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>;
  resolvedArtifact: ReturnType<typeof resolveDaemonServiceArtifact>;
}): DaemonServiceAnomaly[] {
  return input.resolvedArtifact.driftReasonCodes
    .map((reasonCode) => buildBundleAnomaly({ ...input, reasonCode }))
    .filter((anomaly): anomaly is DaemonServiceAnomaly => anomaly !== null);
}

function buildBundleAnomaly(input: {
  expectedVersion: string;
  serviceContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>;
  resolvedArtifact: ReturnType<typeof resolveDaemonServiceArtifact>;
  reasonCode: ReturnType<
    typeof resolveDaemonServiceArtifact
  >["driftReasonCodes"][number];
}): DaemonServiceAnomaly | null {
  switch (input.reasonCode) {
    case "bundle_missing":
      return {
        code: "bundle_missing",
        message: "OpenMeld Service files are missing.",
      };
    case "bundle_version_drift": {
      const installVersion =
        input.serviceContract?.daemonVersion ??
        input.resolvedArtifact.installVersion ??
        input.expectedVersion;
      const activeVersion =
        input.resolvedArtifact.activeBundleVersion ?? "unknown";
      return {
        code: "bundle_version_drift",
        message: `OpenMeld Service is running local service files for v${activeVersion}, but this lane expects v${installVersion}.`,
      };
    }
    case "bundle_id_drift": {
      const expectedBundleId = input.serviceContract?.bundleId ?? "unknown";
      const activeBundleId = input.activeBundle?.bundleId ?? "unknown";
      return {
        code: "bundle_id_drift",
        message: `OpenMeld Service is using local service files that do not match this lane (${activeBundleId} != ${expectedBundleId}).`,
      };
    }
    case "bundle_content_drift":
      return {
        code: "bundle_content_drift",
        message:
          "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
      };
    case "bundle_lane_drift":
      return {
        code: "bundle_lane_drift",
        message:
          "OpenMeld Service is using repo-local service files in a lane that only allows published or packaged service files. Use `openmeld-dev` for repo-local service validation.",
      };
    case "bundle_strategy_legacy":
      return {
        code: "bundle_strategy_legacy",
        message:
          "OpenMeld Service is using an older local service file layout.",
      };
    case "bundle_provenance_drift":
      return {
        code: "bundle_provenance_drift",
        message:
          "OpenMeld Service still depends on a local CLI source path that is no longer available.",
      };
    case "bundle_path_invalid":
      return {
        code: "bundle_path_invalid",
        message: "OpenMeld Service entry file is missing.",
      };
    default:
      return null;
  }
}

function buildProcessAnomalies(input: {
  ownedProcesses: DaemonOwnedProcess[];
  runtimeStatus: DaemonServiceRuntimeStatus;
  intendedMode?: DaemonRunMode;
}): DaemonServiceAnomaly[] {
  const anomalies: DaemonServiceAnomaly[] = [];
  if (input.ownedProcesses.length > 1) {
    anomalies.push({
      code: "duplicate_owned_processes",
      message: `Found ${String(input.ownedProcesses.length)} OpenMeld-owned service processes on this device.`,
    });
  }
  if (
    input.runtimeStatus.status === "running" &&
    input.intendedMode === "foreground" &&
    input.runtimeStatus.mode === "background"
  ) {
    anomalies.push({
      code: "foreground_background_conflict",
      message:
        "OpenMeld background service is already running, so foreground mode cannot start in parallel.",
    });
  }
  if (
    input.runtimeStatus.status === "running" &&
    input.intendedMode === "background" &&
    input.runtimeStatus.mode === "foreground"
  ) {
    anomalies.push({
      code: "background_foreground_conflict",
      message:
        "OpenMeld foreground service is already running, so background mode cannot start in parallel.",
    });
  }
  return anomalies;
}

function resolvePreferredServiceManagerController(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
}): DaemonServiceController | null {
  if (input.runtimeStatus.serviceController !== "unknown") {
    return input.runtimeStatus.serviceController;
  }
  if (isKnownServiceController(input.serviceContract?.serviceController)) {
    return input.serviceContract.serviceController;
  }
  return null;
}

function isKnownServiceController(
  controller: DaemonServiceController | null | undefined
): controller is Exclude<DaemonServiceController, "unknown"> {
  return Boolean(controller && controller !== "unknown");
}

function hasRuntimeBundleMismatch(input: {
  activeBundleEntryPath: string | null;
  activeBundleSourceEntryPath: string | null;
  runtimeCommandEntryPath: string | null;
  runtimeCommandPathExists: boolean | null;
}): boolean {
  if (
    !input.runtimeCommandEntryPath ||
    input.runtimeCommandPathExists !== true
  ) {
    return true;
  }
  if (!input.activeBundleEntryPath) {
    return true;
  }
  const normalizedRuntimePath = normalizeDaemonCommandPath(
    input.runtimeCommandEntryPath
  );
  const acceptedEntryPaths = new Set([
    normalizeDaemonCommandPath(input.activeBundleEntryPath),
    ...(input.activeBundleSourceEntryPath
      ? [normalizeDaemonCommandPath(input.activeBundleSourceEntryPath)]
      : []),
  ]);
  return !acceptedEntryPaths.has(normalizedRuntimePath);
}

function buildRuntimeBundleMismatchMessage(input: {
  activeBundleEntryPath: string | null;
  activeBundleSourceEntryPath: string | null;
  runtimeCommandEntryPath: string | null;
  runtimeCommandPathExists: boolean | null;
}): string {
  if (!input.runtimeCommandEntryPath) {
    return "OpenMeld Service runtime state does not point at a concrete service entry path.";
  }
  if (input.runtimeCommandPathExists !== true) {
    return "OpenMeld Service runtime state still points at a service entry file that no longer exists.";
  }
  if (!input.activeBundleEntryPath) {
    return "OpenMeld Service is running from a service entry path that does not match the active service files.";
  }
  if (input.activeBundleSourceEntryPath) {
    return `OpenMeld Service is running from ${input.runtimeCommandEntryPath}, but neither the active service entry (${input.activeBundleEntryPath}) nor the service source entry (${input.activeBundleSourceEntryPath}) matches this runtime.`;
  }
  return `OpenMeld Service is running from ${input.runtimeCommandEntryPath}, but the active service files point at ${input.activeBundleEntryPath}.`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return error.code !== "ENOENT";
    }
    throw error;
  }
}

function buildLifecycleLockedMessage(meta: OpenMeldLockMeta): string {
  const intent = typeof meta.intent === "string" ? meta.intent : "unknown";
  const command = typeof meta.command === "string" ? meta.command : "unknown";
  const pid = typeof meta.pid === "number" ? ` pid ${String(meta.pid)}` : "";
  return `Another OpenMeld Service task is already running (${command}, intent ${intent}${pid}).`;
}

function mergeOwnedProcesses(
  currentLaneProcesses: DaemonOwnedProcess[],
  legacySharedProcesses: DaemonOwnedProcess[]
): DaemonOwnedProcess[] {
  if (legacySharedProcesses.length === 0) {
    return currentLaneProcesses;
  }
  const merged = [...currentLaneProcesses];
  const seenPids = new Set(
    currentLaneProcesses.map((processInfo) => processInfo.pid)
  );
  for (const processInfo of legacySharedProcesses) {
    if (seenPids.has(processInfo.pid)) {
      continue;
    }
    merged.push(processInfo);
    seenPids.add(processInfo.pid);
  }
  return merged;
}
