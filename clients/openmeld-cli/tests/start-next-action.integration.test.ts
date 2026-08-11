import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";

const { clackSelectMock } = vi.hoisted(() => ({
  clackSelectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === "__cancel__"),
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

vi.mock("../src/ui/search-select", async () => {
  const actual = await vi.importActual<
    typeof import("../src/ui/search-select")
  >("../src/ui/search-select");
  return {
    ...actual,
    promptSearchSelect: async (
      ...args: Parameters<typeof actual.promptSearchSelect>
    ) => {
      const [input] = args;
      if (input.message === "Do you accept and continue?") {
        const legacyDecision = await clackSelectMock(input);
        return legacyDecision === "__cancel__"
          ? { status: "cancelled" as const }
          : {
              status: "submitted" as const,
              value: "__onboarding_disclaimer_accept__",
            };
      }
      return await actual.promptSearchSelect(...args);
    },
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

const {
  collectSkillsReadinessSnapshotMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  getDaemonStatusMock,
  getAuthSessionStateMock,
  listAgentTargetStatesMock,
  promptTextEntryMock,
  resolveOpenMeldProfileMock,
  runDaemonInstallMock,
  runSkillsInstallMock,
} = vi.hoisted(() => ({
  collectSkillsReadinessSnapshotMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  listAgentTargetStatesMock: vi.fn(),
  promptTextEntryMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runSkillsInstallMock: vi.fn(),
}));

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
    resolveOpenMeldProfile: resolveOpenMeldProfileMock,
  };
});

vi.mock("../src/space/command", () => ({
  runSpaceCreate: vi.fn().mockResolvedValue("completed"),
  runSpaceJoin: vi.fn().mockResolvedValue("completed"),
}));

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
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

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    readCurrentObservedDaemonRuntimeStatus:
      readCurrentObservedDaemonRuntimeStatusMock,
  };
});

vi.mock("../src/commands/service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/commands/service")
  >("../src/commands/service");
  return {
    ...actual,
    runDaemonInstall: runDaemonInstallMock,
  };
});

import { runStart } from "../src/commands/start";
import { runSpaceCreate, runSpaceJoin } from "../src/space/command";
import { withSilencedStdio, withTempHome } from "./helpers/fs";
import { createStartFetchHandler } from "./helpers/start-fetch";
import { seedVersionState } from "./helpers/version";

const RUNNING_RUNTIME_STATUS = {
  status: "running",
  mode: "background",
  pid: 4321,
  startedAt: "2026-03-06T00:00:00.000Z",
  updatedAt: "2026-03-06T00:00:00.000Z",
  managedBySystemService: true,
  serviceController: "launchd",
  autoStart: true,
} as const;

describe("start next-action create flow", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    collectSkillsReadinessSnapshotMock.mockReset();
    readCurrentObservedDaemonRuntimeStatusMock.mockReset();
    getDaemonStatusMock.mockReset();
    listAgentTargetStatesMock.mockReset();
    promptTextEntryMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    runDaemonInstallMock.mockReset();
    runSkillsInstallMock.mockReset();

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
    listAgentTargetStatesMock.mockResolvedValue([]);
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue(
      RUNNING_RUNTIME_STATUS
    );
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
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-20T00:00:00.000Z",
      },
    });
    resolveOpenMeldProfileMock.mockResolvedValue({
      openMeldProfileId: "66666666-aaaa-bbbb-cccc-666666666666",
      profileName: "Felix",
      profileKind: "human",
      isDefault: true,
      status: "active",
      ownerUserId: "user-1",
      source: "auth_bootstrap",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    });

    vi.stubGlobal("fetch", vi.fn(createStartFetchHandler(packageJson.version)));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("prompts for space name/guide before create+join", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce("__start_disclaimer_accept__")
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("write");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "starship-01",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "For the discovery mission.",
      });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "human",
          profileId: "66666666-aaaa-bbbb-cccc-666666666666",
          profileName: "Felix",
        });
      });
    });

    expect(runSpaceCreate).toHaveBeenCalledTimes(1);
    expect(runSpaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "starship-01",
        guide: "For the discovery mission.",
        join: true,
        output: "text",
      })
    );
  });

  it("creates the space without guide when skip is selected", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock.mockResolvedValueOnce("__start_disclaimer_accept__");
    selectMock
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("skip");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "starship-02",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "agent",
          profileId: "77777777-aaaa-bbbb-cccc-777777777777",
          profileName: "Codex",
          agentName: "OpenAI Codex",
          agentModel: "gpt-5.3",
          agentOwner: "Felix",
        });
      });
    });

    expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
    expect(runSpaceCreate).toHaveBeenCalledTimes(1);
    expect(runSpaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "starship-02",
        guidePromptHandled: true,
        join: true,
      })
    );

    const callArg = vi.mocked(runSpaceCreate).mock.calls[0]?.[0];
    expect(callArg?.guide).toBeUndefined();
  });

  it("returns from guide back to the space name step", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce("__start_disclaimer_accept__")
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("write")
      .mockResolvedValueOnce("back")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("skip");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "starship-03",
      })
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "starship-03b",
      });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "human",
          profileId: "66666666-aaaa-bbbb-cccc-666666666666",
          profileName: "Felix",
        });
      });
    });

    expect(promptTextEntryMock).toHaveBeenCalledTimes(3);
    expect(runSpaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "starship-03b",
        join: true,
      })
    );
  });

  it("returns to the start action menu when create-space name backs out", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce("__start_disclaimer_accept__")
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("later");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "back",
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "human",
          profileId: "66666666-aaaa-bbbb-cccc-666666666666",
          profileName: "Felix",
        });
      });
    });

    expect(runSpaceCreate).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: expect.stringContaining("What would you like to do now?"),
      })
    );
  });

  it("returns to the start action menu when join goes back", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce("__start_disclaimer_accept__")
      .mockResolvedValueOnce("join")
      .mockResolvedValueOnce("later");
    vi.mocked(runSpaceJoin).mockResolvedValueOnce("back");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "human",
          profileId: "66666666-aaaa-bbbb-cccc-666666666666",
          profileName: "Felix",
        });
      });
    });

    expect(runSpaceJoin).toHaveBeenCalledTimes(1);
    const joinCall = vi.mocked(runSpaceJoin).mock.calls[0]?.[0];
    expect(joinCall).toEqual(
      expect.objectContaining({
        profile: "66666666-aaaa-bbbb-cccc-666666666666",
        output: "text",
        view: "human",
        allowPrompt: true,
        entryChecksHandled: true,
      })
    );
    expect(joinCall).not.toHaveProperty("confirmProfileSelection");
    expect(selectMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: expect.stringContaining("What would you like to do now?"),
      })
    );
  });

  it("returns to the start action menu when create returns back", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    selectMock
      .mockResolvedValueOnce("__start_disclaimer_accept__")
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("write")
      .mockResolvedValueOnce("later");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "starship-04",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "For the return menu case.",
      });
    vi.mocked(runSpaceCreate).mockResolvedValueOnce("back");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          view: "human",
          skillsMode: "off",
          kind: "human",
          profileId: "66666666-aaaa-bbbb-cccc-666666666666",
          profileName: "Felix",
        });
      });
    });

    expect(selectMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        message: expect.stringContaining("What would you like to do now?"),
      })
    );
  });
});
