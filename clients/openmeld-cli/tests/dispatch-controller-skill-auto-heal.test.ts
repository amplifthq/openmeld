import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setConfiguredSkillsConfig } from "../src/config/runtime-config";
import { ensureDispatchControllerOpenMeldSkill } from "../src/local-service/dispatch/ensure-dispatch-controller-openmeld-skill";
import { withTempHome } from "./helpers/fs";

const PREFERRED_SPACE_ACTION_TOOL_COPY =
  /Prefer the dispatch-scoped OpenMeld Space\s+Action tool named in the Wake prompt\./;

describe("ensureDispatchControllerOpenMeldSkill", () => {
  it("silently restores the OpenMeld skill for the current local agent", async () => {
    await withTempHome(async (home) => {
      const targetDir = join(home, "codex-skills");
      await setConfiguredSkillsConfig({
        agents: {
          codex: { globalSkillsDir: targetDir },
        },
      });

      const first = await ensureDispatchControllerOpenMeldSkill({
        agentControllerRef: "builtin:codex",
      });
      const second = await ensureDispatchControllerOpenMeldSkill({
        agentControllerRef: "builtin:codex",
      });

      expect(first).toMatchObject({
        agentId: "codex",
        status: "repaired",
      });
      const installedSkill = await readFile(
        join(targetDir, "openmeld-cli", "SKILL.md"),
        "utf8"
      );
      expect(installedSkill).toContain("name: openmeld-cli");
      expect(installedSkill).toMatch(PREFERRED_SPACE_ACTION_TOOL_COPY);
      expect(installedSkill).toContain(
        '`"$OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH"`'
      );
      expect(second).toMatchObject({
        agentId: "codex",
        status: "not_needed",
      });
    });
  });

  it("does not overwrite a user-owned skill with the same id", async () => {
    await withTempHome(async (home) => {
      const targetDir = join(home, "claude-skills");
      const skillDir = join(targetDir, "openmeld-cli");
      const userSkill = "---\nname: openmeld-cli\n---\nUser-owned content.\n";
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), userSkill, "utf8");
      await setConfiguredSkillsConfig({
        agents: {
          "claude-code": { globalSkillsDir: targetDir },
        },
      });

      const result = await ensureDispatchControllerOpenMeldSkill({
        agentControllerRef: "builtin:claude-code",
      });

      expect(result).toMatchObject({
        agentId: "claude-code",
        status: "blocked",
      });
      expect(await readFile(join(skillDir, "SKILL.md"), "utf8")).toBe(
        userSkill
      );
    });
  });

  it("repairs the current OpenClaw dispatch even while new setup is suspended", async () => {
    await withTempHome(async (home) => {
      const targetDir = join(home, "openclaw-skills");
      await setConfiguredSkillsConfig({
        agents: {
          openclaw: { globalSkillsDir: targetDir },
        },
      });

      await expect(
        ensureDispatchControllerOpenMeldSkill({
          agentControllerRef: "builtin:openclaw",
        })
      ).resolves.toMatchObject({
        agentId: "openclaw",
        status: "repaired",
      });
      await expect(
        readFile(join(targetDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).resolves.toContain("name: openmeld-cli");
    });
  });

  it("does nothing for a controller outside the managed agent registry", async () => {
    await withTempHome(async () => {
      await expect(
        ensureDispatchControllerOpenMeldSkill({
          agentControllerRef: "custom:local-agent",
        })
      ).resolves.toEqual({
        agentId: null,
        status: "unsupported",
      });
    });
  });
});
