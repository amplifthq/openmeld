import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../src/runtime/cli-entry-command";

const {
  collectSkillsReadinessSnapshotMock,
  clackSelectMock,
  createOpenMeldAgentProfileMock,
  createOpenMeldHumanProfileMock,
  getOpenMeldProfileCapabilitiesMock,
  getDaemonStatusMock,
  getAuthSessionStateMock,
  listOpenMeldProfilesMock,
  listAgentTargetStatesMock,
  resolveOpenMeldProfileMock,
  runAgentsDisableMock,
  runAgentsEnableMock,
  runAuthLoginMock,
  runDaemonBackgroundStartForDecisionMock,
  runDaemonInstallMock,
  runSkillsInstallMock,
  inspectDaemonServiceInventoryMock,
  resolveLocalServiceDemandMock,
  setSelectedOpenMeldProfileIdMock,
  maybeAutoStopIdleLocalServiceMock,
  promptSearchMultiselectMock,
  promptSearchSelectMock,
  promptTextEntryMock,
} = vi.hoisted(() => ({
  collectSkillsReadinessSnapshotMock: vi.fn(),
  clackSelectMock: vi.fn(),
  createOpenMeldAgentProfileMock: vi.fn(),
  createOpenMeldHumanProfileMock: vi.fn(),
  getOpenMeldProfileCapabilitiesMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  listOpenMeldProfilesMock: vi.fn(),
  listAgentTargetStatesMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  runAgentsDisableMock: vi.fn(),
  runAgentsEnableMock: vi.fn(),
  runAuthLoginMock: vi.fn(),
  runDaemonBackgroundStartForDecisionMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runSkillsInstallMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  setSelectedOpenMeldProfileIdMock: vi.fn(),
  maybeAutoStopIdleLocalServiceMock: vi.fn(),
  promptSearchMultiselectMock: vi.fn(),
  promptSearchSelectMock: vi.fn(),
  promptTextEntryMock: vi.fn(),
}));

const START_AUTH_LOGIN = "__command_auth_login__";
const START_AUTH_CANCEL = "__command_auth_cancel__";
const START_DISCLAIMER_ACCEPT = "__start_disclaimer_accept__";
const START_ACTION_USE_DEFAULT = "__start_action_use_default__";
const START_ACTION_CREATE = "__start_action_create__";
const START_ACTION_SELECT = "__start_action_select__";
const START_ACTION_EXIT = "__start_action_exit__";

function findSelectCallsByMessage(
  selectMock: {
    mock: {
      calls: unknown[][];
    };
  },
  messagePrefix: string
) {
  return selectMock.mock.calls.filter((call) => {
    const [payload] = call;
    return (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string" &&
      payload.message.startsWith(messagePrefix)
    );
  });
}

function createDaemonInventory(
  input: {
    installedVersion?: string | null;
    runtimeStatus?: "not_running" | "running" | "stale" | "unknown";
    anomalyCodes?: string[];
  } = {}
) {
  const installedVersion =
    input.installedVersion === undefined
      ? packageJson.version
      : input.installedVersion;
  return {
    expectedVersion: packageJson.version,
    installStatus:
      installedVersion === null
        ? {
            installed: false,
            state: null,
          }
        : {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: installedVersion,
              installSource: "daemon.command.install",
              installedAt: "2026-03-01T00:00:00.000Z",
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          },
    runtimeStatus: {
      status: input.runtimeStatus ?? "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    anomalies: (input.anomalyCodes ?? []).map((code) => ({
      code,
      message: String(code),
    })),
  };
}

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === "__cancel__"),
    multiselect: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
    select: clackSelectMock,
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      error: vi.fn(),
      message: vi.fn(),
      clear: vi.fn(),
      isCancelled: false,
    })),
    text: vi.fn(),
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

vi.mock("../src/config/openmeld-profile-selection", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profile-selection")
  >("../src/config/openmeld-profile-selection");
  return {
    ...actual,
    setSelectedOpenMeldProfileId: setSelectedOpenMeldProfileIdMock,
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
  };
});

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    createOpenMeldAgentProfile: createOpenMeldAgentProfileMock,
    createOpenMeldHumanProfile: createOpenMeldHumanProfileMock,
    getOpenMeldProfileCapabilities: getOpenMeldProfileCapabilitiesMock,
    listOpenMeldProfiles: listOpenMeldProfilesMock,
    resolveOpenMeldProfile: resolveOpenMeldProfileMock,
  };
});

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: runAuthLoginMock,
}));

vi.mock("../src/commands/agents", () => ({
  runAgentsDisable: runAgentsDisableMock,
  runAgentsEnable: runAgentsEnableMock,
}));

vi.mock("../src/commands/skills", () => ({
  collectSkillsReadinessSnapshot: collectSkillsReadinessSnapshotMock,
  runSkillsInstall: runSkillsInstallMock,
}));

vi.mock("../src/agents/registry", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/registry")>(
    "../src/agents/registry"
  );
  return {
    ...actual,
    listAgentTargetStates: listAgentTargetStatesMock,
  };
});

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonStatus: getDaemonStatusMock,
  };
});

vi.mock("../src/commands/service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/commands/service")
  >("../src/commands/service");
  return {
    ...actual,
    runDaemonBackgroundStartForDecision:
      runDaemonBackgroundStartForDecisionMock,
    runDaemonInstall: runDaemonInstallMock,
  };
});

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  resolveLocalServiceDemand: resolveLocalServiceDemandMock,
  maybeAutoStopIdleLocalService: maybeAutoStopIdleLocalServiceMock,
}));

vi.mock("../src/start-local/background-helper-local", async () => {
  const actual = await vi.importActual<
    typeof import("../src/start-local/background-helper-local")
  >("../src/start-local/background-helper-local");
  return {
    ...actual,
    resolveStartLocalBackgroundHelperDemand: (
      ...args: Parameters<typeof resolveLocalServiceDemandMock>
    ) => resolveLocalServiceDemandMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (...args: unknown[]) =>
    inspectDaemonServiceInventoryMock(...args),
}));

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselect: (
    ...args: Parameters<typeof promptSearchMultiselectMock>
  ) => promptSearchMultiselectMock(...args),
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: async (
    ...args: Parameters<typeof promptSearchSelectMock>
  ) => {
    const [input] = args;
    if (input?.message === "Do you accept and continue?") {
      const legacyDecision = await clackSelectMock(input);
      return legacyDecision === "__cancel__"
        ? { status: "cancelled" }
        : {
            status: "submitted",
            value: "__onboarding_disclaimer_accept__",
          };
    }
    return await promptSearchSelectMock(...args);
  },
}));

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

import { runStart } from "../src/commands/start";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
  updateConfiguredStartV1OnboardingState,
} from "../src/config/runtime-config";
import {
  createEnabledPreferredBuiltinControllerState,
  createEnabledPreferredBuiltinTargetState,
  resolvePreferredRunnableControllerId,
  resolvePreferredTransportModeSelection,
} from "./helpers/agent-registry-derived";
import {
  stripTerminalOutput,
  withCapturedStdio,
  withTempHome,
} from "./helpers/fs";
import { createStartFetchHandler } from "./helpers/start-fetch";
import { seedVersionState } from "./helpers/version";

const DEFAULT_HUMAN_PROFILE = {
  openMeldProfileId: "human-default",
  profileName: "Felix",
  profileKind: "human",
  isDefault: true,
  status: "active",
  ownerUserId: "owner-1",
  source: "auth_bootstrap",
  createdByUserId: "owner-1",
  lastUsedAt: null,
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
} as const;

describe("openmeld start entry flow", () => {
  beforeEach(async () => {
    const prompts = await import("@clack/prompts");

    vi.stubGlobal("fetch", vi.fn(createStartFetchHandler(packageJson.version)));
    vi.mocked(prompts.cancel).mockReset();
    vi.mocked(prompts.note).mockReset();
    vi.mocked(prompts.outro).mockReset();
    vi.mocked(prompts.select).mockReset();
    getAuthSessionStateMock.mockReset();
    collectSkillsReadinessSnapshotMock.mockReset();
    createOpenMeldAgentProfileMock.mockReset();
    createOpenMeldHumanProfileMock.mockReset();
    getOpenMeldProfileCapabilitiesMock.mockReset().mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: true,
    });
    getDaemonStatusMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    listAgentTargetStatesMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    runAgentsDisableMock.mockReset();
    runAgentsEnableMock.mockReset();
    runAuthLoginMock.mockReset();
    runDaemonInstallMock.mockReset();
    runDaemonBackgroundStartForDecisionMock.mockReset();
    runSkillsInstallMock.mockReset();
    inspectDaemonServiceInventoryMock.mockReset();
    resolveLocalServiceDemandMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockReset();
    maybeAutoStopIdleLocalServiceMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockResolvedValue({
      persistent: false,
    });

    collectSkillsReadinessSnapshotMock.mockResolvedValue({
      status: "up_to_date",
      targetCount: 0,
      summary: {
        upToDate: 0,
        outdated: 0,
        missing: 0,
        externalConflict: 0,
      },
    });
    runDaemonBackgroundStartForDecisionMock.mockResolvedValue("started");
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        runtimeStatus: "not_running",
      })
    );
    maybeAutoStopIdleLocalServiceMock.mockResolvedValue({
      autoStopped: false,
      effectiveRuntimeStatus: "running",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: false,
        repairableReplyCandidateCount: 0,
        reason: "no local execution routes are available",
        localExecutionRouteCount: 0,
        projection: null,
      },
    });
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
    listAgentTargetStatesMock.mockResolvedValue([]);
    getDaemonStatusMock.mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: packageJson.version,
        installSource: "daemon.command.install",
        installedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    });

    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-20T00:00:00.000Z",
        user: {
          id: "owner-1",
          email: "felix@openmeld.invalid",
        },
      },
    });
    resolveOpenMeldProfileMock.mockImplementation((input) => {
      if (input?.openMeldProfileId) {
        return {
          ...DEFAULT_HUMAN_PROFILE,
          openMeldProfileId: input.openMeldProfileId,
          profileName: "Selected",
          profileKind: "agent",
          isDefault: false,
          source: "cli_create",
        };
      }
      return DEFAULT_HUMAN_PROFILE;
    });
    listOpenMeldProfilesMock.mockResolvedValue([
      DEFAULT_HUMAN_PROFILE,
      {
        ...DEFAULT_HUMAN_PROFILE,
        openMeldProfileId: "agt_planner",
        profileName: "Planner",
        profileKind: "agent",
        isDefault: false,
        source: "cli_create",
      },
    ]);
    createOpenMeldHumanProfileMock.mockResolvedValue({
      ...DEFAULT_HUMAN_PROFILE,
      openMeldProfileId: "human-secondary",
      profileName: "Mira Secondary",
      isDefault: false,
      source: "cli_create",
    });
    createOpenMeldAgentProfileMock.mockResolvedValue({
      ...DEFAULT_HUMAN_PROFILE,
      openMeldProfileId: "agt_research_bot",
      profileName: "Research Bot",
      profileKind: "agent",
      isDefault: false,
      source: "cli_create",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses default OpenMeld profile when user selects default", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
    expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
  });

  it("reuses the validated sign-in state for setup check", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(getAuthSessionStateMock).toHaveBeenCalled();
    expect(runAuthLoginMock).not.toHaveBeenCalled();
  });

  it("does not start local setup checks after sign-in", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });

      expect(collectSkillsReadinessSnapshotMock).not.toHaveBeenCalled();
      expect(listAgentTargetStatesMock).not.toHaveBeenCalled();
      expect(getDaemonStatusMock).not.toHaveBeenCalled();
    });
  });

  it("cancels start when the top-level skills attention prompt is cancelled", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    collectSkillsReadinessSnapshotMock.mockResolvedValueOnce({
      status: "action_required",
      targetCount: 2,
      summary: {
        upToDate: 0,
        outdated: 1,
        missing: 1,
        externalConflict: 0,
      },
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce("__cancel__");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    expect(runSkillsInstallMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
  });

  it("does not show the skills decision during start", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    collectSkillsReadinessSnapshotMock.mockResolvedValueOnce({
      status: "action_required",
      targetCount: 1,
      summary: {
        upToDate: 0,
        outdated: 1,
        missing: 0,
        externalConflict: 0,
      },
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(
      findSelectCallsByMessage(selectMock, "Local OpenMeld skills")
    ).toHaveLength(0);
    expect(runSkillsInstallMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
  });

  it("does not run nested skills install from start", async () => {
    const prompts = await import("@clack/prompts");
    const noteMock = vi.mocked(prompts.note);
    const selectMock = vi.mocked(prompts.select);

    collectSkillsReadinessSnapshotMock.mockResolvedValueOnce({
      status: "action_required",
      targetCount: 1,
      summary: {
        upToDate: 0,
        outdated: 1,
        missing: 0,
        externalConflict: 0,
      },
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runSkillsInstallMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
    expect(
      noteMock.mock.calls.find((call) => call[1] === "Welcome")
    ).toBeDefined();
  });

  it("does not prompt for local agents during start", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "adal",
        displayName: "AdaL",
        targetKind: "builtin",
        detected: false,
        selectable: false,
        selectableReason: "not_detected",
        enabled: false,
      },
      {
        agentId: "cursor",
        displayName: "Cursor",
        targetKind: "builtin",
        detected: true,
        selectable: false,
        selectableReason: "not_supported_yet",
        enabled: false,
      },
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
      {
        agentId: "claude-code",
        displayName: "Claude Code",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: false,
      },
    ]);

    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: [],
    });
    selectMock.mockImplementationOnce(async () => START_DISCLAIMER_ACCEPT);
    selectMock.mockImplementation((input) => {
      if (!input || typeof input !== "object" || !("message" in input)) {
        throw new Error("unexpected select payload");
      }
      if (
        input.message === "Should OpenMeld use local agents on this computer?"
      ) {
        throw new Error("start must not ask for local agents");
      }
      if (input.message === "Which profile do you want to use?") {
        return Promise.resolve(START_ACTION_USE_DEFAULT);
      }
      if (
        typeof input.message === "string" &&
        input.message.startsWith(
          "OpenMeld Service is not running. Start it now?"
        )
      ) {
        throw new Error("start must not ask to start OpenMeld Service");
      }
      if (
        typeof input.message === "string" &&
        input.message.startsWith("What would you like to do now?")
      ) {
        return Promise.resolve("later");
      }
      throw new Error(`unexpected select message: ${String(input.message)}`);
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(promptSearchMultiselectMock).not.toHaveBeenCalled();
    expect(runAgentsDisableMock).not.toHaveBeenCalled();
    const profileSelectionPrompt = selectMock.mock.calls.find((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Which profile do you want to use?"
      );
    })?.[0] as
      | {
          options?: Array<{ label: string }>;
        }
      | undefined;
    expect(
      profileSelectionPrompt?.options?.map((option) => option.label)
    ).toEqual([
      "Continue as Felix",
      "Use another profile",
      "Create a new profile",
      "Exit",
    ]);
  });

  it("exits from profile selection without asking for local agents", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
    ]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: ["codex"],
    });
    selectMock.mockResolvedValueOnce(START_DISCLAIMER_ACCEPT);
    selectMock.mockImplementation((input) => {
      if (!input || typeof input !== "object" || !("message" in input)) {
        throw new Error("unexpected select payload");
      }
      if (
        input.message === "Should OpenMeld use local agents on this computer?"
      ) {
        throw new Error("start must not ask for local agents");
      }
      if (input.message === "Which profile do you want to use?") {
        return Promise.resolve(START_ACTION_EXIT);
      }
      throw new Error(`unexpected select message: ${String(input.message)}`);
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const localAgentPromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Should OpenMeld use local agents on this computer?"
      );
    });
    expect(localAgentPromptCalls).toHaveLength(0);
    const profilePromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Which profile do you want to use?"
      );
    });
    expect(
      (
        profilePromptCalls[0]?.[0] as
          | {
              options?: Array<{ label: string }>;
            }
          | undefined
      )?.options?.map((option) => option.label)
    ).toEqual([
      "Continue as Felix",
      "Use another profile",
      "Create a new profile",
      "Exit",
    ]);
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("does not ask about local agents across repeated starts", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
    ]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: ["codex"],
    });
    selectMock.mockResolvedValueOnce(START_DISCLAIMER_ACCEPT);
    selectMock.mockImplementation((input) => {
      if (!input || typeof input !== "object" || !("message" in input)) {
        throw new Error("unexpected select payload");
      }
      if (
        input.message === "Should OpenMeld use local agents on this computer?"
      ) {
        throw new Error("start must not ask for local agents");
      }
      if (input.message === "Which profile do you want to use?") {
        return Promise.resolve(START_ACTION_EXIT);
      }
      throw new Error(`unexpected select message: ${String(input.message)}`);
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const localAgentPromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Should OpenMeld use local agents on this computer?"
      );
    });
    expect(localAgentPromptCalls).toHaveLength(0);
    expect(promptSearchMultiselectMock).not.toHaveBeenCalled();

    const profilePromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Which profile do you want to use?"
      );
    });
    expect(profilePromptCalls).toHaveLength(2);
    expect(
      (
        profilePromptCalls[0]?.[0] as
          | {
              options?: Array<{ label: string }>;
            }
          | undefined
      )?.options?.map((option) => option.label)
    ).toEqual([
      "Continue as Felix",
      "Use another profile",
      "Create a new profile",
      "Exit",
    ]);
    expect(
      (
        profilePromptCalls[1]?.[0] as
          | {
              options?: Array<{ label: string }>;
            }
          | undefined
      )?.options?.map((option) => option.label)
    ).toEqual([
      "Continue as Felix",
      "Use another profile",
      "Create a new profile",
      "Exit",
    ]);
  });

  it("allows choosing an existing OpenMeld profile", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_SELECT)
      .mockResolvedValueOnce("later");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "agt_planner",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(resolveOpenMeldProfileMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt_planner",
    });
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "agt_planner"
    );
    const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          allowBack?: boolean;
          items?: Array<{
            value: string;
            label: string;
            detail?: string;
          }>;
        }
      | undefined;
    expect(pickerCall?.allowBack).toBe(true);
    expect(
      pickerCall?.items?.find((item) => item.value === "agt_planner")
    ).toMatchObject({
      label: "Planner",
    });
    expect(
      pickerCall?.items?.find((item) => item.value === "agt_planner")?.detail
    ).toContain("agent · agt_planner");
  });

  it("returns to profile action selection when searchable profile picker backs out", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_SELECT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "back",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(selectMock).toHaveBeenCalledTimes(4);
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
  });

  it("creates a new OpenMeld profile from entry flow", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_CREATE)
      .mockResolvedValueOnce("agent")
      .mockResolvedValueOnce("later");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "Research Bot",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileName: "Research Bot",
        creatorProfileId: "human-default",
      })
    );
    expect(promptTextEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Profile name",
        placeholder: "my-codex-researcher",
      })
    );
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "agt_research_bot"
    );
  });

  it("configures controller and transport when creating an agent profile", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredControllerId = resolvePreferredRunnableControllerId();
    const selectedTransportMode = resolvePreferredTransportModeSelection();
    const preferredControllerState = createEnabledPreferredBuiltinTargetState();

    listAgentTargetStatesMock.mockResolvedValue([preferredControllerState]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: [preferredControllerId],
    });

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_CREATE)
      .mockResolvedValueOnce("agent")
      .mockResolvedValueOnce("mention_only")
      .mockResolvedValueOnce("later");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "Research Bot",
    });
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: preferredControllerId,
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await setConfiguredDeviceRuntimeState({
        controllers: [createEnabledPreferredBuiltinControllerState()],
      });

      await runStart({
        view: "human",
        skillsMode: "off",
      });

      expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
        profileName: "Research Bot",
        creatorProfileId: "human-default",
      });

      const state = await getConfiguredDeviceRuntimeState();
      const preferredController = state?.controllers?.find(
        (controller) => controller.agentId === preferredControllerId
      );
      expect(preferredController?.transportMode).toBe(selectedTransportMode);

      const transportPromptCalls = selectMock.mock.calls.filter((call) => {
        const [payload] = call;
        return (
          payload &&
          typeof payload === "object" &&
          "message" in payload &&
          payload.message ===
            "How should this profile connect to its controller?"
        );
      });
      expect(transportPromptCalls).toHaveLength(0);
      const controllerPickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              detail?: string;
              label: string;
            }>;
          }
        | undefined;
      expect(
        controllerPickerCall?.items?.find(
          (item) => item.value === preferredControllerId
        )
      ).toMatchObject({
        label: preferredControllerState.displayName,
      });
      expect(
        controllerPickerCall?.items?.find(
          (item) => item.value === preferredControllerId
        )?.detail
      ).toContain(`ID ${preferredControllerId}`);
      expect(controllerPickerCall?.items?.at(-1)).toMatchObject({
        label: "Skip for now",
      });
    });
  });

  it("cancels start when controller picker is cancelled during agent profile creation", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);
    const preferredControllerState = createEnabledPreferredBuiltinTargetState();

    listAgentTargetStatesMock.mockResolvedValue([preferredControllerState]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: [preferredControllerState.agentId],
    });

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_CREATE)
      .mockResolvedValueOnce("agent");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "Cancelled Agent",
    });
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "cancelled",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("returns to the start action picker when the create-profile kind step goes back", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_CREATE)
      .mockResolvedValueOnce("__create_profile_kind_back__")
      .mockResolvedValueOnce(START_ACTION_EXIT);

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const actionPromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message === "Which profile do you want to use?"
      );
    });
    expect(actionPromptCalls).toHaveLength(2);
    expect(promptTextEntryMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("returns to the profile name step when controller setup goes back during start", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredControllerState = createEnabledPreferredBuiltinTargetState();

    listAgentTargetStatesMock.mockResolvedValue([preferredControllerState]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: [preferredControllerState.agentId],
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_CREATE)
      .mockResolvedValueOnce("agent")
      .mockResolvedValueOnce("mention_only")
      .mockResolvedValueOnce("later");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "First Agent",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Second Agent",
      });
    promptSearchSelectMock
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: resolvePreferredRunnableControllerId(),
      });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(promptTextEntryMock).toHaveBeenCalledTimes(2);
    expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
      profileName: "Second Agent",
      creatorProfileId: "human-default",
    });
  });

  it("prompts sign-in and continues when session is missing", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-20T00:00:00.000Z",
        user: {
          id: "owner-1",
          email: "felix@openmeld.invalid",
        },
      },
    });
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "missing",
      session: null,
    });

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_AUTH_LOGIN)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runAuthLoginMock).toHaveBeenCalledWith({
      view: "human",
    });
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
  });

  it("surfaces auth environment mismatch before profile selection", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-20T00:00:00.000Z",
        user: {
          id: "owner-1",
          email: "felix@openmeld.invalid",
        },
      },
    });
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        createdAt: "2026-02-20T00:00:00.000Z",
        user: {
          id: "owner-1",
          email: "felix@openmeld.invalid",
        },
      },
    });

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_AUTH_LOGIN)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    const captured = await withTempHome(async (home) => {
      await seedVersionState(home);
      return withCapturedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
        });
      });
    });

    expect(captured.stdout).toContain("Wrong OpenMeld Environment");
    expect(captured.stdout).toContain(
      "Sign in to the right OpenMeld environment to continue."
    );

    const authPrompt = selectMock.mock.calls[1]?.[0] as
      | {
          message?: string;
        }
      | undefined;
    expect(authPrompt?.message).toBe("What do you want to do?");

    expect(runAuthLoginMock).toHaveBeenCalledWith({
      authUrl: "https://auth.openmeld.invalid",
      view: "human",
    });
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-default"
    );
  });

  it("allows cancel on sign-in gate when session is missing", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const cancelMock = vi.mocked(prompts.cancel);

    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "missing",
      session: null,
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_AUTH_CANCEL);

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("goes straight to next actions after profile selection without a service prompt", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const noteMock = vi.mocked(prompts.note);
    const outroMock = vi.mocked(prompts.outro);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    const captured = await withTempHome(async (home) => {
      await seedVersionState(home);
      return withCapturedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
        });
      });
    });

    const profileSelectionPrompt = selectMock.mock.calls[1]?.[0] as
      | {
          message?: string;
          options?: Array<{ label: string }>;
        }
      | undefined;
    expect(profileSelectionPrompt).toMatchObject({
      message: "Which profile do you want to use?",
    });
    expect(
      profileSelectionPrompt?.options?.map((option) => option.label)
    ).toEqual([
      "Continue as Felix",
      "Use another profile",
      "Create a new profile",
      "Exit",
    ]);

    const currentIdentityCall = noteMock.mock.calls.find(
      (call) => call[1] === "Your current OpenMeld Identity"
    );
    expect(currentIdentityCall?.[0]).toContain(
      "In OpenMeld, a profile is your identity in Spaces."
    );
    expect(currentIdentityCall?.[0]).toContain("Currently using: Felix");
    expect(currentIdentityCall?.[0]).toContain("Type: human");
    expect(currentIdentityCall?.[0]).not.toContain("Profile ID:");
    expect(currentIdentityCall?.[0]).not.toContain("Default:");
    const currentIdentityOptions = currentIdentityCall?.[2] as
      | {
          format?: (line: string) => string;
        }
      | undefined;
    expect(currentIdentityOptions?.format?.("Identity text")).toBe(
      "Identity text"
    );

    const selectedProfileCall = noteMock.mock.calls.find(
      (call) => call[1] === "OpenMeld Profile Selected"
    );
    expect(selectedProfileCall?.[0]).toContain("Profile Name: Felix");
    expect(selectedProfileCall?.[0]).toContain("Type: human");
    expect(selectedProfileCall?.[0]).toContain(
      "This choice only applies to this session."
    );
    expect(selectedProfileCall?.[0]).toContain(
      `Next: Use ${formatOpenMeldCliCommand("openmeld profiles set")} if you want OpenMeld to keep using this profile next time.`
    );
    expect(selectedProfileCall?.[0]).not.toContain("Profile ID:");
    expect(captured.stdout).not.toContain(
      "warning: non-persistent OpenMeld CLI context detected; selected OpenMeld profile only applies to this process"
    );

    const nextActionPrompt = selectMock.mock.calls[2]?.[0] as
      | {
          message?: string;
        }
      | undefined;
    const plainNextActionPromptMessage = stripTerminalOutput(
      nextActionPrompt?.message
    );
    expect(plainNextActionPromptMessage).toContain(
      "What would you like to do now?"
    );
    expect(plainNextActionPromptMessage).toContain(
      "A Space is where you talk to people and agents.\n"
    );

    expect(outroMock).toHaveBeenCalledWith("You're set up.");
    expect(captured.stdout).toContain(
      formatInlineOpenMeldCliCommands(
        "Run `openmeld space` any time to create a Space, join one, or manage one later."
      )
    );
    expect(captured.stdout).not.toContain(
      "Optional action: run `openmeld agents enable --all`."
    );

    const recapCall = noteMock.mock.calls.find((call) => call[1] === "Recap");
    expect(recapCall?.[0]).toContain(
      "Each command below can be run on its own any time."
    );
    expect(recapCall?.[0]).toContain(
      formatOpenMeldCliCommand("openmeld auth status")
    );
    expect(recapCall?.[0]).toContain("Check whether you're signed in.");
    expect(recapCall?.[0]).toContain(
      formatOpenMeldCliCommand("openmeld setup")
    );
    expect(recapCall?.[0]).toContain(
      "Set up this computer for local agent execution."
    );
    expect(recapCall?.[0]).not.toContain(
      formatOpenMeldCliCommand("openmeld skills check")
    );
    expect(recapCall?.[0]).not.toContain(
      formatOpenMeldCliCommand("openmeld agents list")
    );
    expect(recapCall?.[0]).not.toContain(
      formatOpenMeldCliCommand("openmeld service status")
    );
    expect(recapCall?.[0]).toContain(
      formatOpenMeldCliCommand("openmeld profiles list")
    );
    expect(recapCall?.[0]).toContain("See your OpenMeld identities.");
    expect(recapCall?.[0]).toContain(
      formatOpenMeldCliCommand("openmeld space")
    );
    expect(recapCall?.[0]).toContain(
      "Open Space actions to create, join, or manage a Space."
    );
  });

  it("does not emit recap or completion copy when the final next-action prompt is cancelled", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const noteMock = vi.mocked(prompts.note);
    const outroMock = vi.mocked(prompts.outro);
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("__cancel__");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    expect(outroMock).not.toHaveBeenCalled();
    expect(noteMock.mock.calls.find((call) => call[1] === "Recap")).toBe(
      undefined
    );
  });

  it("skips the service-start prompt when this device has no local execution routes", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(maybeAutoStopIdleLocalServiceMock).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenCalledTimes(3);
  });

  it("does not offer service install during start even when selected local agents are selected", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
    ]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: ["codex"],
    });
    getDaemonStatusMock.mockResolvedValue({
      installed: false,
      state: null,
    });
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        installedVersion: null,
      })
    );
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
    selectMock.mockResolvedValueOnce(START_DISCLAIMER_ACCEPT);
    selectMock.mockImplementation((input) => {
      if (!input || typeof input !== "object" || !("message" in input)) {
        throw new Error("unexpected select payload");
      }
      if (
        input.message === "Should OpenMeld use local agents on this computer?"
      ) {
        throw new Error("start must not ask for local agents");
      }
      if (input.message === "Which profile do you want to use?") {
        return Promise.resolve(START_ACTION_USE_DEFAULT);
      }
      if (
        input.message ===
        "What would you like to do now?\nA Space is where you talk to people and agents.\n"
      ) {
        return Promise.resolve("later");
      }
      throw new Error(`unexpected select message: ${String(input.message)}`);
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const servicePromptCall = selectMock.mock.calls.find((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string" &&
        payload.message.startsWith(
          "OpenMeld Service is missing. Install it now?"
        )
      );
    });
    expect(servicePromptCall).toBeUndefined();
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
  });

  it("does not install or start OpenMeld Service during start when selected local agents need it", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    let serviceInstalled = false;

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
    ]);
    promptSearchMultiselectMock.mockResolvedValueOnce({
      status: "submitted",
      value: ["codex"],
    });
    getDaemonStatusMock.mockImplementation(async () =>
      serviceInstalled
        ? {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: packageJson.version,
              installSource: "daemon.command.install",
              installedAt: "2026-03-01T00:00:00.000Z",
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          }
        : {
            installed: false,
            state: null,
          }
    );
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      createDaemonInventory({
        installedVersion: serviceInstalled ? packageJson.version : null,
      })
    );
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
    runDaemonInstallMock.mockImplementation(() => {
      serviceInstalled = true;
    });
    selectMock.mockResolvedValueOnce(START_DISCLAIMER_ACCEPT);
    selectMock.mockImplementation((input) => {
      if (!input || typeof input !== "object" || !("message" in input)) {
        throw new Error("unexpected select payload");
      }
      if (
        input.message === "Should OpenMeld use local agents on this computer?"
      ) {
        throw new Error("start must not ask for local agents");
      }
      if (input.message === "Which profile do you want to use?") {
        return Promise.resolve(START_ACTION_USE_DEFAULT);
      }
      if (
        input.message ===
        "What would you like to do now?\nA Space is where you talk to people and agents.\n"
      ) {
        return Promise.resolve("later");
      }
      throw new Error(`unexpected select message: ${String(input.message)}`);
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runDaemonInstallMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("keeps the start flow moving to next actions instead of attempting service startup", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const outroMock = vi.mocked(prompts.outro);

    runDaemonBackgroundStartForDecisionMock.mockResolvedValue(
      "failed_with_card"
    );
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(outroMock).toHaveBeenCalledWith("You're set up.");
  });

  it("goes straight to next actions when service is missing", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    getDaemonStatusMock.mockResolvedValue({
      installed: false,
      state: null,
    });
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        installedVersion: null,
      })
    );
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const nextActionPrompt = selectMock.mock.calls[2]?.[0] as
      | {
          message?: string;
        }
      | undefined;
    const plainNextActionPromptMessage = stripTerminalOutput(
      nextActionPrompt?.message
    );
    expect(plainNextActionPromptMessage).toContain(
      "What would you like to do now?"
    );
    expect(plainNextActionPromptMessage).toContain(
      "A Space is where you talk to people and agents."
    );
    expect(plainNextActionPromptMessage).toContain(
      "A Space is where you talk to people and agents.\n"
    );
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
  });

  it("keeps human start moving to next actions when saved local-agent setup exists but device readiness is unavailable", async () => {
    const prompts = await import("@clack/prompts");
    const noteMock = vi.mocked(prompts.note);
    const selectMock = vi.mocked(prompts.select);

    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        selectable: true,
        selectableReason: null,
        enabled: true,
      },
    ]);
    getDaemonStatusMock.mockResolvedValue({
      installed: false,
      state: null,
    });
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        installedVersion: null,
      })
    );
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await updateConfiguredStartV1OnboardingState(() => ({
        localAgentsSetupCompletedAt: "2026-04-17T00:00:00.000Z",
      }));
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const blockedCardCall = noteMock.mock.calls.find(
      (call) => call[1] === "Setup Couldn't Continue"
    );
    expect(blockedCardCall).toBeUndefined();
    expect(selectMock).toHaveBeenCalledTimes(3);

    const nextActionPrompt = selectMock.mock.calls[2]?.[0] as
      | {
          message?: string;
        }
      | undefined;
    expect(stripTerminalOutput(nextActionPrompt?.message)).toContain(
      "What would you like to do now?"
    );
  });

  it("goes straight to next actions when service is outdated", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    getDaemonStatusMock.mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.5",
        installSource: "daemon.command.install",
        installedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createDaemonInventory({
        installedVersion: "0.1.5",
      })
    );
    selectMock
      .mockResolvedValueOnce(START_DISCLAIMER_ACCEPT)
      .mockResolvedValueOnce(START_ACTION_USE_DEFAULT)
      .mockResolvedValueOnce("later");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await runStart({
        view: "human",
        skillsMode: "off",
      });
    });

    const nextActionPrompt = selectMock.mock.calls[2]?.[0] as
      | {
          message?: string;
        }
      | undefined;
    const plainNextActionPromptMessage = stripTerminalOutput(
      nextActionPrompt?.message
    );
    expect(plainNextActionPromptMessage).toContain(
      "What would you like to do now?"
    );
    expect(plainNextActionPromptMessage).toContain(
      "A Space is where you talk to people and agents."
    );
    expect(plainNextActionPromptMessage).toContain(
      "A Space is where you talk to people and agents.\n"
    );
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
  });

  it("emits explicit agent next actions with --profile in agent view", async () => {
    const captured = await withTempHome(async (home) => {
      await seedVersionState(home);
      return withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          profileId: "agt_planner",
          skillsMode: "off",
        });
      });
    });

    const lines = captured.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { code?: string; payload?: unknown });
    const nextActions = lines.find(
      (line) => String(line.code ?? "") === "start.next_actions"
    );

    expect(nextActions).toMatchObject({
      payload: {
        commands: formatOpenMeldCliCommands([
          "openmeld whoami --profile agt_planner --view agent",
          "openmeld space create --profile agt_planner --name <space-name> --visibility private --view agent",
          "openmeld space join --profile agt_planner <space-id> --view agent",
        ]),
      },
    });
  });

  it("renders human non-interactive next actions as a card instead of raw JSON", async () => {
    const prompts = await import("@clack/prompts");
    const interaction = await import("../src/runtime/interaction");
    const noteMock = vi.mocked(prompts.note);
    const canUseInteractivePromptsMock = vi.mocked(
      interaction.canUseInteractivePrompts
    );

    canUseInteractivePromptsMock.mockReturnValueOnce(false);

    const captured = await withTempHome(async (home) => {
      await seedVersionState(home);
      return withCapturedStdio(async () => {
        await runStart({
          view: "human",
          profileId: "human-default",
          skillsMode: "off",
        });
      });
    });

    const nextActionsCall = noteMock.mock.calls.find(
      (call) => call[1] === "Next Actions"
    );
    expect(nextActionsCall?.[0]).toContain(
      "Run one of the commands below next."
    );
    expect(nextActionsCall?.[0]).toContain(
      formatOpenMeldCliCommand("openmeld whoami --profile human-default")
    );
    expect(nextActionsCall?.[0]).toContain(
      formatOpenMeldCliCommand(
        "openmeld space create --profile human-default --name <space-name>"
      )
    );
    expect(nextActionsCall?.[0]).toContain(
      formatOpenMeldCliCommand(
        "openmeld space join --profile human-default <space-id>"
      )
    );
    expect(captured.stdout).not.toContain('{"commands":[');
  });
});
