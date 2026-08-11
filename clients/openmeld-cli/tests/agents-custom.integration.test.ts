import { describe, expect, it } from "vitest";
import {
  runAgentsCustomAdd,
  runAgentsCustomList,
  runAgentsCustomRemove,
  runAgentsCustomUpdate,
} from "../src/commands/agents";
import {
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const CUSTOM_TARGET_ID_PREFIX_RE = /^custom-/;

describe("openmeld agents custom", () => {
  it("lists custom agents in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsCustomList({
          view: "agent",
        });
      });
      const envelope = parseAgentResultEnvelope(
        stdout,
        "agents.custom.list.result"
      );
      const payload = envelope.payload as
        | {
            count?: number;
            targets?: Array<{ id?: string }>;
          }
        | undefined;
      expect(payload?.count).toBe(0);
      expect(payload?.targets ?? []).toHaveLength(0);
    });
  });

  it("adds and updates custom target while keeping id stable", async () => {
    await withTempHome(async () => {
      const { stdout: addStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomAdd({
          view: "agent",
          name: "Executor Agent",
          dir: "/tmp/agent-executor",
        });
      });
      const addEnvelope = parseAgentResultEnvelope(
        addStdout,
        "agents.custom.add.result"
      );
      const addedTarget = (addEnvelope.payload as { target?: { id?: string } })
        ?.target;
      expect(addedTarget?.id).toMatch(CUSTOM_TARGET_ID_PREFIX_RE);

      const targetId = String(addedTarget?.id ?? "");
      const { stdout: updateStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomUpdate({
          view: "agent",
          id: targetId,
          name: "Executor Agent Updated",
          dir: "/tmp/agent-executor-v2",
        });
      });
      const updateEnvelope = parseAgentResultEnvelope(
        updateStdout,
        "agents.custom.update.result"
      );
      const updatePayload = updateEnvelope.payload as
        | {
            target?: { id?: string; name?: string; dir?: string };
            updatedFields?: string[];
          }
        | undefined;
      expect(updatePayload?.target?.id).toBe(targetId);
      expect(updatePayload?.target?.name).toBe("Executor Agent Updated");
      expect(updatePayload?.target?.dir).toBe("/tmp/agent-executor-v2");
      expect(updatePayload?.updatedFields).toEqual(["name", "dir"]);

      const customTargets = (await getConfiguredSkillsConfig())?.customTargets;
      expect(customTargets).toHaveLength(1);
      expect(customTargets?.[0]?.id).toBe(targetId);
      expect(customTargets?.[0]?.dir).toBe("/tmp/agent-executor-v2");
    });
  });

  it("auto-prunes stale custom registration and allows remove", async () => {
    await withTempHome(async () => {
      for (const enabled of [true, false]) {
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
              enabled,
              registeredAt: "2026-02-23T00:00:00.000Z",
              updatedAt: "2026-02-23T00:00:00.000Z",
            },
          ],
        });

        const { stdout } = await withCapturedStdio(async () => {
          await runAgentsCustomRemove({
            view: "agent",
            id: "custom-target-001",
          });
        });
        const envelope = parseAgentResultEnvelope(
          stdout,
          "agents.custom.remove.result"
        );
        const payload = envelope.payload as
          | {
              targetId?: string;
            }
          | undefined;
        expect(payload?.targetId).toBe("custom-target-001");

        expect(
          (await getConfiguredSkillsConfig())?.customTargets ?? []
        ).toEqual([]);
        expect(
          (await getConfiguredDeviceRuntimeState())?.controllers ?? []
        ).toEqual([]);
      }
    });
  });

  it("removes target and keeps installs records untouched", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "To Remove",
            dir: "/tmp/remove-target",
          },
        ],
        installs: [
          {
            targetId: "custom-target-001",
            targetDir: "/tmp/remove-target",
            mode: "copy",
            status: "installed",
            skillIds: ["openmeld-cli"],
            updatedAt: "2026-02-24T00:00:00.000Z",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgentsCustomRemove({
          view: "agent",
          id: "custom-target-001",
        });
      });
      const envelope = parseAgentResultEnvelope(
        stdout,
        "agents.custom.remove.result"
      );
      const payload = envelope.payload as
        | {
            targetId?: string;
            installsPolicy?: string;
          }
        | undefined;
      expect(payload?.targetId).toBe("custom-target-001");
      expect(payload?.installsPolicy).toBe("kept");

      const nextSkillsConfig = await getConfiguredSkillsConfig();
      expect(nextSkillsConfig?.customTargets ?? []).toHaveLength(0);
      expect(nextSkillsConfig?.installs ?? []).toHaveLength(1);
      expect(nextSkillsConfig?.installs?.[0]?.targetId).toBe(
        "custom-target-001"
      );
    });
  });

  it("uses invalid_argument for relative dir in add and update", async () => {
    await withTempHome(async () => {
      await expect(
        runAgentsCustomAdd({
          view: "agent",
          name: "Relative Dir",
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
        runAgentsCustomUpdate({
          view: "agent",
          id: "custom-target-001",
          dir: "./relative-new-dir",
        })
      ).rejects.toThrow("agents.custom.invalid_argument:");
    });
  });

  it("uses conflict and not_found error codes", async () => {
    await withTempHome(async () => {
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
        runAgentsCustomAdd({
          view: "agent",
          id: "custom-target-002",
          name: "Duplicate Dir",
          dir: "/tmp/existing-target",
        })
      ).rejects.toThrow("agents.custom.conflict:");

      await expect(
        runAgentsCustomUpdate({
          view: "agent",
          id: "custom-target-missing",
          name: "Missing",
        })
      ).rejects.toThrow("agents.custom.not_found:");

      await expect(
        runAgentsCustomRemove({
          view: "agent",
          id: "custom-target-missing",
        })
      ).rejects.toThrow("agents.custom.not_found:");
    });
  });

  it("renders human view output for list/add/update/remove", async () => {
    await withTempHome(async () => {
      const { stdout: addStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomAdd({
          view: "human",
          name: "Human Target",
          dir: "/tmp/human-target",
        });
      });
      expect(addStdout).toContain("Custom Agent Added");

      const targetId =
        (await getConfiguredSkillsConfig())?.customTargets?.[0]?.id ?? "";
      expect(targetId).toMatch(CUSTOM_TARGET_ID_PREFIX_RE);

      const { stdout: listStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomList({
          view: "human",
        });
      });
      expect(listStdout).toContain("Custom agents");
      expect(listStdout).toContain("Configured custom agents: 1");
      expect(listStdout).toContain("Human Target");

      const { stdout: updateStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomUpdate({
          view: "human",
          id: targetId,
          name: "Human Target Updated",
        });
      });
      expect(updateStdout).toContain("Custom Agent Updated");
      expect(updateStdout).toContain("name");

      const { stdout: removeStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomRemove({
          view: "human",
          id: targetId,
        });
      });
      expect(removeStdout).toContain("Custom Agent Removed");
      expect(removeStdout).toContain("Installs records are kept");
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
