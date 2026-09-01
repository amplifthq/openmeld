import type {
  DaemonServiceLane,
  LocalComponentsReleaseManifest,
  OpenMeldToolsControlRequest,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import { resolveLocalComponentUpdateProjection } from "./update-projection";

const RELEASE_TRIGGERED_UPDATE_MINIMUM_SERVICE_VERSION = "0.3.139";
const SEMVER_CORE_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/u;

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
    !isServiceVersionAtLeast(
      input.serviceVersion,
      RELEASE_TRIGGERED_UPDATE_MINIMUM_SERVICE_VERSION
    ) ||
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

  const projection = resolveLocalComponentUpdateProjection({
    generatedAt: input.generatedAt,
    localComponentsStatus,
    releaseManifest: input.releaseManifest,
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

function isServiceVersionAtLeast(
  candidate: string | null,
  minimum: string
): boolean {
  const parsedCandidate = parseSemverCore(candidate);
  const parsedMinimum = parseSemverCore(minimum);
  if (!(parsedCandidate && parsedMinimum)) {
    return false;
  }
  for (let index = 0; index < parsedCandidate.parts.length; index += 1) {
    const difference =
      (parsedCandidate.parts[index] ?? 0) - (parsedMinimum.parts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return (
    parsedMinimum.prerelease !== null || parsedCandidate.prerelease === null
  );
}

function parseSemverCore(value: string | null): {
  parts: [number, number, number];
  prerelease: string | null;
} | null {
  if (!value) {
    return null;
  }
  const match = SEMVER_CORE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}
