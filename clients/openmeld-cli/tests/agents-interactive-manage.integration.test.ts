import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { resolveBuiltinControllerInstallResolutionMock } = vi.hoisted(() => ({
  resolveBuiltinControllerInstallResolutionMock: vi.fn(),
}));

const { promptSearchMultiselectMock, promptSearchSelectMock } = vi.hoisted(
  () => ({
    promptSearchMultiselectMock: vi.fn(),
    promptSearchSelectMock: vi.fn(),
  })
);

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
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

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselect: (
    ...args: Parameters<typeof promptSearchMultiselectMock>
  ) => promptSearchMultiselectMock(...args),
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
    promptSearchSelectMock(...args),
}));

import { runAgents } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestNodeScriptLaunchContract } from "./helpers/launch-contract";

describe("openmeld agents interactive manage flow", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue(["claude-code", "codex"]);
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: {
        detected: boolean;
        displayName: string;
        persistedLaunchContract?: unknown;
        runtimeSupported: boolean;
      }) => {
        if (!(input.detected && input.runtimeSupported)) {
          return {
            detail: null,
            installChoices: [],
            launchContract: null,
            status: "not_available" as const,
          };
        }
        if (input.persistedLaunchContract) {
          return {
            detail: null,
            installChoices: [],
            launchContract: input.persistedLaunchContract,
            status: "ready" as const,
          };
        }
        return {
          detail: `${input.displayName} needs repair on this computer before OpenMeld can start it.`,
          installChoices: [],
          launchContract: null,
          status: "needs_repair" as const,
        };
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
  });

  it("toggles one registered agent enabled state", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

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
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("manage")
        .mockResolvedValueOnce("toggle_enabled")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "codex",
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      await runAgents({ view: "human" });

      const controllers = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(controllers).toHaveLength(1);
      expect(controllers?.[0]?.agentId).toBe("codex");
      expect(controllers?.[0]?.enabled).toBe(false);
      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            allowBack?: boolean;
            items?: Array<{
              value: string;
              detail?: string;
            }>;
          }
        | undefined;
      expect(pickerCall?.allowBack).toBe(true);
      expect(pickerCall?.items?.[0]).toMatchObject({
        value: "codex",
        label: "codex",
      });
      expect(pickerCall?.items?.[0]?.detail).toContain("Codex");
      expect(pickerCall?.items?.[0]?.detail).toContain("Turned on");
      expect(pickerCall?.items?.[0]?.detail).toContain(
        "Live for Space @mentions"
      );
    });
  });

  it("shows agent details in unified narrow card", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

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
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("manage")
        .mockResolvedValueOnce("show_details")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "codex",
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stdout).toContain("Agent in OpenMeld");
      expect(stdout).toContain("@codex");
      expect(stdout).toContain("App: Codex");
      expect(stdout).toContain("Available in Space");
      expect(stdout).toContain("can wake it");
      expect(stdout).toContain(
        "Connection Type: Codex App Server on this computer"
      );
      expect(stdout).toContain("└");
      expect(stdout).toContain("│");
    });
  });

  it("goes back to the agent-id list before changing another agent", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const claudeLaunchContract = await createTestNodeScriptLaunchContract({
        home,
        scriptName: "claude-code",
      });
      const codexLaunchContract = await createTestNodeScriptLaunchContract({
        home,
        scriptName: "codex",
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            launchContract: claudeLaunchContract,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: codexLaunchContract,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("manage")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("toggle_enabled")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "codex",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "claude-code",
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      await runAgents({ view: "human" });

      const controllers =
        (await getConfiguredDeviceRuntimeState())?.controllers ?? [];
      expect(controllers).toHaveLength(2);
      expect(
        controllers.find((controller) => controller.agentId === "codex")
          ?.enabled
      ).toBe(true);
      expect(
        controllers.find((controller) => controller.agentId === "claude-code")
          ?.enabled
      ).toBe(false);
      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            allowBack?: boolean;
            items?: Array<{
              value: string;
              label?: string;
              detail?: string;
            }>;
          }
        | undefined;
      expect(pickerCall?.allowBack).toBe(true);
      const claudeCodeItem = pickerCall?.items?.find(
        (item) => item.value === "claude-code"
      );
      expect(claudeCodeItem?.label).toBe("claude-code");
      expect(claudeCodeItem?.detail).toContain("Claude Code");
      expect(claudeCodeItem?.detail).toContain("Turned on");
      expect(claudeCodeItem?.detail).toContain("Live for Space @mentions");
    });
  });

  it("shows repair state together with the current switch state in the connected agent picker", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock.mockResolvedValueOnce("manage").mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      await runAgents({ view: "human" });

      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              detail?: string;
            }>;
          }
        | undefined;
      expect(pickerCall?.items?.[0]).toMatchObject({
        value: "claude-code",
      });
      expect(pickerCall?.items?.[0]?.detail).toContain("Claude Code");
      expect(pickerCall?.items?.[0]?.detail).toContain("Turned on");
      expect(pickerCall?.items?.[0]?.detail).toContain(
        "Needs repair on this computer"
      );
    });
  });

  it("shows when a connected agent is turned off in the picker", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

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
            enabled: false,
            launchContract: codexLaunchContract,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock.mockResolvedValueOnce("manage").mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      await runAgents({ view: "human" });

      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              detail?: string;
            }>;
          }
        | undefined;
      expect(pickerCall?.items?.[0]).toMatchObject({
        value: "codex",
      });
      expect(pickerCall?.items?.[0]?.detail).toContain("Codex");
      expect(pickerCall?.items?.[0]?.detail).toContain(
        "Turned off for new @mentions"
      );
      expect(pickerCall?.items?.[0]?.detail).not.toContain(
        "Live for Space @mentions"
      );
    });
  });

  it("returns to the top-level menu when the agent-id picker backs out", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

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
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock.mockResolvedValueOnce("manage").mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      const result = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(cancelMock).not.toHaveBeenCalled();
      expect(result.stdout).not.toContain("Cancelled.");
      expect(result.stderr).not.toContain("Cancelled.");
      expect(selectMock).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps Back/Exit silent and still reports true cancellation", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("manage").mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      const backResult = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(cancelMock).not.toHaveBeenCalled();
      expect(backResult.stdout).not.toContain("Cancelled.");
      expect(backResult.stderr).not.toContain("Cancelled.");

      vi.clearAllMocks();

      selectMock
        .mockResolvedValueOnce("manage")
        .mockResolvedValueOnce("__cancel__");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "codex",
      });

      await runAgents({ view: "human" });

      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });
});
