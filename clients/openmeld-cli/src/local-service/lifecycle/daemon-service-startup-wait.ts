import { sleep } from "@openmeld/utils";
import type { DaemonServiceRuntimeStatus } from "../../config/daemon-state";
import {
  type DaemonServiceInventory,
  inspectDaemonServiceInventory,
} from "./daemon-service-inventory";
import {
  type DaemonServiceJobDiagnostics,
  type DaemonServiceManager,
  type DaemonServiceManagerRuntimeStatus,
  formatDaemonServiceJobDiagnosticsEvidence,
} from "./daemon-service-manager";
import { readCurrentObservedDaemonRuntimeStatus } from "./daemon-service-runtime";

const DEFAULT_SERVICE_STARTUP_WAIT_MS = 5000;
const LAUNCHD_SERVICE_STARTUP_WAIT_MS = 90_000;

export class SystemServiceStartupTimeoutError extends Error {
  readonly code = "openmeld.service.startup_timeout";
  readonly inventory: DaemonServiceInventory | null;
  readonly managerStatus: DaemonServiceManagerRuntimeStatus | null;
  readonly runtimeStatus: DaemonServiceRuntimeStatus | null;
  readonly jobDiagnostics: DaemonServiceJobDiagnostics | null;

  constructor(input: {
    inventory: DaemonServiceInventory | null;
    managerStatus: DaemonServiceManagerRuntimeStatus | null;
    runtimeStatus: DaemonServiceRuntimeStatus | null;
    jobDiagnostics?: DaemonServiceJobDiagnostics | null;
  }) {
    super(buildSystemServiceStartupTimeoutMessage(input));
    this.name = "SystemServiceStartupTimeoutError";
    this.inventory = input.inventory;
    this.managerStatus = input.managerStatus;
    this.runtimeStatus = input.runtimeStatus;
    this.jobDiagnostics = input.jobDiagnostics ?? null;
  }
}

export function resolveSystemServiceStartupWaitMs(
  controller: DaemonServiceManager["controller"]
): number {
  // launchd may defer a newly loaded background item before it spawns the
  // managed process. Keep one controller-owned budget for both an explicit
  // start and replacement verification.
  return controller === "launchd"
    ? LAUNCHD_SERVICE_STARTUP_WAIT_MS
    : DEFAULT_SERVICE_STARTUP_WAIT_MS;
}

export function isDaemonInventoryRunningAndStartReady(
  inventory: DaemonServiceInventory,
  blockingAnomalies: ReadonlySet<
    DaemonServiceInventory["anomalies"][number]["code"]
  >
): boolean {
  return (
    inventory.runtimeStatus.status === "running" &&
    inventory.runtimeStatus.mode === "background" &&
    inventory.runtimeStatus.managedBySystemService === true &&
    inventory.serviceManagerStatus?.running === true &&
    !inventory.anomalies.some((anomaly) => blockingAnomalies.has(anomaly.code))
  );
}

export async function waitForSystemServiceStartup(input: {
  expectedVersion: string;
  manager: DaemonServiceManager;
  waitMs?: number;
  pollMs: number;
  isReady: (inventory: DaemonServiceInventory) => boolean;
  intent?: Parameters<typeof inspectDaemonServiceInventory>[0]["intent"];
}): Promise<{
  inventory: DaemonServiceInventory;
  state: "running";
  runtimeStatus: DaemonServiceRuntimeStatus;
}> {
  const waitMs =
    input.waitMs ?? resolveSystemServiceStartupWaitMs(input.manager.controller);
  const deadlineMs = Date.now() + waitMs;
  let lastInventory: DaemonServiceInventory | null = null;
  while (Date.now() < deadlineMs) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: "background",
      intent: input.intent ?? "run_background",
    }).catch(() => null);
    if (inventory) {
      lastInventory = inventory;
      if (input.isReady(inventory)) {
        return {
          inventory,
          state: "running",
          runtimeStatus: inventory.runtimeStatus,
        };
      }
    }
    await sleep(input.pollMs);
  }

  const finalInventory = await inspectDaemonServiceInventory({
    expectedVersion: input.expectedVersion,
    intendedMode: "background",
    intent: input.intent ?? "run_background",
  }).catch(() => null);
  if (finalInventory) {
    lastInventory = finalInventory;
    if (input.isReady(finalInventory)) {
      return {
        inventory: finalInventory,
        state: "running",
        runtimeStatus: finalInventory.runtimeStatus,
      };
    }
  }

  const finalRuntimeStatus =
    await readCurrentObservedDaemonRuntimeStatus().catch(() => null);
  const finalManagerStatus = await input.manager.status().catch(() => null);
  // Raw controller job details explain a failed wait only. Readiness above is
  // decided by the complete local inventory and never by these diagnostics.
  const finalJobDiagnostics =
    (await input.manager.readJobDiagnostics?.().catch(() => null)) ?? null;
  throw new SystemServiceStartupTimeoutError({
    inventory: lastInventory,
    managerStatus: finalManagerStatus,
    runtimeStatus: finalRuntimeStatus,
    jobDiagnostics: finalJobDiagnostics,
  });
}

export function buildSystemServiceStartupTimeoutMessage(input: {
  inventory: DaemonServiceInventory | null;
  managerStatus: DaemonServiceManagerRuntimeStatus | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  jobDiagnostics?: DaemonServiceJobDiagnostics | null;
}): string {
  const base = `OpenMeld Service failed to reach a running local service state in time. runtime=${input.runtimeStatus?.status ?? "unknown"}, reason=${input.runtimeStatus?.reason || "unknown"}, managerRunning=${String(input.managerStatus?.running ?? false)}, anomalies=${input.inventory?.anomalies.map((anomaly) => anomaly.code).join(",") || "unknown"}`;
  if (!input.jobDiagnostics) {
    return base;
  }
  return `${base}; ${formatDaemonServiceJobDiagnosticsEvidence(input.jobDiagnostics)}`;
}

export function isSystemServiceStartupTimeoutError(
  error: unknown
): error is SystemServiceStartupTimeoutError {
  return (
    error instanceof SystemServiceStartupTimeoutError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "openmeld.service.startup_timeout")
  );
}
