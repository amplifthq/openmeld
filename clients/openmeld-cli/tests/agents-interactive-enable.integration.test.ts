import { afterEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { promptSearchMultiselectMock, promptSearchSelectMock } = vi.hoisted(
  () => ({
    promptSearchMultiselectMock: vi.fn(),
    promptSearchSelectMock: vi.fn(),
  })
);

const { resolveBuiltinControllerInstallResolutionMock } = vi.hoisted(() => ({
  resolveBuiltinControllerInstallResolutionMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselect: (
    ...args: Parameters<typeof promptSearchMultiselectMock>
  ) => promptSearchMultiselectMock(...args),
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
    promptSearchSelectMock(...args),
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

import { runAgents } from "../src/commands/agents";
import { setConfiguredDeviceRuntimeState } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld agents interactive detected enable selection", () => {
  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    resolveBuiltinControllerInstallResolutionMock.mockReset();
  });

  it("prints clear message when detected set has no actionable builtin targets", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex", "cursor"]);
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: { agentId: string; runtimeSupported: boolean }) => {
        if (!input.runtimeSupported) {
          return {
            detail: null,
            launchContract: null,
            status: "not_available" as const,
          };
        }
        return {
          detail: null,
          launchContract: {
            kind: "executable" as const,
            commandPath: process.execPath,
          },
          status: "ready" as const,
        };
      }
    );

    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
          {
            agentId: "cursor",
            displayName: "Cursor",
            enabled: true,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("quick_enable")
        .mockResolvedValueOnce("exit");
      const { stderr } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stderr).toContain("No more agents are available to enable.");
      expect(promptSearchMultiselectMock).not.toHaveBeenCalled();
    });
  });

  it("prints a clear message when all detected agents are already enabled", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
    resolveBuiltinControllerInstallResolutionMock.mockResolvedValue({
      detail: null,
      launchContract: {
        kind: "executable" as const,
        commandPath: process.execPath,
      },
      status: "ready" as const,
    });

    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("quick_enable")
        .mockResolvedValueOnce("exit");

      const { stderr } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stderr).toContain("No more agents are available to enable.");
      expect(promptSearchMultiselectMock).not.toHaveBeenCalled();
    });
  });

  it("hides custom targets from top-level interactive agents menu", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
    resolveBuiltinControllerInstallResolutionMock.mockResolvedValue({
      detail: null,
      launchContract: {
        kind: "executable" as const,
        commandPath: process.execPath,
      },
      status: "ready" as const,
    });

    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("exit");

      await runAgents({ view: "human" });

      const topMenuCall = selectMock.mock.calls[0]?.[0] as
        | {
            options?: Array<{ value: string }>;
          }
        | undefined;
      const topMenuValues = topMenuCall?.options?.map((option) => option.value);
      expect(topMenuValues).toEqual([
        "quick_enable",
        "manage",
        "detect",
        "exit",
      ]);
      expect(topMenuValues).not.toContain("custom");
    });
  });

  it("renders quick-enable options only for actionable agents, without agent ids and with updated hints", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    detectInstalledSkillsAgentsMock.mockResolvedValue([
      "claude-code",
      "codex",
      "openclaw",
      "cursor",
    ]);
    resolveBuiltinControllerInstallResolutionMock.mockImplementation(
      (input: { agentId: string; runtimeSupported: boolean }) => {
        if (!input.runtimeSupported) {
          return {
            detail: null,
            launchContract: null,
            status: "not_available" as const,
          };
        }
        return {
          detail: null,
          launchContract: {
            kind: "executable" as const,
            commandPath: process.execPath,
          },
          status: "ready" as const,
        };
      }
    );

    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("quick_enable")
        .mockResolvedValueOnce("exit");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "submitted",
        value: ["claude-code"],
      });

      await runAgents({ view: "human" });

      const callArg = promptSearchMultiselectMock.mock.calls[0]?.[0] as
        | {
            message?: string;
            allowBack?: boolean;
            items?: Array<{
              value: string;
              label: string;
              detail?: string;
              disabled?: boolean;
            }>;
          }
        | undefined;
      expect(callArg?.message).toBe("Choose agents to enable");
      expect(callArg?.allowBack).toBe(true);
      const items = callArg?.items ?? [];
      expect(items.some((item) => item.label.includes("(codex)"))).toBe(false);
      expect(items.find((item) => item.value === "claude-code")?.label).toBe(
        "Claude Code"
      );
      expect(
        items.find((item) => item.value === "claude-code")?.detail
      ).toContain("ID claude-code");
      expect(
        items.find((item) => item.value === "claude-code")?.detail
      ).toContain("Available to enable now");
      expect(items.find((item) => item.value === "claude-code")?.disabled).toBe(
        false
      );
      expect(items.find((item) => item.value === "openclaw")).toBeUndefined();
      expect(items.find((item) => item.value === "codex")).toBeUndefined();
      expect(items.find((item) => item.value === "cursor")?.label).toBe(
        "Cursor"
      );
      expect(items.find((item) => item.value === "cursor")?.detail).toContain(
        "Available to enable now"
      );
      expect(items.find((item) => item.value === "cursor")?.disabled).toBe(
        false
      );
      expect(
        items.find((item) => item.label === "Custom agents (coming soon)")
          ?.disabled
      ).toBe(true);
    });
  });
});
