import { describe, expect, it } from "vitest";
import {
  runAgentsConfig,
  runAgentsCustomAdd,
  runAgentsCustomRemove,
  runAgentsCustomUpdate,
  runAgentsDisable,
  runAgentsEnable,
} from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("openmeld agents error code compatibility", () => {
  it("keeps existing agents.* validation codes", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsEnable({
          view: "agent",
        })
      ).rejects.toThrow("agents.enable_invalid:");

      await expect(
        runAgentsDisable({
          view: "agent",
        })
      ).rejects.toThrow("agents.disable_invalid:");

      await expect(
        runAgentsConfig({
          view: "agent",
          agentId: "codex",
        })
      ).rejects.toThrow("agents.config_invalid:");
    });
  });

  it("keeps custom command error codes", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsCustomAdd({
          view: "agent",
          name: "Invalid Dir",
          dir: "relative/path",
        })
      ).rejects.toThrow("agents.custom.invalid_argument:");

      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Existing Target",
            dir: "/tmp/existing-target",
          },
        ],
      });

      await expect(
        runAgentsCustomAdd({
          view: "agent",
          id: "custom-target-001",
          name: "Duplicate Id",
          dir: "/tmp/another-target",
        })
      ).rejects.toThrow("agents.custom.conflict:");

      await expect(
        runAgentsCustomUpdate({
          view: "agent",
          id: "custom-missing",
          name: "Missing Target",
        })
      ).rejects.toThrow("agents.custom.not_found:");

      await expect(
        runAgentsCustomRemove({
          view: "agent",
          id: "custom-missing",
        })
      ).rejects.toThrow("agents.custom.not_found:");
    });
  });

  it("auto-prunes stale custom registrations before custom remove", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "In Use Target",
            dir: "/tmp/in-use-target",
          },
        ],
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "custom-target-001",
            displayName: "In Use Target",
            enabled: false,
            registeredAt: "2026-02-24T00:00:00.000Z",
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      await runAgentsCustomRemove({
        view: "agent",
        id: "custom-target-001",
      });
      expect((await getConfiguredSkillsConfig())?.customTargets ?? []).toEqual(
        []
      );
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers ?? []
      ).toEqual([]);
    });
  });
});
