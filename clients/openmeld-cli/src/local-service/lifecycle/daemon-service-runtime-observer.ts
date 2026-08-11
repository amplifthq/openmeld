import process from "node:process";
import type { DaemonRuntimeLease } from "@openmeld/schemas/types";
import {
  DAEMON_HEARTBEAT_STALE_MS,
  type DaemonServiceRuntimeStatus,
} from "../../config/daemon-state";
import { extractDaemonCommandEntryPath } from "./daemon-service-command-path";
import type { DaemonOwnedProcess } from "./daemon-service-process-inventory";

export function resolveObservedDaemonRuntimeStatus(input: {
  runtimeLease: DaemonRuntimeLease | null;
  ownedProcesses: readonly DaemonOwnedProcess[];
}): DaemonServiceRuntimeStatus {
  const runtimeLeaseIssue = resolveRuntimeLeaseIssue(input.runtimeLease);
  const observedProcess = selectObservedRuntimeProcess(input.ownedProcesses);

  if (!runtimeLeaseIssue && input.runtimeLease) {
    return {
      status: "running",
      mode: input.runtimeLease.mode,
      pid: input.runtimeLease.pid,
      startedAt: input.runtimeLease.startedAt,
      updatedAt: input.runtimeLease.updatedAt,
      managedBySystemService: input.runtimeLease.managedBySystemService,
      serviceController: input.runtimeLease.serviceController,
      autoStart: input.runtimeLease.managedBySystemService,
    };
  }

  if (observedProcess) {
    return {
      status: "stale",
      mode: observedProcess.mode,
      pid: observedProcess.pid,
      startedAt: input.runtimeLease?.startedAt ?? null,
      updatedAt: input.runtimeLease?.updatedAt ?? null,
      managedBySystemService: observedProcess.ownership === "stable_launcher",
      serviceController:
        observedProcess.ownership === "legacy_detached"
          ? "legacy-detached"
          : "unknown",
      autoStart: observedProcess.ownership === "stable_launcher",
      reason: runtimeLeaseIssue ?? "runtime_lease_missing",
    };
  }

  if (!input.runtimeLease) {
    return {
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    };
  }

  return {
    status: "stale",
    mode: input.runtimeLease.mode,
    pid: input.runtimeLease.pid,
    startedAt: input.runtimeLease.startedAt,
    updatedAt: input.runtimeLease.updatedAt,
    managedBySystemService: input.runtimeLease.managedBySystemService,
    serviceController: input.runtimeLease.serviceController,
    autoStart: input.runtimeLease.managedBySystemService,
    reason: runtimeLeaseIssue ?? "runtime_lease_missing",
  };
}

export function resolveObservedRuntimeCommandEntryPath(input: {
  ownedProcesses: readonly DaemonOwnedProcess[];
  runtimeStatus: DaemonServiceRuntimeStatus;
}): string | null {
  const runtimePid =
    typeof input.runtimeStatus.pid === "number"
      ? input.runtimeStatus.pid
      : null;
  if (!runtimePid) {
    return null;
  }
  const runtimeProcess = input.ownedProcesses.find(
    (processInfo) => processInfo.pid === runtimePid
  );
  if (!runtimeProcess) {
    return null;
  }
  return extractDaemonCommandEntryPath(runtimeProcess.command);
}

function resolveRuntimeLeaseIssue(
  runtimeLease: DaemonRuntimeLease | null
): string | null {
  if (!runtimeLease) {
    return "runtime_lease_missing";
  }

  if (!Number.isInteger(runtimeLease.pid) || runtimeLease.pid <= 0) {
    return "invalid_pid";
  }

  if (!isPidAlive(runtimeLease.pid)) {
    return "process_not_alive";
  }

  if (isRuntimeLeaseHeartbeatStale(runtimeLease)) {
    return "heartbeat_stale";
  }

  return null;
}

function selectObservedRuntimeProcess(
  ownedProcesses: readonly DaemonOwnedProcess[]
): DaemonOwnedProcess | null {
  const sortedProcesses = [...ownedProcesses].sort((left, right) => {
    const priorityDifference =
      resolveOwnershipPriority(left.ownership) -
      resolveOwnershipPriority(right.ownership);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }
    const modeDifference =
      resolveModePriority(left.mode) - resolveModePriority(right.mode);
    if (modeDifference !== 0) {
      return modeDifference;
    }
    return left.pid - right.pid;
  });
  return sortedProcesses[0] ?? null;
}

function resolveOwnershipPriority(
  ownership: DaemonOwnedProcess["ownership"]
): number {
  switch (ownership) {
    case "stable_launcher":
      return 0;
    case "legacy_detached":
      return 1;
    case "cli_direct":
      return 2;
    default:
      return 3;
  }
}

function resolveModePriority(mode: DaemonOwnedProcess["mode"]): number {
  switch (mode) {
    case "background":
      return 0;
    case "foreground":
      return 1;
    default:
      return 2;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRuntimeLeaseHeartbeatStale(
  runtimeLease: DaemonRuntimeLease
): boolean {
  const freshnessTimestamp = runtimeLease.heartbeatAt ?? runtimeLease.updatedAt;
  const heartbeatMs = Date.parse(freshnessTimestamp);
  if (Number.isNaN(heartbeatMs)) {
    return true;
  }
  return Date.now() - heartbeatMs > DAEMON_HEARTBEAT_STALE_MS;
}
