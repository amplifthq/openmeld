import { describe, expect, it } from "vitest";
import {
  runAgents,
  runAgentsCustomAdd,
  runAgentsCustomList,
  runAgentsCustomRemove,
  runAgentsCustomUpdate,
} from "../src/commands/agents";
import { setConfiguredSkillsConfig } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const CUSTOM_TARGET_ID_PREFIX_RE = /^custom-/;

describe("openmeld agents contract freeze", () => {
  it("keeps agents.menu.result payload contract for custom section", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Contract Custom",
            dir: "/tmp/contract-custom",
          },
        ],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runAgents({
          view: "agent",
        });
      });

      const envelope = parseAgentResultEnvelope(stdout, "agents.menu.result");
      const payload = envelope.payload as
        | {
            commands?: string[];
            selection?: {
              customAgents?: {
                supported?: boolean;
                commands?: string[];
              };
            };
          }
        | undefined;

      expect(payload?.commands).toContain("openmeld agents custom list");
      expect(payload?.commands).toContain("openmeld agents manage");
      expect(payload?.selection?.customAgents?.supported).toBe(false);
      expect(payload?.selection?.customAgents?.commands).toContain(
        "openmeld agents custom remove --id <id>"
      );
    });
  });

  it("keeps custom CRUD result codes and payload shape in agent view", async () => {
    await withTempHome(async () => {
      const { stdout: addStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomAdd({
          view: "agent",
          name: "Contract Add",
          dir: "/tmp/contract-add",
        });
      });
      const addEnvelope = parseAgentResultEnvelope(
        addStdout,
        "agents.custom.add.result"
      );
      const addTarget = (addEnvelope.payload as { target?: { id?: string } })
        ?.target;
      const targetId = String(addTarget?.id ?? "");
      expect(targetId).toMatch(CUSTOM_TARGET_ID_PREFIX_RE);

      const { stdout: listStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomList({
          view: "agent",
        });
      });
      const listEnvelope = parseAgentResultEnvelope(
        listStdout,
        "agents.custom.list.result"
      );
      const listPayload = listEnvelope.payload as
        | {
            count?: number;
            targets?: Array<{ id?: string }>;
          }
        | undefined;
      expect(listPayload?.count).toBe(1);
      expect(listPayload?.targets?.[0]?.id).toBe(targetId);

      const { stdout: updateStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomUpdate({
          view: "agent",
          id: targetId,
          name: "Contract Updated",
          dir: "/tmp/contract-add-v2",
        });
      });
      const updateEnvelope = parseAgentResultEnvelope(
        updateStdout,
        "agents.custom.update.result"
      );
      const updatePayload = updateEnvelope.payload as
        | {
            target?: { id?: string; dir?: string };
            updatedFields?: string[];
          }
        | undefined;
      expect(updatePayload?.target?.id).toBe(targetId);
      expect(updatePayload?.target?.dir).toBe("/tmp/contract-add-v2");
      expect(updatePayload?.updatedFields).toEqual(["name", "dir"]);

      const { stdout: removeStdout } = await withCapturedStdio(async () => {
        await runAgentsCustomRemove({
          view: "agent",
          id: targetId,
        });
      });
      const removeEnvelope = parseAgentResultEnvelope(
        removeStdout,
        "agents.custom.remove.result"
      );
      const removePayload = removeEnvelope.payload as
        | {
            targetId?: string;
            installsPolicy?: string;
            removed?: { id?: string };
          }
        | undefined;
      expect(removePayload?.targetId).toBe(targetId);
      expect(removePayload?.removed?.id).toBe(targetId);
      expect(removePayload?.installsPolicy).toBe("kept");
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
