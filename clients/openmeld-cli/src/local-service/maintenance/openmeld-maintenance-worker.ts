import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { configureDaemonMaintenanceEnvironment } from "../../config/daemon-service-update-worker-registration";
import { withDaemonServiceReconcileLock } from "../../config/daemon-state";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../../config/lock";
import { reconcileManagedCliLauncher } from "../../local-components/managed-install";
import { OPENMELD_VERSION } from "../../runtime/version";
import { maintainOfficialCliSkill } from "../../skills/maintenance";
import {
  readDaemonServiceStartupPolicyCurrent,
  resolveDaemonServiceManager,
} from "../lifecycle/daemon-service-manager";
import { assertDaemonMaintenanceInstallationOwnership } from "../lifecycle/daemon-service-manager-command-match";
import {
  runPendingDaemonServiceUpdate,
  scheduleDaemonServiceUpdate,
} from "../lifecycle/daemon-service-update-coordinator";
import {
  completePendingDaemonServiceUpdate,
  readPendingDaemonServiceUpdate,
} from "../lifecycle/daemon-service-update-state";
import { prepareDaemonServiceUpdateWorkerCarrier } from "../lifecycle/daemon-service-update-worker-manager";
import { readOpenMeldToolsMaintenancePolicy } from "./openmeld-tools-maintenance-policy";
import { readPendingOpenMeldToolsUpdateAttempt } from "./openmeld-tools-update-attempt-state";
import { createOpenMeldToolsUpdateCoordinator } from "./openmeld-tools-update-coordinator";

// The OS owns this process. It is also the sole executor of persisted download
// attempts; Service requests only publish an attempt and wake this worker.
export async function runOpenMeldMaintenanceWorker(): Promise<void> {
  configureDaemonMaintenanceEnvironment(process.env);
  await runMaintenanceWithLock();
}

async function runMaintenanceWithLock(): Promise<boolean> {
  try {
    const lock = await acquireLock({
      openMeldProfileId: "__system__",
      key: "maintenance-worker",
    });
    return await runWithHeldLock({
      lock,
      run: runMaintenancePass,
      releaseContext: { component: "maintenance_worker" },
    });
  } catch (error) {
    // Setup/repair may still own the lifecycle lock when the OS first runs us.
    // Leave its state intact; the existing OS trigger will run another pass.
    if (isOpenMeldLockError(error) && !isOpenMeldOrphanedLockError(error)) {
      return false;
    }
    throw error;
  }
}

async function runMaintenancePass(): Promise<boolean> {
  const pendingJob = await readPendingDaemonServiceUpdate();
  const pendingAttempt = await readPendingOpenMeldToolsUpdateAttempt();
  if (!(pendingJob || pendingAttempt)) {
    const contract = await readDaemonServiceContract();
    if (!contract || contract.desiredState !== "background") {
      return false;
    }
  }
  await assertDaemonMaintenanceInstallationOwnership();
  await reconcileManagedCliLauncher();
  if ((await readOpenMeldToolsMaintenancePolicy()).automaticUpdatesEnabled) {
    try {
      await maintainOfficialCliSkill();
    } catch (error) {
      process.stderr.write(
        `[openmeld] Skill maintenance deferred: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
  const coordinator = createOpenMeldToolsUpdateCoordinator();
  if (!pendingJob) {
    if (pendingAttempt) {
      await coordinator.resumePendingUpdate();
    } else {
      const update = await coordinator.requestUpdate({
        requestSource: "automatic",
      });
      await reconcileCurrentServiceStartupPolicy(update.status === "current");
    }
    await coordinator.waitForIdle();
  }
  const result = await runPendingDaemonServiceUpdate();
  if (result?.phase === "updated") {
    const {
      finishComputerSetupAfterBackgroundUpdate,
      recoverComputerSetupAfterBackgroundUpdate,
    } = await import("../../commands/computer-setup-continuation");
    // Only a verified replacement may replace the working recovery carrier.
    await prepareDaemonServiceUpdateWorkerCarrier(result);
    await finishComputerSetupAfterBackgroundUpdate();
    await withDaemonServiceReconcileLock(async () => {
      const current = await readPendingDaemonServiceUpdate();
      if (
        current?.jobId === result.jobId &&
        current.phase === "updated" &&
        current.targetVersion === result.targetVersion
      ) {
        await completePendingDaemonServiceUpdate(current);
      }
    });
    await recoverComputerSetupAfterBackgroundUpdate();
    return true;
  }
  if (result?.phase === "restored" || result?.phase === "needs_help") {
    process.exitCode = 1;
  }
  return false;
}

async function reconcileCurrentServiceStartupPolicy(
  updatesCurrent: boolean
): Promise<void> {
  if (!updatesCurrent) {
    return;
  }
  const contract = await readDaemonServiceContract();
  // An older recovery worker must not apply its policy to a newer Service,
  // and maintenance must preserve an explicit user stop.
  if (
    contract?.desiredState !== "background" ||
    contract.daemonVersion !== OPENMELD_VERSION
  ) {
    return;
  }
  const manager = await resolveDaemonServiceManager();
  if (
    (await readDaemonServiceStartupPolicyCurrent({
      controller: manager?.controller ?? null,
      status: (await manager?.status()) ?? null,
    })) === false
  ) {
    await scheduleDaemonServiceUpdate({
      targetVersion: contract.daemonVersion,
      urgency: "available",
      requestSource: "automatic",
    });
  }
}
