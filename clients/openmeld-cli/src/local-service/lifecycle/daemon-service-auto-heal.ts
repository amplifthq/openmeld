import process from "node:process";
import { sleep } from "@openmeld/utils";
import {
  clearDaemonServiceRuntimeState,
  type DaemonLifecycleIntent,
  type DaemonRunMode,
  withDaemonServiceRegistrationMutationLock,
} from "../../config/daemon-state";
import { resolveOpenMeldEnvironmentTarget } from "../../config/openmeld-environment-target";
import { DAEMON_SERVICE_AUTO_HEAL_ANOMALIES } from "./daemon-service-anomaly-groups";
import {
  buildDaemonSystemServiceCommandSpec,
  ensureDaemonSystemServiceCommandFiles,
} from "./daemon-service-command-spec";
import {
  buildDaemonServiceCleanupPlan,
  type DaemonServiceCleanupAction,
} from "./daemon-service-hygiene";
import {
  type DaemonServiceAnomalyCode,
  type DaemonServiceInventory,
  inspectDaemonServiceInventory,
} from "./daemon-service-inventory";
import { cleanupLegacySharedDaemonServiceState } from "./daemon-service-legacy-shared";
import {
  type DaemonServiceManager,
  resolveDaemonServiceManager,
} from "./daemon-service-manager";
import {
  getDaemonServiceRepairBudgetState,
  recordDaemonServiceRepairFailure,
  recordDaemonServiceRepairSuccess,
} from "./daemon-service-repair-journal";
import { waitForDaemonSystemServiceToStop } from "./daemon-service-runtime";

const AUTO_HEAL_SAFE_ACTIONS = new Set<DaemonServiceCleanupAction>([
  "clear_stale_runtime_state",
  "stop_owned_processes",
  "remove_system_service_registration",
  "repair_service_manager_registration",
]);
const AUTO_HEAL_DUPLICATE_POLL_MS = 120;
const AUTO_HEAL_DUPLICATE_WAIT_MS = 2000;

export type DaemonServiceAutoHealReport = {
  status: "noop" | "repaired" | "blocked" | "cooldown" | "failed";
  inventoryBefore: DaemonServiceInventory;
  inventoryAfter: DaemonServiceInventory | null;
  appliedActions: DaemonServiceCleanupAction[];
  blockedAnomalyCodes: DaemonServiceAnomalyCode[];
  errorMessage: string | null;
  cooldownUntil: string | null;
};

export async function runDaemonServiceAutoHeal(input: {
  expectedVersion: string;
  intent: DaemonLifecycleIntent;
  requestedMode?: DaemonRunMode;
  cliScriptPath?: string;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
}): Promise<DaemonServiceAutoHealReport> {
  return await withDaemonServiceRegistrationMutationLock(
    async () => await runDaemonServiceAutoHealWithLock(input),
    {
      intent: input.intent,
      command: "OpenMeld Service automatic registration repair",
    }
  );
}

async function runDaemonServiceAutoHealWithLock(input: {
  expectedVersion: string;
  intent: DaemonLifecycleIntent;
  requestedMode?: DaemonRunMode;
  cliScriptPath?: string;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
}): Promise<DaemonServiceAutoHealReport> {
  const inventoryBefore = await inspectDaemonServiceInventory({
    expectedVersion: input.expectedVersion,
    intendedMode: input.requestedMode,
    intent: input.intent,
  });
  const duplicateCleanup =
    resolveLegacyDetachedDuplicateCleanup(inventoryBefore);
  const cleanupPlan = buildDaemonServiceCleanupPlan({
    intent: input.intent,
    inventory: inventoryBefore,
    requestedMode: input.requestedMode,
  });
  const safeActions = cleanupPlan.actions.filter((action) =>
    AUTO_HEAL_SAFE_ACTIONS.has(action)
  );
  const blockedAnomalyCodes = resolveBlockedAutoHealAnomalyCodes({
    inventory: inventoryBefore,
    duplicateCleanup,
  });

  if (duplicateCleanup && !safeActions.includes("stop_owned_processes")) {
    safeActions.push("stop_owned_processes");
  }
  if (safeActions.length === 0 || blockedAnomalyCodes.length > 0) {
    return {
      status: safeActions.length === 0 ? "noop" : "blocked",
      inventoryBefore,
      inventoryAfter: inventoryBefore,
      appliedActions: [],
      blockedAnomalyCodes,
      errorMessage: null,
      cooldownUntil: null,
    };
  }

  const budget = await getDaemonServiceRepairBudgetState({
    actions: safeActions,
  });
  if (budget?.status === "cooldown") {
    return {
      status: "cooldown",
      inventoryBefore,
      inventoryAfter: inventoryBefore,
      appliedActions: [],
      blockedAnomalyCodes,
      errorMessage: budget.lastErrorMessage,
      cooldownUntil: budget.cooldownUntil,
    };
  }

  try {
    await applyDaemonServiceAutoHealActions({
      actions: safeActions,
      cliScriptPath: input.cliScriptPath,
      daemonVersion: input.expectedVersion,
      deviceId: input.deviceId,
      duplicateCleanup,
      gatewayUrl: input.gatewayUrl,
      heartbeatMs: input.heartbeatMs,
      inventory: inventoryBefore,
      profile: input.profile,
    });
    const inventoryAfter = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: input.requestedMode,
      intent: input.intent,
    }).catch(() => null);
    const remainingAutoHealAnomalies = inventoryAfter
      ? resolveAutoHealAnomalyCodes({
          inventory: inventoryAfter,
          duplicateCleanup:
            resolveLegacyDetachedDuplicateCleanup(inventoryAfter),
        })
      : [];
    if (remainingAutoHealAnomalies.length > 0) {
      throw new Error(
        `Automatic repair left recoverable anomalies behind: ${remainingAutoHealAnomalies.join(
          ", "
        )}`
      );
    }
    await recordDaemonServiceRepairSuccess({
      actions: safeActions,
    });
    return {
      status: "repaired",
      inventoryBefore,
      inventoryAfter,
      appliedActions: safeActions,
      blockedAnomalyCodes,
      errorMessage: null,
      cooldownUntil: null,
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    await recordDaemonServiceRepairFailure({
      actions: safeActions,
      errorMessage,
    });
    return {
      status: "failed",
      inventoryBefore,
      inventoryAfter: null,
      appliedActions: safeActions,
      blockedAnomalyCodes,
      errorMessage,
      cooldownUntil: null,
    };
  }
}

async function applyDaemonServiceAutoHealActions(input: {
  actions: DaemonServiceCleanupAction[];
  daemonVersion: string;
  inventory: DaemonServiceInventory;
  duplicateCleanup: LegacyDetachedDuplicateCleanup | null;
  cliScriptPath?: string;
  gatewayUrl?: string;
  profile?: string;
  deviceId?: string;
  heartbeatMs?: number;
}): Promise<void> {
  const actionSet = new Set(input.actions);
  const systemManager = await resolveAutoHealServiceManager(input.inventory);

  if (actionSet.has("clear_stale_runtime_state")) {
    await clearDaemonServiceRuntimeState();
  }

  if (actionSet.has("stop_owned_processes")) {
    await stopDuplicateOwnedProcesses(input.duplicateCleanup);
  }

  if (actionSet.has("remove_system_service_registration")) {
    await removeSystemServiceRegistration(systemManager);
    if (input.inventory.legacySharedService?.present) {
      await cleanupLegacySharedDaemonServiceState();
    }
  }

  if (actionSet.has("repair_service_manager_registration")) {
    await repairSystemServiceRegistration({
      gatewayUrl: input.gatewayUrl,
      systemManager,
    });
  }
}

async function resolveAutoHealServiceManager(
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
  if (
    inventory.serviceContract?.serviceController &&
    inventory.serviceContract.serviceController !== "unknown" &&
    inventory.serviceContract.serviceController !== "legacy-detached"
  ) {
    return await resolveDaemonServiceManager(
      inventory.serviceContract.serviceController
    ).catch(() => null);
  }
  return await resolveDaemonServiceManager().catch(() => null);
}

async function removeSystemServiceRegistration(
  systemManager: DaemonServiceManager | null
): Promise<void> {
  if (!systemManager) {
    return;
  }
  await systemManager.stop().catch(() => undefined);
  await waitForDaemonSystemServiceToStop({
    manager: systemManager,
  }).catch(() => false);
  await systemManager.uninstall().catch(() => undefined);
}

async function repairSystemServiceRegistration(input: {
  systemManager: DaemonServiceManager | null;
  gatewayUrl?: string;
}): Promise<void> {
  if (!input.systemManager) {
    return;
  }
  const serviceCommandSpec = buildDaemonSystemServiceCommandSpec({
    controller: input.systemManager.controller,
    environmentTarget: await resolveOpenMeldEnvironmentTarget({
      gatewayUrl: input.gatewayUrl,
    }),
  });
  await ensureDaemonSystemServiceCommandFiles({
    controller: input.systemManager.controller,
  });
  await input.systemManager.install(serviceCommandSpec);
}

type LegacyDetachedDuplicateCleanup = {
  managedRuntimePid: number;
  legacyDetachedPids: number[];
};

function resolveLegacyDetachedDuplicateCleanup(
  inventory: DaemonServiceInventory
): LegacyDetachedDuplicateCleanup | null {
  if (
    !inventory.anomalies.some(
      (anomaly) => anomaly.code === "duplicate_owned_processes"
    )
  ) {
    return null;
  }
  if (
    inventory.runtimeStatus.status !== "running" ||
    inventory.runtimeStatus.mode !== "background" ||
    !inventory.runtimeStatus.managedBySystemService ||
    !Number.isInteger(inventory.runtimeStatus.pid)
  ) {
    return null;
  }
  const managedRuntimePid = inventory.runtimeStatus.pid;
  if (typeof managedRuntimePid !== "number") {
    return null;
  }
  const managedRuntimeProcess = inventory.ownedProcesses.find(
    (processInfo) => processInfo.pid === managedRuntimePid
  );
  if (!managedRuntimeProcess) {
    return null;
  }
  const legacyDetachedProcesses = inventory.ownedProcesses.filter(
    (processInfo) => processInfo.ownership === "legacy_detached"
  );
  if (legacyDetachedProcesses.length === 0) {
    return null;
  }
  const remainingOtherProcesses = inventory.ownedProcesses.filter(
    (processInfo) =>
      processInfo.pid !== managedRuntimePid &&
      processInfo.ownership !== "legacy_detached"
  );
  if (remainingOtherProcesses.length > 0) {
    return null;
  }
  return {
    managedRuntimePid,
    legacyDetachedPids: legacyDetachedProcesses.map(
      (processInfo) => processInfo.pid
    ),
  };
}

async function stopDuplicateOwnedProcesses(
  duplicateCleanup: LegacyDetachedDuplicateCleanup | null
): Promise<void> {
  if (!duplicateCleanup) {
    return;
  }
  for (const pid of duplicateCleanup.legacyDetachedPids) {
    if (pid === duplicateCleanup.managedRuntimePid) {
      continue;
    }
    await terminateDaemonOwnedProcess(pid);
  }
}

async function terminateDaemonOwnedProcess(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return;
  }
  if (!isPidAlive(pid)) {
    return;
  }
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + AUTO_HEAL_DUPLICATE_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return;
    }
    await sleep(AUTO_HEAL_DUPLICATE_POLL_MS);
  }
  if (isPidAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }
}

function resolveBlockedAutoHealAnomalyCodes(input: {
  inventory: DaemonServiceInventory;
  duplicateCleanup: LegacyDetachedDuplicateCleanup | null;
}): DaemonServiceAnomalyCode[] {
  return input.inventory.anomalies
    .map((anomaly) => anomaly.code)
    .filter((code) => {
      if (DAEMON_SERVICE_AUTO_HEAL_ANOMALIES.has(code)) {
        return false;
      }
      if (code === "duplicate_owned_processes") {
        return input.duplicateCleanup === null;
      }
      return (
        code === "foreground_background_conflict" ||
        code === "background_foreground_conflict" ||
        code === "downgrade_blocked" ||
        code === "lifecycle_locked"
      );
    });
}

function resolveAutoHealAnomalyCodes(input: {
  inventory: DaemonServiceInventory;
  duplicateCleanup: LegacyDetachedDuplicateCleanup | null;
}): DaemonServiceAnomalyCode[] {
  return input.inventory.anomalies
    .map((anomaly) => anomaly.code)
    .filter((code) => {
      if (DAEMON_SERVICE_AUTO_HEAL_ANOMALIES.has(code)) {
        return true;
      }
      return (
        code === "duplicate_owned_processes" && input.duplicateCleanup !== null
      );
    });
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}
