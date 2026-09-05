import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../../config/lock";
import { maintainOfficialCliSkill } from "../../skills/maintenance";
import { assertDaemonMaintenanceInstallationOwnership } from "../lifecycle/daemon-service-manager-command-match";
import { runPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-coordinator";
import { readPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-state";
import { prepareDaemonServiceUpdateWorkerCarrier } from "../lifecycle/daemon-service-update-worker-manager";
import { readOpenMeldToolsMaintenancePolicy } from "./openmeld-tools-maintenance-policy";
import { readPendingOpenMeldToolsUpdateAttempt } from "./openmeld-tools-update-attempt-state";
import { createOpenMeldToolsUpdateCoordinator } from "./openmeld-tools-update-coordinator";

// The OS owns this process. It is also the sole executor of persisted download
// attempts; Service requests only publish an attempt and wake this worker.
export async function runOpenMeldMaintenanceWorker(): Promise<void> {
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
      await coordinator.requestUpdate({ requestSource: "automatic" });
    }
    await coordinator.waitForIdle();
  }
  const result = await runPendingDaemonServiceUpdate();
  if (result?.phase === "updated") {
    // Only a verified replacement may replace the working recovery carrier.
    await prepareDaemonServiceUpdateWorkerCarrier(result);
    return true;
  }
  if (result?.phase === "restored" || result?.phase === "needs_help") {
    process.exitCode = 1;
  }
  return false;
}
