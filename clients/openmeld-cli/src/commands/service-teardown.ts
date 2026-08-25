import { sleep, toErrorMessage } from "@openmeld/utils";
import type {
  clearDaemonServiceRuntimeState,
  DaemonServiceRuntimeStatus,
  getDaemonStatus,
  uninstallDaemon,
  withDaemonServiceRegistrationMutationLock,
} from "../config/daemon-state";
import type { DaemonServiceFailureStage } from "../local-service/lifecycle/daemon-service-evidence";
import type {
  cleanupLegacySharedDaemonServiceState,
  LegacySharedDaemonServiceInspection,
} from "../local-service/lifecycle/daemon-service-legacy-shared";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "../local-service/lifecycle/daemon-service-manager";
import type { listDaemonOwnedProcesses } from "../local-service/lifecycle/daemon-service-process-inventory";
import {
  getEffectiveDaemonRuntimeStatus,
  type readCurrentObservedDaemonRuntimeStatus,
  type resolveDaemonServiceManagerForRuntimeState,
  type waitForDaemonSystemServiceToStop as waitForSystemServiceToStop,
} from "../local-service/lifecycle/daemon-service-runtime";
import type { uninstallDaemonServiceUpdateWorker } from "../local-service/lifecycle/daemon-service-update-worker-manager";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import {
  SERVICE_STOP_CHECK_MS,
  SERVICE_STOP_POLL_MS,
  type stopDaemonProcess,
} from "./service-stop-command";

const STRICT_TEARDOWN_VERIFY_WAIT_MS = 15_000;
const STRICT_TEARDOWN_VERIFY_POLL_MS = 200;

export type DaemonTeardownReason = "reset" | "service_uninstall";

export type DaemonTeardownStrictInput = {
  removeInstallFiles?: boolean;
  reason: DaemonTeardownReason;
};

export type DaemonTeardownStrictResult = {
  removed: boolean;
  stopSignal: NodeJS.Signals | "system" | null;
  systemServiceController: DaemonServiceManager["controller"] | null;
  systemServiceUninstalled: boolean;
};

export type DaemonTeardownStrictDependencies = {
  readCurrentObservedDaemonRuntimeStatus: typeof readCurrentObservedDaemonRuntimeStatus;
  getDaemonStatus: typeof getDaemonStatus;
  resolveDaemonServiceManagerForRuntimeState: typeof resolveDaemonServiceManagerForRuntimeState;
  clearDaemonServiceRuntimeState: typeof clearDaemonServiceRuntimeState;
  cleanupLegacySharedDaemonServiceState: typeof cleanupLegacySharedDaemonServiceState;
  listDaemonOwnedProcesses: typeof listDaemonOwnedProcesses;
  stopDaemonProcess: typeof stopDaemonProcess;
  waitForSystemServiceToStop: typeof waitForSystemServiceToStop;
  uninstallDaemon: typeof uninstallDaemon;
  uninstallServiceUpdateWorker: typeof uninstallDaemonServiceUpdateWorker;
  withRegistrationMutationLock: typeof withDaemonServiceRegistrationMutationLock;
};

export type DaemonStrictTeardownContext = {
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  legacySharedService: LegacySharedDaemonServiceInspection | null;
  usesSystemService: boolean;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
};

class DaemonStrictTeardownError extends Error {
  readonly hint: string;
  readonly reason: DaemonTeardownReason;
  readonly stage: DaemonServiceFailureStage;

  constructor(input: {
    hint: string;
    message: string;
    reason: DaemonTeardownReason;
    stage: DaemonServiceFailureStage;
  }) {
    super(input.message);
    this.hint = input.hint;
    this.name = "DaemonStrictTeardownError";
    this.reason = input.reason;
    this.stage = input.stage;
  }
}

export async function resolveDaemonStrictTeardownContext(input: {
  deps: DaemonTeardownStrictDependencies;
  reason: DaemonTeardownReason;
}): Promise<DaemonStrictTeardownContext> {
  const status = await input.deps.getDaemonStatus();
  const runtimeStatus =
    await input.deps.readCurrentObservedDaemonRuntimeStatus();
  const { serviceManager, serviceManagerStatus, legacySharedService } =
    await input.deps.resolveDaemonServiceManagerForRuntimeState({
      runtimeState: runtimeStatus,
      status,
    });
  const usesSystemService =
    runtimeStatus.managedBySystemService ||
    serviceManagerStatus?.installed === true;
  if (runtimeStatus.managedBySystemService && !serviceManager) {
    throw createStrictTeardownError({
      reason: input.reason,
      message:
        "runtime is marked as system-managed but service manager is unavailable",
      hint: "run `openmeld service status` and retry",
      stage: "pre-stop",
    });
  }

  const effectiveRuntimeStatus = serviceManager
    ? getEffectiveDaemonRuntimeStatus({
        runtimeState: runtimeStatus,
        serviceManagerStatus,
      })
    : runtimeStatus.status;

  return {
    runtimeStatus,
    serviceManager,
    serviceManagerStatus,
    legacySharedService,
    usesSystemService,
    effectiveRuntimeStatus,
  };
}

export async function stopDaemonForStrictTeardown(input: {
  context: DaemonStrictTeardownContext;
  deps: DaemonTeardownStrictDependencies;
  reason: DaemonTeardownReason;
}): Promise<NodeJS.Signals | "system" | null> {
  if (!(input.context.usesSystemService && input.context.serviceManager)) {
    return await stopNonSystemDaemonForStrictTeardown(input);
  }

  if (
    input.context.effectiveRuntimeStatus !== "running" &&
    input.context.serviceManagerStatus?.running !== true
  ) {
    return null;
  }

  await input.context.serviceManager.stop().catch((error) => {
    throw createStrictTeardownError({
      reason: input.reason,
      message: `failed to stop system service (${input.context.serviceManager?.controller}): ${toErrorMessage(error)}`,
      hint: "run `openmeld service stop --force` and retry",
      stage: "stop-wait",
    });
  });

  const stopped = await input.deps.waitForSystemServiceToStop({
    manager: input.context.serviceManager,
    waitMs: SERVICE_STOP_CHECK_MS,
    pollMs: SERVICE_STOP_POLL_MS,
  });
  if (!stopped) {
    throw createStrictTeardownError({
      reason: input.reason,
      message: `system service (${input.context.serviceManager.controller}) is still running`,
      hint: "run `openmeld service stop --force` and retry",
      stage: "stop-wait",
    });
  }

  return "system";
}

export async function stopNonSystemDaemonForStrictTeardown(input: {
  context: DaemonStrictTeardownContext;
  deps: DaemonTeardownStrictDependencies;
  reason: DaemonTeardownReason;
}): Promise<NodeJS.Signals | null> {
  if (input.context.effectiveRuntimeStatus !== "running") {
    return null;
  }
  const daemonPid = input.context.runtimeStatus.pid;
  if (daemonPid === null) {
    throw createStrictTeardownError({
      reason: input.reason,
      message: "runtime state is running but pid is missing",
      hint: "run `openmeld service status` and retry",
      stage: "pre-stop",
    });
  }

  const terminated = await input.deps.stopDaemonProcess(daemonPid, "SIGTERM");
  if (terminated) {
    return "SIGTERM";
  }
  await input.deps.stopDaemonProcess(daemonPid, "SIGKILL");
  return "SIGKILL";
}

export async function ensureRuntimeStoppedAfterStrictTeardownStop(input: {
  deps: DaemonTeardownStrictDependencies;
  reason: DaemonTeardownReason;
}): Promise<void> {
  const runtimeAfterStop =
    await input.deps.readCurrentObservedDaemonRuntimeStatus();
  if (runtimeAfterStop.status === "running") {
    throw createStrictTeardownError({
      reason: input.reason,
      message: `service is still running after stop phase (pid=${String(runtimeAfterStop.pid)})`,
      hint: "run `openmeld service stop --force` and retry",
      stage: "stop-wait",
    });
  }
}

export async function uninstallSystemServiceForStrictTeardown(input: {
  context: DaemonStrictTeardownContext;
  reason: DaemonTeardownReason;
}): Promise<boolean> {
  const managers = resolveStrictTeardownServiceManagers(input.context);
  if (managers.length === 0) {
    return false;
  }

  for (const manager of managers) {
    await manager.uninstall().catch((error) => {
      throw createStrictTeardownError({
        reason: input.reason,
        message: `failed to uninstall system service (${manager.controller}): ${toErrorMessage(error)}`,
        hint: "fix OS service permissions and retry",
        stage: "uninstall-verify",
      });
    });
  }
  return true;
}

export async function verifySystemServiceRemovedAfterStrictTeardown(input: {
  context: DaemonStrictTeardownContext;
  reason: DaemonTeardownReason;
}): Promise<void> {
  const managers = resolveStrictTeardownServiceManagers(input.context);
  if (managers.length === 0) {
    return;
  }

  const deadline = Date.now() + STRICT_TEARDOWN_VERIFY_WAIT_MS;
  while (Date.now() < deadline) {
    let allRemoved = true;
    for (const manager of managers) {
      const finalManagerStatus = await manager.status().catch((error) => {
        throw createStrictTeardownError({
          reason: input.reason,
          message: `failed to verify system service status (${manager.controller}): ${toErrorMessage(error)}`,
          hint: "run `openmeld service status` and confirm service manager state",
          stage: "uninstall-verify",
        });
      });
      if (
        finalManagerStatus.installed ||
        finalManagerStatus.running ||
        finalManagerStatus.enabled
      ) {
        allRemoved = false;
        break;
      }
    }
    if (allRemoved) {
      return;
    }
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }

  for (const manager of managers) {
    const finalManagerStatus = await manager.status().catch((error) => {
      throw createStrictTeardownError({
        reason: input.reason,
        message: `failed to verify system service status (${manager.controller}): ${toErrorMessage(error)}`,
        hint: "run `openmeld service status` and confirm service manager state",
        stage: "uninstall-verify",
      });
    });
    if (
      finalManagerStatus.installed ||
      finalManagerStatus.running ||
      finalManagerStatus.enabled
    ) {
      throw createStrictTeardownError({
        reason: input.reason,
        message: `system service still present after uninstall (controller=${manager.controller}, installed=${String(finalManagerStatus.installed)}, running=${String(finalManagerStatus.running)}, enabled=${String(finalManagerStatus.enabled)})`,
        hint: "remove service from OS manager manually and retry",
        stage: "uninstall-verify",
      });
    }
  }
}

export function resolveStrictTeardownServiceManagers(
  context: DaemonStrictTeardownContext
): DaemonServiceManager[] {
  const managers: DaemonServiceManager[] = [];
  if (context.usesSystemService && context.serviceManager) {
    managers.push(context.serviceManager);
  }
  const legacyManager = context.legacySharedService?.serviceManager;
  if (legacyManager && !managers.includes(legacyManager)) {
    managers.push(legacyManager);
  }
  return managers;
}

export async function ensureRuntimeCleanAfterStrictTeardown(input: {
  deps: DaemonTeardownStrictDependencies;
  reason: DaemonTeardownReason;
}): Promise<void> {
  const deadline = Date.now() + STRICT_TEARDOWN_VERIFY_WAIT_MS;
  while (Date.now() < deadline) {
    const [ownedProcesses, finalRuntime] = await Promise.all([
      input.deps.listDaemonOwnedProcesses({
        ignoreProcessIds: [process.pid],
      }),
      input.deps.readCurrentObservedDaemonRuntimeStatus(),
    ]);
    if (ownedProcesses.length === 0) {
      if (finalRuntime.status === "not_running") {
        return;
      }
      if (finalRuntime.status === "stale") {
        await input.deps.clearDaemonServiceRuntimeState();
        const cleanedRuntime =
          await input.deps.readCurrentObservedDaemonRuntimeStatus();
        if (cleanedRuntime.status === "not_running") {
          return;
        }
      }
    }
    await sleep(STRICT_TEARDOWN_VERIFY_POLL_MS);
  }

  const [ownedProcesses, finalRuntime] = await Promise.all([
    input.deps.listDaemonOwnedProcesses({
      ignoreProcessIds: [process.pid],
    }),
    input.deps.readCurrentObservedDaemonRuntimeStatus(),
  ]);
  if (finalRuntime.status === "running") {
    throw createStrictTeardownError({
      reason: input.reason,
      message: `service still running after teardown (pid=${String(finalRuntime.pid)})`,
      hint: "run `openmeld service stop --force` and retry",
      stage: "uninstall-verify",
    });
  }
  if (ownedProcesses.length > 0) {
    const ownedProcessSummary = ownedProcesses
      .map(
        (processInfo) => `${processInfo.ownership}:${String(processInfo.pid)}`
      )
      .join(", ");
    throw createStrictTeardownError({
      reason: input.reason,
      message: `OpenMeld-owned service processes are still present after teardown (${ownedProcessSummary})`,
      hint: "wait for OpenMeld-owned child processes to exit and retry",
      stage: "uninstall-verify",
    });
  }
  throw createStrictTeardownError({
    reason: input.reason,
    message: `runtime state is still ${finalRuntime.status} after cleanup`,
    hint: "remove stale runtime state and retry",
    stage: "uninstall-verify",
  });
}

function createStrictTeardownError(input: {
  stage?: DaemonServiceFailureStage;
  reason: DaemonTeardownReason;
  message: string;
  hint: string;
}): Error {
  const formattedHint = formatInlineOpenMeldCliCommands(input.hint);
  return new DaemonStrictTeardownError({
    reason: input.reason,
    message: `OpenMeld strict service teardown failed (${input.reason}): ${input.message}. Next step: ${formattedHint}.`,
    hint: formattedHint,
    stage: input.stage ?? "uninstall-verify",
  });
}
