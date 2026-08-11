import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
}));

const { promptSearchMultiselectMock, promptSearchSelectMock } = vi.hoisted(
  () => ({
    promptSearchMultiselectMock: vi.fn(),
    promptSearchSelectMock: vi.fn(),
  })
);
const { promptTextEntryMock } = vi.hoisted(() => ({
  promptTextEntryMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === "__cancel__"),
    select: vi.fn(),
    text: vi.fn(),
  };
});

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

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
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

import {
  runSkills,
  runSkillsCheck,
  runSkillsInstall,
  runSkillsUninstall,
} from "../src/commands/skills";
import { setConfiguredSkillsConfig } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("openmeld skills interactive target filtering", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
  });

  it("shows only missing/outdated agents in interactive install selection", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      const adalSkillsDir = join(home, "adal-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await mkdir(adalSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
          adal: { globalSkillsDir: adalSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi", "adal"]);

      await runSkillsInstall({
        agent: ["pochi"],
        view: "human",
      });

      selectMock
        .mockResolvedValueOnce("select")
        .mockResolvedValueOnce("__navigation__");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "back",
      });
      await runSkillsInstall({ view: "human" });

      const pickerCall = promptSearchMultiselectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              detail?: string;
            }>;
            allowBack?: boolean;
          }
        | undefined;
      expect(pickerCall?.items?.map((item) => item.value)).toEqual(["adal"]);
      expect(pickerCall?.allowBack).toBe(true);
      expect(pickerCall?.items?.[0]?.detail).toContain("ID adal");
      expect(pickerCall?.items?.[0]?.detail).toContain(adalSkillsDir);
    });
  });

  it("defaults the install target menu to automatic install with concise copy", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);
      selectMock.mockResolvedValueOnce("__navigation__");

      const result = await runSkillsInstall({ view: "human" });

      const promptCall = selectMock.mock.calls[0]?.[0] as
        | {
            message?: string;
            initialValue?: string;
            options?: Array<{
              value: string;
              label: string;
              hint?: string;
            }>;
          }
        | undefined;

      expect(result).toBe("cancelled");
      expect(promptCall).toMatchObject({
        message: "How do you want to install OpenMeld skills?",
        initialValue: "all",
      });
      expect(promptCall?.options).toEqual([
        {
          value: "all",
          label: "Install automatically",
          hint: "For all detected agents that need it",
        },
        {
          value: "select",
          label: "Choose agents",
          hint: "Pick which agents to install or update",
        },
        {
          value: "custom",
          label: "Custom agent",
          hint: "Use a custom skills folder",
        },
        {
          value: "guide",
          label: "Manual install guide",
        },
        {
          value: "__navigation__",
          label: "Cancel",
        },
      ]);
    });
  });

  it("shows only OpenMeld-installed agents in interactive uninstall selection", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      const adalSkillsDir = join(home, "adal-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await mkdir(adalSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
          adal: { globalSkillsDir: adalSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi", "adal"]);

      await runSkillsInstall({
        agent: ["pochi"],
        view: "human",
      });

      selectMock
        .mockResolvedValueOnce("select")
        .mockResolvedValueOnce("__navigation__");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "back",
      });
      await runSkillsUninstall({ view: "human" });

      const pickerCall = promptSearchMultiselectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              detail?: string;
            }>;
          }
        | undefined;
      expect(pickerCall?.items?.map((item) => item.value)).toEqual(["pochi"]);
      expect(pickerCall?.items?.[0]?.detail).toContain("ID pochi");
      expect(pickerCall?.items?.[0]?.detail).toContain(pochiSkillsDir);
    });
  });

  it("rejects nonexistent custom uninstall directory in interactive flow", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      await setConfiguredSkillsConfig({
        agents: {},
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue([]);
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("__navigation__");
      promptTextEntryMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: join(home, "missing-skills-dir"),
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      const { stderr } = await withCapturedStdio(async () => {
        await runSkillsUninstall({ view: "human" });
      });

      expect(stderr).toContain("Path does not exist.");
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Custom agent skills directory (absolute path)",
          allowBack: true,
          backLabel: "Back",
        })
      );
    });
  });

  it("returns to the install action menu when the searchable picker goes back", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);

      selectMock
        .mockResolvedValueOnce("select")
        .mockResolvedValueOnce("__navigation__");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "back",
      });

      const result = await withCapturedStdio(async () => {
        await runSkillsInstall({ view: "human" });
      });

      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
      expect(result.stdout).not.toContain("Cancelled.");
      expect(result.stderr).not.toContain("Cancelled.");
      expect(selectMock).toHaveBeenCalledTimes(2);
    });
  });

  it("returns to the install target menu when custom directory input goes back", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("__navigation__");
      promptTextEntryMock.mockResolvedValueOnce({
        status: "back",
      });

      const result = await withCapturedStdio(async () => {
        await runSkillsInstall({ view: "human" });
      });

      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
      expect(result.stdout).not.toContain("Installed OpenMeld skills");
      expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
      expect(selectMock).toHaveBeenCalledTimes(2);
    });
  });

  it("returns to the skills menu when install custom directory backs out level by level", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const pochiSkillsDir = join(home, "pochi-skills");
      await mkdir(pochiSkillsDir, { recursive: true });
      await setConfiguredSkillsConfig({
        agents: {
          pochi: { globalSkillsDir: pochiSkillsDir },
        },
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);
      selectMock
        .mockResolvedValueOnce("install")
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("__navigation__")
        .mockResolvedValueOnce("exit");
      promptTextEntryMock.mockResolvedValueOnce({
        status: "back",
      });

      await withCapturedStdio(async () => {
        await runSkills({ view: "human" });
      });

      const installPrompt = selectMock.mock.calls[1]?.[0] as
        | { options?: Array<{ label: string; value: string }> }
        | undefined;
      expect(
        installPrompt?.options?.some((option) => option.label === "Back")
      ).toBe(true);
      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
      expect(selectMock).toHaveBeenCalledTimes(4);
    });
  });

  it("returns to the uninstall target menu when external uninstall confirm backs out", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const externalDir = join(home, "outside", "skills");
      await mkdir(externalDir, { recursive: true });
      await runSkillsInstall({
        dir: externalDir,
        view: "human",
      });
      detectInstalledSkillsAgentsMock.mockResolvedValue([]);

      selectMock.mockImplementation(
        (input?: {
          message?: string;
          options?: Array<{ label: string; value: unknown }>;
        }) => {
          if (input?.message === "Choose OpenMeld skills uninstall target") {
            const targetPromptCount = selectMock.mock.calls.filter(
              ([payload]) =>
                payload &&
                typeof payload === "object" &&
                "message" in payload &&
                payload.message === "Choose OpenMeld skills uninstall target"
            ).length;
            return Promise.resolve(
              targetPromptCount === 1 ? "custom" : "__navigation__"
            );
          }
          if (
            String(input?.message).includes(
              "Detected 1 uninstall target(s) outside this OpenMeld installation:"
            )
          ) {
            const confirmPromptCount = selectMock.mock.calls.filter(
              ([payload]) =>
                payload &&
                typeof payload === "object" &&
                "message" in payload &&
                String(payload.message).includes(
                  "Detected 1 uninstall target(s) outside this OpenMeld installation:"
                )
            ).length;
            const backValue = input?.options?.find(
              (option) => option.label === "Back"
            )?.value;
            return Promise.resolve(
              confirmPromptCount === 1 ? "continue" : (backValue ?? "continue")
            );
          }
          throw new Error(
            `Unexpected select prompt: ${String(input?.message)}`
          );
        }
      );
      promptTextEntryMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: externalDir,
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      await withCapturedStdio(async () => {
        await runSkillsUninstall({ view: "human" });
      });

      expect(promptTextEntryMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          message: 'Type "UNINSTALL" to confirm external target removal',
          allowBack: true,
          backLabel: "Back",
        })
      );
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("renders skills check inline as cards when run directly", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });
      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(promptSearchSelectMock).not.toHaveBeenCalled();
      expect(stdout).toContain("OpenMeld Skills Status");
      expect(stdout).toContain("status:");
      expect(stdout).toContain(
        "OpenMeld skills are up to date on all detected agents and saved installs."
      );
      expect(stdout).toContain("Up-to-date Installs (1)");
      expect(stdout).toContain(customDir);
    });
  });

  it("returns to the skills menu when the check viewer goes back", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });
      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      selectMock.mockResolvedValueOnce("check").mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      await withCapturedStdio(async () => {
        await runSkills({ view: "human" });
      });

      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            backLabel?: string;
          }
        | undefined;
      expect(selectMock).toHaveBeenCalledTimes(2);
      expect(pickerCall?.backLabel).toBe("Back");
    });
  });
});
