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

export function resolveReleaseTriggeredOpenMeldToolsUpdate(input: {
  capabilities: RuntimeTransportCapabilities;
  generatedAt: string;
  lane: DaemonServiceLane;
  releaseManifest?: LocalComponentsReleaseManifest | null;
  serviceVersion: string | null;
}): ReleaseTriggeredOpenMeldToolsUpdate | null {
  if (
    input.lane !== "prod" ||
    input.capabilities.openMeldToolsControl?.requestAutomaticUpdate !== true ||
    input.capabilities.openMeldToolsControl?.requestUpdate !== true
  ) {
    return null;
  }
  const localComponentsStatus = input.capabilities.localComponents;
  if (
    localComponentsStatus?.maintenance?.automaticUpdatesEnabled !== true ||
    localComponentsStatus.maintenance.status !== "ready"
  ) {
    return null;
  }

  // A release-triggered request must be rooted in the manifest supplied by
  // Core's release projection. Unlike read projections, this path must not
  // infer a target from a build-time default when its owner omitted the fact.
  const projection = resolveLocalComponentUpdateProjection({
    generatedAt: input.generatedAt,
    localComponentsStatus,
    releaseManifest: input.releaseManifest ?? null,
    serviceConnected: true,
    serviceVersion: input.serviceVersion,
  });
  if (projection.updateOperation) {
    return null;
  }
  const updateIsActionable = [
    projection.cli.status,
    projection.service.status,
    projection.skills.status,
  ].some(
    (status) => status === "update_available" || status === "update_required"
  );
  const targetVersion =
    projection.cli.latestPackageVersion ?? projection.service.latestVersion;
  if (!(updateIsActionable && targetVersion)) {
    return null;
  }
  return {
    request: {
      operation: "request_update",
      requestSource: "automatic",
    },
    targetVersion,
  };
}
