import { writeDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { setDaemonServiceRuntimeState } from "../../config/daemon-state";
import {
  readDaemonActiveBundleState,
  resolveDaemonBundleEntryPathFromState,
} from "../../local-service/lifecycle/daemon-service-bundle";
import {
  extractDaemonCommandEntryPath,
  resolveDaemonBundleIdFromEntryPath,
} from "../../local-service/lifecycle/daemon-service-command-path";
import { nowIsoString } from "../core/logger";
import {
  type createDaemonRuntimeState,
  shouldPersistDaemonRuntimeState,
} from "./daemon-runtime-state";

export type DaemonRuntimeState = ReturnType<typeof createDaemonRuntimeState>;

export type DaemonRuntimeLeaseDescriptor = {
  bundleId: string;
  generation: number;
};

export type DaemonRuntimeStateTouch = (
  updates: Partial<{
    heartbeatAt: string | null;
    updatedAt: string;
    stopRequestedAt: string | null;
  }>,
  options?: {
    forcePersist?: boolean;
  }
) => Promise<void>;

export function createDaemonRuntimeStateTracker(input: {
  initialState: DaemonRuntimeState;
  leaseDescriptor: DaemonRuntimeLeaseDescriptor | null;
}): {
  getRuntimeState: () => DaemonRuntimeState;
  touchRuntimeState: DaemonRuntimeStateTouch;
} {
  // OPENMELD_SERVICE_THIN_CORE: local runtime state projection.
  // This writes the local service status/lease projection. It is diagnostic
  // evidence for this computer, not product readiness or Wake outcome truth.
  let runtimeState = input.initialState;
  let lastRuntimeStatePersistAtMs = Date.now();

  const touchRuntimeState: DaemonRuntimeStateTouch = async (
    updates,
    options
  ) => {
    const nowAt = nowIsoString();
    const previousHeartbeatAt = runtimeState.heartbeatAt;
    runtimeState = {
      ...runtimeState,
      ...updates,
      updatedAt: updates.updatedAt ?? nowAt,
    };
    const receivedFirstHeartbeat =
      previousHeartbeatAt === null &&
      typeof updates.heartbeatAt === "string" &&
      updates.heartbeatAt.length > 0;
    const shouldPersist = shouldPersistDaemonRuntimeState({
      forcePersist: options?.forcePersist === true || receivedFirstHeartbeat,
      nowMs: Date.now(),
      lastPersistedAtMs: lastRuntimeStatePersistAtMs,
      updates,
    });
    if (!shouldPersist) {
      return;
    }
    await setDaemonServiceRuntimeState(runtimeState);
    if (input.leaseDescriptor) {
      await writeDaemonRuntimeLease(
        buildDaemonRuntimeLease({
          descriptor: input.leaseDescriptor,
          runtimeState,
        })
      );
    }
    lastRuntimeStatePersistAtMs = Date.now();
  };

  return {
    getRuntimeState: () => runtimeState,
    touchRuntimeState,
  };
}

export async function resolveDaemonRuntimeLeaseDescriptor(input: {
  command: string;
}): Promise<DaemonRuntimeLeaseDescriptor | null> {
  const [contract, activeBundle] = await Promise.all([
    readDaemonServiceContract().catch(() => null),
    readDaemonActiveBundleState().catch(() => null),
  ]);
  if (contract) {
    return {
      generation: contract.generation,
      bundleId: contract.bundleId,
    };
  }
  const activeBundleEntryPath = await resolveDaemonBundleEntryPathFromState(
    activeBundle
  ).catch(() => null);
  const commandEntryPath = extractDaemonCommandEntryPath(input.command);
  const bundleId =
    (commandEntryPath
      ? resolveDaemonBundleIdFromEntryPath(commandEntryPath)
      : null) ??
    (activeBundleEntryPath
      ? resolveDaemonBundleIdFromEntryPath(activeBundleEntryPath)
      : null) ??
    activeBundle?.bundleId ??
    null;
  if (!bundleId) {
    return null;
  }
  return {
    generation: 0,
    bundleId,
  };
}

export function buildDaemonRuntimeLease(input: {
  descriptor: DaemonRuntimeLeaseDescriptor;
  runtimeState: DaemonRuntimeState;
}) {
  return {
    schema: "openmeld-daemon-runtime-lease-v1",
    v: 1,
    generation: input.descriptor.generation,
    bundleId: input.descriptor.bundleId,
    pid: input.runtimeState.pid,
    mode: input.runtimeState.mode,
    startedAt: input.runtimeState.startedAt,
    updatedAt: input.runtimeState.updatedAt,
    heartbeatAt: input.runtimeState.heartbeatAt,
    serviceController: input.runtimeState.serviceController,
    managedBySystemService: input.runtimeState.managedBySystemService,
  } as const;
}
