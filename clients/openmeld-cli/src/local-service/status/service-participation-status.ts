import type { DaemonServiceRuntimeStatus } from "../../config/daemon-state";
import { resolveCurrentDaemonExpectedVersion } from "../lifecycle/current-daemon-version";
import {
  classifyDaemonServiceRunStartability,
  classifyDaemonServiceWakeability,
} from "../lifecycle/daemon-service-anomaly-groups";
import {
  type DaemonServiceAnomalyCode,
  inspectDaemonServiceInventory,
} from "../lifecycle/daemon-service-inventory";

export type DaemonServiceParticipationStatus =
  | {
      kind: "ready";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"];
      advisoryAnomalyCodes?: DaemonServiceAnomalyCode[];
    }
  | {
      kind: "missing";
      expectedVersion: string;
    }
  | {
      kind: "outdated";
      expectedVersion: string;
      installedVersion: string;
    }
  | {
      kind: "not_running";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
    }
  | {
      kind: "needs_repair";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
      detail: string;
      anomalyCodes: string[];
    };

export async function resolveDaemonServiceParticipationStatus(input?: {
  expectedVersion?: string;
}): Promise<DaemonServiceParticipationStatus> {
  const expectedVersion =
    input?.expectedVersion ?? (await resolveCurrentDaemonExpectedVersion());
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion,
  });

  if (!(inventory.installStatus.installed && inventory.installStatus.state)) {
    return {
      kind: "missing",
      expectedVersion,
    };
  }

  const installedVersion = inventory.installStatus.state.daemonVersion;
  const wakeability = classifyDaemonServiceWakeability({
    inventory,
  });
  const blockingServiceDriftCodes = wakeability.blockingCodes;
  const runBlockingServiceDriftCodes = classifyDaemonServiceRunStartability({
    inventory,
  }).blockingCodes;
  const repairAnomalies = inventory.anomalies.filter((anomaly) =>
    [...blockingServiceDriftCodes, ...runBlockingServiceDriftCodes].includes(
      anomaly.code
    )
  );
  if (repairAnomalies.length > 0) {
    return {
      kind: "needs_repair",
      expectedVersion,
      installedVersion,
      runtimeStatus: inventory.runtimeStatus.status,
      detail:
        repairAnomalies[0]?.message ??
        "OpenMeld found conflicting local service state on this device.",
      anomalyCodes: inventory.anomalies.map((anomaly) => anomaly.code),
    };
  }

  if (inventory.runtimeStatus.status !== "running") {
    return {
      kind: "not_running",
      expectedVersion,
      installedVersion,
      runtimeStatus: inventory.runtimeStatus.status,
    };
  }

  return {
    kind: "ready",
    expectedVersion,
    installedVersion,
    runtimeStatus: inventory.runtimeStatus.status,
    advisoryAnomalyCodes: wakeability.advisoryCodes,
  };
}
