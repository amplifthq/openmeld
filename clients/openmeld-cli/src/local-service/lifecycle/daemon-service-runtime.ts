import process from "node:process";
import { sleep } from "@openmeld/utils";
import { readDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import type {
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../../config/daemon-state";
import {
  clearDaemonServiceRuntimeState,
  getDaemonStatus,
} from "../../config/daemon-state";
import {
  inspectLegacySharedDaemonService,
  type LegacySharedDaemonServiceInspection,
} from "./daemon-service-legacy-shared";
import {
  type DaemonServiceManager,
  type DaemonServiceManagerRuntimeStatus,
  resolveDaemonServiceManager,
} from "./daemon-service-manager";
import { listDaemonOwnedProcesses } from "./daemon-service-process-inventory";
import { resolveObservedDaemonRuntimeStatus } from "./daemon-service-runtime-observer";

const DEFAULT_SYSTEM_SERVICE_STOP_WAIT_MS = 3000;
const DEFAULT_SYSTEM_SERVICE_STOP_POLL_MS = 200;

export type CurrentDaemonRuntimeContext = {
  status: DaemonStatus;
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  legacySharedService: LegacySharedDaemonServiceInspection | null;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
};

export type DaemonRuntimeCleanupDecision = {
  context: CurrentDaemonRuntimeContext;
  cleared: boolean;
};

export async function readCurrentObservedDaemonRuntimeStatus(): Promise<DaemonServiceRuntimeStatus> {
  return await readObservedRuntimeState();
}

export async function clearDaemonRuntimeStateIfDefinitelyStopped(): Promise<DaemonRuntimeCleanupDecision> {
  const context = await readCurrentDaemonRuntimeContext();
  const isDefinitelyStopped =
    context.effectiveRuntimeStatus === "not_running" ||
    (await isStoppedSystemServiceSnapshot(context));
  if (!isDefinitelyStopped) {
    return {
      context,
      cleared: false,
    };
  }
  await clearDaemonServiceRuntimeState();
  return {
    context,
    cleared: true,
  };
}

async function isStoppedSystemServiceSnapshot(
  context: CurrentDaemonRuntimeContext
): Promise<boolean> {
  if (
    context.runtimeStatus.status !== "stale" ||
    !context.runtimeStatus.managedBySystemService ||
    context.serviceManagerStatus?.running !== false
  ) {
    return false;
  }

  const ownedProcesses = await listDaemonOwnedProcesses({
    ignoreProcessIds: [process.pid, process.ppid],
  });
  return ownedProcesses.length === 0;
}

export async function readCurrentDaemonRuntimeContext(
  input: { status?: DaemonStatus | null } = {}
): Promise<CurrentDaemonRuntimeContext> {
  const status = input.status ?? (await getDaemonStatus());
  const runtimeStatus = await readCurrentObservedDaemonRuntimeStatus();
  const { serviceManager, serviceManagerStatus, legacySharedService } =
    await resolveDaemonServiceManagerForRuntimeState({
      status,
      runtimeState: runtimeStatus,
    });
  const effectiveRuntimeStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState: runtimeStatus,
    serviceManagerStatus,
  });

  return {
    status,
    runtimeStatus,
    serviceManager,
    serviceManagerStatus,
    legacySharedService,
    effectiveRuntimeStatus,
  };
}

export async function resolveDaemonRuntimeState(
  status: DaemonStatus
): Promise<DaemonServiceRuntimeStatus | null> {
  if (!status.installed) {
    return null;
  }
  return await readCurrentObservedDaemonRuntimeStatus();
}

export async function resolveDaemonServiceManagerFromRuntimeState(
  runtimeState: DaemonServiceRuntimeStatus | null
): Promise<DaemonServiceManager | null> {
  if (!runtimeState?.managedBySystemService) {
    return null;
  }

  if (runtimeState.serviceController === "legacy-detached") {
    return null;
  }

  return await resolveDaemonServiceManager(runtimeState.serviceController);
}

export async function resolveDaemonServiceManagerForRuntimeState(input: {
  status: DaemonStatus;
  runtimeState: DaemonServiceRuntimeStatus | null;
}): Promise<{
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  legacySharedService: LegacySharedDaemonServiceInspection | null;
}> {
  const initialManager = await resolveDaemonServiceManagerFromRuntimeState(
    input.runtimeState
  );
  const initialManagerStatus = initialManager
    ? await initialManager
        .status()
        .catch<DaemonServiceManagerRuntimeStatus | null>(() => null)
    : null;

  if (
    input.status.installed &&
    input.runtimeState?.managedBySystemService !== true &&
    !initialManagerStatus?.installed
  ) {
    const detectedManager = await resolveDaemonServiceManager().catch<null>(
      () => null
    );
    if (detectedManager) {
      const detectedManagerStatus = await detectedManager
        .status()
        .catch<DaemonServiceManagerRuntimeStatus | null>(() => null);
      if (detectedManagerStatus?.installed) {
        return {
          serviceManager: detectedManager,
          serviceManagerStatus: detectedManagerStatus,
          legacySharedService: null,
        };
      }
    }
  }

  const legacySharedService = await inspectLegacySharedDaemonService().catch(
    () => null
  );
  if (
    legacySharedService?.present &&
    legacySharedService.serviceManagerStatus?.installed
  ) {
    const legacyManager =
      legacySharedService.serviceManager ??
      (await resolveDaemonServiceManager(
        legacySharedService.runtimeStatus.serviceController === "unknown"
          ? undefined
          : legacySharedService.runtimeStatus.serviceController,
        legacySharedService.pathInput
      ).catch(() => null));
    if (legacyManager) {
      return {
        serviceManager: legacyManager,
        serviceManagerStatus: legacySharedService.serviceManagerStatus,
        legacySharedService,
      };
    }
  }

  return {
    serviceManager: initialManager,
    serviceManagerStatus: initialManagerStatus,
    legacySharedService,
  };
}

export function getEffectiveDaemonRuntimeStatus(input: {
  runtimeState: DaemonServiceRuntimeStatus;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): DaemonServiceRuntimeStatus["status"] {
  if (input.runtimeState.status === "running") {
    return "running";
  }

  if (
    !(input.runtimeState.managedBySystemService && input.serviceManagerStatus)
  ) {
    return input.runtimeState.status;
  }

  if (input.runtimeState.status === "stale") {
    if (input.runtimeState.reason === "heartbeat_stale") {
      return "stale";
    }
    if (input.serviceManagerStatus.running) {
      return "running";
    }
    if (!input.serviceManagerStatus.enabled) {
      return "not_running";
    }
  }

  if (!input.serviceManagerStatus.running) {
    return "not_running";
  }

  return input.runtimeState.status;
}

export async function waitForDaemonSystemServiceToStop(input: {
  manager: DaemonServiceManager;
  waitMs?: number;
  pollMs?: number;
}): Promise<boolean> {
  const waitMs = input.waitMs ?? DEFAULT_SYSTEM_SERVICE_STOP_WAIT_MS;
  const pollMs = input.pollMs ?? DEFAULT_SYSTEM_SERVICE_STOP_POLL_MS;
  const deadlineMs = Date.now() + waitMs;

  while (Date.now() < deadlineMs) {
    const currentRuntime = await readCurrentObservedDaemonRuntimeStatus().catch(
      () => null
    );
    const managerStatus = await input.manager.status().catch(() => null);

    if (
      managerStatus?.running === false &&
      currentRuntime !== null &&
      currentRuntime.status !== "running"
    ) {
      return true;
    }

    if (
      currentRuntime?.status === "stale" &&
      !currentRuntime.managedBySystemService
    ) {
      return true;
    }

    if (currentRuntime?.status === "not_running") {
      return true;
    }

    await sleep(pollMs);
  }

  const finalRuntime = await readCurrentObservedDaemonRuntimeStatus().catch(
    () => null
  );
  if (finalRuntime?.status === "not_running") {
    return true;
  }

  if (
    finalRuntime?.status === "stale" &&
    !finalRuntime.managedBySystemService
  ) {
    return true;
  }

  if (finalRuntime?.status === "running") {
    return false;
  }

  if (finalRuntime === null) {
    return false;
  }

  const finalManagerStatus = await input.manager.status().catch(() => null);
  return finalManagerStatus?.running === false;
}

async function readObservedRuntimeState(): Promise<DaemonServiceRuntimeStatus> {
  const ignoredProcessIds = [process.pid, process.ppid].filter(
    (pid): pid is number => Number.isInteger(pid) && pid > 0
  );
  const [runtimeLease, ownedProcesses] = await Promise.all([
    readDaemonRuntimeLease().catch(() => null),
    listDaemonOwnedProcesses({
      ignoreProcessIds: ignoredProcessIds,
    }),
  ]);
  return resolveObservedDaemonRuntimeStatus({
    runtimeLease,
    ownedProcesses,
  });
}
