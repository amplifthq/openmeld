import {
  type DaemonServiceRuntimeStatus,
  type DaemonStatus,
  getDaemonStatus,
} from "../../config/daemon-state";
import { resolveCurrentDaemonExpectedVersion } from "../lifecycle/current-daemon-version";
import {
  type DaemonLifecycleEvent,
  readLatestDaemonLifecycleConnectionStateEvent,
  readLatestDaemonLifecycleOriginEvent,
} from "../lifecycle/daemon-lifecycle-journal";
import type { DaemonServiceInventory } from "../lifecycle/daemon-service-inventory";
import { inspectDaemonServiceInventory } from "../lifecycle/daemon-service-inventory";
import type { DaemonServiceManagerRuntimeStatus } from "../lifecycle/daemon-service-manager";
import {
  resolveDaemonRuntimeState,
  resolveDaemonServiceManagerForRuntimeState,
} from "../lifecycle/daemon-service-runtime";
import { readDaemonRuntimeContractRepairReport } from "../state/runtime-contract-guard";
import {
  type DaemonStatusAttention,
  resolveDaemonStatusAttention,
  resolveDaemonStatusAuthenticationAttention,
} from "./daemon-status-attention";

export type DaemonLocalStatusSnapshot = {
  attention: DaemonStatusAttention | null;
  daemonStatus: DaemonStatus;
  inventory: DaemonServiceInventory | null;
  latestConnectionStateEvent: DaemonLifecycleEvent | null;
  latestLifecycleEvent: DaemonLifecycleEvent | null;
  runtimeContractRepairReport: Awaited<
    ReturnType<typeof readDaemonRuntimeContractRepairReport>
  > | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
};

export async function resolveDaemonLocalStatusSnapshot(): Promise<DaemonLocalStatusSnapshot> {
  const daemonStatus = await getDaemonStatus();
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: resolveCurrentDaemonExpectedVersion(),
    intent: "status_cleanup",
  }).catch(() => null);
  const runtimeStatus =
    inventory?.runtimeStatus ??
    (await resolveDaemonRuntimeState(daemonStatus).catch(() => null));
  const serviceManagerStatus =
    inventory?.serviceManagerStatus ??
    (
      await resolveDaemonServiceManagerForRuntimeState({
        runtimeState: runtimeStatus,
        status: daemonStatus,
      }).catch(() => ({
        serviceManagerStatus: null,
      }))
    ).serviceManagerStatus;
  const runtimeContractRepairReport = daemonStatus.installed
    ? await readDaemonRuntimeContractRepairReport().catch(() => null)
    : null;
  const latestLifecycleEvent =
    await readLatestDaemonLifecycleOriginEvent().catch(() => null);
  const latestConnectionStateEvent =
    await readLatestDaemonLifecycleConnectionStateEvent().catch(() => null);
  const attention =
    resolveDaemonStatusAuthenticationAttention({
      latestConnectionStateEvent,
    }) ??
    resolveDaemonStatusAttention({
      inventory,
      runtimeState: runtimeStatus,
    });

  return {
    attention,
    daemonStatus,
    inventory,
    latestConnectionStateEvent,
    latestLifecycleEvent,
    runtimeContractRepairReport,
    runtimeStatus,
    serviceManagerStatus,
  };
}
