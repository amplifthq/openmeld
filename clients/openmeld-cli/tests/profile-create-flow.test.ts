import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOpenMeldAgentProfileMock,
  createOpenMeldHumanProfileMock,
  ensureAgentProfileRuntimeBindingMock,
  resolveOpenMeldProfileOrNullMock,
  resolveLocalAgentControllerReportInputMock,
  submitRuntimeAgentControllerReportMock,
} = vi.hoisted(() => ({
  createOpenMeldAgentProfileMock: vi.fn(),
  createOpenMeldHumanProfileMock: vi.fn(),
  ensureAgentProfileRuntimeBindingMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveLocalAgentControllerReportInputMock: vi.fn(),
  submitRuntimeAgentControllerReportMock: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  createOpenMeldAgentProfile: createOpenMeldAgentProfileMock,
  createOpenMeldHumanProfile: createOpenMeldHumanProfileMock,
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  ensureAgentProfileRuntimeBinding: ensureAgentProfileRuntimeBindingMock,
}));

vi.mock(
  "../src/local-service/reporting/local-agent-controller-report-resolution",
  () => ({
    resolveLocalAgentControllerReportInput:
      resolveLocalAgentControllerReportInputMock,
  })
);

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    submitRuntimeAgentControllerReport: submitRuntimeAgentControllerReportMock,
  })
);

const CREATED_AGENT_PROFILE = {
  openMeldProfileId: "agt-codex",
  profileName: "Codex",
  profileHandle: "codex",
  profileKind: "agent",
  ownerUserId: "user-1",
  source: "test",
  status: "active",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

describe("profile create flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveOpenMeldProfileOrNullMock.mockResolvedValue({
      openMeldProfileId: "hum-creator",
    });
    createOpenMeldAgentProfileMock.mockResolvedValue(CREATED_AGENT_PROFILE);
    createOpenMeldHumanProfileMock.mockResolvedValue({
      ...CREATED_AGENT_PROFILE,
      openMeldProfileId: "hum-new",
      profileKind: "human",
      localAgentSelection: undefined,
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
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
  });

  it("syncs Core primary Binding truth after creating a runnable local agent profile", async () => {
    const { createProfileByKind } = await import("../src/profile/create-flow");

    const profile = await createProfileByKind({
      profileKind: "agent",
      profileName: "Codex",
      localAgentSelection: {
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      },
    });

    expect(profile).toBe(CREATED_AGENT_PROFILE);
    expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
      profileName: "Codex",
      creatorProfileId: "hum-creator",
    });
    expect(submitRuntimeAgentControllerReportMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      diagnosticProfileId: "agt-codex",
      localParticipationState: "ready",
      reasonCodes: ["runtime.agent_controller_report.ready"],
    });
    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith({
      confirmLocalExecutionEvidence: false,
      profile: CREATED_AGENT_PROFILE,
      runtimeReportSubmission: expect.objectContaining({
        agentControllerRef: "builtin:codex",
        status: "submitted",
      }),
    });
  });

  it("passes model selection intent into the created Agent Profile Binding", async () => {
    const { createProfileByKind } = await import("../src/profile/create-flow");

    await createProfileByKind({
      profileKind: "agent",
      profileName: "Codex",
      localAgentSelection: {
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      },
    });

    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      })
    );
  });

  it("passes Agent Controller Permission Mode intent into the created Agent Profile Binding", async () => {
    const { createProfileByKind } = await import("../src/profile/create-flow");

    await createProfileByKind({
      profileKind: "agent",
      profileName: "Codex",
      localAgentSelection: {
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
      },
    });

    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerPermissionMode: "codex:approveForMe",
      })
    );
  });

  it("does not sync Runtime Binding truth for human profile creation", async () => {
    const { createProfileByKind } = await import("../src/profile/create-flow");

    await createProfileByKind({
      profileKind: "human",
      profileName: "Felix",
    });

    expect(createOpenMeldHumanProfileMock).toHaveBeenCalledWith({
      profileName: "Felix",
      creatorProfileId: "hum-creator",
    });
    expect(submitRuntimeAgentControllerReportMock).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
  });
});
