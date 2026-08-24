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
    repairBuiltinControllerInstall: repairBuiltinControllerInstallMock,
    resolveBuiltinControllerInstallResolution:
      resolveBuiltinControllerInstallResolutionMock,
  };
});

import { runAgentsRepair } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents repair", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
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
    repairBuiltinControllerInstallMock.mockResolvedValue({
      ok: true,
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
    repairBuiltinControllerInstallMock.mockReset();
  });

  it("repairs a registered builtin controller and persists its launch contract", async () => {
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
        await runAgentsRepair({
          agent: ["codex"],
          view: "human",
        });
      });

      expect(stdout).toContain("Agents Repaired");
      expect(stdout).toContain("Repaired: 1");
      expect(stdout).toContain("Codex");

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toHaveLength(1);
      expect(controllers[0]?.launchContract).toEqual({
        kind: "executable",
        commandPath: process.execPath,
      });
      expect(repairBuiltinControllerInstallMock).toHaveBeenCalledWith({
        agentId: "codex",
        detected: true,
        displayName: "Codex",
        installId: null,
        runtimeSupported: true,
      });
    });
  });

  it("repairs every registered builtin agent that needs repair when --all is used", async () => {
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
        await runAgentsRepair({
          all: true,
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.repair.result");
      const payload = envelope.payload as
        | {
            allMode?: boolean;
            repaired?: string[];
            requested?: string[];
          }
        | undefined;
      expect(payload?.allMode).toBe(true);
      expect(payload?.requested).toEqual(["codex"]);
      expect(payload?.repaired).toEqual(["codex"]);
      expect(repairBuiltinControllerInstallMock).toHaveBeenCalledWith({
        agentId: "codex",
        detected: true,
        displayName: "Codex",
        installId: null,
        runtimeSupported: true,
      });
    });
  });

  it("rejects conflicting repair selectors", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsRepair({
          all: true,
          agent: ["codex"],
          view: "agent",
        })
      ).rejects.toThrow(
        "agents.config_invalid: use either --all or --agent <id...>, not both"
      );
    });
  });

  it("rejects install selection without an explicit repair selector", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsRepair({
          install: "install_nvm",
          view: "agent",
        })
      ).rejects.toThrow(
        "agents.repair_invalid: provide --all or --agent <id...>"
      );
    });
  });

  it("rejects install selection with more than one repair target", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsRepair({
          agent: ["codex", "claude-code"],
          install: "install_nvm",
          view: "agent",
        })
      ).rejects.toThrow(
        "agents.repair_invalid: use --install only with one --agent <id>"
      );
    });
  });

  it("emits structured install choices when repair still needs one choice", async () => {
    await withTempHome(async () => {
      const installChoices = [
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
      ];
      resolveBuiltinControllerInstallResolutionMock.mockResolvedValue({
        detail:
          "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
        installChoices,
        launchContract: null,
        status: "needs_choice" as const,
      });
      repairBuiltinControllerInstallMock.mockResolvedValue({
        errorCode: "controller.launch.choice_required",
        errorMessage:
          "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
        installChoices,
        ok: false,
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
        await runAgentsRepair({
          agent: ["codex"],
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.repair.result");
      const payload = envelope.payload as
        | {
            errors?: Array<{
              code?: string;
              humanActionRequired?: boolean;
              installChoices?: Array<{ installId?: string }>;
              nextSteps?: string[];
            }>;
          }
        | undefined;
      expect(payload?.errors?.[0]?.code).toBe(
        "controller.launch.choice_required"
      );
      expect(payload?.errors?.[0]?.humanActionRequired).toBe(true);
      expect(
        payload?.errors?.[0]?.installChoices?.map((item) => item.installId)
      ).toEqual(["install_nvm", "install_homebrew"]);
      expect(payload?.errors?.[0]?.nextSteps?.[0]).toContain(
        "openmeld agents repair --agent codex --install install_nvm"
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
