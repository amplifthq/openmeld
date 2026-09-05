import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import {
  buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation,
  buildSpaceMemberAgentPresencePresentation,
  buildSpaceMemberAgentPublicCollaborationPresencePresentation,
} from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

describe("space member agent presence presentation", () => {
  it("returns live labels for live agents", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        liveNow: true,
        wakeState: "wakeable",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Live agent",
      shortLabel: "live now",
      status: "live",
    });
  });

  it("returns wakeable labels for execution-ready agents that are not live now", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        liveNow: false,
        wakeState: "wakeable",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Wakeable agent",
      shortLabel: "wakeable",
      status: "wakeable",
    });
  });

  it("does not use owner wake diagnostics as a fallback when agent wake availability is missing", () => {
    const {
      agentWakeAvailability: _agentWakeAvailability,
      ...memberWithoutAgentWakeAvailability
    } = createSpaceMemberAgentSnapshot({
      agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
        displayState: "ready",
        reasonCodes: [],
      }),
      liveNow: false,
      wakeState: "wakeable",
    });

    expect(
      buildSpaceMemberAgentPresencePresentation(
        memberWithoutAgentWakeAvailability
      )
    ).toMatchObject({
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
      availabilityBadgeLabel: "Checking",
      availabilityPhase: "checking_status",
    });
  });

  it("keeps agent wake availability separate from owner wake diagnostics", () => {
    const member = createSpaceMemberAgentSnapshot({
      liveNow: false,
      agentWakeAvailability: {
        action: "none",
        badgeLabel: "Available",
        category: "available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        reasonCode: "agent_execution.ready",
        status: "available_for_wake",
        summary: "Available for Wake",
        tooltip: "Available for Wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          reasonCodes: ["agent_profile_binding.missing"],
        }),
        agentWakeRouteRegistration: createTestAgentWakeRouteRegistration({
          status: "pending",
          reasonCode: "wake_route.registration_pending",
          reportedAtMs: null,
          daemonSessionId: null,
          deviceId: null,
          lane: null,
          serviceVersion: null,
        }),
        wakeRouteEvidence: {
          observedAt: "2026-05-26T00:00:00.000Z",
          reasonCode: "route.not_registered",
          status: "offline",
        },
        wakeRouteStatus: { status: "offline" },
      },
    });
    expect(buildSpaceMemberAgentPresencePresentation(member)).toMatchObject({
      detailLabel: "Wakeable agent",
      shortLabel: "wakeable",
      status: "wakeable",
      availabilityAction: "none",
      availabilityBadgeLabel: "Available",
      availabilityPhase: "available",
      availabilityReasonCode: "agent_execution.ready",
    });
    const presentation =
      buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation(member);

    expect(presentation).toMatchObject({
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
    });
    expect(
      buildSpaceMemberAgentPublicCollaborationPresencePresentation(member)
    ).toMatchObject({
      detailLabel: "Wakeable agent",
      shortLabel: "wakeable",
      status: "wakeable",
      availabilityBadgeLabel: "Available",
      availabilityPhase: "available",
    });
  });

  it("shows checking connection when agent wake availability is missing", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        includeAgentExecutionReadiness: false,
        liveNow: false,
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
    });
  });

  it("shows unavailable instead of checking when owner readiness is blocked", () => {
    const member = createSpaceMemberAgentSnapshot({
      liveNow: false,
      ownerWakeDiagnostics: {
        state: "action_required",
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "blocked",
          reasonCodes: ["service.update_required"],
        }),
        agentWakeRouteRegistration: createTestAgentWakeRouteRegistration({
          status: "registered",
          reasonCode: null,
          reportedAtMs: 1_768_000_000_000,
          daemonSessionId: "daemon-session-1",
          deviceId: "device_11111111-1111-4111-8111-111111111111",
          lane: "prod",
          serviceVersion: "0.7.60",
        }),
        wakeRouteEvidence: {
          observedAt: "2026-05-26T00:00:00.000Z",
          reasonCode: "online",
          status: "online",
        },
        wakeRouteStatus: { status: "checking" },
      },
    });

    expect(
      buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation(member)
    ).toMatchObject({
      detailLabel: "Reply blocked",
      shortLabel: "reply blocked",
      status: "unavailable",
    });
  });

  it("shows offline when agent wake availability reports offline for Wake", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        liveNow: false,
        agentWakeAvailability:
          createTestAgentAgentWakeAvailability("offline_for_wake"),
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Offline agent",
      shortLabel: "offline",
      status: "offline",
    });
  });

  it("does not treat route-only wakeability as ready when execution readiness is not ready", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          reasonCodes: ["agent_profile_binding.missing"],
        }),
        liveNow: false,
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Reply route unavailable",
      shortLabel: "reply route unavailable",
      status: "unavailable",
    });
  });

  it("returns unavailable labels when daemon route truth is unavailable", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        liveNow: false,
        wakeState: "offline",
        daemonRouteStatus: "unavailable",
        wakeabilityReasonCodes: ["route.unavailable"],
        wakeabilityStatus: "blocked",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Reply route unavailable",
      shortLabel: "reply route unavailable",
      status: "unavailable",
    });
  });

  it("does not infer checking from legacy wakeability when agent wake availability is missing", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
      createSpaceMemberAgentSnapshot({
        daemonRouteStatus: "unavailable",
        includeAgentExecutionReadiness: false,
        liveNow: false,
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
    });
  });

  it("shows checking connection while owner wake diagnostics is refreshable", () => {
    const presentation = buildSpaceMemberAgentPresencePresentation(
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
              reachable: true,
              refreshable: true,
              reasonCodes: ["local_service.refresh_in_progress"],
              source: "runtime_transport",
            },
            route: {
              online: false,
              reasonCodes: ["route.not_registered"],
              source: "daemon_route",
            },
            service: {
              executionCompatible: true,
              reasonCodes: [],
              source: "runtime_transport",
            },
          },
          primaryAction: "check_status",
          reasonCodes: ["route.not_registered"],
        }),
        liveNow: false,
        wakeState: "offline",
        daemonRouteStatus: "offline",
        wakeabilityStatus: "blocked",
      })
    );

    expect(presentation).toMatchObject({
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
    });
  });
});
