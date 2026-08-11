import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTargetState } from "../src/agents/registry";
import { runProfileCreate } from "../src/commands/profile";

const cancelMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const createPresenterMock = vi.hoisted(() => vi.fn());
const resolveCreateProfileKindMock = vi.hoisted(() => vi.fn());
const resolveCreateProfileNameMock = vi.hoisted(() => vi.fn());
const createProfileByKindMock = vi.hoisted(() => vi.fn());
const resolveAgentProfileSetupMock = vi.hoisted(() => vi.fn());
const persistAgentTransportSelectionMock = vi.hoisted(() => vi.fn());
const ensureOpenMeldManagedProfileWorkspaceMock = vi.hoisted(() => vi.fn());
const setSelectedOpenMeldProfileIdMock = vi.hoisted(() => vi.fn());
const renderInfoCardMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const listAgentTargetStatesMock = vi.hoisted(() => vi.fn());

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

function createBuiltinAgentTargetState(
  overrides: Partial<AgentTargetState> = {}
): AgentTargetState {
  const agentId = overrides.agentId ?? "codex";
  const displayName = overrides.displayName ?? "Codex";
  return {
    agentId,
    displayName,
    targetKind: "builtin",
    detected: true,
    lifecycleStatus: "active",
    runtimeSupported: true,
    transportModes: [
      {
        mode: "local-cli",
        label: "Local CLI",
        description: "Run through the local CLI on this computer.",
      },
    ],
    defaultTransportMode: "local-cli",
    contextIdMappingSpec: {
      mappingVersion: 1,
      sourceField: "OPENMELD_AGENT_CONTROLLER_CONVERSATION_ID",
    },
    selectable: true,
    selectableReason: null,
    installChoices: [],
    launchStatus: "ready",
    launchStatusDetail: null,
    launchContract: {
      kind: "executable",
      commandPath: `/usr/local/bin/${agentId}`,
    },
    registered: true,
    enabled: true,
    registration: null,
    ...overrides,
  };
}

vi.mock("@clack/prompts", () => ({
  cancel: (...args: unknown[]) => cancelMock(...args),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: (...args: unknown[]) =>
    resolveRuntimeContextMock(...args),
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: (...args: unknown[]) => createPresenterMock(...args),
}));

vi.mock("../src/profile/create-flow", () => ({
  resolveCreateProfileKind: (...args: unknown[]) =>
    resolveCreateProfileKindMock(...args),
  resolveCreateProfileName: (...args: unknown[]) =>
    resolveCreateProfileNameMock(...args),
  createProfileByKind: (...args: unknown[]) => createProfileByKindMock(...args),
}));

vi.mock("../src/profile/agent-setup-flow", () => ({
  resolveAgentProfileSetup: (...args: unknown[]) =>
    resolveAgentProfileSetupMock(...args),
  persistAgentTransportSelection: (...args: unknown[]) =>
    persistAgentTransportSelectionMock(...args),
}));

vi.mock("../src/profile-workspace/service", () => ({
  ensureOpenMeldManagedProfileWorkspace: (...args: unknown[]) =>
    ensureOpenMeldManagedProfileWorkspaceMock(...args),
  setOpenMeldManagedProfileWorkspace: vi.fn(),
  setCustomProfileWorkspace: vi.fn(),
}));

vi.mock("../src/agents/registry", () => ({
  listAgentTargetStates: (...args: unknown[]) =>
    listAgentTargetStatesMock(...args),
}));

vi.mock("../src/config/openmeld-profile-selection", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profile-selection")
  >("../src/config/openmeld-profile-selection");
  return {
    ...actual,
    setSelectedOpenMeldProfileId: (...args: unknown[]) =>
      setSelectedOpenMeldProfileIdMock(...args),
  };
});

vi.mock("../src/runtime/agent-profile-state", () => ({
  resolveAgentProfileRuntimeState: vi.fn(async () => ({
    transportMode: "local-cli",
    replyReadiness: "blocked",
    replyReadinessLabel: "blocked (local agent connection is missing)",
    replyReadinessReasonCodes: ["profile.unbound"],
    replyReadinessReasonText: "local agent connection is missing",
    autoReplyReady: false,
    autoReplyReason: "local agent connection is missing",
  })),
  buildAgentProfileRuntimeRows: vi.fn(() => []),
  buildAgentProfileStateRows: vi.fn(() => []),
  buildAgentProfileRuntimeData: vi.fn(() => ({})),
  buildAgentProfileStateData: vi.fn(() => ({})),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: (input: {
    resolvedView: string;
    interactive: boolean;
  }) => input.resolvedView === "human" && input.interactive,
}));

vi.mock("../src/ui/info-card", async () => {
  const actual = await vi.importActual<typeof import("../src/ui/info-card")>(
    "../src/ui/info-card"
  );
  return {
    ...actual,
    renderInfoCard: (...args: unknown[]) => renderInfoCardMock(...args),
  };
});

describe("profile create + shared agent setup integration", () => {
  const presenter = {
    line: vi.fn(),
    data: vi.fn(),
    event: vi.fn(),
  };

  beforeEach(() => {
    resolveRuntimeContextMock.mockReset();
    createPresenterMock.mockReset();
    resolveCreateProfileKindMock.mockReset();
    resolveCreateProfileNameMock.mockReset();
    createProfileByKindMock.mockReset();
    resolveAgentProfileSetupMock.mockReset();
    persistAgentTransportSelectionMock.mockReset();
    ensureOpenMeldManagedProfileWorkspaceMock
      .mockReset()
      .mockResolvedValue({ workspacePath: "/tmp/openmeld-managed-workspace" });
    setSelectedOpenMeldProfileIdMock.mockReset();
    cancelMock.mockReset();
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    listAgentTargetStatesMock
      .mockReset()
      .mockResolvedValue([createBuiltinAgentTargetState()]);
    setSelectedOpenMeldProfileIdMock.mockResolvedValue({
      persistent: false,
    });
    renderInfoCardMock.mockReset();
    presenter.line.mockReset();
    presenter.data.mockReset();
    presenter.event.mockReset();

    createPresenterMock.mockReturnValue(presenter);
  });

  it("uses shared agent setup in human interactive create and passes the local-agent selection into creation", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: true,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "New Agent",
    });
    resolveAgentProfileSetupMock.mockResolvedValue({
      status: "configured",
      agentControllerRef: "builtin:codex",
      controllerDisplayName: "Codex",
      transportMode: "local-cli",
      responsePolicy: "mention_only",
      selectionMode: "interactive",
    });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_new_agent",
      profileName: "New Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      view: "human",
    });

    expect(resolveAgentProfileSetupMock).toHaveBeenCalledWith({
      interactive: true,
      useAutoSelectionWhenNonInteractive: false,
      selectControllerMessage: "Choose an agent controller for this profile.",
      selectTransportModeMessage:
        "How should this profile connect to its agent controller?",
      selectResponsePolicyMessage: "When should this profile auto-reply?",
      skipControllerOptionLabel: "Skip for now",
      allowBackToCaller: true,
    });
    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "New Agent",
      profileKind: "agent",
      localAgentSelection: {
        controllerEnabled: true,
        agentControllerRef: "builtin:codex",
      },
    });
    expect(persistAgentTransportSelectionMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      transportMode: "local-cli",
    });
    expect(ensureOpenMeldManagedProfileWorkspaceMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt_new_agent",
    });
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "agt_new_agent"
    );
  });

  it("keeps non-interactive create behavior unchanged for agent profiles", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: false,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Script Agent",
    });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_script_agent",
      profileName: "Script Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      kind: "agent",
      profileName: "Script Agent",
      view: "human",
    });

    expect(resolveAgentProfileSetupMock).not.toHaveBeenCalled();
    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Script Agent",
      profileKind: "agent",
    });
    expect(persistAgentTransportSelectionMock).not.toHaveBeenCalled();
    expect(ensureOpenMeldManagedProfileWorkspaceMock).not.toHaveBeenCalled();
  });

  it("passes explicit model selection flags into non-interactive agent creation", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: false,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Script Agent",
    });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_script_agent",
      profileName: "Script Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      agentController: "builtin:codex",
      kind: "agent",
      model: "gpt-5.4-mini",
      profileName: "Script Agent",
      reasoningEffort: "medium",
      view: "human",
    });

    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Script Agent",
      profileKind: "agent",
      localAgentSelection: {
        agentControllerRef: "builtin:codex",
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      },
    });
    expect(ensureOpenMeldManagedProfileWorkspaceMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt_script_agent",
    });
  });

  it("passes explicit Agent Controller Permission Mode flags into non-interactive agent creation", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: false,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Trusted Agent",
    });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_trusted_agent",
      profileName: "Trusted Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      agentController: "builtin:codex",
      agentControllerPermissionModeInput: "approve-for-me",
      kind: "agent",
      profileName: "Trusted Agent",
      view: "human",
    });

    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Trusted Agent",
      profileKind: "agent",
      localAgentSelection: {
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
      },
    });
    expect(ensureOpenMeldManagedProfileWorkspaceMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt_trusted_agent",
    });
  });

  it("allows launch-ready builtin controllers before they are registered or enabled", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: false,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Disabled Agent",
    });
    listAgentTargetStatesMock.mockResolvedValue([
      createBuiltinAgentTargetState({
        agentId: "codex",
        enabled: false,
        registered: false,
      }),
    ]);
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_disabled_agent",
      profileName: "Disabled Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      agentController: "builtin:codex",
      kind: "agent",
      profileName: "Disabled Agent",
      view: "human",
    });

    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Disabled Agent",
      profileKind: "agent",
      localAgentSelection: {
        agentControllerRef: "builtin:codex",
      },
    });
  });

  it("rejects explicit builtin controllers that are not launch-ready", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: false,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Repair Agent",
    });
    listAgentTargetStatesMock.mockResolvedValue([
      createBuiltinAgentTargetState({
        agentId: "codex",
        launchContract: null,
        launchStatus: "needs_repair",
      }),
    ]);

    await expect(
      runProfileCreate({
        agentController: "builtin:codex",
        kind: "agent",
        profileName: "Repair Agent",
        view: "human",
      })
    ).rejects.toThrow(
      "Built-in agent controller 'builtin:codex' is not runnable"
    );

    expect(createProfileByKindMock).not.toHaveBeenCalled();
  });

  it("cancels create when shared agent setup is cancelled", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: true,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Cancelled Agent",
    });
    resolveAgentProfileSetupMock.mockResolvedValue({
      status: "cancelled",
    });

    await runProfileCreate({
      view: "human",
    });

    expect(createProfileByKindMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("re-prompts profile kind when the shared name step goes back", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: true,
    });
    resolveCreateProfileKindMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "agent",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "human",
      });
    resolveCreateProfileNameMock
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Retried Human",
      });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "hum_retried_human",
      profileName: "Retried Human",
      profileKind: "human",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      view: "human",
    });

    expect(resolveCreateProfileKindMock).toHaveBeenCalledTimes(2);
    expect(resolveCreateProfileNameMock).toHaveBeenCalledTimes(2);
    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Retried Human",
      profileKind: "human",
    });
  });

  it("re-prompts profile name when the shared agent setup goes back", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      interactive: true,
    });
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "First Agent",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Second Agent",
      });
    resolveAgentProfileSetupMock
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "skipped_by_user",
      });
    createProfileByKindMock.mockResolvedValue({
      openMeldProfileId: "agt_second_agent",
      profileName: "Second Agent",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });

    await runProfileCreate({
      view: "human",
    });

    expect(resolveCreateProfileNameMock).toHaveBeenCalledTimes(2);
    expect(resolveAgentProfileSetupMock).toHaveBeenCalledTimes(2);
    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileName: "Second Agent",
      profileKind: "agent",
    });
  });
});
