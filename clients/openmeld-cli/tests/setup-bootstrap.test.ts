import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCliSpaceApiMock,
  ensureAgentProfileRuntimeBindingMock,
  ensureOpenMeldManagedAgentProfileMock,
  listAccountSpaceIndexMock,
  promptSearchSelectMock,
  resolveSetupFollowUpCliEntryCommandMock,
  resolveOpenMeldProfileMock,
  upsertProfileSpaceHistoryMock,
} = vi.hoisted(() => ({
  createCliSpaceApiMock: vi.fn(),
  ensureAgentProfileRuntimeBindingMock: vi.fn(),
  ensureOpenMeldManagedAgentProfileMock: vi.fn(),
  listAccountSpaceIndexMock: vi.fn(),
  promptSearchSelectMock: vi.fn(),
  resolveSetupFollowUpCliEntryCommandMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  upsertProfileSpaceHistoryMock: vi.fn(),
}));

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: listAccountSpaceIndexMock,
}));

vi.mock("../src/config/profile-space-history-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/profile-space-history-api")
  >("../src/config/profile-space-history-api");
  return {
    ...actual,
    upsertProfileSpaceHistory: upsertProfileSpaceHistoryMock,
  };
});

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    ensureOpenMeldManagedAgentProfile: ensureOpenMeldManagedAgentProfileMock,
    resolveOpenMeldProfile: resolveOpenMeldProfileMock,
  };
});

vi.mock("../src/runtime/cli-entry-command", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runtime/cli-entry-command")
  >("../src/runtime/cli-entry-command");
  return {
    ...actual,
    resolveSetupFollowUpCliEntryCommand:
      resolveSetupFollowUpCliEntryCommandMock,
  };
});

vi.mock("../src/space/cli-space-api", () => ({
  createCliSpaceApi: createCliSpaceApiMock,
}));

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  ensureAgentProfileRuntimeBinding: ensureAgentProfileRuntimeBindingMock,
}));

vi.mock("../src/ui/search-select", async () => {
  const actual = await vi.importActual<
    typeof import("../src/ui/search-select")
  >("../src/ui/search-select");
  return {
    ...actual,
    promptSearchSelect: promptSearchSelectMock,
  };
});

const HUMAN_PROFILE = {
  openMeldProfileId: "human_felix",
  ownerName: "Felix",
  ownerUserId: "user_felix",
  profileKind: "human",
  profileName: "Felix",
} as const;

describe("setup account bootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveOpenMeldProfileMock.mockResolvedValue(HUMAN_PROFILE);
    resolveSetupFollowUpCliEntryCommandMock.mockReturnValue("openmeld-dev");
  });

  it("completes with the human profile and no retired Welcoming Assistant assets", async () => {
    const { runSetupFirstBootstrap } = await import(
      "../src/commands/setup-bootstrap"
    );

    const result = await runSetupFirstBootstrap({
      gatewayUrl: "https://gateway.openmeld.test",
      runtimeReports: [],
      selectedLocalAgentIds: [],
    });

    expect(result).toEqual({
      status: "completed",
      assistantProfile: null,
      binding: null,
      bindingWarning: null,
      facts: null,
      humanProfile: {
        openMeldProfileId: "human_felix",
        profileKind: "human",
        profileName: "Felix",
      },
      membership: null,
      retryCommand: null,
      warnings: [],
      welcomeMessage: null,
      welcomingSpace: null,
    });
    expect(resolveOpenMeldProfileMock).toHaveBeenCalledWith({
      profileKind: "human",
    });
    expect(ensureOpenMeldManagedAgentProfileMock).not.toHaveBeenCalled();
    expect(createCliSpaceApiMock).not.toHaveBeenCalled();
    expect(listAccountSpaceIndexMock).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
    expect(upsertProfileSpaceHistoryMock).not.toHaveBeenCalled();
  });

  it("does not bind selected local agents to a retired Welcoming Assistant", async () => {
    const { runSetupFirstBootstrap } = await import(
      "../src/commands/setup-bootstrap"
    );

    const result = await runSetupFirstBootstrap({
      gatewayUrl: "https://gateway.openmeld.test",
      interactive: true,
      runtimeReports: [],
      selectedLocalAgentIds: ["codex"],
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.binding).toBeNull();
      expect(result.bindingWarning).toBeNull();
    }
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
  });

  it("emits Center Agent setup guidance instead of Welcoming Space progress", async () => {
    const { runSetupFirstBootstrap } = await import(
      "../src/commands/setup-bootstrap"
    );
    const line = vi.fn();

    await runSetupFirstBootstrap({
      gatewayUrl: "https://gateway.openmeld.test",
      line,
      runtimeReports: [],
      selectedLocalAgentIds: [],
    });

    expect(line).toHaveBeenCalledWith({
      code: "setup.bootstrap.stage.center_agent",
      text: "Center Agent will guide your next setup steps from OpenMeld Home.",
    });
    expect(
      line.mock.calls.some((call) =>
        String(call[0]?.text ?? "").includes("Welcoming Space")
      )
    ).toBe(false);
  });

  it("fails at the human profile step without creating retired assets", async () => {
    resolveOpenMeldProfileMock.mockRejectedValueOnce(
      new Error("profile unavailable")
    );
    const { runSetupFirstBootstrap } = await import(
      "../src/commands/setup-bootstrap"
    );

    const result = await runSetupFirstBootstrap({
      gatewayUrl: "https://gateway.openmeld.test",
      runtimeReports: [],
      selectedLocalAgentIds: [],
    });

    expect(result).toMatchObject({
      status: "failed",
      failedStep: "human_profile",
      message: "profile unavailable",
      retryCommand: "openmeld-dev setup",
    });
    expect(ensureOpenMeldManagedAgentProfileMock).not.toHaveBeenCalled();
    expect(createCliSpaceApiMock).not.toHaveBeenCalled();
  });
});
