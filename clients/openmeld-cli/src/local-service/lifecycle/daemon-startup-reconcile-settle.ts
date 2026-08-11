import { sleep } from "@openmeld/utils";
import {
  type DaemonInstallState,
  type DaemonStatus,
  getDaemonStatus,
} from "../../config/daemon-state";
import { resolveVersionChangeDirection } from "./version-change-direction";

export type DaemonStartupReconcileSettlement =
  | {
      status: "aligned";
      state: DaemonInstallState;
    }
  | {
      status: "downgrade_blocked";
      state: DaemonInstallState;
    }
  | {
      status: "still_missing";
      state: null;
    }
  | {
      status: "still_outdated";
      state: DaemonInstallState;
    };

export async function waitForDaemonStartupReconcileSettlement(input: {
  expectedVersion: string;
  timeoutMs: number;
  pollMs: number;
  readDaemonStatus?: typeof getDaemonStatus;
}): Promise<DaemonStartupReconcileSettlement> {
  const readDaemonStatus = input.readDaemonStatus ?? getDaemonStatus;
  const deadline = Date.now() + input.timeoutMs;
  let lastSettlement: DaemonStartupReconcileSettlement = {
    status: "still_missing",
    state: null,
  };

  while (true) {
    const daemonStatus = await readDaemonStatus().catch(() => null);
    lastSettlement = resolveDaemonStartupReconcileSettlement({
      expectedVersion: input.expectedVersion,
      daemonStatus,
    });

    if (
      lastSettlement.status === "aligned" ||
      lastSettlement.status === "downgrade_blocked"
    ) {
      return lastSettlement;
    }

    if (Date.now() >= deadline) {
      return lastSettlement;
    }

    await sleep(input.pollMs);
  }
}

function resolveDaemonStartupReconcileSettlement(input: {
  expectedVersion: string;
  daemonStatus: DaemonStatus | null;
}): DaemonStartupReconcileSettlement {
  if (!input.daemonStatus?.installed) {
    return {
      status: "still_missing",
      state: null,
    };
  }

  const state = input.daemonStatus.state;
  const versionDirection = resolveVersionChangeDirection({
    fromVersion: state.daemonVersion,
    toVersion: input.expectedVersion,
  });

  if (versionDirection === "same") {
    return {
      status: "aligned",
      state,
    };
  }

  if (versionDirection === "downgrade") {
    return {
      status: "downgrade_blocked",
      state,
    };
  }

  return {
    status: "still_outdated",
    state,
  };
}
