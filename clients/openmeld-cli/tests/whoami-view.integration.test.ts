import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWhoami } from "../src/commands/whoami";
import { setAuthSession } from "../src/config/auth-session";
import type {
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../src/config/daemon-state";
import { setSelectedOpenMeldProfileId } from "../src/config/openmeld-profile-selection";
import { resolveOpenMeldProfileOrNull } from "../src/config/resolve-openmeld-profile";
import { setConfiguredDeviceRuntimeState } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type AgentViewLine = {
  type: string;
  code: string;
  payload?: Record<string, unknown>;
};

function parseAgentViewLines(stdout: string): AgentViewLine[] {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentViewLine);
}

function expectAgentViewLine(
  lines: AgentViewLine[],
  code: string
): AgentViewLine {
  const line = lines.find((candidate) => candidate.code === code);
  if (!line) {
    throw new Error(`Expected agent view line with code ${code}`);
  }
  return line;
}

const {
  getDaemonRuntimeStatusMock,
  getDaemonStatusMock,
  listOpenMeldProfilesMock,
  readCurrentDaemonRuntimeContextMock,
  readDaemonServiceContractMock,
  resolveAgentProfileRuntimeStateMock,
} = vi.hoisted(() => ({
  getDaemonRuntimeStatusMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  listOpenMeldProfilesMock: vi.fn(),
  readCurrentDaemonRuntimeContextMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  resolveAgentProfileRuntimeStateMock: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    listOpenMeldProfiles: listOpenMeldProfilesMock,
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: vi.fn(),
  };
});

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonRuntimeStatus: getDaemonRuntimeStatusMock,
    getDaemonStatus: getDaemonStatusMock,
  };
});

vi.mock("../src/runtime/agent-profile-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runtime/agent-profile-state")
  >("../src/runtime/agent-profile-state");
  return {
    ...actual,
    resolveAgentProfileRuntimeState: resolveAgentProfileRuntimeStateMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => {
  return {
    readCurrentDaemonRuntimeContext: readCurrentDaemonRuntimeContextMock,
  };
});

vi.mock("../src/config/daemon-service-contract", () => {
  return {
    readDaemonServiceContract: readDaemonServiceContractMock,
  };
});

const createDaemonStatus = (installed: boolean): DaemonStatus => {
  if (!installed) {
    return {
      installed: false,
      state: null,
    };
  }

  return {
    installed: true,
    state: {
      v: 1,
      schema: "openmeld-daemon-install-v1",
      daemonVersion: "0.2.0",
      installSource: "daemon.command.install",
      installedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  };
};

const createDaemonRuntimeStatus = (
  status: DaemonServiceRuntimeStatus["status"],
  input?: {
    autoStart?: boolean;
    serviceController?:
      | "launchd"
      | "systemd"
      | "windows-service"
      | "legacy-detached"
      | "unknown";
  }
): DaemonServiceRuntimeStatus => ({
  status,
  mode: status === "running" ? "background" : null,
  pid: status === "running" ? 123 : null,
  startedAt: status === "running" ? "2026-03-01T00:00:00.000Z" : null,
  updatedAt: status === "running" ? "2026-03-01T00:00:00.000Z" : null,
  managedBySystemService: false,
  serviceController: input?.serviceController ?? "unknown",
  autoStart: input?.autoStart ?? false,
  ...(status === "stale" ? { reason: "heartbeat_stale" } : {}),
});

const createCurrentDaemonRuntimeContext = (input?: {
  installed?: boolean;
  effectiveRuntimeStatus?: "running" | "stale" | "not_running" | "unknown";
  autoStart?: boolean;
  serviceController?:
    | "launchd"
    | "systemd"
    | "windows-service"
    | "legacy-detached"
    | "unknown";
}) => {
  const installed = input?.installed ?? false;
  const effectiveRuntimeStatus = input?.effectiveRuntimeStatus ?? "not_running";
  return {
    status: createDaemonStatus(installed),
    runtimeStatus: createDaemonRuntimeStatus(
      effectiveRuntimeStatus === "running" ? "running" : "not_running",
      {
        autoStart: input?.autoStart,
        serviceController: input?.serviceController,
      }
    ),
    serviceManager: null,
    serviceManagerStatus: null,
    legacySharedService: null,
    effectiveRuntimeStatus,
  };
};

describe("whoami view mode", () => {
  beforeEach(() => {
    readCurrentDaemonRuntimeContextMock.mockResolvedValue(
      createCurrentDaemonRuntimeContext()
    );
    readDaemonServiceContractMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    getDaemonRuntimeStatusMock.mockReset();
    getDaemonStatusMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    readCurrentDaemonRuntimeContextMock.mockReset();
    readDaemonServiceContractMock.mockReset();
    resolveAgentProfileRuntimeStateMock.mockReset();
  });

  it("renders identity card in human view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-felix",
          email: "felix@openmeld.invalid",
          name: "Felix",
        },
        activeOrganization: {
          id: "org-felix",
          slug: "launch",
          name: "Launch Team",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "felix--aaaaaaaa",
        profileName: "Felix",
        profileHandle: "felix",
        profileKind: "human",
        status: "active",
        ownerUserId: "user-felix",
        source: "cli_create",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({ profile: "felix--aaaaaaaa", view: "human" });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Authentication Status");
      expect(stdout).toContain(
        "Signed-in Account: Felix <felix@openmeld.invalid>"
      );
      expect(stdout).toContain("Active Organization: Launch Team (launch)");
      expect(stdout).toContain("Command Profile: 👤 Felix");
      expect(stdout).toContain("Profile Type: 👤 Human");
      expect(stdout).toContain("Profile ID: felix--aaaaaaaa");
      expect(stdout).toContain("Daemon Service Context: not installed");
      expect(stdout).toContain("OpenMeld Service Profile: not set");
      expect(stdout).not.toContain("Profile Status:");
      expect(stdout).not.toContain("Gateway");
      expect(stdout).not.toContain("URL: https://gateway.openmeld.invalid");
    });
  });

  it("merges missing profile guidance into the authentication card with openmeld-canary commands", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-canary");

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-profile-missing",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-felix",
          email: "felix@openmeld.invalid",
          name: "Felix",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(null);
      listOpenMeldProfilesMock.mockResolvedValueOnce([]);

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({ view: "human" });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Authentication Status");
      expect(stdout).toContain("Selected Shell Profile: not selected yet");
      expect(stdout).toContain(
        "Why it matters: OpenMeld uses a profile to know which person or agent this command should use."
      );
      expect(stdout).toContain(
        "Next step: Run `openmeld-canary start` to choose or create a profile."
      );
      expect(stdout).toContain(
        "Shortcut: Or run `openmeld-canary profiles create <profile-name>` to create one directly."
      );
      expect(stdout).not.toContain("OpenMeld Profile Needed");
      expect(stdout.match(/Authentication Status/g)).toHaveLength(1);
    });
  });

  it("formats missing profile recovery with the npx entry command", async () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-profile-existing",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-felix",
          email: "felix@openmeld.invalid",
          name: "Felix",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(null);
      listOpenMeldProfilesMock.mockResolvedValueOnce([
        {
          openMeldProfileId: "felix-existing",
          profileName: "Felix",
          profileHandle: "felix",
          profileKind: "human",
          status: "active",
          ownerUserId: "user-felix",
          source: "cli_create",
          createdByUserId: "user-felix",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({ view: "human" });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain(
        "Next step: Run `npx -y openmeld@latest profiles set <profile-id>` to choose a profile."
      );
      expect(stdout).toContain(
        "Shortcut: Or run `npx -y openmeld@latest whoami --profile <profile-id>` for this command only."
      );
    });
  });

  it("emits structured JSON envelopes in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-2",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        replyReadiness: "blocked",
        replyReadinessLabel: "blocked (local agent connection is missing)",
        replyReadinessReasonCodes: ["profile.unbound"],
        replyReadinessReasonText: "local agent connection is missing",
        autoReplyReady: false,
        autoReplyReason: "local agent connection is missing",
      });
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex--bbbbbbbb",
        profileName: "Codex",
        profileHandle: "codex",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-codex",
        source: "cli_create",
        createdByUserId: "user-codex",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "codex--bbbbbbbb", view: "agent" });
      });

      expect(stderr).toBe("");
      const lines = parseAgentViewLines(stdout);
      expect(lines).toHaveLength(4);
      expect(lines).not.toContainEqual(
        expect.objectContaining({ code: "whoami.agent_overview" })
      );
      expect(lines[0]).toMatchObject({
        type: "info",
        code: "whoami.loaded",
      });
      expect(lines[1]).toMatchObject({
        type: "result",
        code: "whoami.openmeld_profile",
        payload: {
          profileName: "Codex",
          profileKind: "agent",
        },
      });
      expect(lines[2]).toMatchObject({
        type: "result",
        code: "whoami.auth",
      });
      expect(expectAgentViewLine(lines, "whoami.context")).toMatchObject({
        type: "result",
        code: "whoami.context",
        payload: {
          authAccount: {
            state: "valid",
          },
          selectedProfile: {
            profileName: "Codex",
            profileKind: "agent",
          },
          daemonServiceContext: {
            effectiveRuntimeStatus: "not_installed",
            profileId: null,
          },
          agentProfileState: {},
          agentProfileRuntime: {
            transportMode: "local-cli",
            replyReadiness: "blocked",
            replyReadinessReasonCodes: ["profile.unbound"],
            autoReplyReady: false,
            autoReplyReason: "local agent connection is missing",
          },
        },
      });
    });
  });

  it("keeps local service profileName plain in machine-readable whoami context", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-plain-profile-name",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      readCurrentDaemonRuntimeContextMock.mockResolvedValueOnce(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
        })
      );
      readDaemonServiceContractMock.mockResolvedValueOnce({
        daemonVersion: "0.2.0",
        profileId: "codex--bbbbbbbb",
      });
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex--bbbbbbbb",
        profileName: "Codex",
        profileHandle: "codex",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-codex",
        source: "cli_create",
        createdByUserId: "user-codex",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        replyReadiness: "blocked",
        replyReadinessLabel: "blocked (local agent connection is missing)",
        replyReadinessReasonCodes: ["profile.unbound"],
        replyReadinessReasonText: "local agent connection is missing",
        autoReplyReady: false,
        autoReplyReason: "local agent connection is missing",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "codex--bbbbbbbb", view: "agent" });
      });

      const context = expectAgentViewLine(
        parseAgentViewLines(stdout),
        "whoami.context"
      );
      expect(context.payload?.daemonServiceContext).toMatchObject({
        effectiveRuntimeStatus: "running",
        profileId: "codex--bbbbbbbb",
        profileName: "Codex",
      });
      expect(context.payload?.profileAlignment).toMatchObject({
        status: "shell_profile_not_selected",
        serviceProfileId: "codex--bbbbbbbb",
        shellSelectedProfileId: null,
      });
    });
  });

  it("reports shell and OpenMeld Service profile drift separately from the explicit command profile", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-drift-human",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      await setSelectedOpenMeldProfileId("agt-shell-profile");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      readCurrentDaemonRuntimeContextMock.mockResolvedValueOnce(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
        })
      );
      readDaemonServiceContractMock.mockResolvedValueOnce({
        daemonVersion: "0.2.0",
        profileId: "agt-service-profile",
      });
      vi.mocked(resolveOpenMeldProfileOrNull)
        .mockResolvedValueOnce({
          openMeldProfileId: "agt-explicit-profile",
          profileName: "Explicit Bot",
          profileHandle: "explicit-bot",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-codex",
          source: "cli_create",
          createdByUserId: "user-codex",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
        .mockResolvedValueOnce({
          openMeldProfileId: "agt-shell-profile",
          profileName: "Shell Bot",
          profileHandle: "shell-bot",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-codex",
          source: "cli_create",
          createdByUserId: "user-codex",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        localAgentId: "codex",
        localAgentDisplayName: "Codex",
        localAgentEnabled: true,
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({
            profile: "agt-explicit-profile",
            view: "human",
          });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Command Profile: 🤖 Explicit Bot");
      expect(stdout).toContain("Selected Shell Profile: 🤖 Shell Bot");
      expect(stdout).toContain("OpenMeld Service Profile: agt-service-profile");
      expect(stdout).toContain(
        "Profile Alignment: Shell default and OpenMeld Service default are different"
      );
      expect(stdout).toContain(
        "Why it matters: Commands without --profile use the shell default. Background replies use the OpenMeld Service default. This is OK when you intentionally inspect a specific profile."
      );
      expect(stdout).toContain(
        "Next step: Run `openmeld service status --view human`."
      );
      expect(stdout).toContain(
        "Shortcut: Or run `openmeld profiles set agt-service-profile --view human`."
      );
    });
  });

  it("includes shell profile drift diagnostics in machine-readable whoami context", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-drift-agent",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      await setSelectedOpenMeldProfileId("agt-shell-profile");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      readCurrentDaemonRuntimeContextMock.mockResolvedValueOnce(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
        })
      );
      readDaemonServiceContractMock.mockResolvedValueOnce({
        daemonVersion: "0.2.0",
        profileId: "agt-service-profile",
      });
      vi.mocked(resolveOpenMeldProfileOrNull)
        .mockResolvedValueOnce({
          openMeldProfileId: "agt-explicit-profile",
          profileName: "Explicit Bot",
          profileHandle: "explicit-bot",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-codex",
          source: "cli_create",
          createdByUserId: "user-codex",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
        .mockResolvedValueOnce({
          openMeldProfileId: "agt-shell-profile",
          profileName: "Shell Bot",
          profileHandle: "shell-bot",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-codex",
          source: "cli_create",
          createdByUserId: "user-codex",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        localAgentId: "codex",
        localAgentDisplayName: "Codex",
        localAgentEnabled: true,
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({
          profile: "agt-explicit-profile",
          view: "agent",
        });
      });

      const context = expectAgentViewLine(
        parseAgentViewLines(stdout),
        "whoami.context"
      );
      expect(context.payload?.selectedProfile).toMatchObject({
        openMeldProfileId: "agt-explicit-profile",
      });
      expect(context.payload?.selectedShellProfile).toMatchObject({
        openMeldProfileId: "agt-shell-profile",
      });
      expect(context.payload?.profileAlignment).toMatchObject({
        status: "drifted",
        shellSelectedProfileId: "agt-shell-profile",
        serviceProfileId: "agt-service-profile",
        nextSteps: [
          "openmeld service status --view agent",
          "openmeld profiles set agt-service-profile --view agent",
        ],
      });
    });
  });

  it("reports unknown daemon runtime status when runtime inspection fails unexpectedly", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-runtime-unknown",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      readCurrentDaemonRuntimeContextMock.mockRejectedValueOnce(
        new Error("runtime inspection failed")
      );
      getDaemonStatusMock.mockRejectedValueOnce(
        new Error("secondary status lookup failed")
      );
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex--bbbbbbbb",
        profileName: "Codex",
        profileHandle: "codex",
        profileKind: "agent",
        status: "active",
        ownerUserId: "user-codex",
        source: "cli_create",
        createdByUserId: "user-codex",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        replyReadiness: "blocked",
        replyReadinessLabel: "blocked (local agent connection is missing)",
        replyReadinessReasonCodes: ["profile.unbound"],
        replyReadinessReasonText: "local agent connection is missing",
        autoReplyReady: false,
        autoReplyReason: "local agent connection is missing",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "codex--bbbbbbbb", view: "agent" });
      });

      const context = expectAgentViewLine(
        parseAgentViewLines(stdout),
        "whoami.context"
      );
      expect(context.payload?.daemonServiceContext).toMatchObject({
        installed: false,
        effectiveRuntimeStatus: "unknown",
      });
    });
  });

  it("suggests selecting or passing an existing agent profile when none is selected", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-2",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(null);
      listOpenMeldProfilesMock.mockResolvedValueOnce([
        {
          openMeldProfileId: "agt_existing",
          profileName: "Existing Agent",
          profileHandle: "existing-agent",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-codex",
          source: "cli_create",
          createdByUserId: "user-codex",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runWhoami({ view: "agent" });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      const missingLine = lines.find(
        (line) =>
          line.type === "result" && line.code === "whoami.profile_missing"
      );
      expect(missingLine).toMatchObject({
        payload: {
          hint: "run `openmeld profiles set <profile-id> --view agent` or rerun with `openmeld whoami --profile <profile-id> --view agent`",
          nextSteps: [
            "openmeld profiles list --view agent",
            "openmeld profiles set <profile-id> --view agent",
            "openmeld whoami --profile <profile-id> --view agent",
          ],
          profilesFound: true,
          eligibleProfileCount: 1,
        },
      });
    });
  });

  it("suggests creating an agent profile when none exist in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-2",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(null);
      listOpenMeldProfilesMock.mockResolvedValueOnce([]);

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runWhoami({ view: "agent" });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      const missingLine = lines.find(
        (line) =>
          line.type === "result" && line.code === "whoami.profile_missing"
      );
      expect(missingLine).toMatchObject({
        payload: {
          hint: "run `openmeld profiles create <profile-name> --kind agent --view agent`",
          nextSteps: [
            "openmeld profiles create <profile-name> --kind agent --view agent",
            "openmeld profiles list --view agent",
            "openmeld whoami --profile <profile-id> --view agent",
          ],
          profilesFound: false,
          eligibleProfileCount: 0,
        },
      });
    });
  });

  it("emits a lookup-failed payload instead of profile_missing when profile resolution fails", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-lookup-failed",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockRejectedValueOnce(
        new Error("profile service offline")
      );

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runWhoami({ view: "agent" });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(
        lines.find(
          (line) =>
            line.type === "result" && line.code === "whoami.profile_missing"
        )
      ).toBeUndefined();
      const failedLine = lines.find(
        (line) =>
          line.type === "result" && line.code === "whoami.profile_lookup_failed"
      );
      expect(failedLine).toMatchObject({
        payload: {
          summary: "OpenMeld could not load the selected profile right now.",
          details: "profile service offline",
          nextSteps: [
            "openmeld auth status --view agent",
            "openmeld profiles list --view agent",
          ],
        },
      });
    });
  });

  it("shows agent owner in identity card when present", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-3",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-owner",
          email: "owner@openmeld.invalid",
          name: "Felix",
        },
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z",
          },
        ],
      });
      getDaemonStatusMock.mockResolvedValue(createDaemonStatus(true));
      getDaemonRuntimeStatusMock.mockResolvedValue(
        createDaemonRuntimeStatus("running")
      );
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
          autoStart: false,
          serviceController: "launchd",
        })
      );
      readDaemonServiceContractMock.mockResolvedValue({
        daemonVersion: "0.2.0",
        profileId: "codex-owner--cccccccc",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        localAgentId: "codex",
        localAgentDisplayName: "Codex",
        localAgentEnabled: true,
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex-owner--cccccccc",
        profileName: "Codex",
        profileHandle: "codex",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Felix",
        source: "cli_create",
        createdByUserId: "user-owner",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({ profile: "codex-owner--cccccccc", view: "human" });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Command Profile: 🤖 Codex");
      expect(stdout).toContain("Profile Type: 🤖 Agent");
      expect(stdout).not.toContain("Profile Status:");
      expect(stdout).toContain("Daemon Service Context: running");
      expect(stdout).toContain("OpenMeld Service Profile: 🤖 Codex");
      expect(stdout).toContain("Local agent selection: Selected");
      expect(stdout).toContain("Agent: Codex");
      expect(stdout).toContain("Agent On: On");
      expect(stdout).toContain("Connection Type: Local CLI");
      expect(stdout).toContain("Can Reply in Space: Can reply");
      expect(stdout).not.toContain("Auto-Reply:");
    });
  });

  it("shows default transport mode and actionable reason when local projection is missing", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-3",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-owner",
          email: "owner@openmeld.invalid",
          name: "Felix",
        },
      });
      getDaemonStatusMock.mockResolvedValue(createDaemonStatus(true));
      getDaemonRuntimeStatusMock.mockResolvedValue(
        createDaemonRuntimeStatus("running")
      );
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
          serviceController: "launchd",
        })
      );
      readDaemonServiceContractMock.mockResolvedValue({
        daemonVersion: "0.2.0",
        profileId: "codex-owner--missing-local-projection",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        replyReadiness: "blocked",
        replyReadinessLabel:
          "blocked (local device runtime projection is missing (run `openmeld doctor --repair`))",
        replyReadinessReasonCodes: ["projection.missing"],
        replyReadinessReasonText:
          "local device runtime projection is missing (run `openmeld doctor --repair`)",
        autoReplyReady: false,
        autoReplyReason:
          "local device runtime projection is missing (run `openmeld doctor --repair`)",
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex-owner--missing-local-projection",
        profileName: "Codex Missing Local Projection",
        profileHandle: "codex-missing-local-projection",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Felix",
        source: "cli_create",
        createdByUserId: "user-owner",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({
            profile: "codex-owner--missing-local-projection",
            view: "human",
          });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Connection Type: Local CLI");
      expect(stdout).toContain(
        "Can Reply in Space: Blocked (OpenMeld is still setting up this device (run `openmeld doctor --repair`))"
      );
    });
  });

  it("shows unified workspace facts for agent profiles in human view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-workspace-human",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-owner",
          email: "owner@openmeld.invalid",
          name: "Felix",
        },
      });
      getDaemonStatusMock.mockResolvedValue(createDaemonStatus(true));
      getDaemonRuntimeStatusMock.mockResolvedValue(
        createDaemonRuntimeStatus("running")
      );
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
          serviceController: "launchd",
        })
      );
      readDaemonServiceContractMock.mockResolvedValue({
        daemonVersion: "0.2.0",
        profileId: "codex-owner--workspace-human",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        localAgentId: "codex",
        localAgentDisplayName: "Codex",
        localAgentEnabled: true,
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
        wakeRouteEvidence: {
          detail: null,
          observedAt: "2026-02-20T00:00:00.000Z",
          profileId: "codex-owner--workspace-human",
          reasonCode: "online",
          route: {
            online: true,
            daemonSessionId: "daemon-session-1",
            deviceId: "device-1",
            connectionGeneration: 1,
            leaseEpoch: 1,
            lastHeartbeatMs: 1,
            capabilities: {
              runtimeAdapters: [],
            },
          },
          status: "online",
        },
        workspace: {
          configuredWorkspace: "/tmp/demo-workspace",
          configuredWorkspaceDisplay: "/tmp/demo-workspace",
          effectiveRuntimeWorkingDirectory: "/tmp/demo-workspace",
          effectiveRuntimeWorkingDirectoryDisplay: "/tmp/demo-workspace",
          reasonCode: null,
          reasonText: null,
          status: "openmeld_managed",
          workspace: "OpenMeld-managed",
          workspaceSource: "OpenMeld-managed",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex-owner--workspace-human",
        profileName: "Codex Workspace Human",
        profileHandle: "codex-workspace-human",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Felix",
        source: "cli_create",
        createdByUserId: "user-owner",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({
            profile: "codex-owner--workspace-human",
            view: "human",
          });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Server Can Reach This Device: Online");
      expect(stdout).toContain("Workspace: OpenMeld-managed");
      expect(stdout).toContain("Workspace Type: OpenMeld-managed");
      expect(stdout).toContain("Workspace Folder: /tmp/demo-workspace");
      expect(stdout).toContain("Current Working Folder: /tmp/demo-workspace");
    });
  });

  it("renders Local OpenClaw Status rows for OpenClaw agent profiles", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-openclaw",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-owner",
          email: "owner@openmeld.invalid",
          name: "Felix",
        },
      });
      getDaemonStatusMock.mockResolvedValue(createDaemonStatus(true));
      getDaemonRuntimeStatusMock.mockResolvedValue(
        createDaemonRuntimeStatus("running")
      );
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
          serviceController: "launchd",
        })
      );
      readDaemonServiceContractMock.mockResolvedValue({
        daemonVersion: "0.2.0",
        profileId: "agt-openclaw",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        openClawLocalDiagnostics: {
          agentId: "openmeld-openclaw-phase-one",
          authStatus: "present",
          bootstrapResolution: null,
          bootstrapStatus: "healthy",
          errorCode: null,
          gatewayHealth: "healthy",
          gatewayVisibility: "visible",
          message: null,
          workspaceDir: "/tmp/openmeld-openclaw-profile",
        },
        transportMode: "local-cli",
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
        profileHandle: "openclaw-phase-one",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Felix",
        source: "cli_create",
        createdByUserId: "user-owner",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout, plainStderr: stderr } =
        await withCapturedStdio(async () => {
          await runWhoami({ profile: "agt-openclaw", view: "human" });
        });

      expect(stderr).toBe("");
      expect(stdout).toContain("Command Profile: 🤖 OpenClaw Phase One");
      expect(stdout).toContain("Local OpenClaw Status: Current local state");
      expect(stdout).toContain("OpenClaw Agent: openmeld-openclaw-phase-one");
      expect(stdout).toContain("Bootstrap Status: healthy");
      expect(stdout).toContain("Auth Status: present");
      expect(stdout).toContain("Gateway: healthy");
      expect(stdout).toContain("Agent Visibility: visible");
    });
  });

  it("recognizes a prefixed builtin controller ref against the bare local registry id", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-prefixed",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "owner-user",
          email: "owner@openmeld.invalid",
          name: "Felix",
        },
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z",
          },
        ],
      });
      getDaemonStatusMock.mockResolvedValue(createDaemonStatus(true));
      getDaemonRuntimeStatusMock.mockResolvedValue(
        createDaemonRuntimeStatus("running")
      );
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        createCurrentDaemonRuntimeContext({
          installed: true,
          effectiveRuntimeStatus: "running",
          serviceController: "launchd",
        })
      );
      readDaemonServiceContractMock.mockResolvedValue({
        daemonVersion: "0.2.0",
        profileId: "codex-owner--prefixed",
      });
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        localAgentId: "codex",
        localAgentDisplayName: "Codex",
        localAgentEnabled: true,
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex-owner--prefixed",
        profileName: "Codex Prefixed",
        profileHandle: "codex-prefixed",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Felix",
        source: "cli_create",
        createdByUserId: "user-owner",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "codex-owner--prefixed", view: "human" });
      });

      expect(stdout).toContain("Agent: Codex");
      expect(stdout).not.toContain(
        "saved agent controller is no longer available in OpenMeld"
      );
    });
  });

  it("reports only the explicit or selected profile in whoami", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-4",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-felix",
          email: "felix@openmeld.invalid",
          name: "Felix",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "felix--selected",
        profileName: "Felix",
        profileHandle: "felix",
        profileKind: "human",
        status: "active",
        ownerUserId: "user-felix",
        source: "auth_bootstrap",
        createdByUserId: "user-felix",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await withCapturedStdio(async () => {
        await runWhoami({ view: "human" });
      });

      expect(resolveOpenMeldProfileOrNull).toHaveBeenCalledWith({
        openMeldProfileId: undefined,
        allowUnauthenticated: false,
        allowDefaultFallback: false,
        persistSelection: true,
      });
    });
  });

  it("emits unified workspace facts in machine-readable whoami context", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-workspace-agent",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: {
          id: "user-codex",
          email: "codex@openmeld.invalid",
          name: "Codex",
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      resolveAgentProfileRuntimeStateMock.mockResolvedValueOnce({
        transportMode: "local-cli",
        replyReadiness: "ready",
        replyReadinessLabel: "ready",
        replyReadinessReasonCodes: [],
        replyReadinessReasonText: null,
        autoReplyReady: true,
        autoReplyReason: null,
        wakeRouteEvidence: {
          detail: null,
          observedAt: "2026-02-20T00:00:00.000Z",
          profileId: "codex-owner--workspace-agent",
          reasonCode: "online",
          route: {
            online: true,
            daemonSessionId: "daemon-session-2",
            deviceId: "device-2",
            connectionGeneration: 1,
            leaseEpoch: 1,
            lastHeartbeatMs: 1,
            capabilities: {
              runtimeAdapters: [],
            },
          },
          status: "online",
        },
        workspace: {
          configuredWorkspace: "/tmp/codex-repo",
          configuredWorkspaceDisplay: "/tmp/codex-repo",
          effectiveRuntimeWorkingDirectory: "/tmp/codex-repo",
          effectiveRuntimeWorkingDirectoryDisplay: "/tmp/codex-repo",
          reasonCode: null,
          reasonText: null,
          status: "custom",
          workspace: "Custom",
          workspaceSource: "Custom",
        },
      });
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce({
        openMeldProfileId: "codex-owner--workspace-agent",
        profileName: "Codex Workspace Agent",
        profileHandle: "codex-workspace-agent",
        profileKind: "agent",
        status: "active",
        ownerUserId: "Codex",
        source: "cli_create",
        createdByUserId: "user-codex",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({
          profile: "codex-owner--workspace-agent",
          view: "agent",
        });
      });

      const contextLine = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line))
        .find((line) => line.code === "whoami.context");

      expect(contextLine).toMatchObject({
        payload: {
          agentProfileRuntime: {
            wakeRouteEvidence: {
              status: "online",
              reasonCode: "online",
            },
            workspace: {
              workspace: "Custom",
              workspaceSource: "Custom",
              configuredWorkspace: "/tmp/codex-repo",
              effectiveRuntimeWorkingDirectory: "/tmp/codex-repo",
            },
          },
        },
      });
    });
  });
});
