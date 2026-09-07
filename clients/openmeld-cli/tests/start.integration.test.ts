import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { runStart } from "../src/commands/start";
import { DEFAULT_AUTH_BASE_URL } from "../src/config/auth-url";
import { DEFAULT_GATEWAY_BASE_URL } from "../src/config/base-url";
import {
  getConfiguredBaseUrl,
  updateConfiguredStartV1OnboardingState,
} from "../src/config/runtime-config";
import {
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
} from "../src/local-service/state/daemon-device-id";
import { readProfileWorkspaceConfig } from "../src/profile-workspace/service";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../src/runtime/cli-entry-command";
import { createEnabledPreferredBuiltinTargetState } from "./helpers/agent-registry-derived";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";
import {
  createStartFetchHandler,
  type FetchRequestInput,
  resolveRequestUrl,
} from "./helpers/start-fetch";
import { seedVersionState } from "./helpers/version";

const INLINE_LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN =
  /^\/v1\/local-runtimes\/([^/]+)\/enrollment$/u;

const {
  collectObservedDeviceMetadataMock,
  collectSkillsReadinessSnapshotMock,
  createOpenMeldAgentProfileMock,
  createOpenMeldHumanProfileMock,
  getDaemonStatusMock,
  getAuthSessionStateMock,
  listAgentTargetStatesMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  resolveLocalServiceDemandMock,
  runDaemonInstallMock,
  runSkillsInstallMock,
  resolveOpenMeldProfileMock,
  runAuthLoginMock,
  setSelectedOpenMeldProfileIdMock,
} = vi.hoisted(() => ({
  collectObservedDeviceMetadataMock: vi.fn(),
  collectSkillsReadinessSnapshotMock: vi.fn(),
  createOpenMeldAgentProfileMock: vi.fn(),
  createOpenMeldHumanProfileMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  listAgentTargetStatesMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runSkillsInstallMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  runAuthLoginMock: vi.fn(),
  setSelectedOpenMeldProfileIdMock: vi.fn(),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => false),
}));

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: runAuthLoginMock,
}));

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: collectObservedDeviceMetadataMock,
}));

vi.mock("../src/commands/skills", () => ({
  runSkillsInstall: runSkillsInstallMock,
}));
vi.mock("../src/skills/installation-inventory", () => ({
  collectSkillsReadinessSnapshot: collectSkillsReadinessSnapshotMock,
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
    runDaemonInstall: runDaemonInstallMock,
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
    resolveOpenMeldProfile: resolveOpenMeldProfileMock,
  };
});

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

describe("openmeld start", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(createStartFetchHandler(packageJson.version)));
    getAuthSessionStateMock.mockReset();
    collectSkillsReadinessSnapshotMock.mockReset();
    createOpenMeldHumanProfileMock.mockReset();
    createOpenMeldAgentProfileMock.mockReset();
    getDaemonStatusMock.mockReset();
    listAgentTargetStatesMock.mockReset();
    readCurrentObservedDaemonRuntimeStatusMock.mockReset();
    resolveLocalServiceDemandMock.mockReset();
    runDaemonInstallMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    runAuthLoginMock.mockReset();
    runSkillsInstallMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockResolvedValue({
      persistent: false,
    });
    collectObservedDeviceMetadataMock.mockResolvedValue({
      observedDisplayName: "Felix's MacBook Pro",
      platformFamily: "macOS",
      osVersion: "15.4",
      deviceType: "laptop",
      observedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
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
    listAgentTargetStatesMock.mockResolvedValue([]);
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue(null);
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });
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
    createOpenMeldHumanProfileMock.mockResolvedValue({
      ...DEFAULT_HUMAN_PROFILE,
      openMeldProfileId: "human-created",
      profileName: "Mira",
      isDefault: false,
      source: "cli_create",
    });
    createOpenMeldAgentProfileMock.mockResolvedValue({
      ...DEFAULT_HUMAN_PROFILE,
      openMeldProfileId: "agt_created",
      profileName: "Codex Agent",
      profileKind: "agent",
      isDefault: false,
      source: "cli_create",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates a huma OpenMeld profile and persists gateway URL", async () => {
    getAuthSessionStateMock.mockResolvedValue({
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

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          kind: "human",
          profileName: "Mira",
          baseUrl: "http://localhost:8080/",
          skillsMode: "off",
        });
      });

      expect(createOpenMeldHumanProfileMock).toHaveBeenCalledWith({
        profileName: "Mira",
        creatorProfileId: "human-default",
      });
      expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
        "human-created"
      );
      expect(await getConfiguredBaseUrl()).toBe("http://localhost:8080");
    });
  });

  it("creates an agent OpenMeld profile in non-interactive mode", async () => {
    await withTempHome(async (home) => {
      vi.stubEnv("OPENMELD_GATEWAY_URL", "");
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: DEFAULT_AUTH_BASE_URL,
          clientId: "openmeld-cli",
          createdAt: "2026-02-20T00:00:00.000Z",
          user: {
            id: "owner-1",
            email: "felix@openmeld.invalid",
          },
        },
      });
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          kind: "agent",
          profileName: "Codex Agent",
          agentName: "OpenAI Codex",
          agentModel: "gpt-5.3",
          agentOwner: "Felix",
          skillsMode: "off",
        });
      });

      expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
        profileName: "Codex Agent",
        creatorProfileId: "human-default",
      });
      expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
        "agt_created"
      );
      expect(await getConfiguredBaseUrl()).toBe(DEFAULT_GATEWAY_BASE_URL);
    });
  });

  it("shows the default OpenMeld-managed workspace after creating an agent profile", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });
      const normalizedStdout = stdout.replaceAll(/\s+/g, " ");

      expect(normalizedStdout).toContain(
        "This profile uses an OpenMeld workspace."
      );
      expect(normalizedStdout).toContain("Workspace Folder:");
      expect(normalizedStdout).toContain("--profile agt_created");
      expect(normalizedStdout).toContain("--workspace-mode custom");
      expect(normalizedStdout).toContain("--workspace-path");
      expect(normalizedStdout).toContain("/absolute/path");

      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_created",
        })
      ).resolves.toMatchObject({
        status: "valid",
        value: {
          mode: "openmeld_managed",
        },
      });
    });
  });

  it("auto-configures created agent profile with first enabled controller in non-interactive mode", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      createEnabledPreferredBuiltinTargetState(),
    ]);

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });

      expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
        profileName: "Codex Agent",
        creatorProfileId: "human-default",
      });
      expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
        "agt_created"
      );
    });
  });

  it("skips gateway persistence when disable flag is enabled", async () => {
    getAuthSessionStateMock.mockResolvedValue({
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

    await withTempHome(async (home) => {
      await seedVersionState(home);
      vi.stubEnv("OPENMELD_DISABLE_GATEWAY_PERSIST", "1");
      vi.stubEnv("OPENMELD_GATEWAY_URL", "http://localhost:8080/");
      await withSilencedStdio(async () => {
        await runStart({
          kind: "agent",
          profileName: "Codex Agent",
          agentName: "OpenAI Codex",
          agentModel: "gpt-5.3",
          agentOwner: "Felix",
          skillsMode: "off",
        });
      });

      expect(await getConfiguredBaseUrl()).toBeNull();
    });
  });

  it("uses explicit OpenMeld profile id without creating new profile", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      await withSilencedStdio(async () => {
        await runStart({
          profileId: "agt_explicit_001",
          skillsMode: "off",
        });
      });

      expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
      expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
      expect(resolveOpenMeldProfileMock).toHaveBeenCalledWith({
        openMeldProfileId: "agt_explicit_001",
      });
      expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
        "agt_explicit_001"
      );
    });
  });

  it("does not sync the current device target during standalone start when this computer already has a device id", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const runtimePaths = await ensureDaemonRuntimePaths();
      await resolveDaemonDeviceId({
        deviceId: "device-macbook-pro",
        deviceIdPath: runtimePaths.deviceIdPath,
      });
      const fetchMock = vi.fn(
        (input: FetchRequestInput, init?: RequestInit) => {
          const url = resolveRequestUrl(input);
          const pathname = new URL(url).pathname;

          if (pathname === "/v1/devices/current" && init?.method === "GET") {
            return new Response(JSON.stringify({ availability: "missing" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }

          if (pathname === "/v1/devices/current" && init?.method === "PUT") {
            return new Response(
              JSON.stringify({
                availability: "resolved",
                deviceId: "device-macbook-pro",
                runtimeLane: "prod",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          if (
            pathname === "/v1/devices/device-macbook-pro/observed-metadata" &&
            init?.method === "PUT"
          ) {
            return new Response(
              JSON.stringify({
                metadata: {
                  observedDisplayName: "Felix's MacBook Pro",
                  platformFamily: "macOS",
                  osVersion: "15.4",
                  deviceType: "laptop",
                  observedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          const enrollmentMatch =
            INLINE_LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN.exec(pathname);
          if (enrollmentMatch && init?.method === "POST") {
            const enrollmentBody =
              typeof init.body === "string"
                ? (JSON.parse(init.body) as {
                    runtimeLane?: unknown;
                    connectedComputerId?: unknown;
                  })
                : {};
            const enrollmentLane =
              typeof enrollmentBody.runtimeLane === "string"
                ? enrollmentBody.runtimeLane
                : "prod";
            const enrollmentConnectedComputerId =
              enrollmentBody.connectedComputerId;
            return new Response(
              JSON.stringify({
                deviceId: decodeURIComponent(enrollmentMatch[1] ?? ""),
                runtimeLane: enrollmentLane,
                ...(typeof enrollmentConnectedComputerId === "string"
                  ? { connectedComputerId: enrollmentConnectedComputerId }
                  : {}),
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          return new Response(
            JSON.stringify({ version: packageJson.version }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runStart({
          kind: "human",
          profileName: "Mira",
          skillsMode: "off",
        });
      });

      const enrollmentCalls = fetchMock.mock.calls.filter(([input, init]) => {
        const url = resolveRequestUrl(input);
        return (
          new URL(url).pathname ===
            "/v1/local-runtimes/device-macbook-pro/enrollment" &&
          init?.method === "POST"
        );
      });

      expect(enrollmentCalls).toHaveLength(0);

      const observedMetadataCalls = fetchMock.mock.calls.filter(
        ([input, init]) => {
          const url = resolveRequestUrl(input);
          return (
            new URL(url).pathname ===
              "/v1/devices/device-macbook-pro/observed-metadata" &&
            init?.method === "PUT"
          );
        }
      );

      expect(observedMetadataCalls).toHaveLength(0);
    });
  });

  it("keeps standalone start away from existing current device target writes", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const runtimePaths = await ensureDaemonRuntimePaths();
      await resolveDaemonDeviceId({
        deviceId: "device-macbook-pro",
        deviceIdPath: runtimePaths.deviceIdPath,
      });
      const fetchMock = vi.fn(
        (input: FetchRequestInput, init?: RequestInit) => {
          const url = resolveRequestUrl(input);
          const pathname = new URL(url).pathname;

          if (pathname === "/v1/devices/current" && init?.method === "PUT") {
            return new Response(
              JSON.stringify({
                availability: "resolved",
                deviceId: "device-office-imac",
                runtimeLane: "prod",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          if (
            pathname === "/v1/devices/device-macbook-pro/observed-metadata" &&
            init?.method === "PUT"
          ) {
            return new Response(
              JSON.stringify({
                metadata: {
                  observedDisplayName: "Felix's MacBook Pro",
                  platformFamily: "macOS",
                  osVersion: "15.4",
                  deviceType: "laptop",
                  observedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          const enrollmentMatch =
            INLINE_LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN.exec(pathname);
          if (enrollmentMatch && init?.method === "POST") {
            const enrollmentBody =
              typeof init.body === "string"
                ? (JSON.parse(init.body) as {
                    runtimeLane?: unknown;
                    connectedComputerId?: unknown;
                  })
                : {};
            const enrollmentLane =
              typeof enrollmentBody.runtimeLane === "string"
                ? enrollmentBody.runtimeLane
                : "prod";
            const enrollmentConnectedComputerId =
              enrollmentBody.connectedComputerId;
            return new Response(
              JSON.stringify({
                deviceId: decodeURIComponent(enrollmentMatch[1] ?? ""),
                runtimeLane: enrollmentLane,
                ...(typeof enrollmentConnectedComputerId === "string"
                  ? { connectedComputerId: enrollmentConnectedComputerId }
                  : {}),
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          return new Response(
            JSON.stringify({ version: packageJson.version }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runStart({
          kind: "human",
          profileName: "Mira",
          skillsMode: "off",
        });
      });

      const enrollmentCalls = fetchMock.mock.calls.filter(([input, init]) => {
        const url = resolveRequestUrl(input);
        return (
          new URL(url).pathname ===
            "/v1/local-runtimes/device-macbook-pro/enrollment" &&
          init?.method === "POST"
        );
      });

      expect(enrollmentCalls).toHaveLength(0);
    });
  });

  it("fails fast in agent view when authentication is missing", async () => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "missing",
      session: null,
    });

    await withTempHome(async (home) => {
      await seedVersionState(home);
      let thrown: unknown = null;
      const captured = await withCapturedStdio(async () => {
        try {
          await runStart({
            view: "agent",
            profileId: "agt_explicit_001",
            skillsMode: "off",
          });
        } catch (error) {
          thrown = error;
        }
      });
      const stdout = captured.stdout;
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld start requires sign-in before OpenMeld profile selection."
      );
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");

      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("start.disclaimer");
      expect(codes).toContain("start.agent_overview");
      expect(codes).toContain("start.auth.human_action_required");
      expect(codes).not.toContain("start.readiness");
      expect(codes).not.toContain("start.skills");
      expect(codes).not.toContain("start.agents");
      expect(codes).not.toContain("start.welcome");
    });

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
  });

  it("fails in agent view when start arguments are missing", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    try {
      await withTempHome(async (home) => {
        await seedVersionState(home);
        let thrown: unknown = null;
        const captured = await withCapturedStdio(async () => {
          try {
            await runStart({
              view: "agent",
              skillsMode: "off",
            });
          } catch (error) {
            thrown = error;
          }
        });
        const stdout = captured.stdout;

        const message = thrown instanceof Error ? thrown.message : "";
        expect(message).toContain(
          "start in agent view requires explicit agent profile selection or creation arguments."
        );
        expect(message).toContain("[FOR HUMAN OPERATORS]");
        expect(message).toContain("[FOR AGENTS]");
        expect(message).toContain(
          "start in agent view selects or creates an Agent Profile and returns Space commands."
        );

        const codes = parseAgentEnvelopeCodes(stdout);
        expect(codes[0]).toBe("start.disclaimer");
        expect(codes).toContain("start.agent_overview");
        expect(codes).not.toContain("start.readiness");
        expect(codes).not.toContain("start.skills");
        expect(codes).not.toContain("start.agents");
        expect(codes).not.toContain("start.welcome");

        const overviewEnvelope = parseAgentResultEnvelope(
          stdout,
          "start.agent_overview"
        );
        const overviewPayload = overviewEnvelope.payload as
          | {
              commands?: string[];
              humanActionRequired?: {
                steps?: string[];
              };
              notes?: string[];
            }
          | undefined;
        expect(overviewPayload?.commands).toContain(
          "openmeld-dev start --view agent --profile-id <existing-agent-profile-id>"
        );
        expect(overviewPayload?.humanActionRequired?.steps).toContain(
          "openmeld-dev view human"
        );
        expect(overviewPayload?.notes).toContain(
          "openmeld-dev start in agent view selects or creates an Agent Profile and returns Space commands. Run `openmeld-dev setup --view agent` when this computer needs local service or agent setup."
        );
      });
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }

    expect(resolveOpenMeldProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
  });

  it("rejects human profile creation in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      let thrown: unknown = null;
      await withSilencedStdio(async () => {
        try {
          await runStart({
            view: "agent",
            kind: "human",
            profileName: "Human Secondary",
            skillsMode: "off",
          });
        } catch (error) {
          thrown = error;
        }
      });
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain("agent view cannot create human profiles");
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");
    });

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
  });

  it("fails fast in non-interactive mode when auth targets a different gateway", async () => {
    getAuthSessionStateMock.mockResolvedValue({
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

    await withTempHome(async (home) => {
      await seedVersionState(home);
      await expect(
        withSilencedStdio(async () => {
          await runStart({
            skillsMode: "off",
          });
        })
      ).rejects.toThrow(
        formatInlineOpenMeldCliCommands(
          "authentication does not match current gateway (session auth: http://localhost:8788, gateway: https://gateway.openmeld.invalid); run `openmeld login` and retry"
        )
      );
    });

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
  });

  it("emits optional setup guidance in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "start.setup.hint");
      const payload = envelope.payload as
        | { command?: string; optional?: boolean; reason?: string }
        | undefined;
      expect(payload?.command).toBe(
        formatOpenMeldCliCommand("openmeld setup --view agent")
      );
      expect(payload?.optional).toBe(true);
      expect(payload?.reason).toBe(
        "Use setup when this computer needs local service or agent setup."
      );
    });
  });

  it("keeps full selected profile details in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });

      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("start.disclaimer");
      expect(codes).toContain("start.agent_overview");

      const overviewEnvelope = parseAgentResultEnvelope(
        stdout,
        "start.agent_overview"
      );
      const overviewPayload = overviewEnvelope.payload as
        | {
            requiredArguments?: string[];
            stages?: string[];
            humanActionRequired?: {
              possible?: boolean;
            };
          }
        | undefined;
      expect(overviewPayload?.requiredArguments).toContain(
        "--profile-id <existing-agent-profile-id> or --profile <existing-agent-profile-id|name>"
      );
      expect(overviewPayload?.stages).toEqual([
        "check_arguments",
        "authenticate",
        "profile",
        "space_entry",
      ]);
      expect(overviewPayload?.humanActionRequired?.possible).toBe(true);

      const envelope = parseAgentResultEnvelope(
        stdout,
        "start.profile.selected"
      );
      const payload = envelope.payload as
        | {
            profile?: {
              openMeldProfileId?: string;
              profileName?: string;
              profileKind?: string;
            };
          }
        | undefined;
      expect(payload?.profile).toMatchObject({
        openMeldProfileId: "agt_created",
        profileName: "Codex Agent",
        profileKind: "agent",
      });

      const setupEnvelope = parseAgentResultEnvelope(
        stdout,
        "start.profile.agent_setup"
      );
      const setupPayload = setupEnvelope.payload as
        | {
            nextSteps?: string[];
            profileId?: string;
            status?: string;
          }
        | undefined;
      expect(setupPayload).toMatchObject({
        profileId: "agt_created",
        status: "skipped_no_enabled_controllers",
      });
      expect(setupPayload?.nextSteps).toEqual([
        formatOpenMeldCliCommand(
          "openmeld setup --profile agt_created --view agent"
        ),
      ]);
      expect(JSON.stringify(setupPayload?.nextSteps)).not.toContain(
        "openmeld agents enable --all"
      );
    });
  });

  it("emits the selected profile workspace in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });

      const envelope = parseAgentResultEnvelope(
        stdout,
        "start.profile.workspace"
      );
      const payload = envelope.payload as
        | {
            changeCommand?: string;
            summary?: string;
            workspace?: {
              workspace?: string;
              configuredWorkspaceDisplay?: string;
              effectiveRuntimeWorkingDirectoryDisplay?: string;
            };
          }
        | undefined;

      expect(payload?.summary).toBe("This profile uses an OpenMeld workspace.");
      expect(payload?.changeCommand).toBe(
        formatOpenMeldCliCommand(
          "openmeld profiles update --profile agt_created --workspace-mode custom --workspace-path /absolute/path"
        )
      );
      expect(payload?.workspace).toMatchObject({
        workspace: "OpenMeld-managed",
      });
      const configuredWorkspaceDisplay =
        payload?.workspace?.configuredWorkspaceDisplay;
      const effectiveRuntimeWorkingDirectoryDisplay =
        payload?.workspace?.effectiveRuntimeWorkingDirectoryDisplay;
      expect(typeof configuredWorkspaceDisplay).toBe("string");
      expect(typeof effectiveRuntimeWorkingDirectoryDisplay).toBe("string");
      if (
        typeof configuredWorkspaceDisplay !== "string" ||
        typeof effectiveRuntimeWorkingDirectoryDisplay !== "string"
      ) {
        throw new Error("expected workspace presentation display paths");
      }
      expect(
        configuredWorkspaceDisplay.includes("/profiles/agt_created/workspace")
      ).toBe(true);
      expect(
        effectiveRuntimeWorkingDirectoryDisplay.includes(
          "/profiles/agt_created/workspace"
        )
      ).toBe(true);
    });
  });

  it("emits explicit next actions and non-persistent warning in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          kind: "agent",
          profileName: "Codex Agent",
          skillsMode: "off",
        });
      });

      const nextActionsEnvelope = parseAgentResultEnvelope(
        stdout,
        "start.next_actions"
      );
      const nextActionsPayload = nextActionsEnvelope.payload as
        | { commands?: string[] }
        | undefined;
      expect(nextActionsPayload?.commands).toEqual(
        formatOpenMeldCliCommands([
          "openmeld whoami --profile agt_created --view agent",
          "openmeld space create --profile agt_created --name <space-name> --visibility private --view agent",
          "openmeld space join --profile agt_created <space-id> --view agent",
        ])
      );

      const recapEnvelope = parseAgentResultEnvelope(stdout, "start.recap");
      const recapPayload = recapEnvelope.payload as
        | { nextCommands?: string[] }
        | undefined;
      expect(recapPayload?.nextCommands).toEqual(
        formatOpenMeldCliCommands([
          "openmeld whoami --profile agt_created --view agent",
          "openmeld space create --profile agt_created --name <space-name> --visibility private --view agent",
          "openmeld space join --profile agt_created <space-id> --view agent",
        ])
      );

      const warningEnvelope = parseAgentEnvelope(
        stdout,
        "profile.selection.non_persistent"
      );
      expect(warningEnvelope.type).toBe("line");
      expect(warningEnvelope.data).toMatchObject({
        persistent: false,
      });
    });
  });

  it("keeps agent-view start on Space entry when local service would need setup", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const runtimePaths = await ensureDaemonRuntimePaths();
      await resolveDaemonDeviceId({
        deviceId: "device-macbook-pro",
        deviceIdPath: runtimePaths.deviceIdPath,
      });
      const fetchMock = vi.fn(
        (input: FetchRequestInput, init?: RequestInit) => {
          const url = resolveRequestUrl(input);
          const pathname = new URL(url).pathname;

          if (pathname === "/v1/devices/current" && init?.method === "PUT") {
            return new Response(
              JSON.stringify({
                availability: "resolved",
                deviceId: "device-macbook-pro",
                runtimeLane: "prod",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          if (
            pathname === "/v1/devices/device-macbook-pro/observed-metadata" &&
            init?.method === "PUT"
          ) {
            return new Response(
              JSON.stringify({
                metadata: {
                  observedDisplayName: "Felix's MacBook Pro",
                  platformFamily: "macOS",
                  osVersion: "15.4",
                  deviceType: "laptop",
                  observedAtMs: Date.parse("2026-04-14T00:00:00.000Z"),
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          const enrollmentMatch =
            INLINE_LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN.exec(pathname);
          if (enrollmentMatch && init?.method === "POST") {
            const enrollmentBody =
              typeof init.body === "string"
                ? (JSON.parse(init.body) as {
                    runtimeLane?: unknown;
                    connectedComputerId?: unknown;
                  })
                : {};
            const enrollmentLane =
              typeof enrollmentBody.runtimeLane === "string"
                ? enrollmentBody.runtimeLane
                : "prod";
            const enrollmentConnectedComputerId =
              enrollmentBody.connectedComputerId;
            return new Response(
              JSON.stringify({
                deviceId: decodeURIComponent(enrollmentMatch[1] ?? ""),
                runtimeLane: enrollmentLane,
                ...(typeof enrollmentConnectedComputerId === "string"
                  ? { connectedComputerId: enrollmentConnectedComputerId }
                  : {}),
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }

          return new Response(
            JSON.stringify({ version: packageJson.version }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
      );
      vi.stubGlobal("fetch", fetchMock);
      await updateConfiguredStartV1OnboardingState(() => ({
        localAgentsSetupCompletedAt: "2026-04-14T00:00:00.000Z",
      }));
      listAgentTargetStatesMock.mockResolvedValue([
        createEnabledPreferredBuiltinTargetState(),
      ]);
      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
      });
      resolveLocalServiceDemandMock.mockResolvedValue({
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
        projection: null,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runStart({
          view: "agent",
          profileId: "agt_explicit_001",
          skillsMode: "off",
        });
      });

      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes).not.toContain("start.service");
      expect(codes).not.toContain("start.readiness");
      expect(codes).not.toContain("start.skills");
      expect(codes).not.toContain("start.agents");
      expect(codes).toContain("start.next_actions");
      expect(codes).toContain("start.recap");
      expect(codes).toContain("start.setup.hint");

      const setupHintEnvelope = parseAgentResultEnvelope(
        stdout,
        "start.setup.hint"
      );
      expect(setupHintEnvelope.payload).toMatchObject({
        command: formatOpenMeldCliCommand("openmeld setup --view agent"),
        optional: true,
      });

      const enrollmentCalls = fetchMock.mock.calls.filter(([input, init]) => {
        const url = resolveRequestUrl(input);
        return (
          new URL(url).pathname ===
            "/v1/local-runtimes/device-macbook-pro/enrollment" &&
          init?.method === "POST"
        );
      });
      expect(enrollmentCalls).toHaveLength(0);
    });
  });
});

function parseAgentResultEnvelope(
  stdout: string,
  code: string
): { payload?: unknown } {
  const envelope = parseAgentEnvelope(stdout, code);
  return {
    payload: envelope.type === "result" ? envelope.payload : undefined,
  };
}

function parseAgentEnvelopeCodes(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as {
          code?: unknown;
        };
        return typeof parsed.code === "string" ? [parsed.code] : [];
      } catch {
        return [];
      }
    });
}

function parseAgentEnvelope(
  stdout: string,
  code: string
): { type?: string; payload?: unknown; data?: unknown } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        payload?: unknown;
        data?: unknown;
      };
      if (parsed.code === code) {
        return {
          type: parsed.type,
          payload: parsed.payload,
          data: parsed.data,
        };
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return {};
}
