import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  canUseInteractivePromptsMock,
  collectStartReadinessSnapshotMock,
  createPresenterMock,
  emitStartAgentOverviewMock,
  emitStartCompatibilityNoticeMock,
  emitStartReadinessSnapshotMock,
  emitStartRecapMock,
  emitStartSelectionPersistenceWarningMock,
  emitStartSetupHintMock,
  ensureStartAgentIdentityPreflightMock,
  ensureStartAuthenticationMock,
  markStartV1CompletedMock,
  renderSelectedProfileMock,
  renderStartWelcomeMock,
  resolveBaseUrlMock,
  resolveRuntimeContextMock,
  resolveStartSelectedProfileMock,
  runStartDisclaimerStepMock,
  runStartSpaceEntryActionMock,
  setConfiguredBaseUrlMock,
  setSelectedOpenMeldProfileIdMock,
  shouldEnsureDefaultHumanProfileMock,
} = vi.hoisted(() => ({
  canUseInteractivePromptsMock: vi.fn(),
  collectStartReadinessSnapshotMock: vi.fn(),
  createPresenterMock: vi.fn(),
  emitStartAgentOverviewMock: vi.fn(),
  emitStartCompatibilityNoticeMock: vi.fn(),
  emitStartReadinessSnapshotMock: vi.fn(),
  emitStartRecapMock: vi.fn(),
  emitStartSelectionPersistenceWarningMock: vi.fn(),
  emitStartSetupHintMock: vi.fn(),
  ensureStartAgentIdentityPreflightMock: vi.fn(),
  ensureStartAuthenticationMock: vi.fn(),
  markStartV1CompletedMock: vi.fn(),
  renderSelectedProfileMock: vi.fn(),
  renderStartWelcomeMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  resolveStartSelectedProfileMock: vi.fn(),
  runStartDisclaimerStepMock: vi.fn(),
  runStartSpaceEntryActionMock: vi.fn(),
  setConfiguredBaseUrlMock: vi.fn(),
  setSelectedOpenMeldProfileIdMock: vi.fn(),
  shouldEnsureDefaultHumanProfileMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
}));

vi.mock("../src/config/openmeld-profile-selection", () => ({
  setSelectedOpenMeldProfileId: setSelectedOpenMeldProfileIdMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/config/runtime-config", () => ({
  setConfiguredBaseUrl: setConfiguredBaseUrlMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: resolveRuntimeContextMock,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: canUseInteractivePromptsMock,
}));

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: createPresenterMock,
}));

vi.mock("../src/system/current-reply-readiness-snapshot", () => ({
  resolveCurrentReplyReadinessSnapshot: vi.fn(),
}));

vi.mock("../src/system/reply-readiness", () => ({
  formatAgentReplyReadinessLabel: vi.fn(() => "Ready"),
}));

vi.mock("../src/ui/brand", () => ({
  renderOpenMeldHeader: vi.fn(() => "OpenMeld"),
}));

vi.mock("../src/ui/info-card", () => ({
  renderInfoCard: vi.fn(),
}));

vi.mock("../src/skills/installation-inventory", () => ({
  collectSkillsReadinessSnapshot: vi.fn(),
}));

vi.mock("../src/commands/start-auth-and-readiness", () => ({
  collectStartReadinessSnapshot: collectStartReadinessSnapshotMock,
  emitStartReadinessSnapshot: emitStartReadinessSnapshotMock,
  ensureStartAuthentication: ensureStartAuthenticationMock,
  markStartV1Completed: markStartV1CompletedMock,
  runStartDisclaimerStep: runStartDisclaimerStepMock,
}));

vi.mock("../src/start-shell/notices", () => ({
  emitStartCompatibilityNotice: emitStartCompatibilityNoticeMock,
  emitStartRecap: emitStartRecapMock,
  emitStartSetupHint: emitStartSetupHintMock,
  renderStartWelcome: renderStartWelcomeMock,
}));

vi.mock("../src/commands/start-next-action", () => ({
  runStartSpaceEntryAction: runStartSpaceEntryActionMock,
}));

vi.mock("../src/commands/start-profile-flow", () => ({
  emitStartAgentOverview: emitStartAgentOverviewMock,
  emitStartSelectionPersistenceWarning:
    emitStartSelectionPersistenceWarningMock,
  ensureDefaultHumanProfile: vi.fn(),
  ensureStartAgentIdentityPreflight: ensureStartAgentIdentityPreflightMock,
  renderDefaultHumanProfileCard: vi.fn(),
  renderSelectedProfile: renderSelectedProfileMock,
  resolveStartSelectedProfile: resolveStartSelectedProfileMock,
  shouldEnsureDefaultHumanProfile: shouldEnsureDefaultHumanProfileMock,
}));

import { runStart } from "../src/commands/start";

const DEFAULT_RUNTIME = {
  resolvedView: "human",
} as const;

const DEFAULT_PRESENTER = {
  data: vi.fn(),
  line: vi.fn(),
} as const;

const DEFAULT_AUTHENTICATION = {
  auth: {
    status: "valid",
  },
  session: {
    user: {
      email: "felix@openmeld.invalid",
    },
  },
} as const;

const DEFAULT_READINESS = {
  skills: {
    status: "up_to_date",
    targetCount: 0,
    summary: {
      upToDate: 0,
      outdated: 0,
      missing: 0,
      externalConflict: 0,
    },
  },
  service: {
    status: "installed_current",
  },
} as const;

const DEFAULT_PROFILE = {
  openMeldProfileId: "human-default",
  profileName: "Felix",
  profileKind: "human",
  ownerUserId: "owner-1",
} as const;

const DEFAULT_AGENT_PROFILE = {
  openMeldProfileId: "agt-ready",
  profileName: "Worker",
  profileKind: "agent",
  ownerUserId: "owner-1",
} as const;

describe("start.ts coordinator parity", () => {
  beforeEach(() => {
    canUseInteractivePromptsMock.mockReset();
    collectStartReadinessSnapshotMock.mockReset();
    createPresenterMock.mockReset();
    emitStartAgentOverviewMock.mockReset();
    emitStartCompatibilityNoticeMock.mockReset();
    emitStartReadinessSnapshotMock.mockReset();
    emitStartRecapMock.mockReset();
    emitStartSelectionPersistenceWarningMock.mockReset();
    emitStartSetupHintMock.mockReset();
    ensureStartAgentIdentityPreflightMock.mockReset();
    ensureStartAuthenticationMock.mockReset();
    markStartV1CompletedMock.mockReset();
    renderSelectedProfileMock.mockReset();
    renderStartWelcomeMock.mockReset();
    resolveBaseUrlMock.mockReset();
    resolveRuntimeContextMock.mockReset();
    resolveStartSelectedProfileMock.mockReset();
    runStartDisclaimerStepMock.mockReset();
    runStartSpaceEntryActionMock.mockReset();
    setConfiguredBaseUrlMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockReset();
    shouldEnsureDefaultHumanProfileMock.mockReset();

    canUseInteractivePromptsMock.mockReturnValue(true);
    collectStartReadinessSnapshotMock.mockResolvedValue(DEFAULT_READINESS);
    createPresenterMock.mockReturnValue(DEFAULT_PRESENTER);
    ensureStartAuthenticationMock.mockResolvedValue(DEFAULT_AUTHENTICATION);
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.invalid");
    resolveRuntimeContextMock.mockResolvedValue(DEFAULT_RUNTIME);
    resolveStartSelectedProfileMock.mockResolvedValue(DEFAULT_PROFILE);
    runStartDisclaimerStepMock.mockResolvedValue(true);
    runStartSpaceEntryActionMock.mockResolvedValue("completed");
    setSelectedOpenMeldProfileIdMock.mockResolvedValue({
      persistent: false,
      cliContextSource: "memory",
    });
    shouldEnsureDefaultHumanProfileMock.mockReturnValue(false);
  });

  it("does not enter Space actions before a selected profile is confirmed", async () => {
    resolveStartSelectedProfileMock.mockResolvedValueOnce(null);

    await runStart({
      view: "human",
      skillsMode: "off",
    });

    expect(collectStartReadinessSnapshotMock).not.toHaveBeenCalled();
    expect(runStartSpaceEntryActionMock).not.toHaveBeenCalled();
    expect(markStartV1CompletedMock).not.toHaveBeenCalled();
  });

  it("keeps the selected profile flowing into the Space entry stage", async () => {
    await runStart({
      view: "human",
      skillsMode: "off",
    });

    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
    expect(runStartSpaceEntryActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.openmeld.invalid",
        profile: DEFAULT_PROFILE,
      })
    );
    expect(emitStartSetupHintMock).toHaveBeenCalledWith({
      presenter: DEFAULT_PRESENTER,
      runtime: DEFAULT_RUNTIME,
    });
    expect(markStartV1CompletedMock).toHaveBeenCalledTimes(1);
  });

  it("does not call legacy local setup readiness before Space entry", async () => {
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "agent",
    });
    resolveStartSelectedProfileMock.mockResolvedValueOnce(
      DEFAULT_AGENT_PROFILE
    );

    await runStart({
      view: "agent",
      profileId: "agt-ready",
    });

    expect(collectStartReadinessSnapshotMock).not.toHaveBeenCalled();
    expect(runStartSpaceEntryActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: DEFAULT_AGENT_PROFILE,
      })
    );
  });

  it("does not emit recap or completion when Space entry is cancelled", async () => {
    runStartSpaceEntryActionMock.mockResolvedValueOnce("cancelled");

    await runStart({
      view: "human",
      skillsMode: "off",
    });

    expect(runStartSpaceEntryActionMock).toHaveBeenCalledTimes(1);
    expect(emitStartRecapMock).not.toHaveBeenCalled();
    expect(markStartV1CompletedMock).not.toHaveBeenCalled();
    expect(emitStartSetupHintMock).not.toHaveBeenCalled();
  });
});
