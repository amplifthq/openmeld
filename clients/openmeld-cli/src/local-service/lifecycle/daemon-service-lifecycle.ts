import process from "node:process";
import type {
  DaemonServiceContract,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import { sleep, toErrorMessage } from "@openmeld/utils";
import {
  normalizeGatewayBaseUrlOrNull,
  resolveExplicitGatewayUrlOrThrow,
} from "../../config/base-url";
import {
  clearDaemonServiceContract,
  isDaemonServiceContractIdentityReusable,
  isUnsafeProductionDeviceId,
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../../config/daemon-service-contract";
import {
  type DaemonInstallSource,
  type DaemonInstallState,
  installDaemon,
  readDaemonServiceRuntimeSnapshot,
  restoreDaemonInstallStateSnapshot,
  rotateDaemonControlPlaneTokenIfExpired,
} from "../../config/daemon-state";
import {
  type OpenMeldEnvironmentTarget,
  resolveOpenMeldEnvironmentTarget,
  resolveOpenMeldEnvironmentTargetFromEnv,
} from "../../config/openmeld-environment-target";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import { resolveOpenMeldEnvPreset } from "../../config/paths";
import { resolveOpenMeldProfileOrNull } from "../../config/resolve-openmeld-profile";
import { compareSemver, readVersionState } from "../../config/version-state";
import type { OpenMeldDistribution } from "../../runtime/distribution";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonShutdown,
} from "../control-plane/client";
import { CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS } from "../core/constants";
import {
  normalizeHeartbeatIntervalMs,
  normalizeOptionalText,
} from "../core/logger";
import {
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
  resolvePreferredDaemonDeviceId,
} from "../state/daemon-device-id";
import {
  backupDaemonRuntimeDataForReinstall,
  cleanupDaemonRuntimeDataBackup,
  cleanupStaleDaemonRuntimeDataBackups,
  type DaemonRuntimeDataBackup,
  restoreDaemonRuntimeDataForReinstall,
} from "../state/runtime-data-preservation";
import {
  emitDaemonLifecycleEvent,
  runDaemonServiceManagerAction,
} from "./daemon-lifecycle-journal";
import {
  buildDaemonServiceTargetSpec,
  resolveDaemonServiceAlignmentDecision,
} from "./daemon-service-alignment-target";
import {
  activateDaemonServiceBundle,
  type DaemonActiveBundleState,
  discardPreparedDaemonServiceBundle,
  isDaemonBundleSourceAllowedForLane,
  prepareDaemonServiceBundle,
  restoreDaemonActiveBundleStateSnapshot,
  verifyDaemonActiveBundleIntegrity,
} from "./daemon-service-bundle";
import { normalizeDaemonCommandPath } from "./daemon-service-command-path";
import {
  buildDaemonSystemServiceCommandSpec,
  ensureDaemonSystemServiceCommandFiles,
} from "./daemon-service-command-spec";
import {
  type DaemonServiceContractMissingField,
  writeDaemonServiceContract,
} from "./daemon-service-contract-writer";
import {
  captureDaemonServiceEvidenceBestEffort,
  type DaemonServiceFailureStage,
} from "./daemon-service-evidence";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "./daemon-service-inventory";
import { inspectDaemonServiceInventory } from "./daemon-service-inventory";
import { cleanupLegacySharedDaemonServiceState } from "./daemon-service-legacy-shared";
import {
  type DaemonServiceManager,
  disableDaemonServiceAutostartIfConfigured,
  resolveDaemonServiceManager,
} from "./daemon-service-manager";
import { listDaemonOwnedProcesses } from "./daemon-service-process-inventory";
import {
  clearDaemonRuntimeStateIfDefinitelyStopped,
  getEffectiveDaemonRuntimeStatus,
  readCurrentObservedDaemonRuntimeStatus,
  waitForDaemonSystemServiceToStop,
} from "./daemon-service-runtime";
import { forceKillStalledDaemonAfterStopTimeout } from "./daemon-service-stalled-force-kill";
import { startDaemonSystemServiceWithAutoRepair } from "./daemon-service-start-recovery";
import {
  isSystemServiceStartupTimeoutError,
  waitForSystemServiceStartup,
} from "./daemon-service-startup-wait";
import { ensureDaemonServiceMaintenanceInstalled } from "./daemon-service-update-worker-manager";
import { resolveVersionChangeDirection } from "./version-change-direction";

const STRICT_TEARDOWN_VERIFY_WAIT_MS = 15_000;
const STRICT_TEARDOWN_VERIFY_POLL_MS = 200;
const PROCESS_STOP_WAIT_MS = 2000;
const MISSING_CONTROLLED_SHUTDOWN_CLOSE_REASON_FIXED_VERSION = "0.2.88";
const MISSING_REQUIRED_CONTRACT_FIELDS_REASON =
  "missing_required_contract_fields";
const VERIFIED_ROLLBACK_UNTRUSTED_ANOMALIES = new Set<DaemonServiceAnomalyCode>(
  [
    "background_foreground_conflict",
    "bundle_id_drift",
    "bundle_lane_drift",
    "bundle_missing",
    "bundle_path_invalid",
    "bundle_provenance_drift",
    "bundle_strategy_legacy",
    "duplicate_owned_processes",
    "foreground_background_conflict",
    "legacy_detached_runtime",
    "legacy_shared_service_present",
    "lifecycle_locked",
    "multiple_active_owners",
    "runtime_bundle_mismatch",
  ]
);
const STOPPED_LIFECYCLE_RUNTIME_SNAPSHOT_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "runtime_stale",
    "runtime_bundle_mismatch",
    "runtime_contract_missing",
    "runtime_contract_mismatch",
    "runtime_contract_unavailable",
  ]);

export type DaemonServiceLifecycleOperation =
  | "upgrade_reconcile"
  | "reinstall"
  | "startup_repair";

export type DaemonServiceLifecyclePhase =
  | "inspect"
  | "backup"
  | "stop_or_drain"
  | "wait_stopped"
  | "unregister"
  | "wait_absent"
  | "prepare_bundle"
  | "install_bundle"
  | "write_contract"
  | "register_service"
  | "restore_runtime_data"
  | "start_if_desired"
  | "wait_running"
  | "verify_final_inventory";

export type DaemonServiceLifecycleRecoveryStatus =
  | "restored_verified_previous_state"
  | "stopped_safe_current_version"
  | "failed_before_safe_state";

type DaemonServiceLifecycleReasonCode =
  | DaemonServiceAnomalyCode
  | "unknown_owned_processes"
  | typeof MISSING_REQUIRED_CONTRACT_FIELDS_REASON;

export type DaemonServiceLifecycleOutcome =
  | {
      status: "already_aligned";
      targetVersion: string;
      inventoryBefore: DaemonServiceInventory;
      inventoryAfter: DaemonServiceInventory;
      reasonCodes: [];
      completedPhases: DaemonServiceLifecyclePhase[];
      desiredState: "background" | "stopped";
      shouldStartAfterLifecycle: boolean;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "aligned";
      targetVersion: string;
      inventoryBefore: DaemonServiceInventory;
      inventoryAfter: DaemonServiceInventory;
      reasonCodes: [];
      completedPhases: DaemonServiceLifecyclePhase[];
      desiredState: "background" | "stopped";
      shouldStartAfterLifecycle: boolean;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "stopped_safe";
      targetVersion: string;
      inventoryBefore: DaemonServiceInventory;
      inventoryAfter: DaemonServiceInventory;
      reasonCodes: DaemonServiceLifecycleReasonCode[];
      completedPhases: DaemonServiceLifecyclePhase[];
      desiredState: "background" | "stopped";
      shouldStartAfterLifecycle: boolean;
      backupDataPath: null;
      failureStage: DaemonServiceFailureStage | null;
      evidencePath: string | null;
      recoveryStatus: "stopped_safe_current_version";
      errorMessage: string;
    }
  | {
      status: "blocked";
      targetVersion: string;
      inventoryBefore: DaemonServiceInventory;
      inventoryAfter: DaemonServiceInventory;
      reasonCodes: DaemonServiceLifecycleReasonCode[];
      completedPhases: DaemonServiceLifecyclePhase[];
      desiredState: "background" | "stopped";
      shouldStartAfterLifecycle: boolean;
      backupDataPath: null;
      errorMessage: null;
    }
  | {
      status: "failed";
      targetVersion: string;
      inventoryBefore: DaemonServiceInventory | null;
      inventoryAfter: DaemonServiceInventory | null;
      reasonCodes: DaemonServiceLifecycleReasonCode[];
      completedPhases: DaemonServiceLifecyclePhase[];
      desiredState: "background" | "stopped" | null;
      shouldStartAfterLifecycle: boolean | null;
      backupDataPath: string | null;
      failureStage: DaemonServiceFailureStage | null;
      evidencePath: string | null;
      recoveryStatus: DaemonServiceLifecycleRecoveryStatus;
      errorCode: string | null;
      errorMessage: string;
    };

export class DaemonServiceLifecycleDrainTimeoutError extends Error {
  readonly waitMs: number;

  constructor(waitMs: number) {
    super(`graceful shutdown timed out after ${String(waitMs)}ms`);
    this.name = "DaemonServiceLifecycleDrainTimeoutError";
    this.waitMs = waitMs;
  }
}

export class DaemonServiceUpdateDeferredError extends Error {
  constructor() {
    super("New local work arrived before the update could switch the Service.");
    this.name = "DaemonServiceUpdateDeferredError";
  }
}

class DaemonServiceLifecycleControlledDrainError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(`controlled service drain failed: ${toErrorMessage(cause)}`);
    this.name = "DaemonServiceLifecycleControlledDrainError";
    this.cause = cause;
  }
}

class DaemonServiceLifecycleStageError extends Error {
  override readonly cause: unknown;
  readonly reasonCodes: DaemonServiceLifecycleReasonCode[];
  readonly stage: DaemonServiceFailureStage;

  constructor(input: {
    cause?: unknown;
    message: string;
    reasonCodes?: DaemonServiceLifecycleReasonCode[];
    stage: DaemonServiceFailureStage;
  }) {
    super(input.message);
    this.name = "DaemonServiceLifecycleStageError";
    this.stage = input.stage;
    this.reasonCodes = input.reasonCodes ?? [];
    this.cause = input.cause;
  }
}

type DaemonServiceLifecycleRestorePoint = {
  desiredState: "background" | "stopped";
  shouldStartAfterLifecycle: boolean;
  previousActiveBundle: DaemonActiveBundleState | null;
  previousContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  previousInstallState: DaemonInstallState | null;
  trusted: boolean;
};

type DaemonServiceLifecycleMutableState = {
  completedPhases: DaemonServiceLifecyclePhase[];
  inventoryBefore: DaemonServiceInventory | null;
  desiredState: "background" | "stopped" | null;
  shouldStartAfterLifecycle: boolean | null;
  runtimeDataBackup: DaemonRuntimeDataBackup | null;
  backupDataPath: string | null;
  backupRootPath: string | null;
  evidencePath: string | null;
  failureStage: DaemonServiceFailureStage | null;
};

type DaemonServiceLifecycleCommandOptions = {
  environmentTarget: OpenMeldEnvironmentTarget;
  gatewayUrl?: string;
  ownerUserId?: string;
  openMeldProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
};

type DaemonServiceLifecycleContext = {
  commandOptions: DaemonServiceLifecycleCommandOptions;
  currentContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  desiredState: "background" | "stopped";
  shouldStartAfterLifecycle: boolean;
  serviceManager: DaemonServiceManager;
};

function toLifecycleIntent(
  operation: DaemonServiceLifecycleOperation
): "startup_check" | "reinstall" | "upgrade_reconcile" {
  switch (operation) {
    case "reinstall":
      return "reinstall";
    case "upgrade_reconcile":
      return "upgrade_reconcile";
    case "startup_repair":
      return "startup_check";
    default:
      throw new Error(`Unsupported lifecycle operation: ${String(operation)}`);
  }
}

export async function runDaemonServiceLifecycle(input: {
  expectedVersion: string;
  operation: DaemonServiceLifecycleOperation;
  installSource: DaemonInstallSource;
  cliScriptPath?: string;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
  desiredState?: "background" | "stopped";
  shouldStartAfterLifecycle?: boolean;
  forceReinstall?: boolean;
  drainWaitMs?: number;
  forceKillAfterDrainTimeout?: boolean;
  onlyIfIdle?: true;
  preparedBundle?: DaemonActiveBundleState;
  onPhase?: (phase: DaemonServiceLifecyclePhase) => Promise<void> | void;
}): Promise<DaemonServiceLifecycleOutcome> {
  let preparedBundle: DaemonActiveBundleState | null =
    input.preparedBundle ?? null;
  const ownsPreparedBundle = input.preparedBundle === undefined;
  const state: DaemonServiceLifecycleMutableState = {
    completedPhases: [],
    inventoryBefore: null,
    desiredState: null,
    shouldStartAfterLifecycle: null,
    runtimeDataBackup: null,
    backupDataPath: null,
    backupRootPath: null,
    evidencePath: null,
    failureStage: null,
  };
  const target = buildDaemonServiceTargetSpec({
    daemonVersion: input.expectedVersion,
    gatewayUrl: input.gatewayUrl,
  });
  const emitPhase = async (
    phase: DaemonServiceLifecyclePhase
  ): Promise<void> => {
    state.completedPhases.push(phase);
    await input.onPhase?.(phase);
    await writeLifecycleEvidenceEvent({
      evidencePath: state.evidencePath,
      completedPhases: state.completedPhases,
      failureStage: state.failureStage,
    });
  };

  try {
    if (input.onlyIfIdle && input.forceKillAfterDrainTimeout) {
      throw new Error("An idle update switch cannot force-stop the Service.");
    }
    await emitPhase("inspect");
    state.inventoryBefore = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: resolveLifecycleIntendedMode(input),
      intent: toLifecycleIntent(input.operation),
    });
    const inventoryBefore = state.inventoryBefore;
    const desiredState =
      input.desiredState ?? resolveLifecycleDesiredState(inventoryBefore);
    const shouldStartAfterLifecycle =
      input.shouldStartAfterLifecycle ??
      resolveLifecycleShouldStartAfterLifecycle({
        desiredState,
        inventory: inventoryBefore,
      });
    state.desiredState = desiredState;
    state.shouldStartAfterLifecycle = shouldStartAfterLifecycle;
    const immediateOutcome = resolveImmediateLifecycleOutcome({
      completedPhases: state.completedPhases,
      desiredState,
      expectedVersion: input.expectedVersion,
      forceReinstall: input.forceReinstall === true,
      inventoryBefore,
      shouldStartAfterLifecycle,
      target,
    });
    if (immediateOutcome) {
      if (immediateOutcome.status === "already_aligned") {
        await cleanupStaleDaemonRuntimeDataBackupsAfterHealthyLifecycle(
          input.operation
        );
      }
      return immediateOutcome;
    }
    const serviceManager =
      await resolveLifecycleServiceManager(inventoryBefore);
    if (!serviceManager) {
      throw new DaemonServiceLifecycleStageError({
        message:
          "OpenMeld could not resolve a system service manager for local service lifecycle repair.",
        stage: "inspect",
      });
    }
    const commandOptions = await resolveLifecycleCommandOptions({
      inventory: inventoryBefore,
      gatewayUrl: input.gatewayUrl,
      profile: input.profile,
      deviceId: input.deviceId,
      heartbeatMs: input.heartbeatMs,
    });
    const restorePoint = await createLifecycleRestorePoint({
      desiredState,
      inventoryBefore,
      shouldStartAfterLifecycle,
    });
    const context: DaemonServiceLifecycleContext = {
      commandOptions,
      currentContract: inventoryBefore.serviceContract ?? null,
      desiredState,
      shouldStartAfterLifecycle,
      serviceManager,
    };

    state.evidencePath = await captureDaemonServiceEvidenceBestEffort({
      evidencePath: state.evidencePath ?? undefined,
      phase: "before_cleanup",
      profile: input.profile,
    });
    await writeLifecycleEvidenceEvent({
      evidencePath: state.evidencePath,
      completedPhases: state.completedPhases,
      failureStage: state.failureStage,
    });

    state.failureStage = "prepare_bundle";
    await emitPhase("prepare_bundle");
    preparedBundle = await resolveLifecycleReplacementBundle({
      cliScriptPath: input.cliScriptPath,
      daemonVersion: input.expectedVersion,
      preparedBundle,
    });

    return await executeDaemonServiceLifecycle({
      context,
      emitPhase,
      expectedVersion: input.expectedVersion,
      installSource: input.installSource,
      inventoryBefore,
      operation: input.operation,
      cliScriptPath: input.cliScriptPath,
      state,
      target,
      restorePoint,
      preparedBundle,
      drainWaitMs: input.drainWaitMs ?? PROCESS_STOP_WAIT_MS,
      forceKillAfterDrainTimeout: input.forceKillAfterDrainTimeout === true,
      onlyIfIdle: input.onlyIfIdle,
    });
  } catch (error) {
    if (
      error instanceof DaemonServiceLifecycleDrainTimeoutError ||
      error instanceof DaemonServiceUpdateDeferredError
    ) {
      throw error;
    }
    state.evidencePath =
      (await captureDaemonServiceEvidenceBestEffort({
        evidencePath: state.evidencePath ?? undefined,
        phase: "after_failure",
        profile: input.profile,
      })) ?? state.evidencePath;
    await writeLifecycleEvidenceEvent({
      evidencePath: state.evidencePath,
      completedPhases: state.completedPhases,
      failureStage: state.failureStage,
    });
    await cleanupStaleDaemonRuntimeDataBackups(
      buildFailedLifecycleBackupCleanupInput(state.backupRootPath)
    ).catch(() => undefined);
    return {
      status: "failed",
      targetVersion: input.expectedVersion,
      inventoryBefore: state.inventoryBefore,
      inventoryAfter: null,
      reasonCodes: [],
      completedPhases: state.completedPhases,
      desiredState: state.desiredState,
      shouldStartAfterLifecycle: state.shouldStartAfterLifecycle,
      backupDataPath: state.backupDataPath,
      failureStage: state.failureStage,
      evidencePath: state.evidencePath,
      recoveryStatus: "failed_before_safe_state",
      errorCode: resolveLifecycleFailureErrorCode(error),
      errorMessage: toErrorMessage(error),
    };
  } finally {
    await cleanupPreparedBundleAfterLifecycle({
      operation: input.operation,
      preparedBundle: ownsPreparedBundle ? preparedBundle : null,
    });
  }
}

function resolveLifecycleIntendedMode(input: {
  desiredState?: "background" | "stopped";
  shouldStartAfterLifecycle?: boolean;
}): "background" | undefined {
  return input.shouldStartAfterLifecycle === true ||
    input.desiredState === "background"
    ? "background"
    : undefined;
}

function buildFailedLifecycleBackupCleanupInput(
  backupRootPath: string | null
): { retainBackupRootPaths: string[] } | Record<string, never> {
  return backupRootPath ? { retainBackupRootPaths: [backupRootPath] } : {};
}

async function resolveLifecycleReplacementBundle(input: {
  cliScriptPath?: string;
  daemonVersion: string;
  preparedBundle: DaemonActiveBundleState | null;
}): Promise<DaemonActiveBundleState> {
  if (input.preparedBundle) {
    return input.preparedBundle;
  }
  return await prepareLifecycleReplacementBundle({
    cliScriptPath: input.cliScriptPath,
    daemonVersion: input.daemonVersion,
  });
}

async function prepareLifecycleReplacementBundle(input: {
  cliScriptPath?: string;
  daemonVersion: string;
}): Promise<DaemonActiveBundleState> {
  return await prepareDaemonServiceBundle({
    activate: false,
    daemonVersion: input.daemonVersion,
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
}

async function cleanupPreparedBundleAfterLifecycle(input: {
  operation: DaemonServiceLifecycleOperation;
  preparedBundle: DaemonActiveBundleState | null;
}): Promise<void> {
  if (!input.preparedBundle) {
    return;
  }
  try {
    await discardPreparedDaemonServiceBundle(input.preparedBundle);
  } catch (error) {
    console.warn("[openmeld.daemon_bundle.cleanup_warning]", {
      bundleId: input.preparedBundle.bundleId,
      errorMessage: toErrorMessage(error),
      operation: input.operation,
    });
  }
}

async function executeDaemonServiceLifecycle(input: {
  context: DaemonServiceLifecycleContext;
  emitPhase: (phase: DaemonServiceLifecyclePhase) => Promise<void>;
  expectedVersion: string;
  installSource: DaemonInstallSource;
  inventoryBefore: DaemonServiceInventory;
  operation: DaemonServiceLifecycleOperation;
  preparedBundle: DaemonActiveBundleState;
  cliScriptPath?: string;
  state: DaemonServiceLifecycleMutableState;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
  restorePoint: DaemonServiceLifecycleRestorePoint;
  drainWaitMs: number;
  forceKillAfterDrainTimeout: boolean;
  onlyIfIdle?: true;
}): Promise<DaemonServiceLifecycleOutcome> {
  try {
    input.state.failureStage = "stop_or_drain";
    await input.emitPhase("stop_or_drain");
    await stopLifecycleRuntime({
      drainWaitMs: input.drainWaitMs,
      forceKillAfterDrainTimeout: input.forceKillAfterDrainTimeout,
      onlyIfIdle: input.onlyIfIdle,
      inventory: input.inventoryBefore,
      operation: input.operation,
      serviceManager: input.context.serviceManager,
      stopCause:
        input.inventoryBefore.serviceContract?.ownerUserId &&
        input.context.commandOptions.ownerUserId &&
        input.inventoryBefore.serviceContract.ownerUserId !==
          input.context.commandOptions.ownerUserId
          ? "user_stop"
          : "controlled_service_update",
    });

    input.state.failureStage = "wait_stopped";
    await input.emitPhase("wait_stopped");
    await waitForLifecycleRuntimeStopped({
      inventory: input.inventoryBefore,
      serviceManager: input.context.serviceManager,
    });

    // Replacing the program and its OS registration leaves runtime data in
    // place. Only legacy cleanup removes a runtime root; ordinary updates must
    // not traverse or overwrite task workspaces as part of program maintenance.
    if (input.inventoryBefore.legacySharedService?.present) {
      input.state.failureStage = "backup";
      await input.emitPhase("backup");
      input.state.runtimeDataBackup =
        await backupDaemonRuntimeDataForReinstall();
      input.state.backupRootPath =
        input.state.runtimeDataBackup?.backupRootPath ?? null;
      input.state.backupDataPath =
        input.state.runtimeDataBackup?.backupDataPath ?? null;
    }

    input.state.failureStage = "unregister";
    await input.emitPhase("unregister");
    await input.context.serviceManager.uninstall();
    if (input.inventoryBefore.legacySharedService?.present) {
      await cleanupLegacySharedDaemonServiceState();
      await waitForLegacySharedServiceCleanup({
        expectedVersion: input.expectedVersion,
        operation: input.operation,
        shouldStartAfterLifecycle: input.context.shouldStartAfterLifecycle,
      });
    }

    input.state.failureStage = "wait_absent";
    await input.emitPhase("wait_absent");
    await waitForLifecycleRuntimeAbsentWithRetry(input.context.serviceManager);

    input.state.failureStage = "install_bundle";
    await input.emitPhase("install_bundle");
    const preparedBundle = input.preparedBundle;
    // An older running Service may cache this token when it starts. Rotate only
    // after the previous Service is verified absent so the CLI and Service can
    // never end up using different control-plane credentials.
    await rotateDaemonControlPlaneTokenIfExpired();
    await activateDaemonServiceBundle(preparedBundle);
    await installDaemon({
      daemonVersion: input.expectedVersion,
      source: input.installSource,
    });

    input.state.failureStage = "write_contract";
    await input.emitPhase("write_contract");
    await ensureLifecycleServiceContract({
      commandOptions: input.context.commandOptions,
      currentContract: input.context.currentContract,
      daemonVersion: input.expectedVersion,
      desiredState: input.context.desiredState,
      preparedBundle,
      serviceController: input.context.serviceManager.controller,
    });

    input.state.failureStage = "register_service";
    await input.emitPhase("register_service");
    const serviceDistribution: OpenMeldDistribution =
      preparedBundle.bundleFormat === "binary_v1" ? "binary" : "npm";
    const serviceCommandSpec = buildDaemonSystemServiceCommandSpec({
      ...(preparedBundle.bundleFormat === "binary_v1"
        ? { binaryExecutablePath: preparedBundle.sourceEntryScriptPath }
        : {}),
      controller: input.context.serviceManager.controller,
      distribution: serviceDistribution,
      environmentTarget: input.context.commandOptions.environmentTarget,
    });
    await installDaemonSystemServiceRegistration({
      distribution: serviceDistribution,
      serviceCommandSpec,
      serviceManager: input.context.serviceManager,
    });
    await ensureDaemonServiceMaintenanceInstalled();
    if (!input.context.shouldStartAfterLifecycle) {
      await input.context.serviceManager.deactivate().catch(() => undefined);
      await input.context.serviceManager.waitUntilStopped();
    }

    if (input.state.runtimeDataBackup) {
      input.state.failureStage = "restore_runtime_data";
      await input.emitPhase("restore_runtime_data");
      await restoreDaemonRuntimeDataForReinstall(input.state.runtimeDataBackup);
      await cleanupDaemonRuntimeDataBackup(input.state.runtimeDataBackup);
      input.state.runtimeDataBackup = null;
      input.state.backupDataPath = null;
      input.state.backupRootPath = null;
    }

    if (input.context.shouldStartAfterLifecycle) {
      input.state.failureStage = "start_if_desired";
      await input.emitPhase("start_if_desired");
      await startDaemonSystemServiceWithAutoRepair({
        distribution: serviceDistribution,
        serviceCommandSpec,
        systemManager: input.context.serviceManager,
      });

      input.state.failureStage = "wait_running";
      await input.emitPhase("wait_running");
    }

    input.state.failureStage = "verify_final_inventory";
    await input.emitPhase("verify_final_inventory");
    const verifyFinalInventory = async (): Promise<DaemonServiceInventory> =>
      await waitForVerifiedLifecycleInventory({
        desiredState: input.context.desiredState,
        expectedVersion: input.expectedVersion,
        operation: input.operation,
        serviceManager: input.context.serviceManager,
        shouldStartAfterLifecycle: input.context.shouldStartAfterLifecycle,
        target: input.target,
      });
    const inventoryAfter = input.context.shouldStartAfterLifecycle
      ? await runDaemonServiceManagerAction({
          action: "wait_running",
          controller: input.context.serviceManager.controller,
          intent: toLifecycleIntent(input.operation),
          resolveErrorMetadata: (error) => {
            const startupError = readLifecycleStartupTimeoutError(error);
            return startupError?.jobDiagnostics
              ? { jobDiagnostics: startupError.jobDiagnostics }
              : null;
          },
          run: verifyFinalInventory,
        })
      : await verifyFinalInventory();
    await cleanupStaleDaemonRuntimeDataBackupsAfterHealthyLifecycle(
      input.operation
    );
    return {
      status: "aligned",
      targetVersion: input.expectedVersion,
      inventoryBefore: input.inventoryBefore,
      inventoryAfter,
      reasonCodes: [],
      completedPhases: input.state.completedPhases,
      desiredState: input.context.desiredState,
      shouldStartAfterLifecycle: input.context.shouldStartAfterLifecycle,
      backupDataPath: null,
      errorMessage: null,
    };
  } catch (error) {
    if (
      error instanceof DaemonServiceLifecycleDrainTimeoutError ||
      error instanceof DaemonServiceUpdateDeferredError ||
      error instanceof DaemonServiceLifecycleControlledDrainError ||
      (input.onlyIfIdle && input.state.failureStage === "stop_or_drain")
    ) {
      // A pre-admission failure cannot enter replacement/rollback teardown.
      throw error;
    }
    input.state.evidencePath =
      (await captureDaemonServiceEvidenceBestEffort({
        evidencePath: input.state.evidencePath ?? undefined,
        phase: "after_failure",
      })) ?? input.state.evidencePath;
    await writeLifecycleEvidenceEvent({
      evidencePath: input.state.evidencePath,
      completedPhases: input.state.completedPhases,
      failureStage: input.state.failureStage,
    });
    const recovered = await recoverLifecycleFailure({
      commandOptions: input.context.commandOptions,
      currentContract: input.context.currentContract,
      error,
      expectedVersion: input.expectedVersion,
      inventoryBefore: input.inventoryBefore,
      operation: input.operation,
      restorePoint: input.restorePoint,
      serviceManager: input.context.serviceManager,
      state: input.state,
      target: input.target,
      cliScriptPath: input.cliScriptPath,
    });
    return recovered;
  }
}

async function recoverLifecycleFailure(input: {
  commandOptions: DaemonServiceLifecycleCommandOptions;
  currentContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  error: unknown;
  expectedVersion: string;
  inventoryBefore: DaemonServiceInventory;
  operation: DaemonServiceLifecycleOperation;
  restorePoint: DaemonServiceLifecycleRestorePoint;
  serviceManager: DaemonServiceManager;
  state: DaemonServiceLifecycleMutableState;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
  cliScriptPath?: string;
}): Promise<DaemonServiceLifecycleOutcome> {
  const originalErrorMessage = toErrorMessage(input.error);
  const originalErrorCode = resolveLifecycleFailureErrorCode(input.error);
  const originalFailureStage = resolveLifecycleFailureStage(
    input.error,
    input.state.failureStage
  );
  const originalReasonCodes = resolveLifecycleFailureReasonCodes(input.error);

  let verifiedRollbackError: unknown = null;
  if (
    input.restorePoint.trusted &&
    isVerifiedRollbackEligibleFailureStage(originalFailureStage)
  ) {
    const restoredPrevious = await restoreVerifiedPreviousState({
      restorePoint: input.restorePoint,
      serviceManager: input.serviceManager,
    }).catch((error) => {
      verifiedRollbackError = error;
      console.warn("[openmeld.daemon_service.verified_rollback_failed]", {
        errorMessage: toErrorMessage(error),
        failureStage: originalFailureStage,
        operation: input.operation,
        previousVersion:
          input.restorePoint.previousInstallState?.daemonVersion ?? null,
        targetVersion: input.expectedVersion,
      });
      return null;
    });
    if (restoredPrevious) {
      return {
        status: "failed",
        targetVersion: input.expectedVersion,
        inventoryBefore: input.inventoryBefore,
        inventoryAfter: restoredPrevious,
        reasonCodes: originalReasonCodes,
        completedPhases: input.state.completedPhases,
        desiredState: input.restorePoint.desiredState,
        shouldStartAfterLifecycle: input.restorePoint.shouldStartAfterLifecycle,
        backupDataPath: input.state.backupDataPath,
        failureStage: originalFailureStage,
        evidencePath: input.state.evidencePath,
        recoveryStatus: "restored_verified_previous_state",
        errorCode: originalErrorCode,
        errorMessage: originalErrorMessage,
      };
    }
  }
  const recoveryErrorMessage = verifiedRollbackError
    ? `${originalErrorMessage}; verified previous Service recovery failed: ${toErrorMessage(verifiedRollbackError)}`
    : originalErrorMessage;

  if (originalFailureStage === "backup") {
    // The old installation and its data have not changed. A failed backup is
    // not permission to uninstall it or try a second, unprepared replacement.
    return {
      status: "failed",
      targetVersion: input.expectedVersion,
      inventoryBefore: input.inventoryBefore,
      inventoryAfter: null,
      reasonCodes: originalReasonCodes,
      completedPhases: input.state.completedPhases,
      desiredState: input.restorePoint.desiredState,
      shouldStartAfterLifecycle: input.restorePoint.shouldStartAfterLifecycle,
      backupDataPath: input.state.backupDataPath,
      failureStage: originalFailureStage,
      evidencePath: input.state.evidencePath,
      recoveryStatus: "failed_before_safe_state",
      errorCode: originalErrorCode,
      errorMessage: recoveryErrorMessage,
    };
  }

  const stoppedSafe = await transitionLifecycleToStoppedSafeCurrentVersion({
    commandOptions: input.commandOptions,
    currentContract: input.currentContract,
    expectedVersion: input.expectedVersion,
    operation: input.operation,
    runtimeDataBackup: input.state.runtimeDataBackup,
    serviceManager: input.serviceManager,
    cliScriptPath: input.cliScriptPath,
  }).catch((safeStopError) => {
    return { safeStopError };
  });

  if ("safeStopError" in stoppedSafe) {
    await cleanupStaleDaemonRuntimeDataBackups(
      input.state.backupRootPath
        ? {
            retainBackupRootPaths: [input.state.backupRootPath],
          }
        : {}
    );
    return {
      status: "failed",
      targetVersion: input.expectedVersion,
      inventoryBefore: input.inventoryBefore,
      inventoryAfter: null,
      reasonCodes: dedupeReasonCodes([
        ...originalReasonCodes,
        ...resolveLifecycleFailureReasonCodes(stoppedSafe.safeStopError),
      ]),
      completedPhases: input.state.completedPhases,
      desiredState: input.restorePoint.desiredState,
      shouldStartAfterLifecycle: input.restorePoint.shouldStartAfterLifecycle,
      backupDataPath: input.state.backupDataPath,
      failureStage: originalFailureStage,
      evidencePath: input.state.evidencePath,
      recoveryStatus: "failed_before_safe_state",
      errorCode: originalErrorCode,
      errorMessage: `${recoveryErrorMessage}; stopped-safe recovery failed: ${toErrorMessage(stoppedSafe.safeStopError)}`,
    };
  }

  input.state.runtimeDataBackup = null;
  input.state.backupDataPath = null;
  input.state.backupRootPath = null;
  await cleanupStaleDaemonRuntimeDataBackups();
  return {
    status: "stopped_safe",
    targetVersion: input.expectedVersion,
    inventoryBefore: input.inventoryBefore,
    inventoryAfter: stoppedSafe,
    reasonCodes: originalReasonCodes,
    completedPhases: input.state.completedPhases,
    desiredState: input.restorePoint.desiredState,
    shouldStartAfterLifecycle: input.restorePoint.shouldStartAfterLifecycle,
    backupDataPath: null,
    failureStage: originalFailureStage,
    evidencePath: input.state.evidencePath,
    recoveryStatus: "stopped_safe_current_version",
    errorMessage: recoveryErrorMessage,
  };
}

function isVerifiedRollbackEligibleFailureStage(
  failureStage: DaemonServiceFailureStage | null
): boolean {
  return (
    failureStage === "install_bundle" ||
    failureStage === "write_contract" ||
    failureStage === "register_service" ||
    failureStage === "restore_runtime_data" ||
    failureStage === "start_if_desired" ||
    failureStage === "wait_running" ||
    failureStage === "verify_final_inventory"
  );
}

async function restoreVerifiedPreviousState(input: {
  restorePoint: DaemonServiceLifecycleRestorePoint;
  serviceManager: DaemonServiceManager;
}): Promise<DaemonServiceInventory> {
  const previousVersion =
    input.restorePoint.previousInstallState?.daemonVersion ??
    input.restorePoint.previousContract?.daemonVersion;
  if (!previousVersion) {
    throw new Error(
      "verified rollback is missing the previous daemon version."
    );
  }
  const requiredFloor = (await readVersionState())?.required_floor?.trim();
  if (requiredFloor && compareSemver(previousVersion, requiredFloor) < 0) {
    throw new Error(
      `verified rollback version ${previousVersion} is below the required version floor ${requiredFloor}.`
    );
  }
  await input.serviceManager.uninstall();
  await input.serviceManager.waitUntilAbsent();
  await ensureNoOwnedProcessesRemain();
  await restoreDaemonInstallStateSnapshot(
    input.restorePoint.previousInstallState
  );
  await restoreDaemonActiveBundleStateSnapshot(
    input.restorePoint.previousActiveBundle
  );
  await restoreLifecycleServiceContractSnapshot(
    input.restorePoint.previousContract
  );
  const previousDistribution: OpenMeldDistribution =
    input.restorePoint.previousActiveBundle?.bundleFormat === "binary_v1"
      ? "binary"
      : "npm";
  await installDaemonSystemServiceRegistration({
    distribution: previousDistribution,
    serviceCommandSpec: buildDaemonSystemServiceCommandSpec({
      ...(input.restorePoint.previousActiveBundle?.bundleFormat === "binary_v1"
        ? {
            binaryExecutablePath:
              input.restorePoint.previousActiveBundle.sourceEntryScriptPath,
          }
        : {}),
      controller: input.serviceManager.controller,
      distribution: previousDistribution,
      environmentTarget: resolveOpenMeldEnvironmentTargetFromEnv(),
    }),
    serviceManager: input.serviceManager,
  });
  if (input.restorePoint.shouldStartAfterLifecycle) {
    await input.serviceManager.start();
  } else {
    await input.serviceManager.waitUntilStopped();
  }
  const inventoryAfter = await waitForVerifiedLifecycleInventory({
    desiredState: input.restorePoint.desiredState,
    expectedVersion: previousVersion,
    operation: "upgrade_reconcile",
    serviceManager: input.serviceManager,
    shouldStartAfterLifecycle: input.restorePoint.shouldStartAfterLifecycle,
    target: buildDaemonServiceTargetSpec({
      daemonVersion: previousVersion,
      distribution:
        input.restorePoint.previousActiveBundle?.bundleFormat === "binary_v1"
          ? "binary"
          : "npm",
    }),
  });
  return inventoryAfter;
}

async function transitionLifecycleToStoppedSafeCurrentVersion(input: {
  commandOptions: DaemonServiceLifecycleCommandOptions;
  currentContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  expectedVersion: string;
  operation: DaemonServiceLifecycleOperation;
  runtimeDataBackup: DaemonRuntimeDataBackup | null;
  serviceManager: DaemonServiceManager;
  cliScriptPath?: string;
}): Promise<DaemonServiceInventory> {
  await input.serviceManager.uninstall().catch(() => undefined);
  await input.serviceManager.waitUntilAbsent().catch(() => undefined);
  await ensureNoOwnedProcessesRemain();
  const preparedBundle = await prepareDaemonServiceBundle({
    daemonVersion: input.expectedVersion,
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
  await installDaemon({
    daemonVersion: input.expectedVersion,
    source: "cli.auto_check",
  });
  await ensureLifecycleServiceContract({
    commandOptions: input.commandOptions,
    currentContract: input.currentContract,
    daemonVersion: input.expectedVersion,
    desiredState: "stopped",
    preparedBundle,
    serviceController: input.serviceManager.controller,
  });
  const serviceDistribution: OpenMeldDistribution =
    preparedBundle.bundleFormat === "binary_v1" ? "binary" : "npm";
  await installDaemonSystemServiceRegistration({
    distribution: serviceDistribution,
    serviceCommandSpec: buildDaemonSystemServiceCommandSpec({
      ...(preparedBundle.bundleFormat === "binary_v1"
        ? { binaryExecutablePath: preparedBundle.sourceEntryScriptPath }
        : {}),
      controller: input.serviceManager.controller,
      distribution: serviceDistribution,
      environmentTarget: input.commandOptions.environmentTarget,
    }),
    serviceManager: input.serviceManager,
  });
  await input.serviceManager.waitUntilStopped();
  if (input.runtimeDataBackup) {
    await restoreDaemonRuntimeDataForReinstall(input.runtimeDataBackup);
    await cleanupDaemonRuntimeDataBackup(input.runtimeDataBackup);
  }
  return await waitForVerifiedLifecycleInventory({
    desiredState: "stopped",
    expectedVersion: input.expectedVersion,
    operation: input.operation,
    serviceManager: input.serviceManager,
    shouldStartAfterLifecycle: false,
    target: buildDaemonServiceTargetSpec({
      daemonVersion: input.expectedVersion,
    }),
  });
}

function readLifecycleStartupTimeoutError(error: unknown) {
  if (isSystemServiceStartupTimeoutError(error)) {
    return error;
  }
  if (
    error instanceof DaemonServiceLifecycleStageError &&
    isSystemServiceStartupTimeoutError(error.cause)
  ) {
    return error.cause;
  }
  return null;
}

async function createLifecycleRestorePoint(input: {
  desiredState: "background" | "stopped";
  inventoryBefore: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
}): Promise<DaemonServiceLifecycleRestorePoint> {
  const previousActiveBundle = input.inventoryBefore.activeBundle ?? null;
  const activeBundleIntegrityVerified = previousActiveBundle
    ? await verifyDaemonActiveBundleIntegrity(previousActiveBundle).catch(
        () => false
      )
    : false;
  return {
    desiredState: input.desiredState,
    shouldStartAfterLifecycle: input.shouldStartAfterLifecycle,
    previousActiveBundle,
    previousContract: input.inventoryBefore.serviceContract ?? null,
    previousInstallState: input.inventoryBefore.installStatus.installed
      ? input.inventoryBefore.installStatus.state
      : null,
    trusted: isVerifiedRollbackRestorePointTrusted({
      activeBundleIntegrityVerified,
      inventory: input.inventoryBefore,
    }),
  };
}

function isVerifiedRollbackRestorePointTrusted(input: {
  activeBundleIntegrityVerified: boolean;
  inventory: DaemonServiceInventory;
}): boolean {
  const inventory = input.inventory;
  const previousInstallState = inventory.installStatus.installed
    ? inventory.installStatus.state
    : null;
  const previousContract = inventory.serviceContract ?? null;
  const previousActiveBundle = inventory.activeBundle ?? null;
  if (!(previousInstallState && previousContract && previousActiveBundle)) {
    return false;
  }
  if (!isDaemonServiceContractIdentityReusable(previousContract)) {
    return false;
  }
  if (previousContract.serviceController === "legacy-detached") {
    return false;
  }
  if (
    previousInstallState.daemonVersion !== previousContract.daemonVersion ||
    previousInstallState.daemonVersion !== previousActiveBundle.daemonVersion
  ) {
    return false;
  }
  if (previousContract.bundleId !== previousActiveBundle.bundleId) {
    return false;
  }
  if (
    previousActiveBundle.bundleFormat !== "self_contained_v1" &&
    previousActiveBundle.bundleFormat !== "binary_v1"
  ) {
    return false;
  }
  if (!input.activeBundleIntegrityVerified) {
    return false;
  }
  if (
    inventory.anomalies.some((anomaly) =>
      VERIFIED_ROLLBACK_UNTRUSTED_ANOMALIES.has(anomaly.code)
    )
  ) {
    return false;
  }
  return (
    typeof inventory.activeBundleEntryPath === "string" &&
    inventory.activeBundleEntryPath.length > 0
  );
}

async function stopLifecycleRuntime(input: {
  stopCause: RuntimeTransportStopCause;
  drainWaitMs: number;
  forceKillAfterDrainTimeout: boolean;
  onlyIfIdle?: true;
  inventory: DaemonServiceInventory;
  operation: DaemonServiceLifecycleOperation;
  serviceManager: DaemonServiceManager;
}): Promise<void> {
  const lifecycleIntent = toLifecycleIntent(input.operation);
  await emitDaemonLifecycleEvent({
    command: `openmeld service ${input.operation.replaceAll("_", "-")}`,
    intent: lifecycleIntent,
    metadata: {
      drainWaitMs: input.drainWaitMs,
      forceKillAfterDrainTimeout: input.forceKillAfterDrainTimeout,
      strategy: "controlled_drain",
    },
    result: "selected",
    stopCause: input.stopCause,
    type: "stop.strategy.selected",
  });
  const usesSystemService =
    input.inventory.runtimeStatus.managedBySystemService ||
    input.inventory.serviceManagerStatus?.installed === true ||
    input.inventory.serviceManagerStatus?.running === true;
  if (usesSystemService) {
    await stopLifecycleSystemServiceRuntime({
      ...input,
      lifecycleIntent,
    });
    return;
  }
  const runtimeStatus = input.inventory.runtimeStatus;
  if (runtimeStatus.status !== "running") {
    return;
  }
  if (input.onlyIfIdle) {
    await requestControlledSystemServiceDrain({ ...input, lifecycleIntent });
    return;
  }
  if (!Number.isInteger(runtimeStatus.pid) || runtimeStatus.pid === null) {
    throw new DaemonServiceLifecycleStageError({
      message: "OpenMeld runtime is marked running but no pid is available.",
      stage: "stop_or_drain",
    });
  }
  const terminated = await stopDaemonProcessWithTimeout(
    runtimeStatus.pid,
    "SIGTERM",
    input.drainWaitMs
  );
  if (terminated) {
    return;
  }
  // `forceKillAfterDrainTimeout` stays the explicit user-confirmed force
  // path; the stalled-heartbeat fallback below is the automatic escape for
  // daemons that are provably wedged and would otherwise keep every stop
  // and repair failing.
  if (input.forceKillAfterDrainTimeout) {
    await stopDaemonProcess(runtimeStatus.pid, "SIGKILL");
    return;
  }
  const forceKill = await forceKillStalledDaemonAfterStopTimeout({
    stage: "stop_or_drain",
  });
  if (!forceKill.killed) {
    throw new DaemonServiceLifecycleDrainTimeoutError(input.drainWaitMs);
  }
}

async function stopLifecycleSystemServiceRuntime(input: {
  stopCause: RuntimeTransportStopCause;
  drainWaitMs: number;
  forceKillAfterDrainTimeout: boolean;
  onlyIfIdle?: true;
  inventory: DaemonServiceInventory;
  lifecycleIntent: "startup_check" | "reinstall" | "upgrade_reconcile";
  operation: DaemonServiceLifecycleOperation;
  serviceManager: DaemonServiceManager;
}): Promise<void> {
  const restoreAutostartOnDrainFailure =
    await disableDaemonServiceAutostartIfConfigured({
      manager: input.serviceManager,
      status: input.inventory.serviceManagerStatus,
    });
  let drained = false;
  try {
    drained =
      hasActiveLifecycleRuntimeEvidence(input.inventory) &&
      !input.forceKillAfterDrainTimeout &&
      (await requestControlledSystemServiceDrain({
        onlyIfIdle: input.onlyIfIdle,
        drainWaitMs: input.drainWaitMs,
        inventory: input.inventory,
        lifecycleIntent: input.lifecycleIntent,
        operation: input.operation,
        stopCause: input.stopCause,
      }));
  } catch (drainError) {
    if (restoreAutostartOnDrainFailure) {
      try {
        await input.serviceManager.enableAutostart();
      } catch (restoreError) {
        throw new DaemonServiceLifecycleControlledDrainError(
          new Error(
            `${toErrorMessage(drainError)}; failed to restore service autostart: ${toErrorMessage(restoreError)}`
          )
        );
      }
    }
    throw drainError;
  }
  await input.serviceManager.stop();
  if (drained) {
    return;
  }
  const stopCandidates = resolveSafeOwnedProcessStopCandidates(input.inventory);
  for (const processInfo of stopCandidates) {
    await stopDaemonProcess(processInfo.pid, "SIGTERM");
  }
}

function hasActiveLifecycleRuntimeEvidence(
  inventory: DaemonServiceInventory
): boolean {
  return (
    inventory.runtimeStatus.status === "running" ||
    inventory.serviceManagerStatus?.running === true ||
    inventory.ownedProcesses.length > 0
  );
}

async function requestControlledSystemServiceDrain(input: {
  onlyIfIdle?: true;
  stopCause: RuntimeTransportStopCause;
  drainWaitMs: number;
  inventory: DaemonServiceInventory;
  lifecycleIntent: "startup_check" | "reinstall" | "upgrade_reconcile";
  operation: DaemonServiceLifecycleOperation;
}): Promise<boolean> {
  try {
    const shutdown = await requestLocalDaemonShutdown({
      ...(input.onlyIfIdle ? { onlyIfIdle: true } : {}),
      payload: {
        gracePeriodMs: input.drainWaitMs,
        mode: "graceful",
      },
      // New Services bound their post-work result-receipt and socket-close
      // waits. Bound this request too so an older Service cannot hold setup
      // forever. Missing acknowledgement never proves that accepted work has
      // drained, even when the requested version is newer.
      timeoutMs: CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS,
    });
    const refusedResult = input.onlyIfIdle ? "deferred" : "unsupported";
    await emitDaemonLifecycleEvent({
      command: `openmeld service ${input.operation.replaceAll("_", "-")}`,
      intent: input.lifecycleIntent,
      metadata: {
        accepted: shutdown.accepted,
        gracePeriodMs: shutdown.gracePeriodMs,
        mode: shutdown.mode,
      },
      result: shutdown.accepted ? "completed" : refusedResult,
      stopCause: input.stopCause,
      type: "stop.controlled_drain",
    });
    if (input.onlyIfIdle && !shutdown.accepted) {
      throw new DaemonServiceUpdateDeferredError();
    }
    return shutdown.accepted;
  } catch (error) {
    if (error instanceof DaemonServiceUpdateDeferredError) {
      throw error;
    }
    const {
      isLegacyShutdownContract,
      isManagerRunningWithoutRuntime,
      isLegacyMissingCloseReason,
      observedDaemonVersion,
      isCompatibilityFallback,
    } = classifyControlledShutdownFailure(
      error,
      input.inventory,
      input.onlyIfIdle === true
    );
    await emitDaemonLifecycleEvent({
      command: `openmeld service ${input.operation.replaceAll("_", "-")}`,
      intent: input.lifecycleIntent,
      metadata: {
        compatibilityFallback: isCompatibilityFallback,
        ...(isLegacyMissingCloseReason
          ? {
              compatibilityReason: "legacy_missing_close_reason",
              observedDaemonVersion,
            }
          : {}),
        ...(isManagerRunningWithoutRuntime
          ? {
              compatibilityReason: "manager_running_without_runtime",
            }
          : {}),
        errorMessage: toErrorMessage(error),
      },
      result: isCompatibilityFallback ? "fallback" : "failed",
      stopCause: input.stopCause,
      type: "stop.controlled_drain",
    });
    if (isCompatibilityFallback) {
      return false;
    }
    if (input.onlyIfIdle && isLegacyShutdownContract) {
      throw new DaemonServiceLifecycleControlledDrainError(
        new Error(
          "This Service cannot confirm an atomic idle update switch. Update OpenMeld manually when current work finishes."
        )
      );
    }
    throw new DaemonServiceLifecycleControlledDrainError(error);
  }
}

function classifyControlledShutdownFailure(
  error: unknown,
  inventory: DaemonServiceInventory,
  onlyIfIdle: boolean
) {
  const isLegacyShutdownContract =
    error instanceof LocalDaemonControlPlaneClientError &&
    error.code === "daemon.control.contract_mismatch";
  const isManagerRunningWithoutRuntime =
    error instanceof LocalDaemonControlPlaneClientError &&
    error.code === "daemon.control.endpoint_missing" &&
    inventory.runtimeStatus.status !== "running" &&
    inventory.ownedProcesses.length === 0;
  const isLegacyMissingCloseReason =
    isLegacyMissingControlledShutdownCloseReason({ error, inventory });
  return {
    isLegacyShutdownContract,
    isManagerRunningWithoutRuntime,
    isLegacyMissingCloseReason,
    isCompatibilityFallback:
      isManagerRunningWithoutRuntime ||
      (!onlyIfIdle && (isLegacyShutdownContract || isLegacyMissingCloseReason)),
    observedDaemonVersion: isLegacyMissingCloseReason
      ? resolveObservedDaemonVersion(inventory)
      : null,
  };
}

function isLegacyMissingControlledShutdownCloseReason(input: {
  error: unknown;
  inventory: DaemonServiceInventory;
}): boolean {
  if (
    !(input.error instanceof LocalDaemonControlPlaneClientError) ||
    input.error.code !== "daemon.run.socket_closed" ||
    input.error.message !== "daemon stream closed (code=1000, reason=closed)"
  ) {
    return false;
  }
  const observedDaemonVersion = resolveObservedDaemonVersion(input.inventory);
  if (!observedDaemonVersion) {
    return false;
  }
  try {
    return (
      resolveVersionChangeDirection({
        fromVersion: observedDaemonVersion,
        toVersion: MISSING_CONTROLLED_SHUTDOWN_CLOSE_REASON_FIXED_VERSION,
      }) === "upgrade"
    );
  } catch {
    return false;
  }
}

function resolveObservedDaemonVersion(
  inventory: DaemonServiceInventory
): string | null {
  return (
    inventory.activeBundle?.daemonVersion ??
    inventory.serviceContract?.daemonVersion ??
    (inventory.installStatus.installed
      ? inventory.installStatus.state?.daemonVersion
      : null) ??
    null
  );
}

async function ensureLifecycleRuntimeStopped(): Promise<void> {
  const runtimeAfterStop = await readCurrentObservedDaemonRuntimeStatus();
  if (runtimeAfterStop.status === "stale") {
    await clearDaemonRuntimeStateIfDefinitelyStopped();
    return;
  }
  if (runtimeAfterStop.status === "running") {
    throw new DaemonServiceLifecycleStageError({
      message: `OpenMeld service is still running after stop phase (pid=${String(
        runtimeAfterStop.pid
      )}).`,
      stage: "wait_stopped",
    });
  }
}

async function waitForLifecycleRuntimeStopped(input: {
  inventory: DaemonServiceInventory;
  serviceManager: DaemonServiceManager;
}): Promise<void> {
  const usesSystemService =
    input.inventory.runtimeStatus.managedBySystemService ||
    input.inventory.serviceManagerStatus?.installed === true ||
    input.inventory.serviceManagerStatus?.running === true;

  if (usesSystemService) {
    const stopped = await waitForDaemonSystemServiceToStop({
      manager: input.serviceManager,
      waitMs: STRICT_TEARDOWN_VERIFY_WAIT_MS,
      pollMs: STRICT_TEARDOWN_VERIFY_POLL_MS,
    });
    // A daemon that survived the graceful window may be wedged (old daemons
    // sleep through SIGTERM inside reconnect backoff for up to 15 minutes,
    // which no lifecycle stop window can cover). Escalate to SIGKILL only
    // under the stalled-heartbeat safety boundary; a fresh heartbeat keeps
    // the existing failure below.
    const stoppedAfterForceKill =
      stopped ||
      ((await forceKillStalledDaemonAfterStopTimeout({ stage: "wait_stopped" }))
        .killed &&
        (await waitForDaemonSystemServiceToStop({
          manager: input.serviceManager,
          waitMs: STRICT_TEARDOWN_VERIFY_WAIT_MS,
          pollMs: STRICT_TEARDOWN_VERIFY_POLL_MS,
        })));
    if (!stoppedAfterForceKill) {
      const runtimeAfterWait = await readCurrentObservedDaemonRuntimeStatus();
      throw new DaemonServiceLifecycleStageError({
        message: `OpenMeld service is still running after stop phase (pid=${String(
          runtimeAfterWait.pid
        )}).`,
        stage: "wait_stopped",
      });
    }
  }

  await ensureLifecycleRuntimeStopped();
}

async function waitForLifecycleRuntimeAbsentWithRetry(
  serviceManager: DaemonServiceManager
): Promise<void> {
  let initialError: unknown;
  try {
    await serviceManager.waitUntilAbsent();
    await ensureNoOwnedProcessesRemain();
    return;
  } catch (error) {
    initialError = error;
  }

  try {
    // A controlled drain may finish just after launchd's first absence window.
    // Give that same process one final bounded verification window before any
    // reinstall or stopped-safe recovery mutates the persistent Service state.
    await serviceManager.waitUntilAbsent();
    await ensureNoOwnedProcessesRemain();
  } catch (retryError) {
    throw new DaemonServiceLifecycleStageError({
      cause: retryError,
      message: `${toErrorMessage(retryError)}; initial absence verification failed: ${toErrorMessage(initialError)}`,
      stage: "wait_absent",
    });
  }
}

async function cleanupStaleDaemonRuntimeDataBackupsAfterHealthyLifecycle(
  operation: DaemonServiceLifecycleOperation
): Promise<void> {
  try {
    await cleanupStaleDaemonRuntimeDataBackups();
  } catch (error) {
    // The Service is already verified healthy, so stale temporary data must
    // never trigger destructive lifecycle recovery. Keep the failure visible
    // and retry cleanup on the next already-aligned lifecycle check.
    console.warn("[openmeld.daemon_runtime_data.cleanup_warning]", {
      errorMessage: toErrorMessage(error),
      operation,
    });
  }
}

async function ensureNoOwnedProcessesRemain(): Promise<void> {
  const deadline = Date.now() + STRICT_TEARDOWN_VERIFY_WAIT_MS;
  while (Date.now() < deadline) {
    const [ownedProcesses, runtimeStatus] = await Promise.all([
      listDaemonOwnedProcesses({
        ignoreProcessIds: [process.pid, process.ppid].filter(
          (pid): pid is number => Number.isInteger(pid) && pid > 0
        ),
      }),
      readCurrentObservedDaemonRuntimeStatus(),
    ]);
    if (ownedProcesses.length === 0) {
      if (runtimeStatus.status === "not_running") {
        return;
      }
      if (runtimeStatus.status === "stale") {
        await clearDaemonRuntimeStateIfDefinitelyStopped();
        return;
      }
    }
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }
  const [ownedProcesses, runtimeStatus] = await Promise.all([
    listDaemonOwnedProcesses({
      ignoreProcessIds: [process.pid, process.ppid].filter(
        (pid): pid is number => Number.isInteger(pid) && pid > 0
      ),
    }),
    readCurrentObservedDaemonRuntimeStatus(),
  ]);
  if (ownedProcesses.length > 0) {
    const summary = ownedProcesses
      .map(
        (processInfo) => `${processInfo.ownership}:${String(processInfo.pid)}`
      )
      .join(", ");
    throw new DaemonServiceLifecycleStageError({
      message: `OpenMeld-owned service processes are still present after teardown (${summary}).`,
      stage: "wait_absent",
    });
  }
  if (runtimeStatus.status !== "not_running") {
    throw new DaemonServiceLifecycleStageError({
      message: `OpenMeld runtime is still ${runtimeStatus.status} after teardown.`,
      stage: "wait_absent",
    });
  }
}

async function waitForLegacySharedServiceCleanup(input: {
  expectedVersion: string;
  operation: DaemonServiceLifecycleOperation;
  shouldStartAfterLifecycle: boolean;
}): Promise<void> {
  const deadline = Date.now() + STRICT_TEARDOWN_VERIFY_WAIT_MS;
  let lastInventory: DaemonServiceInventory | null = null;
  while (Date.now() < deadline) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intent: toLifecycleIntent(input.operation),
    });
    lastInventory = inventory;
    const hasLegacySharedService =
      inventory.legacySharedService?.present === true ||
      inventory.anomalies.some(
        (anomaly) => anomaly.code === "legacy_shared_service_present"
      );
    if (!hasLegacySharedService) {
      return;
    }
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }

  throw new DaemonServiceLifecycleStageError({
    message:
      "OpenMeld Service legacy shared registration is still present after cleanup. reason=legacy_shared_service_present",
    reasonCodes: ["legacy_shared_service_present"],
    stage: "unregister",
    cause: lastInventory,
  });
}

function resolveSafeOwnedProcessStopCandidates(
  inventory: DaemonServiceInventory
) {
  const seenPids = new Set<number>();
  return inventory.ownedProcesses.filter((processInfo) => {
    if (processInfo.ownership === "unknown") {
      return false;
    }
    if (processInfo.mode === "foreground") {
      return false;
    }
    if (seenPids.has(processInfo.pid)) {
      return false;
    }
    seenPids.add(processInfo.pid);
    return true;
  });
}

async function resolveLifecycleCommandOptions(input: {
  inventory: DaemonServiceInventory;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
}): Promise<DaemonServiceLifecycleCommandOptions> {
  const [currentContract, runtimeSnapshot, runtimePaths, fallbackProfile] =
    await Promise.all([
      Promise.resolve(
        input.inventory.serviceContract ?? readDaemonServiceContract()
      ).catch(() => null),
      readDaemonServiceRuntimeSnapshot().catch(() => null),
      ensureDaemonRuntimePaths().catch(() => null),
      resolveOpenMeldProfileOrNull({
        allowDefaultFallback: true,
        allowUnauthenticated: true,
        persistSelection: false,
      }).catch(() => null),
    ]);
  const reusableCurrentContract = isDaemonServiceContractIdentityReusable(
    currentContract
  )
    ? currentContract
    : null;
  const environmentTarget = await resolveOpenMeldEnvironmentTarget({
    gatewayUrl: input.gatewayUrl,
  });
  const explicitGatewayUrl = await resolveExplicitGatewayUrlOrThrow(
    input.gatewayUrl
  );
  const commandGatewayUrl = environmentTarget.gatewayUrl;
  const preferCommandGateway = shouldPreferCommandResolvedGatewayForLifecycle();
  const gatewayUrl = resolveLifecycleGatewayUrl({
    explicitGatewayUrl,
    preferCommandGateway,
    commandGatewayUrl,
    currentGatewayUrl: normalizeGatewayBaseUrlOrNull(
      currentContract?.gatewayUrl
    ),
    runtimeGatewayUrl: normalizeGatewayBaseUrlOrNull(
      runtimeSnapshot?.gatewayUrl
    ),
  });
  const openMeldProfileId =
    normalizeOptionalText(input.profile) ??
    normalizeOptionalText(runtimeSnapshot?.openMeldProfileId) ??
    fallbackProfile?.openMeldProfileId ??
    reusableCurrentContract?.profileId;
  const ownerUserId = await resolveLifecycleCommandOwnerUserId({
    openMeldProfileId,
    fallbackProfile,
    reusableCurrentContract,
  });
  const shouldDiscardPersistedDeviceId =
    resolveOpenMeldEnvPreset() === "prod"
      ? isUnsafeProductionDeviceId
      : undefined;
  const deviceId = runtimePaths
    ? await resolveDaemonDeviceId({
        deviceId: resolvePreferredDaemonDeviceId({
          explicitDeviceId: input.deviceId,
          contractDeviceId: reusableCurrentContract?.deviceId,
        }),
        deviceIdPath: runtimePaths.deviceIdPath,
        ...(shouldDiscardPersistedDeviceId
          ? { shouldDiscardPersistedDeviceId }
          : {}),
      }).catch(() => reusableCurrentContract?.deviceId ?? null)
    : (normalizeOptionalText(input.deviceId) ??
      reusableCurrentContract?.deviceId ??
      null);
  const heartbeatMs = normalizeHeartbeatIntervalMs(
    input.heartbeatMs ?? currentContract?.heartbeatMs
  );
  return {
    environmentTarget,
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(openMeldProfileId ? { openMeldProfileId } : {}),
    ...(deviceId ? { deviceId } : {}),
    ...(typeof heartbeatMs === "number" ? { heartbeatMs } : {}),
  };
}

function resolveLifecycleGatewayUrl(input: {
  explicitGatewayUrl?: string | null;
  preferCommandGateway: boolean;
  commandGatewayUrl: string;
  currentGatewayUrl: string | null;
  runtimeGatewayUrl: string | null;
}): string | null {
  if (input.explicitGatewayUrl) {
    return input.explicitGatewayUrl;
  }
  if (input.preferCommandGateway) {
    return input.commandGatewayUrl;
  }
  if (input.currentGatewayUrl) {
    return input.currentGatewayUrl;
  }
  if (input.runtimeGatewayUrl) {
    return input.runtimeGatewayUrl;
  }
  return input.commandGatewayUrl;
}

async function resolveLifecycleCommandOwnerUserId(input: {
  openMeldProfileId?: string | null;
  fallbackProfile: OpenMeldProfile | null;
  reusableCurrentContract: DaemonServiceContract | null;
}): Promise<string | undefined> {
  const profileId = normalizeOptionalText(input.openMeldProfileId);
  if (profileId && input.fallbackProfile?.openMeldProfileId === profileId) {
    return (
      normalizeOptionalText(input.fallbackProfile.ownerUserId) ?? undefined
    );
  }

  if (profileId) {
    const selectedProfile = await resolveOpenMeldProfileOrNull({
      openMeldProfileId: profileId,
      allowDefaultFallback: false,
      allowUnauthenticated: true,
      persistSelection: false,
    }).catch(() => null);
    const fallbackFromResolved = normalizeOptionalText(
      selectedProfile?.ownerUserId
    );
    if (fallbackFromResolved) {
      return fallbackFromResolved;
    }
  }

  if (profileId && input.reusableCurrentContract?.profileId === profileId) {
    return (
      normalizeOptionalText(input.reusableCurrentContract.ownerUserId) ??
      undefined
    );
  }

  if (!profileId) {
    return (
      normalizeOptionalText(input.reusableCurrentContract?.ownerUserId) ??
      undefined
    );
  }

  return undefined;
}

function shouldPreferCommandResolvedGatewayForLifecycle(): boolean {
  if (normalizeOptionalText(process.env.OPENMELD_GATEWAY_URL)) {
    return true;
  }
  const preset = resolveOpenMeldEnvPreset();
  return preset === "dev-local" || preset === "canary";
}

function resolveLifecycleDesiredState(
  inventory: DaemonServiceInventory
): "background" | "stopped" {
  if (inventory.serviceContract?.desiredState === "background") {
    return "background";
  }
  if (inventory.serviceContract?.desiredState === "stopped") {
    return "stopped";
  }
  if (inventory.serviceManagerStatus?.running) {
    return "background";
  }
  if (inventory.runtimeStatus.mode !== "background") {
    return "stopped";
  }
  return inventory.runtimeStatus.status === "running" ||
    inventory.runtimeStatus.status === "stale" ||
    inventory.runtimeStatus.managedBySystemService ||
    inventory.runtimeStatus.autoStart
    ? "background"
    : "stopped";
}

function resolveLifecycleShouldStartAfterLifecycle(input: {
  desiredState: "background" | "stopped";
  inventory: DaemonServiceInventory;
}): boolean {
  if (input.desiredState !== "background") {
    return false;
  }
  if (input.inventory.serviceManagerStatus?.running) {
    return true;
  }
  if (input.inventory.runtimeStatus.mode !== "background") {
    return false;
  }
  return (
    input.inventory.runtimeStatus.status === "running" ||
    input.inventory.runtimeStatus.status === "stale" ||
    input.inventory.runtimeStatus.managedBySystemService ||
    input.inventory.runtimeStatus.autoStart
  );
}

async function resolveLifecycleServiceManager(
  inventory: DaemonServiceInventory
): Promise<DaemonServiceManager | null> {
  if (inventory.serviceManager) {
    return inventory.serviceManager;
  }
  if (inventory.legacySharedService?.serviceManager) {
    return inventory.legacySharedService.serviceManager;
  }
  if (
    inventory.runtimeStatus.serviceController !== "unknown" &&
    inventory.runtimeStatus.serviceController !== "legacy-detached"
  ) {
    return await resolveDaemonServiceManager(
      inventory.runtimeStatus.serviceController
    ).catch(() => null);
  }
  return await resolveDaemonServiceManager().catch(() => null);
}

function resolveUnsafeOwnedProcessReasonCodes(
  inventory: DaemonServiceInventory
): DaemonServiceLifecycleReasonCode[] {
  if (
    inventory.ownedProcesses.some(
      (processInfo) => processInfo.ownership === "unknown"
    )
  ) {
    return ["unknown_owned_processes"];
  }
  return [];
}

function resolveImmediateLifecycleOutcome(input: {
  completedPhases: DaemonServiceLifecyclePhase[];
  desiredState: "background" | "stopped";
  expectedVersion: string;
  forceReinstall: boolean;
  inventoryBefore: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}):
  | Extract<DaemonServiceLifecycleOutcome, { status: "already_aligned" }>
  | Extract<DaemonServiceLifecycleOutcome, { status: "blocked" }>
  | null {
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory: input.inventoryBefore,
    target: input.target,
  });
  if (!input.forceReinstall && decision.status === "already_aligned") {
    return {
      status: "already_aligned",
      targetVersion: input.expectedVersion,
      inventoryBefore: input.inventoryBefore,
      inventoryAfter: input.inventoryBefore,
      reasonCodes: [],
      completedPhases: input.completedPhases,
      desiredState: input.desiredState,
      shouldStartAfterLifecycle: input.shouldStartAfterLifecycle,
      backupDataPath: null,
      errorMessage: null,
    };
  }
  const unsafeReasonCodes = resolveUnsafeOwnedProcessReasonCodes(
    input.inventoryBefore
  );
  if (
    input.forceReinstall ||
    (decision.status !== "not_installed" &&
      decision.status !== "blocked" &&
      unsafeReasonCodes.length === 0)
  ) {
    return null;
  }
  return {
    status: "blocked",
    targetVersion: input.expectedVersion,
    inventoryBefore: input.inventoryBefore,
    inventoryAfter: input.inventoryBefore,
    reasonCodes: dedupeReasonCodes([
      ...decision.reasonCodes,
      ...unsafeReasonCodes,
    ]),
    completedPhases: input.completedPhases,
    desiredState: input.desiredState,
    shouldStartAfterLifecycle: input.shouldStartAfterLifecycle,
    backupDataPath: null,
    errorMessage: null,
  };
}

function dedupeReasonCodes(
  reasonCodes: DaemonServiceLifecycleReasonCode[]
): DaemonServiceLifecycleReasonCode[] {
  return [...new Set(reasonCodes)];
}

async function ensureLifecycleServiceContract(input: {
  commandOptions: DaemonServiceLifecycleCommandOptions;
  currentContract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  daemonVersion: string;
  desiredState: "background" | "stopped";
  preparedBundle: Awaited<ReturnType<typeof prepareDaemonServiceBundle>>;
  serviceController: DaemonServiceManager["controller"];
}): Promise<void> {
  const bundleId =
    input.preparedBundle.bundleId ?? input.currentContract?.bundleId ?? null;
  const reusableCurrentContract = isDaemonServiceContractIdentityReusable(
    input.currentContract
  )
    ? input.currentContract
    : null;
  const writeResult = await writeDaemonServiceContract({
    daemonVersion: input.daemonVersion,
    bundleId,
    desiredState: input.desiredState,
    serviceController: input.serviceController,
    autoStart: input.desiredState === "background",
    gatewayUrl: input.commandOptions.gatewayUrl ?? null,
    ...(input.commandOptions.ownerUserId
      ? { ownerUserId: input.commandOptions.ownerUserId }
      : {}),
    ...(input.commandOptions.openMeldProfileId
      ? { profileId: input.commandOptions.openMeldProfileId }
      : {}),
    deviceId: input.commandOptions.deviceId ?? null,
    heartbeatMs:
      input.commandOptions.heartbeatMs ??
      input.currentContract?.heartbeatMs ??
      null,
    ...(reusableCurrentContract ? { lane: reusableCurrentContract.lane } : {}),
  });
  if (writeResult.status === "skipped_missing_fields") {
    throw new DaemonServiceLifecycleStageError({
      message: formatMissingContractFieldsLifecycleError(
        writeResult.missingFields
      ),
      reasonCodes: [MISSING_REQUIRED_CONTRACT_FIELDS_REASON],
      stage: "write_contract",
    });
  }
}

function formatMissingContractFieldsLifecycleError(
  missingFields: DaemonServiceContractMissingField[]
): string {
  const fields = missingFields.length > 0 ? missingFields.join(",") : "unknown";
  return `OpenMeld Service contract cannot be written. reason=${MISSING_REQUIRED_CONTRACT_FIELDS_REASON} missingFields=${fields}`;
}

async function restoreLifecycleServiceContractSnapshot(
  snapshot: Awaited<ReturnType<typeof readDaemonServiceContract>>
): Promise<void> {
  if (!snapshot) {
    await clearDaemonServiceContract();
    return;
  }
  await upsertDaemonServiceContract({
    daemonVersion: snapshot.daemonVersion,
    bundleId: snapshot.bundleId,
    desiredState: snapshot.desiredState,
    serviceController: snapshot.serviceController,
    autoStart: snapshot.autoStart,
    gatewayUrl: snapshot.gatewayUrl,
    ...(snapshot.ownerUserId ? { ownerUserId: snapshot.ownerUserId } : {}),
    ...(snapshot.profileId ? { profileId: snapshot.profileId } : {}),
    deviceId: snapshot.deviceId,
    ...(snapshot.connectedComputerId
      ? { connectedComputerId: snapshot.connectedComputerId }
      : {}),
    heartbeatMs: snapshot.heartbeatMs,
    lane: snapshot.lane,
  });
}

type VerifiedLifecycleInventoryInput = {
  desiredState: "background" | "stopped";
  expectedVersion: string;
  operation: DaemonServiceLifecycleOperation;
  serviceManager: DaemonServiceManager;
  shouldStartAfterLifecycle: boolean;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
};

async function waitForStartedLifecycleInventory(
  input: VerifiedLifecycleInventoryInput
): Promise<DaemonServiceInventory> {
  try {
    const result = await waitForSystemServiceStartup({
      expectedVersion: input.expectedVersion,
      manager: input.serviceManager,
      pollMs: STRICT_TEARDOWN_VERIFY_POLL_MS,
      intent: toLifecycleIntent(input.operation),
      isReady: (inventory) =>
        verifyLifecycleInventory({
          desiredState: input.desiredState,
          inventory,
          shouldStartAfterLifecycle: true,
          target: input.target,
        }) === null,
    });
    return result.inventory;
  } catch (error) {
    if (!isSystemServiceStartupTimeoutError(error)) {
      throw error;
    }
    const inventory = error.inventory;
    const verificationError = inventory
      ? verifyLifecycleInventory({
          desiredState: input.desiredState,
          inventory,
          shouldStartAfterLifecycle: true,
          target: input.target,
        })
      : null;
    throw new DaemonServiceLifecycleStageError({
      cause: error,
      message: verificationError ?? error.message,
      reasonCodes: inventory
        ? readDaemonServiceInventoryAnomalyCodes(inventory)
        : [],
      stage: "verify_final_inventory",
    });
  }
}

async function waitForVerifiedLifecycleInventory(
  input: VerifiedLifecycleInventoryInput
): Promise<DaemonServiceInventory> {
  if (input.shouldStartAfterLifecycle) {
    return await waitForStartedLifecycleInventory(input);
  }

  const deadline = Date.now() + STRICT_TEARDOWN_VERIFY_WAIT_MS;
  let lastInventory: DaemonServiceInventory | null = null;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intent: toLifecycleIntent(input.operation),
    });
    const verificationError = verifyLifecycleInventory({
      desiredState: input.desiredState,
      inventory,
      shouldStartAfterLifecycle: input.shouldStartAfterLifecycle,
      target: input.target,
    });
    if (!verificationError) {
      return inventory;
    }
    if (
      !shouldRetryLifecycleInventoryVerification({
        inventory,
        shouldStartAfterLifecycle: input.shouldStartAfterLifecycle,
      })
    ) {
      throw new DaemonServiceLifecycleStageError({
        message: verificationError,
        reasonCodes: readDaemonServiceInventoryAnomalyCodes(inventory),
        stage: "verify_final_inventory",
        cause: inventory,
      });
    }
    lastInventory = inventory;
    lastError = verificationError;
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }
  throw new DaemonServiceLifecycleStageError({
    message:
      lastError ??
      "OpenMeld could not verify the final local service inventory state.",
    reasonCodes: lastInventory
      ? readDaemonServiceInventoryAnomalyCodes(lastInventory)
      : [],
    stage: "verify_final_inventory",
    cause: lastInventory,
  });
}

function readDaemonServiceInventoryAnomalyCodes(
  inventory: DaemonServiceInventory
): DaemonServiceLifecycleReasonCode[] {
  return inventory.anomalies.map((anomaly) => anomaly.code);
}

async function installDaemonSystemServiceRegistration(input: {
  distribution: OpenMeldDistribution;
  serviceCommandSpec: ReturnType<typeof buildDaemonSystemServiceCommandSpec>;
  serviceManager: DaemonServiceManager;
}): Promise<void> {
  await ensureDaemonSystemServiceCommandFiles({
    controller: input.serviceManager.controller,
    distribution: input.distribution,
  });
  await input.serviceManager.install(input.serviceCommandSpec);
}

function verifyLifecycleInventory(input: {
  desiredState: "background" | "stopped";
  inventory: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}): string | null {
  const staticVerificationFailure =
    verifyLifecycleInventoryStaticRequirements(input);
  if (staticVerificationFailure) {
    return staticVerificationFailure;
  }
  const effectiveRuntimeStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState: input.inventory.runtimeStatus,
    serviceManagerStatus: input.inventory.serviceManagerStatus,
  });
  const serviceManagerStatus = input.inventory.serviceManagerStatus;
  if (!serviceManagerStatus) {
    return "Lifecycle verification failed because system service registration is missing.";
  }
  if (input.shouldStartAfterLifecycle) {
    if (
      effectiveRuntimeStatus !== "running" ||
      input.inventory.runtimeStatus.mode !== "background" ||
      serviceManagerStatus.running !== true
    ) {
      return `Lifecycle verification failed because background service did not recover. runtime=${effectiveRuntimeStatus}, mode=${input.inventory.runtimeStatus.mode ?? "unknown"}, managerRunning=${String(
        serviceManagerStatus.running
      )}`;
    }
    return null;
  }
  if (effectiveRuntimeStatus === "running") {
    return "Lifecycle verification failed because the service is still running even though it should remain stopped.";
  }
  if (serviceManagerStatus.running) {
    return "Lifecycle verification failed because the system service manager still reports the service as running.";
  }
  return null;
}

function verifyLifecycleInventoryStaticRequirements(input: {
  desiredState: "background" | "stopped";
  inventory: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}): string | null {
  return (
    verifyLifecycleInventoryDecision(input) ??
    verifyLifecycleInventoryContractState(input) ??
    verifyLifecycleInventoryBundleState(input) ??
    verifyLifecycleInventoryManagerState(input) ??
    (input.shouldStartAfterLifecycle
      ? verifyLifecycleInventoryRuntimeBundleState(input)
      : null)
  );
}

function verifyLifecycleInventoryDecision(input: {
  inventory: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}): string | null {
  const inventory = buildLifecycleAlignmentInventory(input);
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory,
    target: input.target,
  });
  if (decision.status === "already_aligned") {
    return null;
  }
  return `Lifecycle verification failed because the service is still ${decision.status}. reasons=${decision.reasonCodes.join(",") || "none"}`;
}

function buildLifecycleAlignmentInventory(input: {
  inventory: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
}): DaemonServiceInventory {
  if (
    input.shouldStartAfterLifecycle ||
    input.inventory.serviceManagerStatus?.running !== false ||
    input.inventory.ownedProcesses.length > 0
  ) {
    return input.inventory;
  }

  return {
    ...input.inventory,
    anomalies: input.inventory.anomalies.filter(
      (anomaly) =>
        !STOPPED_LIFECYCLE_RUNTIME_SNAPSHOT_ANOMALIES.has(anomaly.code)
    ),
  };
}

function verifyLifecycleInventoryContractState(input: {
  desiredState: "background" | "stopped";
  inventory: DaemonServiceInventory;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}): string | null {
  const contract = input.inventory.serviceContract ?? null;
  if (!contract) {
    return "Lifecycle verification failed because the service contract is missing.";
  }
  if (contract.daemonVersion !== input.target.daemonVersion) {
    return `Lifecycle verification failed because service contract version is ${contract.daemonVersion} instead of ${input.target.daemonVersion}.`;
  }
  if (
    input.inventory.activeBundle &&
    contract.bundleId !== input.inventory.activeBundle.bundleId
  ) {
    return `Lifecycle verification failed because service contract bundle is ${contract.bundleId} instead of ${input.inventory.activeBundle.bundleId}.`;
  }
  if (contract.desiredState !== input.desiredState) {
    return `Lifecycle verification failed because service contract desiredState is ${contract.desiredState} instead of ${input.desiredState}.`;
  }
  return null;
}

function verifyLifecycleInventoryBundleState(input: {
  inventory: DaemonServiceInventory;
  target: ReturnType<typeof buildDaemonServiceTargetSpec>;
}): string | null {
  if (!input.inventory.activeBundle) {
    return "Lifecycle verification failed because the active service bundle is missing.";
  }
  if (input.inventory.activeBundle.bundleFormat !== input.target.bundleFormat) {
    return `Lifecycle verification failed because bundle format is ${input.inventory.activeBundle.bundleFormat}.`;
  }
  if (
    input.inventory.activeBundle.daemonVersion !== input.target.daemonVersion
  ) {
    return `Lifecycle verification failed because active bundle version is ${input.inventory.activeBundle.daemonVersion} instead of ${input.target.daemonVersion}.`;
  }
  if (
    !isDaemonBundleSourceAllowedForLane({
      sourceKind: input.inventory.activeBundle.sourceKind,
    })
  ) {
    return "Lifecycle verification failed because the active service bundle came from repo-local workspace source in a lane that only allows published or packaged bundles.";
  }
  if (input.inventory.activeBundleEntryPath) {
    return null;
  }
  return "Lifecycle verification failed because the active bundle entry path is missing.";
}

function verifyLifecycleInventoryManagerState(input: {
  inventory: DaemonServiceInventory;
}): string | null {
  if (!input.inventory.serviceManagerStatus?.installed) {
    return "Lifecycle verification failed because system service registration is missing.";
  }
  if (!input.inventory.serviceManagerStatus.enabled) {
    return "Lifecycle verification failed because system service registration is disabled.";
  }
  if (resolveUnsafeOwnedProcessReasonCodes(input.inventory).length > 0) {
    return "Lifecycle verification failed because OpenMeld still detected an unknown owned process.";
  }
  return null;
}

function verifyLifecycleInventoryRuntimeBundleState(input: {
  inventory: DaemonServiceInventory;
}): string | null {
  if (!input.inventory.runtimeCommandEntryPath) {
    return "Lifecycle verification failed because runtime state does not point at a concrete service bundle entry path.";
  }
  if (input.inventory.runtimeCommandPathExists !== true) {
    return "Lifecycle verification failed because the running service still points at a bundle entry path that no longer exists.";
  }
  const activeBundleEntryPath = input.inventory.activeBundleEntryPath;
  if (!activeBundleEntryPath) {
    return "Lifecycle verification failed because the active bundle entry path is missing.";
  }
  if (
    normalizeDaemonCommandPath(input.inventory.runtimeCommandEntryPath) ===
    normalizeDaemonCommandPath(activeBundleEntryPath)
  ) {
    return null;
  }
  return `Lifecycle verification failed because runtime is still using ${input.inventory.runtimeCommandEntryPath} instead of ${activeBundleEntryPath}.`;
}

function shouldRetryLifecycleInventoryVerification(input: {
  inventory: DaemonServiceInventory;
  shouldStartAfterLifecycle: boolean;
}): boolean {
  if (!input.shouldStartAfterLifecycle) {
    return true;
  }
  return !hasTerminalRuntimeBundleMismatch(input.inventory);
}

function hasTerminalRuntimeBundleMismatch(
  inventory: DaemonServiceInventory
): boolean {
  if (inventory.runtimeStatus.status !== "running") {
    return false;
  }
  if (inventory.runtimeCommandPathExists !== true) {
    return false;
  }
  if (!(inventory.runtimeCommandEntryPath && inventory.activeBundleEntryPath)) {
    return false;
  }
  return (
    normalizeDaemonCommandPath(inventory.runtimeCommandEntryPath) !==
    normalizeDaemonCommandPath(inventory.activeBundleEntryPath)
  );
}

function resolveLifecycleFailureStage(
  error: unknown,
  fallback: DaemonServiceFailureStage | null
): DaemonServiceFailureStage | null {
  if (error instanceof DaemonServiceLifecycleStageError) {
    return error.stage;
  }
  if (error instanceof DaemonServiceLifecycleDrainTimeoutError) {
    return "stop_or_drain";
  }
  return fallback;
}

function resolveLifecycleFailureReasonCodes(
  error: unknown
): DaemonServiceLifecycleReasonCode[] {
  if (error instanceof DaemonServiceLifecycleStageError) {
    return error.reasonCodes;
  }
  return [];
}

function resolveLifecycleFailureErrorCode(error: unknown): string | null {
  const visited = new Set<unknown>();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof LocalDaemonControlPlaneClientError) {
      return current.code;
    }
    if (current instanceof Error && current.cause) {
      current = current.cause;
      continue;
    }
    break;
  }
  return null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

async function stopDaemonProcess(
  pid: number,
  signal: NodeJS.Signals
): Promise<boolean> {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return true;
    }
    throw new Error(
      `Failed to send ${signal} to pid ${String(pid)}: ${toErrorMessage(error)}`
    );
  }
  if (signal === "SIGKILL") {
    return true;
  }
  return await waitForProcessToExit(pid, PROCESS_STOP_WAIT_MS);
}

async function stopDaemonProcessWithTimeout(
  pid: number,
  signal: NodeJS.Signals,
  timeoutMs: number
): Promise<boolean> {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return true;
    }
    throw new Error(
      `Failed to send ${signal} to pid ${String(pid)}: ${toErrorMessage(error)}`
    );
  }
  return await waitForProcessToExit(pid, timeoutMs);
}

async function waitForProcessToExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }
  return !isPidAlive(pid);
}

async function writeLifecycleEvidenceEvent(input: {
  evidencePath: string | null;
  completedPhases: readonly DaemonServiceLifecyclePhase[];
  failureStage: DaemonServiceFailureStage | null;
}): Promise<void> {
  if (!input.evidencePath) {
    return;
  }
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await writeFile(
    join(input.evidencePath, "lifecycle.json"),
    `${JSON.stringify(
      {
        schema: "openmeld-daemon-service-lifecycle-v1",
        completedPhases: input.completedPhases,
        failureStage: input.failureStage,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  ).catch(() => undefined);
}
