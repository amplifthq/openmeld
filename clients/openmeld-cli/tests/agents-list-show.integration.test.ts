import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { resolveBuiltinControllerInstallResolutionMock } = vi.hoisted(() => ({
  resolveBuiltinControllerInstallResolutionMock: vi.fn(),
}));

const { resolveAgentControllerInterfaceSnapshotMock } = vi.hoisted(() => ({
  resolveAgentControllerInterfaceSnapshotMock: vi.fn(),
}));

vi.mock("../src/skills/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/agents")>(
    "../src/skills/agents"
  );
  return {
    ...actual,
    detectInstalledRuntimeAgents: detectInstalledSkillsAgentsMock,
    detectInstalledSkillsAgents: detectInstalledSkillsAgentsMock,
  };
});

vi.mock("../src/agents/local-controller-install", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agents/local-controller-install")
  >("../src/agents/local-controller-install");
  return {
    ...actual,
    resolveBuiltinControllerInstallResolution:
      resolveBuiltinControllerInstallResolutionMock,
  };
});

vi.mock("../src/local-service/inventory/agent-controller-interface", () => ({
  resolveAgentControllerInterfaceSnapshot:
    resolveAgentControllerInterfaceSnapshotMock,
}));

import { runAgentsList, runAgentsShow } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestNodeScriptLaunchContract } from "./helpers/launch-contract";

describe("openmeld agents list/show", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
    resolveAgentControllerInterfaceSnapshotMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      auth: { status: "authenticated", label: "Signed in" },
      capabilities: {
        approvals: true,
        cancel: true,
        interrupt: true,
        modelSelection: true,
        nativeEventStream: true,
        permissionModes: true,
        structuredUserInput: false,
      },
      checkedAt: "2026-06-28T00:00:00.000Z",
      controllerId: "codex",
      displayName: "Codex",
      launch: {
        argsPrefix: [],
        commandPath: process.execPath,
        installChoiceCount: 0,
        status: "ready",
      },
      message: null,
      models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
      nativeInterface: "codex-app-server",
      schemaVersion: 1,
      skills: [],
      status: "ready",
      usageLimits: [
        {
          key: "codex:primary",
          label: "5-hour usage",
          observedAt: "2026-06-28T00:00:00.000Z",
          resetsAt: "2026-06-28T05:00:00.000Z",
          status: "available",
          usedPercent: 42,
        },
      ],
      version: "0.1.0",
      versionAdvisory: {
        checkedAt: "2026-06-28T00:00:00.000Z",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        message: "Update available.",
        status: "behind_latest",
        updateCommand: "npm install -g @openai/codex@latest",
      },
    });
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: { persistedLaunchContract?: unknown }) => {
        if (input.persistedLaunchContract) {
          return {
            detail: null,
            installChoices: [],
            launchContract: input.persistedLaunchContract,
            status: "ready" as const,
          };
        }
        return {
          detail: null,
          installChoices: [],
          launchContract: {
            kind: "executable",
            commandPath: process.execPath,
          },
          status: "ready" as const,
        };
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    resolveAgentControllerInterfaceSnapshotMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
  });

  it("lists registered agents in agent view", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.list.result");
      const payload = envelope.payload as
        | {
            count?: number;
            registrations?: Array<{ agentId?: string }>;
          }
        | undefined;
      expect(payload?.count).toBe(1);
      expect(payload?.registrations?.[0]?.agentId).toBe("codex");
    });
  });

  it("keeps effective transport mode machine-readable in agent view", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          view: "agent",
          agentId: "codex",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.show.result");
      const payload = envelope.payload as
        | {
            agentControllerInterface?: {
              agentControllerRef?: string;
              models?: Array<{ displayName?: string; id?: string }>;
              nativeInterface?: string;
            } | null;
            agent?: {
              configuredTransportMode?: string | null;
              configuredTransportModeStatus?: string;
              effectiveTransportMode?: string;
              transportMode?: string;
              transportModeSource?: string;
            };
            effectiveConfig?: {
              configuredTransportMode?: string | null;
              configuredTransportModeStatus?: string;
              effectiveTransportMode?: string;
              transportMode?: string;
              transportModeSource?: string;
            };
          }
        | undefined;
      expect(payload?.agent?.transportMode).toBe("codex-app-server");
      expect(payload?.agent?.configuredTransportMode).toBe("codex-app-server");
      expect(payload?.agent?.configuredTransportModeStatus).toBe("supported");
      expect(payload?.agent?.effectiveTransportMode).toBe("codex-app-server");
      expect(payload?.agent?.transportModeSource).toBe("registration");
      expect(payload?.effectiveConfig?.configuredTransportMode).toBe(
        "codex-app-server"
      );
      expect(payload?.effectiveConfig?.configuredTransportModeStatus).toBe(
        "supported"
      );
      expect(payload?.effectiveConfig?.effectiveTransportMode).toBe(
        "codex-app-server"
      );
      expect(payload?.effectiveConfig?.transportMode).toBe("codex-app-server");
      expect(payload?.effectiveConfig?.transportModeSource).toBe(
        "registration"
      );
      expect(payload?.agentControllerInterface).toMatchObject({
        agentControllerRef: "builtin:codex",
        nativeInterface: "codex-app-server",
        models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
      });
    });
  });

  it("emits agent controller interface evidence under show json", async () => {
    await withTempHome(async (home) => {
      const codexLaunchContract = await createTestNodeScriptLaunchContract({
        home,
        scriptName: "codex",
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: codexLaunchContract,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          agentId: "codex",
          json: true,
        });
      });

      const envelope = parseJsonEnvelope(stdout, "agents.show") as
        | {
            type?: string;
            agent?: {
              agentId?: string;
              displayName?: string;
            };
            agentControllerInterface?: {
              agentControllerRef?: string;
              models?: Array<{ displayName?: string; id?: string }>;
              nativeInterface?: string;
            } | null;
            launchStatus?: string;
          }
        | undefined;
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      expect(envelope?.type).toBe("agents.show");
      expect(envelope?.agent?.agentId).toBe("codex");
      expect(envelope?.launchStatus).toBe("available");
      expect(envelope?.agentControllerInterface).toMatchObject({
        agentControllerRef: "builtin:codex",
        nativeInterface: "codex-app-server",
        models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
      });
      expect(
        (
          envelope?.agentControllerInterface as
            | { usageLimits?: unknown }
            | null
            | undefined
        )?.usageLimits
      ).toBeUndefined();
    });
  });

  it("does not probe a local agent that is turned off", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: false,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          agentId: "codex",
          json: true,
        });
      });

      const envelope = parseJsonEnvelope(stdout, "agents.show") as
        | {
            agentControllerInterface?: unknown;
          }
        | undefined;
      expect(envelope?.agentControllerInterface).toBeNull();
      expect(
        resolveAgentControllerInterfaceSnapshotMock
      ).not.toHaveBeenCalled();
    });
  });

  it("reconciles stale Codex local-cli registrations to Codex App Server", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.list.result");
      const payload = envelope.payload as
        | {
            registrations?: Array<{
              configuredTransportMode?: string | null;
              configuredTransportModeStatus?: string;
              defaultTransportMode?: string | null;
              effectiveConfig?: {
                effectiveTransportMode?: string;
                transportMode?: string;
                transportModeSource?: string;
              };
              effectiveTransportMode?: string;
              transportMode?: string;
              transportModeSource?: string;
            }>;
          }
        | undefined;
      const codex = payload?.registrations?.[0];
      expect(codex?.transportMode).toBe("codex-app-server");
      expect(codex?.configuredTransportMode).toBe("codex-app-server");
      expect(codex?.configuredTransportModeStatus).toBe("supported");
      expect(codex?.defaultTransportMode).toBe("codex-app-server");
      expect(codex?.effectiveTransportMode).toBe("codex-app-server");
      expect(codex?.transportModeSource).toBe("registration");
      expect(codex?.effectiveConfig?.effectiveTransportMode).toBe(
        "codex-app-server"
      );
      expect(codex?.effectiveConfig?.transportMode).toBe("codex-app-server");
      expect(codex?.effectiveConfig?.transportModeSource).toBe("registration");

      const savedState = await getConfiguredDeviceRuntimeState();
      expect(savedState?.controllers?.[0]?.transportMode).toBe(
        "codex-app-server"
      );
    });
  });

  it("lists only enabled agents in human view", async () => {
    await withTempHome(async (home) => {
      const codexLaunchContract = await createTestNodeScriptLaunchContract({
        home,
        scriptName: "codex",
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: codexLaunchContract,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
          {
            agentId: "cursor",
            displayName: "Cursor",
            enabled: false,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({
          view: "human",
        });
      });

      expect(stdout).toContain("Agents Available for Space");
      expect(stdout).toContain("1 agent is live for Space");
      expect(stdout).toContain("Available Agents (1)");
      expect(stdout).toContain("@codex");
      expect(stdout).toContain("Codex");
      expect(stdout).not.toContain("cursor");
      expect(stdout).not.toContain("enabled=");
      expect(stdout).not.toContain("dispatchPolicy=");
    });
  });

  it("renders friendly empty state when no enabled agents", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: false,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsList({
          view: "human",
        });
      });

      expect(stdout).toContain("Agents Available for Space");
      expect(stdout).toContain("No agents are live yet");
      expect(stdout).toContain("openmeld agents detect");
      expect(stdout).toContain("enable the agents you want OpenMeld to use");
    });
  });

  it("shows one registered agent in human view", async () => {
    await withTempHome(async (home) => {
      const codexLaunchContract = await createTestNodeScriptLaunchContract({
        home,
        scriptName: "codex",
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: codexLaunchContract,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          view: "human",
          agentId: "codex",
        });
      });

      expect(stdout).toContain("Agent in OpenMeld");
      expect(stdout).toContain("Agent:");
      expect(stdout).toContain("@codex");
      expect(stdout).toContain("App: Codex");
      expect(stdout).toContain("Available in Space");
      expect(stdout).toContain("can wake it");
      expect(stdout).toContain("Connection Type: Codex App Server");
      expect(stdout).toContain("Controller:");
      expect(stdout).toContain("Enabled");
      expect(stdout).toContain("Account:");
      expect(stdout).toContain("Authenticated");
      expect(stdout).toContain("Native interface:");
      expect(stdout).toContain("Codex App Server");
      expect(stdout).toContain("Version:");
      expect(stdout).toContain("v0.1.0");
      expect(stdout).toContain("Version status:");
      expect(stdout).toContain("Update available");
      expect(stdout).toContain("v0.2.0");
      expect(stdout).toContain("Update command:");
      expect(stdout).toContain("npm install -g @openai/codex@latest");
      expect(stdout).toContain("Launch check:");
      expect(stdout).toContain("Can launch");
      expect(stdout).toContain("Models:");
      expect(stdout).toContain("GPT-5.5");
      expect(stdout).toContain("Capabilities:");
      expect(stdout).toContain("Approvals");
      expect(stdout).toContain("Last checked:");
    });
  });

  it("shows enabled legacy controllers as needing repair", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          view: "human",
          agentId: "codex",
        });
      });

      expect(stdout).toContain("Needs repair on this computer");
      expect(stdout).toContain("will not wake it until you repair it");
      expect(stdout).toContain("openmeld agents repair --agent codex");
      expect(stdout).toContain(
        "Codex is connected, but OpenMeld needs to repair how it starts on this computer."
      );
    });
  });

  it("shows registered agents that still need one install choice", async () => {
    await withTempHome(async () => {
      resolveBuiltinControllerInstallResolutionMock.mockResolvedValue({
        detail:
          "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
        installChoices: [
          {
            installId: "install_nvm",
            label: "nvm install",
            detail: "Node 24.14.0",
            commandPath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/codex",
            launchContract: {
              kind: "node_script" as const,
              nodePath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/node",
              scriptPath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/codex",
            },
          },
          {
            installId: "install_homebrew",
            label: "Homebrew install",
            detail: "Node 25.8.0",
            commandPath: "/opt/homebrew/bin/codex",
            launchContract: {
              kind: "node_script" as const,
              nodePath: "/opt/homebrew/bin/node",
              scriptPath: "/opt/homebrew/bin/codex",
            },
          },
        ],
        launchContract: null,
        status: "needs_choice" as const,
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: {
              kind: "executable",
              commandPath: "/tmp/missing-codex",
            },
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsShow({
          view: "human",
          agentId: "codex",
        });
      });

      expect(stdout).toContain("Needs your choice on this Mac");
      expect(stdout).toContain("will not wake it until you choose one install");
      expect(stdout).toContain("openmeld agents repair --agent codex");
      expect(stdout).toContain(
        "OpenMeld found more than one Codex install on this computer"
      );
    });
  });
});

function parseAgentResultEnvelope(
  stdout: string,
  code: string
): { payload?: unknown } {
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
      };
      if (parsed.type === "result" && parsed.code === code) {
        return { payload: parsed.payload };
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return {};
}

function parseJsonEnvelope(stdout: string, type: string): { type?: string } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed = JSON.parse(lines[0] ?? "{}") as { type?: string };
  if (parsed.type !== type) {
    throw new Error(`Expected ${type} JSON envelope.`);
  }
  return parsed;
}
