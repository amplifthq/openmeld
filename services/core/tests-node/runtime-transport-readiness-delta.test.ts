import { describe, expect, it } from "vitest";
import {
  diffSessionReadinessComponents,
  snapshotSessionReadinessComponents,
} from "../src/runtime-transport/application/runtime-transport-readiness-delta";

function createSession(input: {
  leases?: string[];
  included?: string[];
  skipped?: { profileId: string; skipReason: string }[];
  rejected?: { profileId: string; reasonCode: string }[];
}) {
  return {
    localWakeRouteReport:
      input.included || input.skipped
        ? {
            includedProfileIds: input.included ?? [],
            skippedProfiles: input.skipped ?? [],
          }
        : null,
    profileIds: new Set(input.leases ?? []),
    rejectedProfileRegistrationsByProfileId: new Map(
      (input.rejected ?? []).map((entry) => [entry.profileId, entry])
    ),
  };
}

describe("snapshotSessionReadinessComponents", () => {
  it("returns an empty snapshot for a missing session", () => {
    expect(snapshotSessionReadinessComponents(null)).toEqual({
      leaseProfileIds: [],
      reportIncludedProfileIds: [],
      reportSkippedKeys: [],
      rejectedKeys: [],
    });
  });
});

describe("diffSessionReadinessComponents", () => {
  it("returns nothing when a re-register carries identical facts", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({
        leases: ["agt-a", "agt-b"],
        skipped: [{ profileId: "agt-c", skipReason: "controller.disabled" }],
      })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({
        leases: ["agt-a", "agt-b"],
        skipped: [{ profileId: "agt-c", skipReason: "controller.disabled" }],
      })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual([]);
  });

  it("detects a profile gaining a lease without touching bystanders", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({ leases: ["agt-a", "agt-b"] })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({ leases: ["agt-a", "agt-b", "agt-new"] })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual(["agt-new"]);
  });

  it("detects a profile losing its lease", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({ leases: ["agt-a", "agt-b"] })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({ leases: ["agt-a"] })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual(["agt-b"]);
  });

  it("detects a skip-reason change even when membership is unchanged", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({
        skipped: [
          { profileId: "agt-a", skipReason: "controller.launch.needs_repair" },
        ],
      })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({
        skipped: [
          { profileId: "agt-a", skipReason: "controller.registry.disabled" },
        ],
      })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual(["agt-a"]);
  });

  it("detects a rejection reason change", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({
        rejected: [
          { profileId: "agt-a", reasonCode: "daemon.session.reject_conflict" },
        ],
      })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({
        rejected: [
          { profileId: "agt-a", reasonCode: "daemon.session.reject_stale" },
        ],
      })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual(["agt-a"]);
  });

  it("collapses a profile moving between components to one entry", () => {
    const before = snapshotSessionReadinessComponents(
      createSession({ included: ["agt-a"] })
    );
    const after = snapshotSessionReadinessComponents(
      createSession({
        skipped: [
          { profileId: "agt-a", skipReason: "controller.launch.needs_repair" },
        ],
      })
    );
    expect(diffSessionReadinessComponents(before, after)).toEqual(["agt-a"]);
  });
});
