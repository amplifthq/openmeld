import { resolveOpenMeldToolsUpdateTargetVersions } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { compareSemver } from "../config/version-state";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { waitForOpenMeldToolsUpdateCompletion } from "../local-service/maintenance/openmeld-tools-update-join";
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
  currentServiceVerified?: boolean;
}): SetupServiceUpdateTruth {
  const operation = input.operation;
  if (!operation) {
    return { status: "ready" };
  }
  const target = resolveOpenMeldToolsUpdateTargetVersions(operation);
  const currentInstallationSatisfiesTarget =
    input.currentServiceVerified === true &&
    input.installedServiceVersion !== null &&
    compareSemver(input.currentCliVersion, target.cliVersion) >= 0 &&
    compareSemver(input.installedServiceVersion, target.serviceVersion) >= 0;
  if (operation.phase === "restored" || operation.phase === "needs_help") {
    if (currentInstallationSatisfiesTarget) {
      return { status: "ready" };
    }
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
        "OpenMeld Service is updating in the background. Setup will continue automatically when it finishes.",
      status: "updating",
    };
  }
  if (currentInstallationSatisfiesTarget) {
    return { status: "ready" };
  }
  return {
    message:
      "OpenMeld Service update could not be verified. Run `openmeld service update`.",
    status: "verifying",
  };
}

export async function assertSetupServiceUpdateComplete(
  input: Parameters<typeof waitForOpenMeldToolsUpdateCompletion>[0] = {}
): Promise<void> {
  const operation = await waitForOpenMeldToolsUpdateCompletion(input);
  if (!operation) {
    return;
  }
  const target = resolveOpenMeldToolsUpdateTargetVersions(operation);
  const expectedServiceVersion = await resolveCurrentDaemonExpectedVersion(
    target.serviceVersion
  );
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: expectedServiceVersion,
    intent: "status_cleanup",
  });
  const truth = resolveSetupServiceUpdateTruth({
    currentCliVersion: OPENMELD_VERSION,
    installedServiceVersion:
      inventory.serviceContract?.daemonVersion ??
      inventory.installStatus.state?.daemonVersion ??
      null,
    operation,
    currentServiceVerified:
      inventory.anomalies.length === 0 &&
      inventory.runtimeStatus.status === "running",
  });
  if (truth.status !== "ready") {
    throw new Error(truth.message);
  }
}
