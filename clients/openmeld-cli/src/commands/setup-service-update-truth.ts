import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { compareSemver } from "../config/version-state";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { resolveDaemonServiceUpdateOperation } from "../local-service/lifecycle/daemon-service-update-state";
import { OPENMELD_VERSION } from "../runtime/version";

export type SetupServiceUpdateTruth =
  | { status: "ready" }
  | {
      message: string;
      status: "updating" | "failed" | "verifying";
    };

export function resolveSetupServiceUpdateTruth(input: {
  currentCliVersion: string;
  installedServiceVersion: string | null;
  operation: OpenMeldToolsUpdateOperation | null;
}): SetupServiceUpdateTruth {
  const operation = input.operation;
  if (!operation) {
    return { status: "ready" };
  }
  if (compareSemver(input.currentCliVersion, operation.targetVersion) > 0) {
    return { status: "ready" };
  }
  if (operation.phase === "restored" || operation.phase === "needs_help") {
    return {
      message: "OpenMeld Service update failed. Run `openmeld service update`.",
      status: "failed",
    };
  }
  if (
    operation.phase === "waiting_for_work" ||
    operation.phase === "updating"
  ) {
    return {
      message:
        "OpenMeld Service update started in the background. Run `openmeld setup` again after it finishes.",
      status: "updating",
    };
  }
  if (
    input.currentCliVersion === operation.targetVersion &&
    input.installedServiceVersion === operation.targetVersion
  ) {
    return { status: "ready" };
  }
  return {
    message:
      "OpenMeld Service update could not be verified. Run `openmeld service update`.",
    status: "verifying",
  };
}

export async function assertSetupServiceUpdateComplete(): Promise<void> {
  const operation = await resolveDaemonServiceUpdateOperation();
  if (!operation) {
    return;
  }
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: OPENMELD_VERSION,
    intent: "status_cleanup",
  });
  const truth = resolveSetupServiceUpdateTruth({
    currentCliVersion: OPENMELD_VERSION,
    installedServiceVersion:
      inventory.installStatus.state?.daemonVersion ?? null,
    operation,
  });
  if (truth.status !== "ready") {
    throw new Error(truth.message);
  }
}
