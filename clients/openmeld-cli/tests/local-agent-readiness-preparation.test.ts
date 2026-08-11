import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  persistAgentTransportSelectionMock,
  resolveAgentTargetStateMock,
  resolveAgentProfileSetupMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
  resolveCurrentReplyReadinessSnapshotMock,
  runAgentsEnableMock,
  runAgentsRepairMock,
  runDoctorMock,
  ensureAgentProfileRuntimeBindingMock,
  resolveLocalAgentControllerReportInputMock,
  syncDeviceRuntimeStateProjectionMock,
  syncProfileWorkspaceStateMock,
  submitRuntimeAgentControllerReportMock,
  updateOpenMeldProfileMock,
} = vi.hoisted(() => ({
  persistAgentTransportSelectionMock: vi.fn(),
  resolveAgentTargetStateMock: vi.fn(),
  resolveAgentProfileSetupMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
  runAgentsEnableMock: vi.fn(),
  runAgentsRepairMock: vi.fn(),
  runDoctorMock: vi.fn(),
  ensureAgentProfileRuntimeBindingMock: vi.fn(),
  resolveLocalAgentControllerReportInputMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
  syncProfileWorkspaceStateMock: vi.fn(),
  submitRuntimeAgentControllerReportMock: vi.fn(),
  updateOpenMeldProfileMock: vi.fn(),
}));

vi.mock("../src/agents/registry", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/registry")>(
    "../src/agents/registry"
  );
  return {
    ...actual,
    resolveAgentTargetState: resolveAgentTargetStateMock,
  };
});

vi.mock("../src/profile/agent-setup-flow", () => ({
  persistAgentTransportSelection: persistAgentTransportSelectionMock,
  resolveAgentProfileSetup: resolveAgentProfileSetupMock,
}));

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    updateOpenMeldProfile: updateOpenMeldProfileMock,
  };
});

vi.mock("../src/system/current-reply-readiness-snapshot", () => ({
  resolveCurrentReplyReadinessSnapshot:
    resolveCurrentReplyReadinessSnapshotMock,
}));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  syncDeviceRuntimeStateProjection: syncDeviceRuntimeStateProjectionMock,
}));

vi.mock(
  "../src/local-service/reporting/local-agent-controller-report-resolution",
  () => ({
    resolveLocalAgentControllerReportInput:
      resolveLocalAgentControllerReportInputMock,
  })
);

vi.mock("../src/system/profile-workspace-state", () => ({
  syncProfileWorkspaceState: syncProfileWorkspaceStateMock,
}));

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  ensureAgentProfileRuntimeBinding: ensureAgentProfileRuntimeBindingMock,
}));

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    submitRuntimeAgentControllerReport: submitRuntimeAgentControllerReportMock,
  })
);

vi.mock("../src/commands/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/agents")>(
    "../src/commands/agents"
  );
  return {
    ...actual,
    runAgentsEnable: runAgentsEnableMock,
    runAgentsRepair: runAgentsRepairMock,
  };
});

vi.mock("../src/commands/doctor", () => ({
  runDoctor: runDoctorMock,
}));

const BASE_AGENT_PROFILE = {
  openMeldProfileId: "agt-codex",
  profileName: "Codex",
  profileHandle: "codex",
  profileKind: "agent",
  ownerUserId: "user-1",
  source: "cli_test",
  status: "active",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-04-17T00:00:00.000Z",
  updatedAt: "2026-04-17T00:00:00.000Z",
} as const;

describe("local agent readiness preparation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    resolveAgentProfileSetupMock.mockResolvedValue({
      status: "configured",
      agentControllerRef: "builtin:codex",
      transportMode: "codex-app-server",
    });
    resolveAgentTargetStateMock.mockResolvedValue({
      agentId: "codex",
      displayName: "Codex",
      lifecycleStatus: "active",
      selectable: true,
      targetKind: "builtin",
    });
    updateOpenMeldProfileMock.mockResolvedValue(BASE_AGENT_PROFILE);
    persistAgentTransportSelectionMock.mockResolvedValue(undefined);
    syncDeviceRuntimeStateProjectionMock.mockResolvedValue(undefined);
    syncProfileWorkspaceStateMock.mockResolvedValue({
      invalidWorkspaceProfileIds: [],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: "repair",
      projectedProfileIds: ["agt-codex"],
      provisionedProfileIds: [],
      reason: "projected agent profile workspaces look good",
      status: "ok",
    });
    resolveLocalAgentControllerReportInputMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      diagnosticProfileId: "agt-codex",
      localParticipationState: "ready",
      reasonCodes: ["runtime.agent_controller_report.ready"],
    });
    submitRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "reused",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    ensureAgentProfileRuntimeBindingMock.mockResolvedValue({
      outcome: "created",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValue({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      primaryBinding: null,
      reasonCodes: [],
      routable: true,
    });
    runAgentsEnableMock.mockResolvedValue({
      status: "completed",
      summary: {
        allMode: false,
        requested: ["codex"],
        registered: [],
        reenabled: ["codex"],
        skipped: [],
        errors: [],
      },
    });
    runAgentsRepairMock.mockResolvedValue({
      status: "completed",
      summary: {
        allMode: false,
        requested: ["codex"],
        repaired: ["codex"],
        skipped: [],
        errors: [],
      },
    });
    runDoctorMock.mockResolvedValue(undefined);
  });

  it("sets up controller binding when the profile is still unbound", async () => {
    resolveCurrentReplyReadinessSnapshotMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["profile.unbound"],
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: [],
        },
      });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [
        {
          ...BASE_AGENT_PROFILE,
        },
      ],
      interactive: true,
      view: "human",
    });

    expect(resolveAgentProfileSetupMock).toHaveBeenCalledTimes(1);
    expect(submitRuntimeAgentControllerReportMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      diagnosticProfileId: "agt-codex",
      localParticipationState: "ready",
      reasonCodes: ["runtime.agent_controller_report.ready"],
    });
    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith({
      profile: BASE_AGENT_PROFILE,
      runtimeReportSubmission: expect.objectContaining({
        agentControllerRef: "builtin:codex",
        status: "submitted",
      }),
    });
    expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
    expect(persistAgentTransportSelectionMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      transportMode: "codex-app-server",
    });
    expect(result.status).toBe("prepared");
  });

  it("reconnects an explicit local agent without replaying cached Binding settings", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValue({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      primaryBinding: {
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:customConfig",
        executionTarget: {
          agentControllerConversationId: "codex-thread-existing",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_previous",
          },
        },
        modelSelection: {
          modelId: "gpt-5.6-sol",
          reasoningLevel: "ultra",
        },
      },
      reasonCodes: [],
      routable: true,
    });
    resolveCurrentReplyReadinessSnapshotMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: ["profile.unbound"],
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          reasonCodes: [],
        },
      });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      explicitLocalAgentSelections: new Map([["agt-codex", "codex"]]),
      profiles: [BASE_AGENT_PROFILE],
      interactive: false,
      view: "agent",
    });

    expect(resolveAgentProfileSetupMock).not.toHaveBeenCalled();
    expect(submitRuntimeAgentControllerReportMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      diagnosticProfileId: "agt-codex",
      localParticipationState: "ready",
      reasonCodes: ["runtime.agent_controller_report.ready"],
    });
    expect(
      resolveAgentProfilePrimaryAgentControllerReportMock
    ).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith({
      confirmLocalExecutionEvidence: false,
      profile: BASE_AGENT_PROFILE,
      runtimeReportSubmission: expect.objectContaining({
        agentControllerRef: "builtin:codex",
        status: "submitted",
      }),
      writeMode: "reconnect",
    });
    expect(persistAgentTransportSelectionMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      transportMode: "codex-app-server",
    });
    expect(result.status).toBe("prepared");
    expect(result.preparedConnections).toEqual([
      expect.objectContaining({
        agentProfileBindingEnsure: expect.objectContaining({
          status: "accepted",
        }),
        profileId: "agt-codex",
        runtimeReport: expect.objectContaining({
          agentControllerRef: "builtin:codex",
          localParticipationState: "ready",
          runtimeReportSubmission: expect.objectContaining({
            status: "submitted",
            openMeldServiceRuntimeId: "runtime_opaque_1",
          }),
        }),
      }),
    ]);
  });

  it("rejects an explicit suspended local agent for new profile binding", async () => {
    resolveAgentTargetStateMock.mockResolvedValueOnce({
      agentId: "openclaw",
      displayName: "OpenClaw",
      lifecycleStatus: "suspended",
      selectable: true,
      targetKind: "builtin",
    });
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: ["profile.unbound"],
      },
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    await expect(
      prepareLocalAgentReadiness({
        explicitLocalAgentSelections: new Map([["agt-codex", "openclaw"]]),
        profiles: [BASE_AGENT_PROFILE],
        interactive: false,
        view: "agent",
      })
    ).rejects.toThrow(
      "OpenMeld no longer offers OpenClaw for new Agent Profiles."
    );
    expect(submitRuntimeAgentControllerReportMock).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
    expect(persistAgentTransportSelectionMock).not.toHaveBeenCalled();
  });

  it("repairs missing projection and workspace state in a single readiness pass", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: ["projection.missing", "workspace.missing"],
      },
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [BASE_AGENT_PROFILE],
      interactive: true,
      view: "human",
    });

    expect(syncDeviceRuntimeStateProjectionMock).toHaveBeenCalledWith({
      mode: "repair",
    });
    expect(syncProfileWorkspaceStateMock).toHaveBeenCalledWith({
      mode: "repair",
      profileIds: ["agt-codex"],
    });
    expect(result.status).toBe("prepared");
  });

  it("repairs profile workspace when service readiness masks workspace state at the device layer", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      agentReplyReadiness: {
        reasonCodes: ["workspace.missing", "service.not_running"],
      },
      deviceReplyReadiness: {
        reasonCodes: ["service.not_running"],
      },
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [BASE_AGENT_PROFILE],
      interactive: true,
      view: "human",
    });

    expect(syncProfileWorkspaceStateMock).toHaveBeenCalledWith({
      mode: "repair",
      profileIds: ["agt-codex"],
    });
    expect(result.status).toBe("prepared");
  });

  it("does not report prepared when workspace.invalid remains blocked after repair", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: ["workspace.invalid"],
      },
    });
    syncProfileWorkspaceStateMock.mockResolvedValue({
      invalidWorkspaceProfileIds: ["agt-codex"],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: "repair",
      projectedProfileIds: ["agt-codex"],
      provisionedProfileIds: [],
      reason:
        "one or more projected agent profiles have invalid local workspaces",
      status: "degraded",
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [BASE_AGENT_PROFILE],
      interactive: true,
      view: "human",
    });

    expect(result.status).toBe("unchanged");
  });

  it("does not report prepared when workspace repair was skipped before touching the profile", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: ["workspace.missing"],
      },
    });
    syncProfileWorkspaceStateMock.mockResolvedValue({
      invalidWorkspaceProfileIds: [],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: "repair",
      projectedProfileIds: [],
      provisionedProfileIds: [],
      reason:
        "sign in is required before OpenMeld can check profile workspaces",
      status: "skipped",
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [BASE_AGENT_PROFILE],
      interactive: true,
      view: "human",
    });

    expect(result.status).toBe("unchanged");
  });

  it("resolves an interactive install choice before continuing profile preparation", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [
          "controller.launch.choice_required",
          "service.gateway_chain_unhealthy",
        ],
      },
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    const result = await prepareLocalAgentReadiness({
      profiles: [BASE_AGENT_PROFILE],
      interactive: true,
      view: "human",
    });

    expect(runAgentsEnableMock).toHaveBeenCalledWith({
      agent: ["codex"],
      interactive: true,
      view: "human",
    });
    expect(runAgentsRepairMock).not.toHaveBeenCalled();
    expect(runDoctorMock).not.toHaveBeenCalled();
    expect(result.status).toBe("prepared");
  });

  it("stops non-interactive prepare with concrete install-choice commands", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [
          "controller.launch.choice_required",
          "service.gateway_chain_unhealthy",
        ],
      },
    });
    runAgentsEnableMock.mockResolvedValueOnce({
      status: "completed",
      summary: {
        allMode: false,
        requested: ["codex"],
        registered: [],
        reenabled: [],
        skipped: [],
        errors: [
          {
            agentId: "codex",
            code: "controller.launch.choice_required",
            humanActionRequired: true,
            installChoices: [
              {
                commandPath: "/opt/homebrew/bin/codex",
                detail: "/opt/homebrew/bin/codex",
                installId: "homebrew-codex",
                label: "Codex 0.130.0",
                launchContract: {
                  kind: "executable",
                  commandPath: "/opt/homebrew/bin/codex",
                },
              },
            ],
            nextSteps: [
              "openmeld agents enable --agent codex --install homebrew-codex",
            ],
            reason:
              "OpenMeld found more than one Codex install on this computer.",
            summary:
              "OpenMeld needs one install choice on this Mac before it can continue.",
          },
        ],
      },
    });

    const { prepareLocalAgentReadiness } = await import(
      "../src/system/local-agent-readiness-preparation"
    );

    await expect(
      prepareLocalAgentReadiness({
        profiles: [BASE_AGENT_PROFILE],
        interactive: false,
        view: "agent",
      })
    ).rejects.toThrow(
      "OpenMeld found more than one Codex install on this computer. Run one of these commands first: `openmeld agents enable --agent codex --install homebrew-codex`."
    );
    expect(runDoctorMock).not.toHaveBeenCalled();
  });
});
