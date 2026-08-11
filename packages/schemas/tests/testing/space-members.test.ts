import { describe, expect, it } from "vitest";
import { spaceMembersSnapshotSchema } from "../../src/schemas/http/space-members";
import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "../../src/testing/space-members";

describe("space member testing fixtures", () => {
  it("derives canonical viewer recovery evidence for ready agent fixtures", () => {
    const snapshot = createSpaceMemberAgentSnapshot();

    expect(snapshot.ownerWakeDiagnostics?.wakeRouteEvidence).toEqual({
      observedAt: "2026-03-13T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    });
    expect(
      snapshot.ownerWakeDiagnostics?.agentExecutionReadiness.displayState
    ).toBe("ready");
  });

  it("creates schema-valid owner-scoped member snapshots by default", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [createSpaceMemberAgentSnapshot()],
      humans: [createSpaceMemberHumanSnapshot()],
    });

    expect(spaceMembersSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("derives canonical blocked viewer recovery evidence for blocked agent fixtures", () => {
    const snapshot = createSpaceMemberAgentSnapshot({
      wakeabilityStatus: "blocked",
      wakeabilityReasonCodes: ["profile.unbound"],
      wakeabilityReasonText: "This profile currently has no daemon route",
    });

    expect(snapshot.ownerWakeDiagnostics?.wakeRouteEvidence).toEqual({
      observedAt: "2026-03-13T00:00:00.000Z",
      reasonCode: "route.not_registered",
      status: "offline",
    });
    expect(
      snapshot.ownerWakeDiagnostics?.agentExecutionReadiness.displayState
    ).toBe("not_ready");
  });

  it("recomputes snapshot summary from the provided members", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [
        createSpaceMemberAgentSnapshot({
          liveNow: true,
        }),
        createSpaceMemberAgentSnapshot({
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileName: "Watcher",
          wakeabilityStatus: "blocked",
        }),
      ],
      humans: [
        createSpaceMemberHumanSnapshot({
          liveNow: true,
        }),
      ],
    });

    expect(snapshot.summary).toEqual({
      agentCount: 2,
      checkingAgentCount: 0,
      humanCount: 1,
      liveNowCount: 2,
      offlineAgentCount: 0,
      totalCount: 3,
      unavailableAgentCount: 1,
      wakeableAgentCount: 1,
    });
  });

  it("counts route-only local service gaps as offline", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [
        createSpaceMemberAgentSnapshot({
          agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
            displayState: "not_ready",
            facts: {
              binding: {
                reasonCodes: [],
                routable: true,
                source: "binding_truth",
              },
              localService: {
                reachable: false,
                refreshable: false,
                reasonCodes: ["service.not_running"],
                source: "runtime_transport",
              },
              route: {
                online: false,
                reasonCodes: ["agent_execution.route_offline"],
              },
            },
            primaryAction: "run_prepare",
            reasonCodes: ["service.not_running"],
          }),
          daemonRouteStatus: "offline",
          profileId: "agt_44444444-4444-4444-8444-444444444444",
          profileName: "Offline Agent",
          wakeabilityStatus: "ready",
        }),
      ],
    });

    expect(snapshot.summary).toEqual({
      agentCount: 1,
      checkingAgentCount: 0,
      humanCount: 0,
      liveNowCount: 0,
      offlineAgentCount: 1,
      totalCount: 1,
      unavailableAgentCount: 0,
      wakeableAgentCount: 0,
    });
  });

  it("keeps explicit setup gaps unavailable instead of offline", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [
        createSpaceMemberAgentSnapshot({
          profileId: "agt_55555555-5555-4555-8555-555555555555",
          profileName: "Unbound Agent",
          wakeabilityReasonCodes: ["profile.unbound"],
          wakeabilityStatus: "blocked",
        }),
      ],
    });

    expect(snapshot.summary).toEqual({
      agentCount: 1,
      checkingAgentCount: 0,
      humanCount: 0,
      liveNowCount: 0,
      offlineAgentCount: 0,
      totalCount: 1,
      unavailableAgentCount: 1,
      wakeableAgentCount: 0,
    });
  });

  it("recomputes snapshot summary from execution readiness before legacy wake fields", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [
        createSpaceMemberAgentSnapshot({
          agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
            displayState: "not_ready",
            reasonCodes: ["agent_profile_binding.missing"],
          }),
          wakeabilityStatus: "ready",
          wakeState: "wakeable",
        }),
      ],
    });

    expect(snapshot.summary).toEqual({
      agentCount: 1,
      checkingAgentCount: 0,
      humanCount: 0,
      liveNowCount: 0,
      offlineAgentCount: 0,
      totalCount: 1,
      unavailableAgentCount: 1,
      wakeableAgentCount: 0,
    });
  });

  it("rejects ready Agent Execution Readiness fixtures with blocking readiness impact", () => {
    expect(() =>
      createSpaceMemberAgentExecutionReadiness({
        displayState: "ready",
        facts: {
          readinessImpact: {
            blocked: true,
            expiresAtMs: 1_770_001_800_000,
            impactKind: "local_execution",
            observedAtMs: 1_770_000_000_000,
            reasonCodes: ["controller.runtime.missing"],
            source: "wake_failure",
          },
        },
      })
    ).toThrow(
      "ready AgentExecutionReadiness fixture carries blocking facts: readinessImpact.blocked=true"
    );
  });
});
