import { describe, expect, it, vi } from "vitest";

vi.mock("@openmeld/schemas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/schemas")>();
  return {
    ...actual,
    resolvePublicAgentAvailabilityCopy: () => null,
  };
});

import {
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
  resolveAgentWakeAvailability,
} from "../src";

const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";

function createPrimaryBinding() {
  return createAgentProfileBindingDisplayProjection({
    agentProfileId,
    bindingId: "bind_11111111-1111-4111-8111-111111111111",
    bindingState: "enabled_primary",
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
    },
  });
}

describe("agent wake availability local copy fallbacks", () => {
  it("keeps sign-in guidance honest when shared copy is unavailable", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-07-13T06:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "needs_prepare",
        ready: false,
        reasonCodes: [
          "runtime.agent_controller_report_unavailable",
          "provider_account.access_required",
          "controller.auth.unauthenticated",
        ],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        agentControllerRef: "builtin:codex",
        wakeRouteStatus: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device_11111111-1111-4111-8111-111111111111",
          lane: "dev-local",
          lastHeartbeatMs: 1_768_000_000_000,
          leaseEpoch: 1,
          status: "ready",
        },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Sign-in needed",
      category: "unavailable",
      label: "Sign-in needed",
      status: "unavailable_for_wake",
      summary: "Sign in to this local agent from a terminal on this computer.",
      tooltip: "This local agent is not signed in on this computer.",
    });
  });

  it("keeps reconnecting copy specific when shared copy is unavailable", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.reconnecting"],
        source: "runtime_transport",
      },
      route: {
        observedAt: "2026-06-12T10:58:55.000Z",
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "checking" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Reconnecting",
      label: "Reconnecting Computer",
      summary: "Computer is reconnecting.",
      tooltip: "Reconnecting Computer",
    });
  });
});
