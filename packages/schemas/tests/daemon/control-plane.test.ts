import { describe, expect, it } from "vitest";
import {
  OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
  openMeldDaemonControlPlaneRequestSchema,
  openMeldDaemonControlPlaneResponseSchema,
} from "../../src/index";

describe("daemon control-plane schema", () => {
  it("accepts status request envelope", () => {
    const result = openMeldDaemonControlPlaneRequestSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      command: "status",
      requestId: "req-1",
      authToken: "token-1",
    });
    expect(result.success).toBe(true);
  });

  it.each([
    [{}, true],
    [{ mode: "force" }, false],
    [
      {
        accountAdmissionId: "45fa0c3e-188b-4bd8-b709-1dd5075bed7c",
      },
      false,
    ],
  ])("validates an idle-only shutdown without force or account handoff: %j", (payload, accepted) => {
    expect(
      openMeldDaemonControlPlaneRequestSchema.safeParse({
        v: 1,
        command: "shutdown_if_idle",
        payload,
      }).success
    ).toBe(accepted);
  });

  it("accepts a strict Service update readiness request and response", () => {
    expect(
      openMeldDaemonControlPlaneRequestSchema.safeParse({
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "service_update_readiness",
      }).success
    ).toBe(true);
    expect(
      openMeldDaemonControlPlaneResponseSchema.safeParse({
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        code: "service.update_readiness",
        payload: {
          acceptedWakeCount: 1,
          safeToSwitch: false,
          unacknowledgedResultCount: 1,
        },
      }).success
    ).toBe(true);
    expect(
      openMeldDaemonControlPlaneResponseSchema.safeParse({
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        code: "service.update_readiness",
        payload: {
          acceptedWakeCount: 0,
          safeToSwitch: true,
          unacknowledgedResultCount: 0,
          processIdle: true,
        },
      }).success
    ).toBe(false);
  });

  it("accepts conversation execution status request envelope", () => {
    const result = openMeldDaemonControlPlaneRequestSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      command: "conversation_execution_status",
      payload: {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        boundAgentControllerRef: "builtin:codex",
        agentControllerRef: "builtin:codex",
        spaceId:
          "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b",
        targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
        transportMode: "codex-app-server",
        validate: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts sync route catalog request envelope", () => {
    const result = openMeldDaemonControlPlaneRequestSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      command: "sync_route_catalog",
      payload: {
        reason: "profile_created",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a local Agent Activity reconciliation request envelope", () => {
    expect(
      openMeldDaemonControlPlaneRequestSchema.safeParse({
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "request_agent_activity_sync",
        payload: {
          reason: "project_connection_disconnected",
        },
      }).success
    ).toBe(true);
    expect(
      openMeldDaemonControlPlaneResponseSchema.safeParse({
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        code: "service.agent_activity_sync_requested",
        payload: { accepted: true },
      }).success
    ).toBe(true);
  });

  it("accepts set profile workspace request envelope", () => {
    const result = openMeldDaemonControlPlaneRequestSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      command: "set_profile_workspace",
      payload: {
        targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
        workspaceMode: "custom",
        workspacePath: "/Users/felix/Desktop/work/openmeld",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts health response envelope", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      requestId: "req-3",
      code: "service.health",
      payload: {
        state: "ok",
        runtimeState: "healthy",
        reasonCode: "ok",
        checkedAt: "2026-02-25T12:00:00.000Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts cancel response envelope", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.cancel",
      payload: {
        accepted: true,
        note: "force_interrupt_fallback",
        resolvedDispatchId: "dispatch-1",
        resolvedRuntimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
        resolvedTaskId: "task-1",
        reasonCode: "adapter.cancel.accepted",
        target: {
          by: "dispatch",
          dispatchId: "dispatch-1",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts conversation execution status response envelope", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.conversation_execution_status",
      payload: {
        agentContextLookupKey:
          "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
        controllerLaunchStatus: "ready",
        executionState: {
          activeContextId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
          agentContextLookupKey:
            "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
          dispatchesSinceBootstrapApplied: 0,
          lastRuntimeWorkspacePath: "/tmp/workspace",
          runtimeWorkspaceFingerprint: "sha256:workspace-a",
          updatedAt: "2026-04-14T09:38:43.482Z",
        },
        localRuntimeContext: {
          agentContextLookupKey:
            "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
          runtimeWorkspaceFingerprint: "sha256:workspace-a",
          status: "ready",
        },
        providerConversationProof: {
          agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
          checkedAt: "2026-04-14T09:38:43.482Z",
          errorCode: null,
          errorMessage: null,
          errorType: null,
          expiresAt: "2026-04-14T09:48:43.482Z",
          intrusive: false,
          method: "codex_app_server_thread_resume",
          provider: "codex",
          status: "passed",
          transportMode: "codex-app-server",
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
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts sync route catalog response envelope", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.sync_route_catalog",
      payload: {
        accepted: true,
        addedProfileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
        keptProfileIds: [],
        profileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
        removedProfileIds: [],
        skippedProfiles: [
          {
            profileId: "agt_a13fbe53-0dfc-42c0-99fb-a0c2609cecec",
            profileName: "Codex",
            skipReason: "workspace.missing",
          },
        ],
        syncStatus: "changed",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts set profile workspace response envelope", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.set_profile_workspace",
      payload: {
        accepted: true,
        targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
        status: "updated",
        workspaceMode: "custom",
        workspacePath: "/Users/felix/Desktop/work/openmeld",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts sync route catalog response when an unchanged catalog was re-registered", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.sync_route_catalog",
      payload: {
        accepted: true,
        keptProfileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
        profileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
        syncStatus: "registered",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects legacy providerResumeProbe field names in conversation execution status", () => {
    const result = openMeldDaemonControlPlaneResponseSchema.safeParse({
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      code: "service.conversation_execution_status",
      payload: {
        agentContextLookupKey: "lookup-key",
        controllerLaunchStatus: "ready",
        executionState: null,
        providerResumeProbe: {
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
        workspaceRuntime: {
          configPath: "/tmp/workspace.json",
          configuredWorkspacePath: "/tmp/workspace",
          effectiveRuntimeWorkingDirectory: "/tmp/workspace",
          runtimeContext: {
            providerRuntimeWorkingDirectory: "/tmp/workspace",
          },
          status: "ready",
          workspaceMode: "openmeld_managed",
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
