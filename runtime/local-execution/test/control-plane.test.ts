import { describe, expect, it } from "vitest";
import {
  buildControlPlaneResponse,
  parseControlPlaneRequest,
} from "../src/control-plane";

const BASE_CONTEXT = {
  statusPayload: {
    installed: true,
    running: true,
    daemonVersion: "0.1.2",
    runtimeRoot: "/tmp/.openmeld/runtime/daemon",
    checkedAt: "2026-02-25T12:00:00.000Z",
  },
  healthPayload: {
    state: "ok" as const,
    runtimeState: "healthy" as const,
    reasonCode: "ok",
    checkedAt: "2026-02-25T12:00:00.000Z",
  },
  historyEntries: [
    {
      id: "evt-1",
      ts: "2026-02-25T12:00:00.000Z",
      code: "service.started",
      message: "OpenMeld local service started",
    },
  ],
};

describe("local execution control-plane helper", () => {
  it("returns status response and keeps requestId", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "status",
        requestId: "req-1",
      },
      context: BASE_CONTEXT,
    });

    expect(response.code).toBe("service.status");
    expect(response.requestId).toBe("req-1");
  });

  it("returns history response with entries", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "history",
      },
      context: BASE_CONTEXT,
    });

    expect(response.code).toBe("service.history");
    if (response.code === "service.history") {
      expect(response.payload.entries).toHaveLength(1);
    }
  });

  it("uses fallback interrupt payload when no handler is provided", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "interrupt",
        payload: {
          target: {
            by: "task",
            taskId: "task-1",
          },
        },
      },
      context: BASE_CONTEXT,
    });

    expect(response.code).toBe("service.interrupt");
    if (response.code === "service.interrupt") {
      expect(response.payload.accepted).toBe(false);
      expect(response.payload.target).toEqual({
        by: "task",
        taskId: "task-1",
      });
    }
  });

  it("uses fallback cancel payload when no handler is provided", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "cancel",
        payload: {
          target: {
            by: "dispatch",
            dispatchId: "dispatch-1",
          },
        },
      },
      context: BASE_CONTEXT,
    });

    expect(response.code).toBe("service.cancel");
    if (response.code === "service.cancel") {
      expect(response.payload.accepted).toBe(false);
      expect(response.payload.target).toEqual({
        by: "dispatch",
        dispatchId: "dispatch-1",
      });
    }
  });

  it("applies shutdown defaults when payload is missing", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "shutdown",
      },
      context: BASE_CONTEXT,
    });

    expect(response.code).toBe("service.shutdown");
    if (response.code === "service.shutdown") {
      expect(response.payload.mode).toBe("graceful");
      expect(response.payload.gracePeriodMs).toBe(5000);
    }
  });

  it.each([
    true,
    false,
  ])("never falls back to ordinary shutdown for an idle-only request (supported: %s)", async (supported) => {
    let idleHandled = false;
    let ordinaryHandled = false;
    const response = await buildControlPlaneResponse({
      request: { v: 1, command: "shutdown_if_idle" },
      context: {
        ...BASE_CONTEXT,
        shutdownHandler: (payload) => {
          ordinaryHandled = true;
          return {
            accepted: true,
            mode: payload.mode,
            gracePeriodMs: payload.gracePeriodMs,
          };
        },
        ...(supported
          ? {
              shutdownIfIdleHandler: (payload: { gracePeriodMs: number }) => {
                idleHandled = true;
                return {
                  accepted: false,
                  mode: "graceful" as const,
                  gracePeriodMs: payload.gracePeriodMs,
                };
              },
            }
          : {}),
      },
    });
    expect(ordinaryHandled).toBe(false);
    expect(idleHandled).toBe(supported);
    expect(response).toMatchObject(
      supported
        ? {
            code: "service.shutdown",
            payload: { accepted: false, mode: "graceful" },
          }
        : {
            code: "service.error",
            payload: { errorCode: "daemon.control.contract_mismatch" },
          }
    );
  });

  it("reports whether every accepted Wake and result receipt is safe before an update switch", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "service_update_readiness",
      },
      context: {
        ...BASE_CONTEXT,
        serviceUpdateReadinessHandler: () => ({
          acceptedWakeCount: 1,
          safeToSwitch: false,
          unacknowledgedResultCount: 0,
        }),
      },
    });

    expect(response).toEqual({
      v: 1,
      code: "service.update_readiness",
      payload: {
        acceptedWakeCount: 1,
        safeToSwitch: false,
        unacknowledgedResultCount: 0,
      },
    });
  });

  it("uses conversation execution status handler when provided", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "conversation_execution_status",
        payload: {
          agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
          boundAgentControllerRef: "builtin:codex",
          agentControllerRef: "builtin:codex",
          spaceId:
            "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b",
          targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
          transportMode: "local-cli",
          validate: true,
        },
      },
      context: {
        ...BASE_CONTEXT,
        conversationExecutionStatusHandler: async () => ({
          agentContextLookupKey:
            "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
          controllerLaunchStatus: "ready",
          executionState: null,
          localRuntimeContext: {
            agentContextLookupKey:
              "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
            runtimeWorkspaceFingerprint: "sha256:workspace-a",
            status: "missing",
          },
          providerConversationProof: {
            agentControllerConversationId: null,
            checkedAt: null,
            errorCode: null,
            errorMessage: null,
            errorType: null,
            expiresAt: null,
            intrusive: false,
            method: null,
            provider: null,
            status: "not_run",
            transportMode: "local-cli",
          },
          runtimeWorkspace: {
            configPath: "/tmp/workspace.json",
            configuredWorkspacePath: "/tmp/workspace",
            fingerprint: "sha256:workspace-a",
            path: "/tmp/workspace",
            reasonCode: null,
            reasonText: null,
            runtimeContext: {
              providerRuntimeWorkingDirectory: "/tmp/workspace",
            },
            status: "ready",
            workspaceMode: "openmeld_managed",
          },
        }),
      },
    });

    expect(response.code).toBe("service.conversation_execution_status");
    if (response.code === "service.conversation_execution_status") {
      expect(response.payload.controllerLaunchStatus).toBe("ready");
      expect(response.payload.localRuntimeContext.status).toBe("missing");
    }
  });

  it("uses sync route catalog handler when provided", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "sync_route_catalog",
        payload: {
          reason: "profile_created",
        },
      },
      context: {
        ...BASE_CONTEXT,
        syncRouteCatalogHandler: async () => ({
          accepted: true,
          addedProfileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
          keptProfileIds: [],
          profileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
          removedProfileIds: [],
          syncStatus: "changed",
        }),
      },
    });

    expect(response.code).toBe("service.sync_route_catalog");
    if (response.code === "service.sync_route_catalog") {
      expect(response.payload.accepted).toBe(true);
      expect(response.payload.syncStatus).toBe("changed");
      expect(response.payload.profileIds).toEqual([
        "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
      ]);
    }
  });

  it("requests an immediate Agent Activity reconciliation when provided", async () => {
    const response = await buildControlPlaneResponse({
      request: {
        v: 1,
        command: "request_agent_activity_sync",
        payload: {
          reason: "project_connection_disconnected",
        },
      },
      context: {
        ...BASE_CONTEXT,
        requestAgentActivitySyncHandler: () => ({ accepted: true }),
      },
    });

    expect(response).toMatchObject({
      code: "service.agent_activity_sync_requested",
      payload: { accepted: true },
    });
  });

  it("throws for invalid request", () => {
    expect(() =>
      parseControlPlaneRequest({
        v: 1,
        command: "unknown",
      })
    ).toThrowError("invalid daemon control-plane request");
  });
});
