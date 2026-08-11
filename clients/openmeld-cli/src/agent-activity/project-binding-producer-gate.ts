import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";

export class ProjectBindingProducerUpdateRequiredError extends Error {
  readonly code = "project_bindings.update_required" as const;

  constructor(input: { expectedVersion: string; observedVersion: string }) {
    super(
      `OpenMeld Service must be updated before local Project connections can change (observed ${input.observedVersion}, expected v${input.expectedVersion}). Run \`openmeld upgrade\`, then retry.`
    );
    this.name = "ProjectBindingProducerUpdateRequiredError";
  }
}

export async function assertProjectBindingProducerCompatible(
  dependencies: {
    readCompatibility?: () => Promise<{
      blockingAnomalyCodes: string[];
      expectedVersion: string;
      observedVersions: string[];
      servicePresent: boolean;
    }>;
  } = {}
): Promise<void> {
  const compatibility = await (
    dependencies.readCompatibility ?? readServiceCompatibility
  )();
  if (
    !compatibility.servicePresent ||
    (compatibility.observedVersions.length > 0 &&
      compatibility.observedVersions.every(
        (version) => version === compatibility.expectedVersion
      ) &&
      compatibility.blockingAnomalyCodes.length === 0)
  ) {
    return;
  }
  throw new ProjectBindingProducerUpdateRequiredError({
    expectedVersion: compatibility.expectedVersion,
    observedVersion:
      compatibility.observedVersions.length > 0
        ? compatibility.observedVersions
            .map((version) => `v${version}`)
            .join(", ")
        : "an unverified Service version",
  });
}

export function isProjectBindingUpdateRequiredError(
  error: unknown
): error is { code: "project_bindings.update_required" } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "project_bindings.update_required"
  );
}

const PRODUCER_BLOCKING_ANOMALIES = new Set([
  "bundle_content_drift",
  "bundle_id_drift",
  "bundle_version_drift",
  "downgrade_blocked",
  "multiple_active_owners",
  "runtime_bundle_mismatch",
  "runtime_contract_mismatch",
  "runtime_contract_missing",
  "version_outdated",
]);

async function readServiceCompatibility(): Promise<{
  blockingAnomalyCodes: string[];
  expectedVersion: string;
  observedVersions: string[];
  servicePresent: boolean;
}> {
  const expectedVersion = resolveCurrentDaemonExpectedVersion();
  const inventory = await inspectDaemonServiceInventory({ expectedVersion });
  const observedVersions = new Set<string>();
  if (inventory.installStatus.installed && inventory.installStatus.state) {
    observedVersions.add(inventory.installStatus.state.daemonVersion);
  }
  if (inventory.activeBundle?.daemonVersion) {
    observedVersions.add(inventory.activeBundle.daemonVersion);
  }
  if (inventory.serviceContract?.daemonVersion) {
    observedVersions.add(inventory.serviceContract.daemonVersion);
  }
  return {
    blockingAnomalyCodes: inventory.anomalies
      .map((anomaly) => anomaly.code)
      .filter((code) => PRODUCER_BLOCKING_ANOMALIES.has(code)),
    expectedVersion,
    observedVersions: [...observedVersions],
    servicePresent: Boolean(
      inventory.installStatus.installed ||
        inventory.activeBundle ||
        inventory.serviceContract ||
        inventory.runtimeStatus.status === "running"
    ),
  };
}
