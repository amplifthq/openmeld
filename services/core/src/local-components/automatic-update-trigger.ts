import type {
  DaemonServiceLane,
  LocalComponentsReleaseManifest,
  OpenMeldToolsControlRequest,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import { resolveLocalComponentUpdateProjection } from "./update-projection";

export type ReleaseTriggeredOpenMeldToolsUpdate = {
  request: OpenMeldToolsControlRequest & { operation: "request_update" };
  targetVersion: string;
};

type ReleaseTriggeredOpenMeldToolsUpdateInput = {
  capabilities: RuntimeTransportCapabilities;
  generatedAt: string;
  lane: DaemonServiceLane;
  releaseManifest?: LocalComponentsReleaseManifest | null;
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
  if (!input.releaseManifest) {
    return {
      reasonCode: "automatic_update.release_manifest_unavailable",
      status: "skipped",
    };
  }

  // A release-triggered request must be rooted in the manifest supplied by
  // Core's release projection. Unlike read projections, this path must not
  // infer a target from a build-time default when its owner omitted the fact.
  const projection = resolveLocalComponentUpdateProjection({
    generatedAt: input.generatedAt,
    localComponentsStatus,
    releaseManifest: input.releaseManifest,
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
  const targetVersion = input.releaseManifest.components.cli.packageVersion;
  if (!updateIsActionable) {
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
