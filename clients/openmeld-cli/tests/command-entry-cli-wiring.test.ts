import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

type CenterAgentAskCommandModule =
  typeof import("../src/center-agent/ask-command");
type CenterAgentContextCommandModule =
  typeof import("../src/center-agent/context-command");
type OrgCommandModule = typeof import("../src/org/command");
type ProfileCreationRequestCommandModule =
  typeof import("../src/profile-creation-request/command");
type SpaceCommandModule = typeof import("../src/space/command");
type SpaceMembersCommandModule = typeof import("../src/space/members-command");
type SpaceOrganizationCommandModule =
  typeof import("../src/space/organization-space-command");
type SpaceWakeControlCommandModule =
  typeof import("../src/space/wake-control-command");
type RunCommandWithEntryChecks =
  typeof import("../src/openmeld-cli-entry-checks").runCommandWithEntryChecks;

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
  runSpaceJoin: vi.fn<SpaceCommandModule["runSpaceJoin"]>(
    async () => "completed"
  ),
  runSpaceList: vi.fn<SpaceCommandModule["runSpaceList"]>(
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
  runSpaceWakeProgress: vi.fn<
    SpaceWakeControlCommandModule["runSpaceWakeProgress"]
  >(async () => undefined),
  runSpaceWakeStop: vi.fn<SpaceWakeControlCommandModule["runSpaceWakeStop"]>(
    async () => undefined
  ),
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

vi.mock("../src/openmeld-cli-entry-checks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/openmeld-cli-entry-checks")>();
  return {
    ...actual,
    runCommandWithEntryChecks: runCommandWithEntryChecksMock,
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
    runSpaceJoin: runMocks.runSpaceJoin,
    runSpaceList: runMocks.runSpaceList,
    runSpaceSend: runMocks.runSpaceSend,
  };
});

vi.mock("../src/space/members-command", async (importOriginal) => {
  const actual = await importOriginal<SpaceMembersCommandModule>();
  return {
    ...actual,
    runSpaceMembers: runMocks.runSpaceMembers,
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

  it("maps repeatable space send attachment argv to runSpaceSend", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "send",
      "--profile",
      "agt-sender",
      "--password",
      "correct-horse",
      "--attach",
      "./diagram.png",
      "--attach",
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
      attachmentPaths: ["./diagram.png", "./photo.jpg"],
      baseUrl: "https://gateway.example.test",
      entryChecksHandled: true,
      file: undefined,
      password: "correct-horse",
      plainText: true,
      profile: "agt-sender",
      replyToSignalId: "signal-parent",
      space: "space-alpha",
      stdin: false,
      text: "hello agents",
      view: "agent",
    });
  });

  it("maps space members argv to runSpaceMembers", async () => {
    await runCli([
      "space",
      "--gateway-url",
      "https://gateway.example.test",
      "members",
      "space-alpha",
      "--profile",
      "agt-reader",
      "--password",
      "space-secret",
      "--json",
    ]);

    expect(runMocks.runSpaceMembers).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceMembers).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      entryChecksHandled: true,
      json: true,
      password: "space-secret",
      profile: "agt-reader",
      space: "space-alpha",
      view: "agent",
    });
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
      "--client-message",
      "client-message-1",
      "--target-profile",
      "agt-target",
      "--password",
      "space-secret",
    ]);

    expect(runMocks.runSpaceWakeProgress).toHaveBeenCalledOnce();
    expect(runMocks.runSpaceWakeProgress).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example.test",
      clientMessageId: "client-message-1",
      entryChecksHandled: true,
      password: "space-secret",
      profile: "agt-observer",
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
      "--space",
      "space-1",
      "--source",
      "local-agent",
      "--request-key",
      "request-key-2",
      "--organization",
      "amplift",
      "--no-organization-wake-access",
    ]);

    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledOnce();
    expect(runMocks.runProfileCreationRequestCreate).toHaveBeenCalledWith({
      agentController: "builtin:codex",
      agentControllerPermissionModeInput: "approve-for-me",
      authorizeForOrganization: false,
      confirmDangerousAgentControllerPermissionMode: false,
      defaultProjectId: "project-1",
      idempotencyKey: "request-key-2",
      modelId: "gpt-5.5",
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
