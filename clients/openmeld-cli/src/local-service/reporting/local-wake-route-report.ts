import {
  daemonServiceLaneSchema,
  localWakeRouteWorkingFolderObservationSchema,
} from "@openmeld/schemas";
import type {
  LocalWakeRouteReport,
  LocalWakeRouteWorkingFolderObservation,
} from "@openmeld/schemas/types";
import type { RouteCatalog } from "../core/types";
import { DaemonServiceRunError } from "../core/types";

export function createLocalWakeRouteReport(input: {
  daemonSessionId: string;
  deviceId: string;
  lane: string;
  reportedAtMs: number;
  routeCatalog: RouteCatalog;
  serviceVersion: string | null;
}): LocalWakeRouteReport {
  const lane = daemonServiceLaneSchema.safeParse(input.lane);
  if (!lane.success) {
    throw invalidV4Report("invalid OpenMeld Service lane for route report");
  }
  const profileConfigurationRevisions = resolveProfileConfigurationRevisions(
    input.routeCatalog
  );
  const baseReport = {
    daemonSessionId: input.daemonSessionId,
    deviceId: input.deviceId,
    includedProfileIds: [...input.routeCatalog.profileIds],
    lane: lane.data,
    reportedAtMs: input.reportedAtMs,
    serviceVersion: input.serviceVersion,
    ...(profileConfigurationRevisions ? { profileConfigurationRevisions } : {}),
    skippedProfiles: [...input.routeCatalog.skippedProfiles],
  };

  if (input.routeCatalog.expectedRoutesContractVersion !== "v4") {
    return baseReport;
  }

  const expectedProfileIds = [
    ...(input.routeCatalog.workingFolderExpectedProfileIds ?? []),
  ].sort((left, right) => left.localeCompare(right));
  const observations = parseV4WorkingFolderObservations(
    input.routeCatalog.workingFolderObservations ?? []
  );
  const observedProfileIds = observations
    .map((observation) => observation.profileId)
    .sort((left, right) => left.localeCompare(right));
  if (
    new Set(expectedProfileIds).size !== expectedProfileIds.length ||
    new Set(observedProfileIds).size !== observedProfileIds.length ||
    expectedProfileIds.length !== observedProfileIds.length ||
    expectedProfileIds.some(
      (profileId, index) => profileId !== observedProfileIds[index]
    )
  ) {
    throw invalidV4Report(
      "negotiated v4 working-folder observations do not exactly cover expected routes"
    );
  }

  return {
    ...baseReport,
    expectedRoutesContractVersion: "v4",
    workingFolderObservations: observations,
  };
}

function parseV4WorkingFolderObservations(
  observations: NonNullable<RouteCatalog["workingFolderObservations"]>
): LocalWakeRouteWorkingFolderObservation[] {
  return observations.map((observation) => {
    const parsed =
      localWakeRouteWorkingFolderObservationSchema.safeParse(observation);
    if (!parsed.success) {
      throw invalidV4Report(
        `invalid negotiated v4 working-folder observation for ${observation.profileId}`
      );
    }
    return parsed.data;
  });
}

function resolveProfileConfigurationRevisions(routeCatalog: RouteCatalog) {
  if (routeCatalog.profileIds.length === 0) {
    return null;
  }
  const revisions = routeCatalog.profileIds.map((profileId) => {
    const configurationRevision =
      routeCatalog.routeByProfileId.get(profileId)?.configurationRevision ??
      null;
    const bindingId =
      routeCatalog.routeByProfileId.get(profileId)?.bindingId ?? null;
    return configurationRevision === null || bindingId === null
      ? null
      : { bindingId, configurationRevision, profileId };
  });
  return revisions.every(
    (
      revision
    ): revision is {
      bindingId: string;
      configurationRevision: number;
      profileId: string;
    } => revision !== null
  )
    ? revisions
    : null;
}

export function hasCompleteProfileConfigurationRevisions(
  routeCatalog: RouteCatalog
): boolean {
  return resolveProfileConfigurationRevisions(routeCatalog) !== null;
}

function invalidV4Report(message: string): DaemonServiceRunError {
  return new DaemonServiceRunError({
    code: "daemon.run.register_payload_invalid",
    message,
  });
}
