import type {
  DaemonServiceLane,
  OpenMeldToolsControlRequest,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import type { CoreLocalComponentsRelease } from "./release-source";
import { resolveLocalComponentUpdateProjection } from "./update-projection";

export type ReleaseTriggeredOpenMeldToolsUpdate = {
  request: OpenMeldToolsControlRequest & { operation: "request_update" };
  targetVersion: string;
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
  if (projection.updateOperation) {
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
  const targetVersion = projection.cli.latestPackageVersion;
  const targetsAvailable =
    targetVersion !== null && projection.service.latestVersion !== null;

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
    },
  };
}

export function resolveReleaseTriggeredOpenMeldToolsUpdate(
  input: ReleaseTriggeredOpenMeldToolsUpdateInput
): ReleaseTriggeredOpenMeldToolsUpdate | null {
  const decision = resolveReleaseTriggeredOpenMeldToolsUpdateDecision(input);
  return decision.status === "request" ? decision.update : null;
}
