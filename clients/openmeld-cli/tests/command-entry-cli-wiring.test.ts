import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

type CenterAgentAskCommandModule =
  typeof import("../src/center-agent/ask-command");
type CenterAgentContextCommandModule =
  typeof import("../src/center-agent/context-command");
type MemberAgentCommandModule = typeof import("../src/member-agents/command");
type MemberAgentSessionCommandModule =
  typeof import("../src/member-agents/session-command");
type OrgCommandModule = typeof import("../src/org/command");
type ProfileCreationRequestCommandModule =
  typeof import("../src/profile-creation-request/command");
type ProfileExecutionModeCommandModule =
  typeof import("../src/profile/execution-mode-command");
type SpaceBoardCommandModule = typeof import("../src/space/board-command");
type SpaceAccessCommandModule = typeof import("../src/space/access-command");
type SpaceAddMeCommandModule = typeof import("../src/space/add-me-command");
type SpaceCommandModule = typeof import("../src/space/command");
type SpaceLinkCommandModule = typeof import("../src/space/link-command");
type SpaceMembersCommandModule = typeof import("../src/space/members-command");
type SpaceOrganizationCommandModule =
  typeof import("../src/space/organization-space-command");
type SpaceStatusCommandModule = typeof import("../src/space/status-command");
type SpaceWakeControlCommandModule =
  typeof import("../src/space/wake-control-command");
type RunCommandWithEntryChecks =
  typeof import("../src/openmeld-cli-entry-checks").runCommandWithEntryChecks;
type ServiceCommandModule = typeof import("../src/commands/service");

const runMocks = vi.hoisted(() => ({
  runCenterAgentAsk: vi.fn<CenterAgentAskCommandModule["runCenterAgentAsk"]>(
    async () => undefined
  ),
  runCenterAgentContext: vi.fn<
    CenterAgentContextCommandModule["runCenterAgentContext"]
  >(async () => undefined),
  runCenterAgentContextReceipt: vi.fn<
    CenterAgentContextCommandModule["runCenterAgentContextReceipt"]
  >(async () => undefined),
  runAgentList: vi.fn<MemberAgentCommandModule["runAgentList"]>(
    async () => undefined
  ),
  runAgentAdd: vi.fn<MemberAgentCommandModule["runAgentAdd"]>(
    async () => undefined
  ),
  runAgentShow: vi.fn<MemberAgentCommandModule["runAgentShow"]>(
    async () => undefined
  ),
  runSessionList: vi.fn<MemberAgentSessionCommandModule["runSessionList"]>(
    async () => undefined
  ),
  runSessionDelete: vi.fn<MemberAgentSessionCommandModule["runSessionDelete"]>(
    async () => undefined
  ),
  runOrgDirectory: vi.fn<OrgCommandModule["runOrgDirectory"]>(
    async () => undefined
  ),
  runOrgComputers: vi.fn<OrgCommandModule["runOrgComputers"]>(
    async () => undefined
  ),
  runOrgInviteLink: vi.fn<OrgCommandModule["runOrgInviteLink"]>(
    async () => undefined
  ),
  runProfileCreationRequestCreate: vi.fn<
    ProfileCreationRequestCommandModule["runProfileCreationRequestCreate"]
  >(async () => undefined),
  runProfileCreationRequestPreferenceSet: vi.fn<
    ProfileCreationRequestCommandModule["runProfileCreationRequestPreferenceSet"]
  >(async () => undefined),
  runProfileExecutionMode: vi.fn<
    ProfileExecutionModeCommandModule["runProfileExecutionMode"]
  >(async () => undefined),
  runSpaceJoin: vi.fn<SpaceCommandModule["runSpaceJoin"]>(
    async () => "completed"
  ),
  runSpaceAccess: vi.fn<SpaceAccessCommandModule["runSpaceAccess"]>(
    async () => undefined
  ),
  runSpaceBoard: vi.fn<SpaceBoardCommandModule["runSpaceBoard"]>(
    async () => undefined
  ),
  runSpaceAddMe: vi.fn<SpaceAddMeCommandModule["runSpaceAddMe"]>(
    async () => "completed"
  ),
  runSpaceHistory: vi.fn<SpaceCommandModule["runSpaceHistory"]>(
    async () => undefined
  ),
  runSpaceList: vi.fn<SpaceCommandModule["runSpaceList"]>(
    async () => undefined
  ),
  runSpaceLink: vi.fn<SpaceLinkCommandModule["runSpaceLink"]>(
    async () => undefined
  ),
  runSpaceMembers: vi.fn<SpaceMembersCommandModule["runSpaceMembers"]>(
    async () => undefined
  ),
  runSpaceOrganizationList: vi.fn<
    SpaceOrganizationCommandModule["runSpaceOrganizationList"]
  >(async () => undefined),
  runSpaceSelfServeJoin: vi.fn<
    SpaceOrganizationCommandModule["runSpaceSelfServeJoin"]
  >(async () => undefined),
  runSpaceSend: vi.fn<SpaceCommandModule["runSpaceSend"]>(
    async () => undefined
  ),
  runSpaceStatus: vi.fn<SpaceStatusCommandModule["runSpaceStatus"]>(
    async () => undefined
  ),
  runSpaceWakeProgress: vi.fn<
    SpaceWakeControlCommandModule["runSpaceWakeProgress"]
  >(async () => undefined),
  runSpaceWakeStop: vi.fn<SpaceWakeControlCommandModule["runSpaceWakeStop"]>(
    async () => undefined
  ),
  runDaemonRunAfterEntryChecks: vi.fn<
    ServiceCommandModule["runDaemonRunAfterEntryChecks"]
  >(async () => ({ ok: true, reason: "started" })),
}));
const runCommandWithEntryChecksMock = vi.hoisted(() =>
  vi.fn<RunCommandWithEntryChecks>(async (input) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await input.run();
  })
);

vi.mock("../src/config/system-layout", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/config/system-layout")>();
  return {
    ...actual,
    ensureSystemLayout: vi.fn(async () => undefined),
  };
});

vi.mock(
  "../src/commands/computer-auth-handoff-recovery",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/commands/computer-auth-handoff-recovery")
      >();
    return {
      ...actual,
      // Commands still dispatch when an interrupted account's Service cannot
      // recover. Only the explicit handoff path may request that recovery.
      recoverInterruptedComputerAuthHandoff: vi.fn(() =>
        Promise.reject(new Error("Previous Computer Service cannot start"))
      ),
    };
  }
);

vi.mock("../src/openmeld-cli-entry-checks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/openmeld-cli-entry-checks")>();
  return {
    ...actual,
    runCommandWithEntryChecks: runCommandWithEntryChecksMock,
  };
});

vi.mock("../src/commands/service", async (importOriginal) => {
  const actual = await importOriginal<ServiceCommandModule>();
  return {
    ...actual,
    runDaemonRunAfterEntryChecks: runMocks.runDaemonRunAfterEntryChecks,
  };
});

vi.mock("../src/openmeld-cli-view", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/openmeld-cli-view")>();
  return {
    ...actual,
    readConfiguredDefaultView: vi.fn(async () => "auto" as const),
  };
});

vi.mock(
  "../src/local-components/managed-command-authority",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-components/managed-command-authority")
      >();
    return {
      ...actual,
      resolveManagedCliDelegation: vi.fn(async () => ({ status: "stay" })),
    };
  }
);

vi.mock("../src/member-agents/command", async (importOriginal) => {
  const actual = await importOriginal<MemberAgentCommandModule>();
  return {
    ...actual,
    runAgentList: runMocks.runAgentList,
    runAgentAdd: runMocks.runAgentAdd,
    runAgentShow: runMocks.runAgentShow,
  };
});

const memberAgentsFlag = vi.hoisted(() => ({ enabled: true }));

vi.mock("@openmeld/schemas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/schemas")>();
  return {
    ...actual,
    get MEMBER_AGENTS_ENABLED() {
      return memberAgentsFlag.enabled;
    },
  };
});

vi.mock("../src/member-agents/session-command", async (importOriginal) => {
  const actual = await importOriginal<MemberAgentSessionCommandModule>();
  return {
    ...actual,
    runSessionDelete: runMocks.runSessionDelete,
    runSessionList: runMocks.runSessionList,
  };
});

vi.mock("../src/org/command", async (importOriginal) => {
  const actual = await importOriginal<OrgCommandModule>();
  return {
    ...actual,
    runOrgComputers: runMocks.runOrgComputers,
    runOrgDirectory: runMocks.runOrgDirectory,
    runOrgInviteLink: runMocks.runOrgInviteLink,
  };
});

vi.mock("../src/profile-creation-request/command", async (importOriginal) => {
  const actual = await importOriginal<ProfileCreationRequestCommandModule>();
  return {
    ...actual,
    runProfileCreationRequestCreate: runMocks.runProfileCreationRequestCreate,
    runProfileCreationRequestPreferenceSet:
      runMocks.runProfileCreationRequestPreferenceSet,
  };
});

vi.mock("../src/profile/execution-mode-command", () => ({
  runProfileExecutionMode: runMocks.runProfileExecutionMode,
}));

vi.mock("../src/center-agent/ask-command", async (importOriginal) => {
  const actual = await importOriginal<CenterAgentAskCommandModule>();
  return {
    ...actual,
    runCenterAgentAsk: runMocks.runCenterAgentAsk,
  };
});

vi.mock("../src/center-agent/context-command", async (importOriginal) => {
  const actual = await importOriginal<CenterAgentContextCommandModule>();
  return {
    ...actual,
    runCenterAgentContext: runMocks.runCenterAgentContext,
    runCenterAgentContextReceipt: runMocks.runCenterAgentContextReceipt,
  };
});

vi.mock("../src/space/command", async (importOriginal) => {
  const actual = await importOriginal<SpaceCommandModule>();
  return {
    ...actual,
    runSpaceHistory: runMocks.runSpaceHistory,
    runSpaceJoin: runMocks.runSpaceJoin,
    runSpaceList: runMocks.runSpaceList,
    runSpaceSend: runMocks.runSpaceSend,
  };
});

vi.mock("../src/space/board-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceBoardCommandModule>();
  return {
    ...actual,
    runSpaceBoard: runMocks.runSpaceBoard,
  };
});

vi.mock("../src/space/link-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceLinkCommandModule>();
  return {
    ...actual,
    runSpaceLink: runMocks.runSpaceLink,
  };
});

vi.mock("../src/space/access-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceAccessCommandModule>();
  return {
    ...actual,
    runSpaceAccess: runMocks.runSpaceAccess,
  };
});

vi.mock("../src/space/add-me-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceAddMeCommandModule>();
  return {
    ...actual,
    runSpaceAddMe: runMocks.runSpaceAddMe,
  };
});

vi.mock("../src/space/members-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceMembersCommandModule>();
  return {
    ...actual,
    runSpaceMembers: runMocks.runSpaceMembers,
  };
});

vi.mock("../src/space/status-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceStatusCommandModule>();
  return {
    ...actual,
    runSpaceStatus: runMocks.runSpaceStatus,
  };
});

vi.mock("../src/space/organization-space-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceOrganizationCommandModule>();
  return {
    ...actual,
    runSpaceOrganizationList: runMocks.runSpaceOrganizationList,
    runSpaceSelfServeJoin: runMocks.runSpaceSelfServeJoin,
  };
});

vi.mock("../src/space/wake-control-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceWakeControlCommandModule>();
  return {
    ...actual,
    runSpaceWakeProgress: runMocks.runSpaceWakeProgress,
    runSpaceWakeStop: runMocks.runSpaceWakeStop,
  };
});

const openMeldSource = readFileSync(
  new URL("../src/openmeld.ts", import.meta.url),
  "utf8"
);
const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  process.env.OPENMELD_DAEMON_RUNTIME_DETACHED = undefined;
  process.env.OPENMELD_DAEMON_RUNTIME_SYSTEM_SERVICE = undefined;
});

describe("command entry CLI wiring", () => {
  it("uses the shared entry flow instead of old startup-only checks", () => {
    expect(openMeldSource).not.toContain("runDaemonStartupCheck(");
    expect(openMeldSource).not.toContain("maybeRunStartupUpgradeCheck(");
    expect(openMeldSource).not.toContain("runStartupLocalStateAlignment(");
    expect(openMeldSource).toContain('entryName: "root"');
    expect(openMeldSource).toContain(
      "const runtime = await resolveRuntimeContext();"
    );
    expect(
      openMeldSource.match(/runCommandWithEntryChecks\(/g)?.length ?? 0
    ).toBeGreaterThan(40);
  });

  it("shows global view options in nested command help", () => {
    expect(openMeldSource).toContain(
      "program.configureHelp({ showGlobalOptions: true });"
    );
  });

  it("keeps startup agent overviews out of normal success output", () => {
    expect(openMeldSource).toContain('argv.includes("--details")');
    expect(openMeldSource).toContain("handleExplicitHelpCommand(argv)");
  });

  it("keeps interactive service start on the shared command-entry policy", async () => {
    await runCli(["service", "start", "--mode", "background"]);

    expect(runCommandWithEntryChecksMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        routeTokens: ["service", "run"],
      })
    );
    expect(runMocks.runDaemonRunAfterEntryChecks).toHaveBeenCalledOnce();
  });

  it("enters managed system-service bootstrap before command-entry remote checks", async () => {
    process.env.OPENMELD_DAEMON_RUNTIME_DETACHED = "1";
    process.env.OPENMELD_DAEMON_RUNTIME_SYSTEM_SERVICE = "1";
    const entryCallCount = runCommandWithEntryChecksMock.mock.calls.length;
    const runCallCount =
      runMocks.runDaemonRunAfterEntryChecks.mock.calls.length;
    vi.resetModules();
    process.argv = [
      "node",
      "openmeld-command-entry-test",
      "--view",
      "agent",
      "service",
      "run",
      "--mode",
      "background",
    ];

    await import("../src/openmeld");
    await vi.waitUntil(
      () =>
        runMocks.runDaemonRunAfterEntryChecks.mock.calls.length ===
        runCallCount + 1,
      { interval: 10, timeout: 1000 }
    );

    expect(runCommandWithEntryChecksMock).toHaveBeenCalledTimes(entryCallCount);
    expect(runMocks.runDaemonRunAfterEntryChecks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: "background",
        view: "agent",
      })
    );
  });

  it("maps Center Agent ask Organization targeting to the command runner", async () => {
    await runCli([
      "center-agent",
      "ask",
      "--organization",
      "launch",
      "--via",
      "codex",
      "--session",
      "thread-1",
      "--no-wait",
      "--json",
      "Record",
      "the",
      "decision",
    ]);

    expect(runMocks.runCenterAgentAsk).toHaveBeenCalledOnce();
    expect(runMocks.runCenterAgentAsk).toHaveBeenCalledWith({
      file: undefined,
      organization: "launch",
      sessionId: "thread-1",
      stdin: false,
      text: "Record the decision",
      timeoutSeconds: undefined,
      via: "codex",
      view: "agent",
      wait: false,
    });
  });

  it("maps Center Agent context Organization targeting to the command runner", async () => {
    await runCli([
      "center-agent",
      "context",
      "--conversation",
      "selected-center-session",
      "--organization",
      "org-2",
      "--cursor",
      "older-1",
      "--limit",
      "10",
      "--max-tokens",
      "2048",
      "--json",
    ]);

    expect(runMocks.runCenterAgentContext).toHaveBeenCalledOnce();
    expect(runMocks.runCenterAgentContext).toHaveBeenCalledWith({
      cursor: "older-1",
      limit: 10,
      maxContextTokens: 2048,
      organization: "org-2",
      sessionId: undefined,
      spaceId: "selected-center-session",
      via: undefined,
      view: "agent",
    });
  });

  it("maps Center Agent context receipt Organization targeting to the command runner", async () => {
    await runCli([
      "center-agent",
      "context",
      "receipt",
      "manifest-1",
      "--all",
      "--organization",
      "launch",
      "--json",
    ]);

    expect(runMocks.runCenterAgentContextReceipt).toHaveBeenCalledOnce();
    expect(runMocks.runCenterAgentContextReceipt).toHaveBeenCalledWith({
      all: true,
      entries: [],
      manifestId: "manifest-1",
      organization: "launch",
      sessionId: undefined,
      via: undefined,
      view: "agent",
    });
  });

  it("maps repeatable Space file argv to runSpaceSend", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "send",
      "--profile",
      "agt-sender",
      "--password",
      "correct-horse",
      "--file",
      "./diagram.png",
      "--file",
      "./photo.jpg",
      "--plain",
      "--reply-to",
      "signal-parent",
      "space-alpha",
      "hello",
      "agents",
    ]);

    expect(runMocks.runSpaceSend).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceSend).toHaveBeenCalledWith({
      filePaths: ["./diagram.png", "./photo.jpg"],
      baseUrl: "https://gateway.example.test",
      entryChecksHandled: true,
      textFile: undefined,
      password: "correct-horse",
      plainText: true,
      profile: "agt-sender",
      replyToSignalId: "signal-parent",
      space: "space-alpha",
      stdin: false,
      text: "hello agents",
      view: "agent",
      wakeTargets: [],
      referenceTargets: [],
      mentionTargets: [],
    });
  });

  it("parses a Space URL before running members and keeps explicit --profile authoritative", async () => {
    await runCli([
      "space",
      "members",
      "https://openmeld.ai/o/example/spaces/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef?profileId=url-profile",
      "--profile",
      "agt-reader",
      "--password",
      "space-secret",
      "--json",
    ]);

    expect(runMocks.runSpaceMembers).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceMembers).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.ai",
      brief: false,
      entryChecksHandled: true,
      json: true,
      password: "space-secret",
      profile: "agt-reader",
      space: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      target: undefined,
      view: "agent",
    });
    expect(runCommandWithEntryChecksMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.openmeld.ai",
        profile: "agt-reader",
      })
    );
  });

  it("uses a Space URL profileId when --profile is absent", async () => {
    await runCli([
      "space",
      "members",
      "https://openmeld.ai/o/example/spaces/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef?profileId=url-profile",
    ]);

    expect(runMocks.runSpaceMembers).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.openmeld.ai",
        profile: "url-profile",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      })
    );
  });

  it("forwards add-me model selection and exact Agent Profile reuse flags", async () => {
    const spaceId =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    await runCli([
      "space",
      "add-me",
      spaceId,
      "--model",
      "gpt-5.5",
      "--reasoning-effort",
      "xhigh",
      "--agent-profile",
      "agt_known",
    ]);

    expect(runMocks.runSpaceAddMe).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceAddMe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        agentProfile: "agt_known",
        space: spaceId,
      })
    );
  });

  it("parses full Space URLs and keeps --profile authoritative for every read command", async () => {
    const spaceId =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const spaceUrl = `https://openmeld.ai/o/example/spaces/${spaceId}?profileId=url-profile`;
    const cases = [
      ["board", runMocks.runSpaceBoard],
      ["history", runMocks.runSpaceHistory],
      ["members", runMocks.runSpaceMembers],
      ["status", runMocks.runSpaceStatus],
    ] as const;

    for (const [command, runCommand] of cases) {
      runCommand.mockClear();
      await runCli(["space", command, spaceUrl, "--profile", "agt-reader"]);

      expect(runCommand).toHaveBeenCalledOnce();
      expect(runCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://gateway.openmeld.ai",
          profile: "agt-reader",
          space: spaceId,
        })
      );
    }
  });

  it("preserves copied message focus when resolving Space access", async () => {
    const spaceId =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const spaceUrl = `https://openmeld.ai/o/example/spaces/${spaceId}?focusSignalId=signal-123&focusThreadRootSignalId=thread-123&profileId=url-profile`;

    await runCli([
      "space",
      "access",
      spaceUrl,
      "--profile",
      "agt-reader",
      "--password",
      "space-secret",
      "--json",
    ]);

    expect(runMocks.runSpaceAccess).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceAccess).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.ai",
      json: true,
      password: "space-secret",
      profile: "agt-reader",
      signalId: "signal-123",
      space: spaceId,
      threadRootSignalId: "thread-123",
      view: "agent",
    });
    expect(runCommandWithEntryChecksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonOutput: true,
        routeTokens: ["space", "access"],
      })
    );
  });

  it("maps a passive Space message link without running entry checks", async () => {
    const spaceId =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const signalId = "11111111-1111-4111-8111-111111111111";
    const threadRootSignalId = "22222222-2222-4222-8222-222222222222";
    const entryCheckCount = runCommandWithEntryChecksMock.mock.calls.length;

    await runPassiveCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "link",
      spaceId,
      "--signal",
      signalId,
      "--thread-root-signal",
      threadRootSignalId,
    ]);

    expect(runMocks.runSpaceLink).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceLink).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      signalId,
      space: spaceId,
      threadRootSignalId,
      view: "agent",
    });
    expect(runCommandWithEntryChecksMock).toHaveBeenCalledTimes(
      entryCheckCount
    );
  });

  it("maps space list --organization argv to the Organization directory runner", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "list",
      "--organization",
      "--limit",
      "7",
      "--profile",
      "agt-reader",
      "--json",
    ]);

    expect(runMocks.runSpaceOrganizationList).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceOrganizationList).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      entryChecksHandled: true,
      json: true,
      limit: 7,
      profile: "agt-reader",
      view: "agent",
    });
    expect(runMocks.runSpaceList).not.toHaveBeenCalled();
  });

  it("maps space join --self-serve argv to runSpaceSelfServeJoin", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "join",
      "space-public",
      "--self-serve",
      "--password",
      "space-secret",
      "--profile",
      "human-member",
    ]);

    expect(runMocks.runSpaceSelfServeJoin).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceSelfServeJoin).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      entryChecksHandled: true,
      profile: "human-member",
      password: "space-secret",
      space: "space-public",
      view: "agent",
    });
    expect(runMocks.runSpaceJoin).not.toHaveBeenCalled();
  });

  it("maps space wake-progress selectors to runSpaceWakeProgress", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "wake-progress",
      "space-alpha",
      "--profile",
      "agt-observer",
      "--target-profile",
      "agt-target",
      "--source-profile",
      "human-source",
      "--password",
      "space-secret",
    ]);

    expect(runMocks.runSpaceWakeProgress).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceWakeProgress).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      clientMessageId: undefined,
      entryChecksHandled: true,
      password: "space-secret",
      profile: "agt-observer",
      sourceProfileId: "human-source",
      space: "space-alpha",
      targetProfileId: "agt-target",
      view: "agent",
    });
  });

  it("maps space wake-stop selectors to runSpaceWakeStop", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "wake-stop",
      "space-alpha",
      "--profile",
      "agt-operator",
      "--source-signal",
      "signal-source",
      "--target-profile",
      "agt-target",
      "--reason",
      "Stop duplicate work",
      "--password",
      "space-secret",
    ]);

    expect(runMocks.runSpaceWakeStop).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceWakeStop).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      clientMessageId: undefined,
      entryChecksHandled: true,
      password: "space-secret",
      profile: "agt-operator",
      reason: "Stop duplicate work",
      sourceSignalId: "signal-source",
      space: "space-alpha",
      targetProfileId: "agt-target",
      view: "agent",
    });
  });

  it("maps agent list and agent show argv to the MemberAgent commands", async () => {
    await runCli(["agent", "list"], "human");
    expect(runCommandWithEntryChecksMock.mock.calls.at(-1)?.[0]).toMatchObject({
      routeTokens: ["agent", "list"],
    });
    expect(runMocks.runAgentList).toHaveBeenCalledWith({ view: "human" });

    await runCli(["agent", "show", "codex"]);
    expect(runCommandWithEntryChecksMock.mock.calls.at(-1)?.[0]).toMatchObject({
      routeTokens: ["agent", "show"],
    });
    expect(runMocks.runAgentShow).toHaveBeenCalledWith({
      memberAgent: "codex",
      view: "agent",
    });

    await runCli(["agent", "add", "opencode"], "human");
    expect(runCommandWithEntryChecksMock.mock.calls.at(-1)?.[0]).toMatchObject({
      routeTokens: ["agent", "add"],
    });
    expect(runMocks.runAgentAdd).toHaveBeenCalledWith({
      harness: "opencode",
      view: "human",
    });
  });

  it("maps session list and session delete argv to the Session commands", async () => {
    await runCli(
      [
        "session",
        "list",
        "--agent",
        "codex",
        "--profile",
        "agt_1",
        "--limit",
        "5",
      ],
      "human"
    );
    expect(runCommandWithEntryChecksMock.mock.calls.at(-1)?.[0]).toMatchObject({
      routeTokens: ["session", "list"],
    });
    expect(runMocks.runSessionList).toHaveBeenCalledWith({
      limit: "5",
      memberAgent: "codex",
      profile: "agt_1",
      view: "human",
    });

    await runCli(["session", "delete", "dm-1", "--yes"]);
    expect(runCommandWithEntryChecksMock.mock.calls.at(-1)?.[0]).toMatchObject({
      routeTokens: ["session", "delete"],
    });
    expect(runMocks.runSessionDelete).toHaveBeenCalledWith({
      spaceId: "dm-1",
      view: "agent",
      yes: true,
    });
  });

  it("skips entry checks for agent and session commands while the flag is off", async () => {
    memberAgentsFlag.enabled = false;
    try {
      const entryCallCount = runCommandWithEntryChecksMock.mock.calls.length;
      await runFlagOffCli(["agent", "list"], runMocks.runAgentList);
      await runFlagOffCli(
        ["session", "delete", "dm-1"],
        runMocks.runSessionDelete
      );
      expect(runCommandWithEntryChecksMock.mock.calls.length).toBe(
        entryCallCount
      );
      expect(runMocks.runAgentList).toHaveBeenLastCalledWith({ view: "human" });
      expect(runMocks.runSessionDelete).toHaveBeenLastCalledWith({
        spaceId: "dm-1",
        view: "human",
        yes: false,
      });
    } finally {
      memberAgentsFlag.enabled = true;
    }
  });

  it("maps org directory argv to runOrgDirectory", async () => {
    await runCli(["org", "directory", "--json"], "human");

    expect(runMocks.runOrgDirectory).toHaveBeenCalledOnce();
    expect(runMocks.runOrgDirectory).toHaveBeenCalledWith({
      json: true,
      view: "agent",
    });
  });

  it("maps org computers argv to the shared Organization Computers projection", async () => {
    await runCli(["org", "computers", "--json"], "human");

    expect(runMocks.runOrgComputers).toHaveBeenCalledOnce();
    expect(runMocks.runOrgComputers).toHaveBeenCalledWith({
      json: true,
      view: "agent",
    });
  });

  it.each([
    "get",
    "create",
    "revoke",
  ] as const)("maps org invite-link %s argv to runOrgInviteLink", async (action) => {
    await runCli(["org", "invite-link", action, "--json"], "human");

    expect(runMocks.runOrgInviteLink).toHaveBeenCalledOnce();
    expect(runMocks.runOrgInviteLink).toHaveBeenCalledWith({
      action,
      json: true,
      view: "agent",
    });
  });

  it.each([
    undefined,
    "serial",
    "parallel",
  ])("routes execution-mode %s through the checked CLI entry", async (mode) => {
    await runCli([
      "profiles",
      "execution-mode",
      "agt_11111111-1111-4111-8111-111111111111",
      ...(mode ? ["--mode", mode] : []),
    ]);
    expect(runMocks.runProfileExecutionMode).toHaveBeenCalledExactlyOnceWith({
      profile: "agt_11111111-1111-4111-8111-111111111111",
      mode,
      view: "agent",
    });
    expect(runCommandWithEntryChecksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTokens: ["profile", "execution-mode"],
        view: "agent",
      })
    );
  });

  it("maps Agent Profile creation request argv to the request runner", async () => {
    await runCli([
      "profiles",
      "requests",
      "create",
      "Review Agent",
      "--owner",
      "user-2",
      "--session",
      "fork",
      "--native-session",
      "01-native-session",
      "--space",
      "space-1",
      "--source",
      "local-agent",
      "--request-key",
      "request-key-1",
      "--organization",
      "amplift",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledOnce();
    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith({
      idempotencyKey: "request-key-1",
      nativeSessionId: "01-native-session",
      organization: "amplift",
      profileName: "Review Agent",
      requestedSpaceId: "space-1",
      sessionStrategy: "fork",
      source: "local-agent",
      targetOwner: "user-2",
      view: "agent",
    });
  });

  it("uses profiles create as the unified entry for a teammate-owned Agent", async () => {
    await runCli([
      "profiles",
      "create",
      "Review Agent",
      "--kind",
      "agent",
      "--owner",
      "user-2",
      "--agent-controller",
      "builtin:codex",
      "--computer",
      "computer-2",
      "--project",
      "project-1",
      "--model",
      "gpt-5.5",
      "--reasoning-effort",
      "high",
      "--agent-controller-permission-mode",
      "approve-for-me",
      "--agent-controller-collaboration-mode",
      "codex:plan",
      "--open-code-permission",
      '{"edit":"allow"}',
      "--space",
      "space-1",
      "--source",
      "local-agent",
      "--request-key",
      "request-key-2",
      "--organization",
      "amplift",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledOnce();
    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith({
      agentController: "builtin:codex",
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionModeInput: "approve-for-me",
      confirmDangerousAgentControllerPermissionMode: false,
      defaultProjectId: "project-1",
      idempotencyKey: "request-key-2",
      modelId: "gpt-5.5",
      openCodePermissionInput: '{"edit":"allow"}',
      nativeSessionId: undefined,
      organization: "amplift",
      profileName: "Review Agent",
      reasoningLevel: "high",
      requestedSpaceId: "space-1",
      sessionStrategy: "new",
      source: "local-agent",
      targetComputerId: "computer-2",
      targetOwner: "user-2",
      view: "agent",
    });
  });

  it("rejects a legacy conversation flag before an owner-request create can drop it", async () => {
    await expect(
      runCli([
        "profiles",
        "create",
        "Current Codex",
        "--kind",
        "agent",
        "--agent-controller",
        "builtin:codex",
        "--agent-controller-conversation-id",
        "thread-1",
        "--organization",
        "amplift",
      ])
    ).rejects.toThrow("Use --session resume --native-session <id> instead.");
    expect(runMocks.runProfileCreationRequestCreate).not.toHaveBeenCalled();
  });

  it("uses the same creation request contract for the current user's advanced choices", async () => {
    await runCli([
      "profiles",
      "create",
      "Planning Agent",
      "--kind",
      "agent",
      "--agent-controller",
      "builtin:codex",
      "--computer",
      "computer-1",
      "--project",
      "project-1",
      "--agent-controller-collaboration-mode",
      "codex:plan",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentController: "builtin:codex",
        agentControllerCollaborationMode: "codex:plan",
        defaultProjectId: "project-1",
        profileName: "Planning Agent",
        targetComputerId: "computer-1",
        targetOwner: "self",
      })
    );
  });

  it("routes Remote Agent creation through the shared request", async () => {
    await runCli([
      "profiles",
      "create",
      "Remote Reviewer",
      "--kind",
      "agent",
      "--agent-controller",
      "hosted:remote-agent",
      "--model",
      "openai/gpt-6-sol",
      "--reasoning-effort",
      "medium",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentController: "hosted:remote-agent",
        modelId: "openai/gpt-6-sol",
        reasoningLevel: "medium",
      })
    );
  });

  it("maps --no-default-project to an explicit managed-workspace choice", async () => {
    await runCli([
      "profiles",
      "create",
      "Managed Workspace Agent",
      "--kind",
      "agent",
      "--agent-controller",
      "builtin:codex",
      "--computer",
      "computer-1",
      "--no-default-project",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultProjectId: undefined,
        profileName: "Managed Workspace Agent",
        reuseSavedDefaultProject: false,
        targetOwner: "self",
      })
    );
  });

  it("maps Agent Profile creation approval preferences to the request runner", async () => {
    await runCli([
      "profiles",
      "requests",
      "preferences",
      "set",
      "--new-session",
      "automatically-allow",
      "--existing-session",
      "ask-every-time",
      "--organization",
      "org-1",
    ]);

    expect(
      runMocks.runProfileCreationRequestPreferenceSet
    ).toHaveBeenCalledOnce();
    expect(
      runMocks.runProfileCreationRequestPreferenceSet
    ).toHaveBeenCalledWith({
      existingSessionPolicy: "ask-every-time",
      newSessionPolicy: "automatically-allow",
      organization: "org-1",
      view: "agent",
    });
  });
});

async function runCli(
  argv: string[],
  view: "agent" | "human" = "agent"
): Promise<void> {
  vi.resetModules();
  process.argv = [
    "node",
    "openmeld-command-entry-test",
    "--view",
    view,
    ...argv,
  ];
  const callIndex = runCommandWithEntryChecksMock.mock.calls.length;
  await import("../src/openmeld");
  await vi.waitUntil(
    () => runCommandWithEntryChecksMock.mock.calls.length === callIndex + 1,
    { interval: 10, timeout: 1000 }
  );
  await runCommandWithEntryChecksMock.mock.results[callIndex]?.value;
  if (process.exitCode) {
    throw new Error(`CLI parsing failed with exit code ${process.exitCode}.`);
  }
}

async function runFlagOffCli(
  argv: string[],
  runMock: { mock: { calls: unknown[]; results: { value: unknown }[] } }
): Promise<void> {
  vi.resetModules();
  process.argv = [
    "node",
    "openmeld-command-entry-test",
    "--view",
    "human",
    ...argv,
  ];
  const callIndex = runMock.mock.calls.length;
  await import("../src/openmeld");
  await vi.waitUntil(() => runMock.mock.calls.length === callIndex + 1, {
    interval: 10,
    timeout: 1000,
  });
  await runMock.mock.results[callIndex]?.value;
}

async function runPassiveCli(
  argv: string[],
  view: "agent" | "human" = "agent"
): Promise<void> {
  vi.resetModules();
  process.argv = [
    "node",
    "openmeld-command-entry-test",
    "--view",
    view,
    ...argv,
  ];
  const callIndex = runMocks.runSpaceLink.mock.calls.length;
  await import("../src/openmeld");
  await vi.waitUntil(
    () => runMocks.runSpaceLink.mock.calls.length === callIndex + 1,
    { interval: 10, timeout: 1000 }
  );
  await runMocks.runSpaceLink.mock.results[callIndex]?.value;
  if (process.exitCode) {
    throw new Error(`CLI parsing failed with exit code ${process.exitCode}.`);
  }
}
