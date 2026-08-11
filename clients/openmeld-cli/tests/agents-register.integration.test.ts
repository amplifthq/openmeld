import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const {
  repairBuiltinControllerInstallMock,
  resolveBuiltinControllerInstallResolutionMock,
} = vi.hoisted(() => ({
  repairBuiltinControllerInstallMock: vi.fn(),
  resolveBuiltinControllerInstallResolutionMock: vi.fn(),
}));

vi.mock("../src/skills/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/agents")>(
    "../src/skills/agents"
  );
  return {
    ...actual,
    detectInstalledSkillsAgents: detectInstalledSkillsAgentsMock,
  };
});

vi.mock("../src/agents/local-controller-install", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agents/local-controller-install")
  >("../src/agents/local-controller-install");
  return {
    ...actual,
    repairBuiltinControllerInstall: repairBuiltinControllerInstallMock,
    resolveBuiltinControllerInstallResolution:
      resolveBuiltinControllerInstallResolutionMock,
  };
});

import { runAgentsEnable } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents enable", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: { detected: boolean; runtimeSupported: boolean }) => {
        if (!(input.detected && input.runtimeSupported)) {
          return {
            detail: null,
            installChoices: [],
            launchContract: null,
            status: "not_available" as const,
          };
        }
        return {
          detail: null,
          installChoices: [],
          launchContract: {
            kind: "executable" as const,
            commandPath: process.execPath,
          },
          status: "ready" as const,
        };
      }
    );
    repairBuiltinControllerInstallMock.mockImplementation(
      (input: { detected: boolean; runtimeSupported: boolean }) => {
        if (!(input.detected && input.runtimeSupported)) {
          return {
            errorCode: "controller.launch.needs_repair" as const,
            errorMessage: "Codex is not available on this computer.",
            installChoices: [],
            ok: false as const,
          };
        }
        return {
          launchContract: {
            kind: "executable" as const,
            commandPath: process.execPath,
          },
          ok: true as const,
          selectedInstall: {
            commandPath: process.execPath,
            detail: process.execPath,
            installId: "node-codex",
            label: "Codex",
            launchContract: {
              kind: "executable" as const,
              commandPath: process.execPath,
            },
          },
        };
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
    repairBuiltinControllerInstallMock.mockReset();
  });

  it("registers only detected built-ins for --all", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Custom Target",
            dir: "/tmp/custom-target",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          all: true,
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            allMode?: boolean;
            requested?: string[];
            registered?: string[];
          }
        | undefined;
      expect(payload?.allMode).toBe(true);
      expect(payload?.requested).toEqual(["codex"]);
      expect(payload?.registered).toEqual(["codex"]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers.map((item) => item.agentId)).toEqual(["codex"]);
      expect(controllers[0]?.transportMode).toBe("codex-app-server");
    });
  });

  it("does not register suspended built-ins for --all", async () => {
    await withTempHome(async () => {
      detectInstalledSkillsAgentsMock.mockResolvedValue(["codex", "openclaw"]);

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          all: true,
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            allMode?: boolean;
            requested?: string[];
            registered?: string[];
          }
        | undefined;
      expect(payload?.allMode).toBe(true);
      expect(payload?.requested).toEqual(["codex"]);
      expect(payload?.registered).toEqual(["codex"]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers.map((item) => item.agentId)).toEqual(["codex"]);
    });
  });

  it("emits a canonical JSON envelope with --json", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          all: true,
          json: true,
        });
      });

      const envelope = parseJsonEnvelope(stdout, "agents.enable") as
        | { schemaVersion?: number; allMode?: boolean; registered?: string[] }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(envelope?.allMode).toBe(true);
      expect(envelope?.registered).toEqual(["codex"]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers.map((item) => item.agentId)).toEqual(["codex"]);
    });
  });

  it("registers explicit custom target id", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Custom Target",
            dir: "/tmp/custom-target",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          agent: ["custom-target-001"],
          view: "agent",
        });
      });
      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            errors?: Array<{
              agentId?: string;
              code?: string;
              reason?: string;
            }>;
            registered?: string[];
            reenabled?: string[];
          }
        | undefined;
      expect(payload?.registered ?? []).toHaveLength(0);
      expect(payload?.reenabled ?? []).toHaveLength(0);
      expect(payload?.errors).toEqual([
        {
          agentId: "custom-target-001",
          code: "agents.invalid_agent_id",
          reason: "custom target is not runnable yet",
        },
      ]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toEqual([]);
    });
  });

  it("rejects explicitly enabling suspended built-ins", async () => {
    await withTempHome(async () => {
      detectInstalledSkillsAgentsMock.mockResolvedValue(["openclaw"]);

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          agent: ["openclaw"],
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            errors?: Array<{
              agentId?: string;
              code?: string;
              reason?: string;
            }>;
            registered?: string[];
            reenabled?: string[];
          }
        | undefined;
      expect(payload?.registered ?? []).toHaveLength(0);
      expect(payload?.reenabled ?? []).toHaveLength(0);
      expect(payload?.errors).toEqual([
        {
          agentId: "openclaw",
          code: "agents.invalid_agent_id",
          reason: "suspended for new OpenMeld profiles",
        },
      ]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toEqual([]);
    });
  });

  it("reenables existing disabled registration", async () => {
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

      await runAgentsEnable({
        agent: ["codex"],
        view: "human",
      });

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toHaveLength(1);
      expect(controllers[0]?.agentId).toBe("codex");
      expect(controllers[0]?.enabled).toBe(true);
      expect(controllers[0]?.transportMode).toBe("codex-app-server");
    });
  });

  it("updates the launch contract when an already-enabled agent is given an explicit install", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: {
              kind: "executable",
              commandPath: "/stale/codex",
            },
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });
      resolveBuiltinControllerInstallResolutionMock.mockResolvedValueOnce({
        detail:
          "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
        installChoices: [
          {
            commandPath: "/opt/homebrew/bin/codex",
            detail: "/opt/homebrew/bin/codex",
            installId: "homebrew-codex",
            label: "Codex 0.130.0",
            launchContract: {
              kind: "executable",
              commandPath: "/opt/homebrew/bin/codex",
            },
          },
        ],
        launchContract: null,
        status: "needs_choice",
      });
      repairBuiltinControllerInstallMock.mockResolvedValueOnce({
        launchContract: {
          kind: "executable",
          commandPath: "/opt/homebrew/bin/codex",
        },
        ok: true,
        selectedInstall: {
          commandPath: "/opt/homebrew/bin/codex",
          detail: "/opt/homebrew/bin/codex",
          installId: "homebrew-codex",
          label: "Codex 0.130.0",
          launchContract: {
            kind: "executable",
            commandPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          agent: ["codex"],
          install: "homebrew-codex",
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            errors?: unknown[];
            reenabled?: string[];
          }
        | undefined;
      expect(payload?.errors ?? []).toHaveLength(0);
      expect(payload?.reenabled).toEqual(["codex"]);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers[0]?.enabled).toBe(true);
      expect(controllers[0]?.launchContract).toEqual({
        kind: "executable",
        commandPath: "/opt/homebrew/bin/codex",
      });
    });
  });

  it("renders human enable results inside cards with plain-language copy", async () => {
    await withTempHome(async () => {
      detectInstalledSkillsAgentsMock.mockResolvedValue([
        "claude-code",
        "codex",
      ]);

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          agent: ["claude-code", "codex"],
          view: "human",
        });
      });

      expect(stdout).toContain("Agents Turned On");
      expect(stdout).toContain("2 selected agents are available now");
      expect(stdout).toContain("On now: 2");
      expect(stdout).toContain("Turned On Now (2)");
      expect(stdout).not.toContain("✅ Agents Turned On");
      expect(stdout).not.toContain("✅ @claude-code");
      expect(stdout).toContain("Claude Code");
      expect(stdout).toContain("Codex");
      expect(stdout).not.toContain("requested=");
      expect(stdout).not.toContain("enabled_now=");
      expect(stdout).not.toContain("- claude-code");
    });
  });

  it("prefers built-in target when custom target id collides", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "codex",
            name: "Custom Codex Override",
            dir: "/tmp/custom-codex",
          },
        ],
      });

      await runAgentsEnable({
        agent: ["codex"],
        view: "human",
      });

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toHaveLength(1);
      expect(controllers[0]?.agentId).toBe("codex");
      expect(controllers[0]?.displayName).toBe("Codex");
    });
  });

  it("auto-prunes unknown registrations before enable target resolution", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "stale-custom-001",
            displayName: "Stale Custom",
            enabled: false,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsEnable({
          agent: ["stale-custom-001"],
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.enable.result");
      const payload = envelope.payload as
        | {
            errors?: Array<{ agentId?: string; code?: string }>;
            reenabled?: string[];
          }
        | undefined;
      expect(payload?.errors).toEqual([
        {
          agentId: "stale-custom-001",
          code: "agents.invalid_agent_id",
          reason: "unknown built-in target id",
        },
      ]);
      expect(payload?.reenabled ?? []).toHaveLength(0);

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toHaveLength(0);
    });
  });
});

function parseJsonEnvelope(
  stdout: string,
  type: string
): Record<string, unknown> | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: string };
      if (parsed.type === type) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return undefined;
}

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
