import { resolveOpenMeldToolsUpdateTargetVersions } from "@openmeld/schemas";
import type {
  DaemonServiceLane,
  OpenMeldToolsControlRequest,
  OpenMeldToolsUpdateOperation,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import type { CoreLocalComponentsRelease } from "./release-source";
import {
  compareSemver,
  resolveLocalComponentUpdateProjection,
} from "./update-projection";

export type ReleaseTriggeredOpenMeldToolsUpdate = {
  request: OpenMeldToolsControlRequest & { operation: "request_update" };
  targetVersion: string;
  targetServiceVersion: string;
};

type ReleaseTriggeredOpenMeldToolsUpdateInput = {
  capabilities: RuntimeTransportCapabilities;
  generatedAt: string;
  lane: DaemonServiceLane;
  release: CoreLocalComponentsRelease;
  serviceVersion: string | null;
};

export type ReleaseTriggeredOpenMeldToolsUpdateDecision =
  | {
      status: "request";
      update: ReleaseTriggeredOpenMeldToolsUpdate;
    }
  | {
      status: "skipped";
      reasonCode:
        | "automatic_update.capability_not_supported"
        | "automatic_update.disabled"
        | "automatic_update.lane_not_supported"
        | "automatic_update.local_components_unavailable"
        | "automatic_update.maintenance_not_ready"
        | "automatic_update.no_actionable_release"
        | "automatic_update.operation_present"
        | "automatic_update.release_manifest_unavailable";
    };

function newerTargetAfterFailedUpdate(
  operation: OpenMeldToolsUpdateOperation,
  cliVersion: string | null,
  serviceVersion: string | null
): boolean {
  if (
    (operation.phase !== "needs_help" && operation.phase !== "restored") ||
    !cliVersion ||
    !serviceVersion
  ) {
    return false;
  }
  const previous = resolveOpenMeldToolsUpdateTargetVersions(operation);
  const cli = compareSemver(cliVersion, previous.cliVersion);
  const service = compareSemver(serviceVersion, previous.serviceVersion);
  return (
    cli !== null &&
    service !== null &&
    cli >= 0 &&
    service >= 0 &&
    (cli > 0 || service > 0)
  );
}

export function resolveReleaseTriggeredOpenMeldToolsUpdateDecision(
  input: ReleaseTriggeredOpenMeldToolsUpdateInput
): ReleaseTriggeredOpenMeldToolsUpdateDecision {
  if (input.lane !== "prod") {
    return {
      reasonCode: "automatic_update.lane_not_supported",
      status: "skipped",
    };
  }
  if (
    input.capabilities.openMeldToolsControl?.requestAutomaticUpdate !== true ||
    input.capabilities.openMeldToolsControl?.requestUpdate !== true
  ) {
    return {
      reasonCode: "automatic_update.capability_not_supported",
      status: "skipped",
    };
  }
  const localComponentsStatus = input.capabilities.localComponents;
  if (!localComponentsStatus) {
    return {
      reasonCode: "automatic_update.local_components_unavailable",
      status: "skipped",
    };
  }
  if (localComponentsStatus.maintenance?.automaticUpdatesEnabled !== true) {
    return {
      reasonCode: "automatic_update.disabled",
      status: "skipped",
    };
  }
  if (localComponentsStatus.maintenance.status !== "ready") {
    return {
      reasonCode: "automatic_update.maintenance_not_ready",
      status: "skipped",
    };
  }
  if (!input.release.manifest) {
    return {
      reasonCode: "automatic_update.release_manifest_unavailable",
      status: "skipped",
    };
  }

  // A release-triggered request is rooted in the published release only.
  const projection = resolveLocalComponentUpdateProjection({
    generatedAt: input.generatedAt,
    localComponentsStatus,
    release: input.release,
    serviceConnected: true,
    serviceVersion: input.serviceVersion,
  });
  const targetVersion = projection.cli.latestPackageVersion;
  const serviceTarget = projection.service.latestVersion;
  if (
    projection.updateOperation &&
    !newerTargetAfterFailedUpdate(
      projection.updateOperation,
      targetVersion,
      serviceTarget
    )
  ) {
    return {
      reasonCode: "automatic_update.operation_present",
      status: "skipped",
    };
  }
  const updateIsActionable = [
    projection.cli.status,
    projection.service.status,
    projection.skills.status,
  ].some(
    (status) => status === "update_available" || status === "update_required"
  );
  const targetsAvailable = targetVersion !== null && serviceTarget !== null;

  if (!(updateIsActionable && targetsAvailable)) {
    return {
      reasonCode: "automatic_update.no_actionable_release",
      status: "skipped",
    };
  }
  return {
    status: "request",
    update: {
      request: {
        operation: "request_update",
        requestSource: "automatic",
      },
      targetVersion,
      targetServiceVersion: serviceTarget,
    },
  };
}

export function resolveReleaseTriggeredOpenMeldToolsUpdate(
  input: ReleaseTriggeredOpenMeldToolsUpdateInput
): ReleaseTriggeredOpenMeldToolsUpdate | null {
  const decision = resolveReleaseTriggeredOpenMeldToolsUpdateDecision(input);
  return decision.status === "request" ? decision.update : null;
}
