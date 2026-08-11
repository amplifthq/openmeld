import { describe, expect, it } from "vitest";
import {
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
  resolveAgentWakeAvailability,
  resolveEvidenceSyncHealth,
  type WakeRouteStatus,
} from "../src";

const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";
const generatedAt = "2026-06-11T07:00:00.000Z";

function createPrimaryBinding() {
  return createAgentProfileBindingDisplayProjection({
    agentProfileId,
    bindingId: "bind_11111111-1111-4111-8111-111111111111",
    bindingState: "enabled_primary",
    executionTarget: {
      agentControllerConversationId: "thread-ctx-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
    },
  });
}

function createReadyWakeRouteStatus(): WakeRouteStatus {
  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device_11111111-1111-4111-8111-111111111111",
    lane: "dev-local",
    lastHeartbeatMs: 1_768_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  };
}

describe("evidence sync health", () => {
  it("projects owner diagnostics without becoming Wake readiness truth", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      claimDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-06-11T06:55:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
      service: {
        executionCompatible: true,
        expectedEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        observedEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        reasonCodes: [],
        source: "runtime_transport",
      },
    });

    const health = resolveEvidenceSyncHealth({
      generatedAt,
      readiness,
    });

    expect(health).toMatchObject({
      agentProfileId,
      authoritative: false,
      scope: "owner_diagnostics",
      source: "evidence_sync_health",
      status: "healthy",
      useInstead: ["AgentWakeAvailability", "openmeld service trace"],
      verdict: "not_wake_readiness",
    });
    expect(health.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "binding_projection",
          role: "wake_path_evidence",
          status: "healthy",
        }),
        expect.objectContaining({
          id: "route_catalog_sync",
          lastSuccessAt: "2026-06-11T06:55:00.000Z",
          status: "healthy",
        }),
        expect.objectContaining({
          id: "execution_authority_diagnostic",
          role: "owner_diagnostic",
          status: "healthy",
        }),
      ])
    );
  });

  it("keeps provider conversation proof as owner diagnostics unless public readiness changes separately", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      providerConversation: {
        agentControllerConversationId: "thread-ctx-1",
        errorCode: "process.timeout",
        errorMessage: "codex app-server did not complete within 30000ms",
        errorType: "timeout",
        expiresAtMs: 1_770_003_600_000,
        method: "codex_app_server_thread_resume",
        observedAtMs: 1_770_000_000_000,
        provider: "codex",
        ready: false,
        reasonCodes: ["provider_conversation.proof_failed", "process.timeout"],
        required: true,
        source: "runtime_reporting",
        status: "failed",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-06-11T06:55:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        readiness,
        wakeRouteStatus: createReadyWakeRouteStatus(),
      }).status
    ).toBe("available_for_wake");

    const health = resolveEvidenceSyncHealth({
      generatedAt,
      readiness,
    });

    expect(health.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "provider_conversation.proof_failed",
          id: "provider_conversation_diagnostic",
          role: "owner_diagnostic",
          status: "degraded",
          summary: "Provider conversation proof is required but not ready.",
        }),
      ])
    );
    expect(health.status).toBe("degraded");
  });

  it("surfaces missing route evidence as degraded diagnostics", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    const health = resolveEvidenceSyncHealth({
      generatedAt,
      readiness,
    });

    expect(health.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureCode: "agent_execution.route_missing",
          id: "route_catalog_sync",
          status: "degraded",
        }),
      ])
    );
    expect(health.status).toBe("degraded");
  });
});
