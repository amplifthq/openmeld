import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentProfileRuntimeRows,
  resolveAgentProfileRuntimeState,
} from "../src/runtime/agent-profile-state";

const { resolveCurrentReplyReadinessSnapshotMock, primaryBindingMock } =
  vi.hoisted(() => ({
    resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
    primaryBindingMock: vi.fn(),
  }));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport: primaryBindingMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  primaryBindingMock.mockResolvedValue(null);
});

vi.mock("../src/system/current-reply-readiness-snapshot", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/current-reply-readiness-snapshot")
  >("../src/system/current-reply-readiness-snapshot");
  return {
    ...actual,
    resolveCurrentReplyReadinessSnapshot:
      resolveCurrentReplyReadinessSnapshotMock,
  };
});

describe("agent profile runtime state", () => {
  it("does not run workstation diagnostics for a hosted Binding", async () => {
    primaryBindingMock.mockResolvedValue({
      capabilityKind: "hosted:remote-agent",
      agentControllerRef: "hosted:remote-agent",
    });
    const state = await resolveAgentProfileRuntimeState({
      openMeldProfileId: "agt_remote",
      profileKind: "agent",
    } as never);
    expect(state).toBeNull();
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
    expect(buildAgentProfileRuntimeRows(state)).toEqual([]);
  });
  it("keeps daemon route evidence diagnostic-only when local reply setup is ready", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      agentReplyReadiness: {
        localAgentId: "codex",
        reasonCodes: [],
        reasonText: "This profile can reply from Space when mentioned",
        replyReadiness: "ready",
        transportMode: "local-cli",
      },
      daemonRouteObservation: {
        detail:
          "Server can't currently see an active reply route for this agent profile.",
        observedAt: "2026-05-31T00:00:00.000Z",
        profileId: "agt_codex",
        reasonCode: "route.not_registered",
        route: {
          online: false,
          reasonCode: "daemon.profile.offline",
        },
        status: "offline",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: null,
    });

    const state = await resolveAgentProfileRuntimeState({
      openMeldProfileId: "agt_codex",
      ownerUserId: "user_1",
      profileKind: "agent",
      profileName: "Codex",
    } as never);

    expect(state?.replyReadiness).toBe("ready");
    expect(state?.replyReadinessLabel).toBe("Can reply");
    expect(state?.replyReadinessReasonCodes).toEqual([]);
    expect(buildAgentProfileRuntimeRows(state)).toContainEqual({
      label: "Can Reply in Space",
      value: "Can reply",
    });
    expect(buildAgentProfileRuntimeRows(state)).toContainEqual({
      label: "Server Can Reach This Device",
      value:
        "Offline — OpenMeld server can't currently see an active reply route for this profile.",
    });
  });
});
