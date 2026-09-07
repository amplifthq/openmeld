import process from "node:process";
import type { DaemonServiceRuntimeStatus } from "../../config/daemon-state";
import {
  type DaemonOwnedProcess,
  listDaemonOwnedProcesses,
} from "./daemon-service-process-inventory";
import type {
  CurrentDaemonRuntimeContext,
  readCurrentDaemonRuntimeContext,
} from "./daemon-service-runtime";
import { readCurrentDaemonRuntimeContext as readCurrentDaemonRuntimeContextImpl } from "./daemon-service-runtime";

export type DaemonLifecycleOwnerKind =
  | "cli_direct"
  | "legacy_detached"
  | "system_service";

export type DaemonOwnerSetSummary =
  | "multiple_owners"
  | "no_owner"
  | "single_owner";

export type DaemonStoppedContractWriteBlockedReason =
  | "owned_processes_still_active"
  | "service_manager_still_enabled"
  | "service_manager_still_running"
  | "daemon_owners_still_active";

export type DaemonOwnerSnapshot = {
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: CurrentDaemonRuntimeContext["serviceManager"];
  serviceManagerStatus: CurrentDaemonRuntimeContext["serviceManagerStatus"];
  ownedProcesses: DaemonOwnedProcess[];
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  systemServiceRegistrationPresent: boolean;
  activeOwnerKinds: DaemonLifecycleOwnerKind[];
  ownerSetSummary: DaemonOwnerSetSummary;
  mustStopManagerFirst: boolean;
};

export type DaemonStopStrategy =
  | {
      kind: "manager_first";
      requiresResidualProcessCleanup: true;
      reason: string;
    }
  | {
      kind: "not_running";
      requiresResidualProcessCleanup: false;
      reason: string;
    }
  | {
      kind: "process_then_manager_cleanup";
      requiresResidualProcessCleanup: true;
      reason: string;
    }
  | {
      kind: "process_only";
      requiresResidualProcessCleanup: true;
      reason: string;
    };

export async function readCurrentDaemonOwnerSnapshot(
  input: {
    ignoreProcessIds?: Iterable<number>;
    listOwnedProcesses?: typeof listDaemonOwnedProcesses;
    readRuntimeContext?: typeof readCurrentDaemonRuntimeContext;
  } = {}
): Promise<DaemonOwnerSnapshot> {
  const listOwnedProcesses =
    input.listOwnedProcesses ?? listDaemonOwnedProcesses;
  const readRuntimeContext =
    input.readRuntimeContext ?? readCurrentDaemonRuntimeContextImpl;
  const ignoredProcessIds = [
    process.pid,
    process.ppid,
    ...Array.from(input.ignoreProcessIds ?? []),
  ].filter((pid): pid is number => Number.isInteger(pid) && pid > 0);

  const [context, ownedProcesses] = await Promise.all([
    readRuntimeContext(),
    listOwnedProcesses({
      ignoreProcessIds: ignoredProcessIds,
    }),
  ]);

  return buildDaemonOwnerSnapshot({
    context,
    ownedProcesses,
  });
}

export function buildDaemonOwnerSnapshot(input: {
  context: CurrentDaemonRuntimeContext;
  ownedProcesses: DaemonOwnedProcess[];
}): DaemonOwnerSnapshot {
  return buildDaemonOwnerSnapshotFromObservedState({
    runtimeStatus: input.context.runtimeStatus,
    serviceManager: input.context.serviceManager,
    serviceManagerStatus: input.context.serviceManagerStatus,
    effectiveRuntimeStatus: input.context.effectiveRuntimeStatus,
    ownedProcesses: input.ownedProcesses,
  });
}

export function buildDaemonOwnerSnapshotFromObservedState(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  serviceManager: CurrentDaemonRuntimeContext["serviceManager"];
  serviceManagerStatus: CurrentDaemonRuntimeContext["serviceManagerStatus"];
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  ownedProcesses: DaemonOwnedProcess[];
}): DaemonOwnerSnapshot {
  const activeOwnerKinds = resolveActiveOwnerKinds({
    runtimeStatus: input.runtimeStatus,
    effectiveRuntimeStatus: input.effectiveRuntimeStatus,
    serviceManagerStatus: input.serviceManagerStatus,
    ownedProcesses: input.ownedProcesses,
  });

  return {
    runtimeStatus: input.runtimeStatus,
    serviceManager: input.serviceManager,
    serviceManagerStatus: input.serviceManagerStatus,
    ownedProcesses: input.ownedProcesses,
    effectiveRuntimeStatus: input.effectiveRuntimeStatus,
    systemServiceRegistrationPresent:
      input.runtimeStatus.managedBySystemService ||
      input.serviceManagerStatus?.installed === true ||
      input.serviceManagerStatus?.running === true,
    activeOwnerKinds,
    ownerSetSummary: resolveOwnerSetSummary(activeOwnerKinds),
    mustStopManagerFirst:
      input.runtimeStatus.managedBySystemService ||
      input.serviceManagerStatus?.installed === true ||
      input.serviceManagerStatus?.running === true,
  };
}

export function resolveDaemonStopStrategy(
  snapshot: DaemonOwnerSnapshot
): DaemonStopStrategy {
  const hasOwnedProcesses = snapshot.ownedProcesses.length > 0;
  if (
    snapshot.effectiveRuntimeStatus !== "running" &&
    !hasOwnedProcesses &&
    snapshot.serviceManagerStatus?.running !== true
  ) {
    return {
      kind: "not_running",
      requiresResidualProcessCleanup: false,
      reason: "no active local service owner is currently running",
    };
  }

  if (snapshot.activeOwnerKinds.includes("system_service")) {
    return {
      kind: "manager_first",
      requiresResidualProcessCleanup: true,
      reason:
        "a system-managed local service owner is active on this device, so stop must go through the OS service manager first",
    };
  }

  if (snapshot.systemServiceRegistrationPresent) {
    return {
      kind: "process_then_manager_cleanup",
      requiresResidualProcessCleanup: true,
      reason:
        "a direct local service owner is active and system service registration is still present, so stop must drain the process and then clear the service manager registration",
    };
  }

  return {
    kind: "process_only",
    requiresResidualProcessCleanup: true,
    reason: "only direct local service processes are active on this device",
  };
}

export function hasActiveDaemonOwners(snapshot: DaemonOwnerSnapshot): boolean {
  return (
    snapshot.activeOwnerKinds.length > 0 ||
    snapshot.ownedProcesses.length > 0 ||
    snapshot.serviceManagerStatus?.running === true
  );
}

export function resolveStoppedContractWriteBlockedReason(
  snapshot: DaemonOwnerSnapshot
): DaemonStoppedContractWriteBlockedReason | null {
  if (snapshot.ownedProcesses.length > 0) {
    return "owned_processes_still_active";
  }
  if (snapshot.serviceManagerStatus?.running === true) {
    return "service_manager_still_running";
  }
  if (snapshot.serviceManagerStatus?.enabled === true) {
    return "service_manager_still_enabled";
  }
  if (hasActiveDaemonOwners(snapshot)) {
    return "daemon_owners_still_active";
  }
  return null;
}

export function summarizeDaemonOwnerSnapshot(
  snapshot: DaemonOwnerSnapshot
): Record<string, unknown> {
  return {
    activeOwnerKinds: snapshot.activeOwnerKinds,
    effectiveRuntimeStatus: snapshot.effectiveRuntimeStatus,
    mustStopManagerFirst: snapshot.mustStopManagerFirst,
    ownedProcessCount: snapshot.ownedProcesses.length,
    ownedProcesses: snapshot.ownedProcesses.map((processInfo) => ({
      mode: processInfo.mode,
      ownership: processInfo.ownership,
      pid: processInfo.pid,
    })),
    ownerSetSummary: snapshot.ownerSetSummary,
    runtimeStatus: snapshot.runtimeStatus.status,
    serviceManagerController: snapshot.serviceManager?.controller ?? null,
    serviceManagerStatus: snapshot.serviceManagerStatus
      ? {
          enabled: snapshot.serviceManagerStatus.enabled,
          installed: snapshot.serviceManagerStatus.installed,
          running: snapshot.serviceManagerStatus.running,
        }
      : null,
    systemServiceRegistrationPresent: snapshot.systemServiceRegistrationPresent,
  };
}

export function formatDaemonOwnerSummaryLabel(
  snapshot: DaemonOwnerSnapshot
): string {
  if (snapshot.ownerSetSummary === "no_owner") {
    return "No active owner";
  }

  const ownerLabel = formatDaemonOwnerKinds(snapshot.activeOwnerKinds);
  if (snapshot.ownerSetSummary === "single_owner") {
    return ownerLabel;
  }

  return `⚠️ Multiple owners — ${ownerLabel}`;
}

export function formatDaemonOwnerKinds(
  ownerKinds: readonly DaemonLifecycleOwnerKind[]
): string {
  return ownerKinds.map(formatDaemonOwnerKindLabel).join(" + ");
}

function resolveActiveOwnerKinds(input: {
  runtimeStatus: DaemonServiceRuntimeStatus;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  serviceManagerStatus: CurrentDaemonRuntimeContext["serviceManagerStatus"];
  ownedProcesses: DaemonOwnedProcess[];
}): DaemonLifecycleOwnerKind[] {
  const owners = new Set<DaemonLifecycleOwnerKind>();
  const verifiedDirectRuntimePid =
    input.runtimeStatus.status === "running" &&
    !input.runtimeStatus.managedBySystemService &&
    input.runtimeStatus.serviceController === "unknown"
      ? input.runtimeStatus.pid
      : null;

  if (
    input.serviceManagerStatus?.running === true ||
    input.ownedProcesses.some(
      (processInfo) =>
        processInfo.ownership === "stable_launcher" &&
        processInfo.pid !== verifiedDirectRuntimePid
    ) ||
    (input.runtimeStatus.managedBySystemService &&
      input.effectiveRuntimeStatus === "running")
  ) {
    owners.add("system_service");
  }

  if (
    input.ownedProcesses.some(
      (processInfo) => processInfo.ownership === "legacy_detached"
    ) ||
    (input.runtimeStatus.serviceController === "legacy-detached" &&
      input.effectiveRuntimeStatus === "running")
  ) {
    owners.add("legacy_detached");
  }

  if (
    input.ownedProcesses.some(
      (processInfo) =>
        processInfo.ownership === "cli_direct" ||
        processInfo.ownership === "unknown"
    ) ||
    (!input.runtimeStatus.managedBySystemService &&
      input.runtimeStatus.serviceController !== "legacy-detached" &&
      input.effectiveRuntimeStatus === "running")
  ) {
    owners.add("cli_direct");
  }

  return Array.from(owners).sort();
}

function resolveOwnerSetSummary(
  activeOwnerKinds: DaemonLifecycleOwnerKind[]
): DaemonOwnerSetSummary {
  if (activeOwnerKinds.length === 0) {
    return "no_owner";
  }
  if (activeOwnerKinds.length === 1) {
    return "single_owner";
  }
  return "multiple_owners";
}

function formatDaemonOwnerKindLabel(
  ownerKind: DaemonLifecycleOwnerKind
): string {
  switch (ownerKind) {
    case "cli_direct":
      return "Direct CLI";
    case "legacy_detached":
      return "Legacy detached runtime";
    case "system_service":
      return "System service";
    default:
      return ownerKind;
  }
}
