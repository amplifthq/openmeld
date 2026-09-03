import type {
  DaemonServiceLane,
  LocalRuntimeExpectedRoute,
  LocalWakeRouteReport,
  LocalWakeRouteWorkingFolderObservation,
} from "@openmeld/schemas/types";

export type CurrentExpectedWorkingFolderRoute = Pick<
  LocalRuntimeExpectedRoute,
  "agentProfileId" | "bindingId"
> & {
  configurationRevision: number;
  defaultProjectId: string | null;
};

export type CurrentWorkingFolderObservations =
  | {
      observationsByProfileId: ReadonlyMap<
        string,
        LocalWakeRouteWorkingFolderObservation
      >;
      status: "confirmed";
    }
  | {
      reasonCode:
        | "working_folder.legacy_contract"
        | "working_folder.session_mismatch"
        | "working_folder.report_stale"
        | "working_folder.expected_routes_invalid"
        | "working_folder.observation_coverage_invalid"
        | "working_folder.observation_identity_mismatch"
        | "working_folder.observation_stale";
      status: "unknown";
    };

/**
 * Extracts current working-folder facts from one negotiated v4 Service report.
 * Unknown is intentionally fail-closed: callers must never use it to authorize
 * a Wake or reconstruct a current fact from a historical Wake outcome.
 */
export function resolveCurrentWorkingFolderObservations(input: {
  currentSession: {
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
  };
  expectedRoutes: readonly CurrentExpectedWorkingFolderRoute[];
  freshnessMs: number;
  nowMs: number;
  report: LocalWakeRouteReport;
}): CurrentWorkingFolderObservations {
  if (!("expectedRoutesContractVersion" in input.report)) {
    return unknown("working_folder.legacy_contract");
  }
  if (
    input.report.expectedRoutesContractVersion !== "v4" ||
    input.report.daemonSessionId !== input.currentSession.daemonSessionId ||
    input.report.deviceId !== input.currentSession.deviceId ||
    input.report.lane !== input.currentSession.lane
  ) {
    return unknown("working_folder.session_mismatch");
  }
  if (
    !isFreshAt({
      freshnessMs: input.freshnessMs,
      nowMs: input.nowMs,
      observedAtMs: input.report.reportedAtMs,
    })
  ) {
    return unknown("working_folder.report_stale");
  }

  const expectedByProfileId = new Map<
    string,
    CurrentExpectedWorkingFolderRoute
  >();
  for (const route of input.expectedRoutes) {
    if (expectedByProfileId.has(route.agentProfileId)) {
      return unknown("working_folder.expected_routes_invalid");
    }
    expectedByProfileId.set(route.agentProfileId, route);
  }
  if (
    input.report.workingFolderObservations.length !== expectedByProfileId.size
  ) {
    return unknown("working_folder.observation_coverage_invalid");
  }

  const observationsByProfileId = new Map<
    string,
    LocalWakeRouteWorkingFolderObservation
  >();
  for (const observation of input.report.workingFolderObservations) {
    if (observationsByProfileId.has(observation.profileId)) {
      return unknown("working_folder.observation_coverage_invalid");
    }
    const expected = expectedByProfileId.get(observation.profileId);
    if (!expected) {
      return unknown("working_folder.observation_coverage_invalid");
    }
    if (
      observation.bindingId !== expected.bindingId ||
      observation.configurationRevision !== expected.configurationRevision ||
      observation.defaultProjectId !== expected.defaultProjectId
    ) {
      return unknown("working_folder.observation_identity_mismatch");
    }
    if (
      observation.observedAtMs > input.report.reportedAtMs ||
      !isFreshAt({
        freshnessMs: input.freshnessMs,
        nowMs: input.nowMs,
        observedAtMs: observation.observedAtMs,
      })
    ) {
      return unknown("working_folder.observation_stale");
    }
    observationsByProfileId.set(observation.profileId, observation);
  }

  return { observationsByProfileId, status: "confirmed" };
}

function isFreshAt(input: {
  freshnessMs: number;
  nowMs: number;
  observedAtMs: number;
}): boolean {
  return (
    input.freshnessMs > 0 &&
    input.observedAtMs <= input.nowMs &&
    input.nowMs - input.observedAtMs < input.freshnessMs
  );
}

function unknown(
  reasonCode: Extract<
    CurrentWorkingFolderObservations,
    { status: "unknown" }
  >["reasonCode"]
): CurrentWorkingFolderObservations {
  return { reasonCode, status: "unknown" };
}
