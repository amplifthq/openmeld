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
    detectInstalledSkillsAgents: detectInstalledSkillsAgentsMock,
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

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

import { runAgents } from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const CUSTOM_TARGET_ID_PREFIX_RE = /^custom-/;

describe("openmeld agents interactive custom flow", () => {
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

  it("shows minimal custom menu options without deprecated enable", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");

      await runAgents({ view: "human" });

      const customMenuCall = selectMock.mock.calls[1]?.[0] as
        | {
            options?: Array<{ value: string }>;
          }
        | undefined;
      const customValues = customMenuCall?.options?.map(
        (option) => option.value
      );
      expect(customValues).toEqual(["add", "edit", "remove", "list", "back"]);
    });
  });

  it("adds custom target from interactive custom menu", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("add")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptTextEntryMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "Interactive Target",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "/tmp/interactive-target",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "",
        });

      await runAgents({ view: "human" });

      const customTargets = (await getConfiguredSkillsConfig())?.customTargets;
      expect(customTargets).toHaveLength(1);
      expect(customTargets?.[0]?.name).toBe("Interactive Target");
      expect(customTargets?.[0]?.dir).toBe("/tmp/interactive-target");
      expect(customTargets?.[0]?.id).toMatch(CUSTOM_TARGET_ID_PREFIX_RE);
    });
  });

  it("re-prompts until custom dir is non-empty absolute path", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("add")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptTextEntryMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "Dir Validation Target",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "relative/path",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "/tmp/dir-validation-target",
        })
        .mockResolvedValueOnce({
          status: "submitted",
          value: "",
        });

      const { stderr } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stderr).toContain("Custom target absolute dir is required.");
      expect(stderr).toContain(
        "Custom target absolute dir must be an absolute path."
      );

      const customTargets = (await getConfiguredSkillsConfig())?.customTargets;
      expect(customTargets).toHaveLength(1);
      expect(customTargets?.[0]?.name).toBe("Dir Validation Target");
      expect(customTargets?.[0]?.dir).toBe("/tmp/dir-validation-target");
      expect(customTargets?.[0]?.id).toMatch(CUSTOM_TARGET_ID_PREFIX_RE);
    });
  });

  it("updates custom target dir from interactive custom menu while keeping id", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Interactive Edit",
            dir: "/tmp/interactive-edit",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("dir")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "custom-target-001",
      });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: "/tmp/interactive-edit-v2",
      });

      await runAgents({ view: "human" });

      const customTargets = (await getConfiguredSkillsConfig())?.customTargets;
      expect(customTargets).toHaveLength(1);
      expect(customTargets?.[0]?.id).toBe("custom-target-001");
      expect(customTargets?.[0]?.dir).toBe("/tmp/interactive-edit-v2");
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
        value: "custom-target-001",
      });
      expect(pickerCall?.items?.[0]?.detail).toContain("ID custom-target-001");
      expect(pickerCall?.items?.[0]?.detail).toContain("/tmp/interactive-edit");
    });
  });

  it("removes custom target from interactive custom menu", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Interactive Remove",
            dir: "/tmp/interactive-remove",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("remove")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "custom-target-001",
      });

      await runAgents({ view: "human" });

      expect((await getConfiguredSkillsConfig())?.customTargets ?? []).toEqual(
        []
      );
    });
  });

  it("keeps state unchanged when listing and backing out", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Interactive List",
            dir: "/tmp/interactive-list",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("list")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");

      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(stdout).toContain("Custom agents");
      expect(stdout).toContain("Configured custom agents: 1");
      expect((await getConfiguredSkillsConfig())?.customTargets).toHaveLength(
        1
      );
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers ?? []
      ).toEqual([]);
    });
  });

  it("returns to the custom menu when searchable target selection backs out", async () => {
    const prompts = await import("@clack/prompts");
    const cancelMock = vi.mocked(prompts.cancel);
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Interactive Edit",
            dir: "/tmp/interactive-edit",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });

      const result = await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(cancelMock).not.toHaveBeenCalled();
      expect(result.stdout).not.toContain("Cancelled.");
      expect(result.stderr).not.toContain("Cancelled.");
      expect(selectMock).toHaveBeenCalledTimes(4);
    });
  });

  it("returns from custom target dir back to name, then back to the custom menu", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("add")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptTextEntryMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "Backtrack Target",
        })
        .mockResolvedValueOnce({
          status: "back",
        })
        .mockResolvedValueOnce({
          status: "back",
        });

      await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(promptTextEntryMock).toHaveBeenCalledTimes(3);
      expect((await getConfiguredSkillsConfig())?.customTargets ?? []).toEqual(
        []
      );
      expect(selectMock).toHaveBeenCalledTimes(4);
    });
  });

  it("returns from edit value back to field picker, then back to target picker", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);

    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Interactive Edit",
            dir: "/tmp/interactive-edit",
          },
        ],
      });

      selectMock
        .mockResolvedValueOnce("custom")
        .mockResolvedValueOnce("edit")
        .mockResolvedValueOnce("name")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("back")
        .mockResolvedValueOnce("exit");
      promptSearchSelectMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "custom-target-001",
        })
        .mockResolvedValueOnce({
          status: "back",
        });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "back",
      });

      await withCapturedStdio(async () => {
        await runAgents({ view: "human" });
      });

      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "New name",
          allowBack: true,
          backLabel: "Back",
        })
      );
      expect(selectMock).toHaveBeenCalledTimes(6);
    });
  });
});
