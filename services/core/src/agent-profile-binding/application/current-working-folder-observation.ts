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

export type CurrentWorkingFolderObservation =
  | {
      observation: LocalWakeRouteWorkingFolderObservation;
      status: "confirmed";
    }
  | {
      reasonCode:
        | "working_folder.legacy_contract"
        | "working_folder.session_mismatch"
        | "working_folder.report_stale"
        | "working_folder.observation_coverage_invalid"
        | "working_folder.observation_identity_mismatch"
        | "working_folder.observation_stale";
      status: "unknown";
    };

/**
 * Verifies one target's working-folder fact from a negotiated v4 Service report.
 * Other Profiles do not determine this target's identity or freshness. Full
 * expected-route inventory remains the catalog reconciliation owner's concern.
 * Unknown is intentionally fail-closed: callers must never use it to authorize
 * a Wake or reconstruct a current fact from a historical Wake outcome.
 */
export function resolveCurrentWorkingFolderObservation(input: {
  currentSession: {
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
  };
  expectedRoute: CurrentExpectedWorkingFolderRoute;
  freshnessMs: number;
  nowMs: number;
  report: LocalWakeRouteReport;
}): CurrentWorkingFolderObservation {
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

  const targetObservations = input.report.workingFolderObservations.filter(
    (observation) =>
      observation.profileId === input.expectedRoute.agentProfileId
  );
  const observation = targetObservations[0];
  if (targetObservations.length !== 1 || !observation) {
    return unknown("working_folder.observation_coverage_invalid");
  }
  const expected = input.expectedRoute;
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
  return { observation, status: "confirmed" };
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
    CurrentWorkingFolderObservation,
    { status: "unknown" }
  >["reasonCode"]
): CurrentWorkingFolderObservation {
  return { reasonCode, status: "unknown" };
}
