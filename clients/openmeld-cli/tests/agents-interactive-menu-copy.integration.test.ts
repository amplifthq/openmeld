import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { resolveBuiltinControllerInstallResolutionMock } = vi.hoisted(() => ({
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
    resolveBuiltinControllerInstallResolution:
      resolveBuiltinControllerInstallResolutionMock,
  };
});

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

import { runAgents } from "../src/commands/agents";
import { setConfiguredDeviceRuntimeState } from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("openmeld agents interactive menu copy", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue([]);
    resolveBuiltinControllerInstallResolutionMock.mockResolvedValue({
      detail: null,
      installChoices: [],
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
      },
      status: "ready",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
  });

  it("hides the turn-on entry when no actionable agents are available", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("exit");

      await runAgents({ view: "human" });

      const menuCall = selectMock.mock.calls[0]?.[0] as
        | {
            message?: string;
            options?: Array<{
              value?: string;
              label?: string;
              hint?: string;
            }>;
          }
        | undefined;

      expect(menuCall?.message).toContain("OpenMeld agents:");
      expect(menuCall?.message).toContain(
        "Enable agents on this computer so people in a Space can mention them."
      );
      expect(
        menuCall?.options?.some((option) => option.value === "quick_enable")
      ).toBe(false);
      expect(menuCall?.options?.map((option) => option.label)).toEqual([
        "Review Agents on This Device",
        "Find Agents on This Device",
        "Exit",
      ]);
      expect(menuCall?.options?.[0]).toMatchObject({
        hint: "No agents are set up on this computer yet",
      });
    });
  });

  it("shows clear entry labels when actionable agents are available", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);

    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("exit");

      await runAgents({ view: "human" });

      const options = (
        selectMock.mock.calls[0]?.[0] as
          | {
              options?: Array<{
                value?: string;
                label?: string;
                hint?: string;
              }>;
            }
          | undefined
      )?.options;

      expect(options?.[0]).toMatchObject({
        value: "quick_enable",
        label: "Enable available agents",
        hint: "1 new agent can be turned on now",
      });
      expect(options?.[1]).toMatchObject({
        value: "manage",
        label: "Review Agents on This Device",
      });
      expect(options?.[2]).toMatchObject({
        value: "detect",
        label: "Find Agents on This Device",
        hint: "Check which supported AI tools OpenMeld can see here",
      });
    });
  });

  it("hides the new-agent entry when the only available agent is already set up but turned off", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue(["claude-code"]);

    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: false,
            launchContract: {
              kind: "executable",
              commandPath: process.execPath,
            },
            registeredAt: "2026-04-13T00:00:00.000Z",
            updatedAt: "2026-04-13T00:00:00.000Z",
          },
        ],
      });
      selectMock.mockResolvedValueOnce("exit");

      await runAgents({ view: "human" });

      const menuOptions = (
        selectMock.mock.calls[0]?.[0] as
          | {
              options?: Array<{
                value?: string;
                label?: string;
                hint?: string;
              }>;
            }
          | undefined
      )?.options;

      expect(
        menuOptions?.some((option) => option.value === "quick_enable")
      ).toBe(false);
      expect(menuOptions?.[0]).toMatchObject({
        value: "manage",
        label: "Review Agents on This Device",
        hint: "Review 1 agent on this computer",
      });
    });
  });
});
