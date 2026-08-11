import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSkillInstallStateForTarget } from "../src/skills/state";
import type { LocalSkill } from "../src/skills/store";
import { withTempHome } from "./helpers/fs";

const SKILL_ID = "openmeld-cli";
const CONTENT_HASH = "a".repeat(64);
const VERSION = "0.3.25";

async function writeSkillStore(input: {
  storeDir: string;
  contentHash: string;
  version: string;
}): Promise<void> {
  const skillDir = join(input.storeDir, SKILL_ID);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "# OpenMeld CLI skill\n");
  await writeFile(
    join(skillDir, ".openmeld-skill.json"),
    `${JSON.stringify({
      managedBy: "openmeld",
      skillId: SKILL_ID,
      mode: "source",
      contentHash: input.contentHash,
      version: input.version,
      updatedAt: "2026-08-08T00:00:00.000Z",
    })}\n`
  );
}

function buildLocalSkill(storeDir: string): LocalSkill {
  return {
    id: SKILL_ID,
    name: "OpenMeld CLI",
    absolutePath: join(storeDir, SKILL_ID),
    relativePath: SKILL_ID,
    contentHash: CONTENT_HASH,
    version: VERSION,
  };
}

describe("skill install state for symlinked targets", () => {
  it("keeps a link that resolves to this store up to date", async () => {
    await withTempHome(async (home) => {
      const storeDir = join(home, ".openmeld", "skills");
      await writeSkillStore({
        storeDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const targetDir = join(home, ".claude", "skills");
      await mkdir(targetDir, { recursive: true });
      await symlink(join(storeDir, SKILL_ID), join(targetDir, SKILL_ID));

      const state = await resolveSkillInstallStateForTarget({
        skill: buildLocalSkill(storeDir),
        target: { id: "claude-code", dir: targetDir, type: "agent" },
      });

      expect(state.state).toBe("up_to_date");
    });
  });

  it("treats a link into a foreign store as outdated even when hash and version match", async () => {
    await withTempHome(async (home) => {
      const storeDir = join(home, ".openmeld", "skills");
      await writeSkillStore({
        storeDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      // A lane-local store with an identical marker: without the link-target
      // check this hijacked link is invisible and dangles once the lane is
      // deleted.
      const foreignStoreDir = join(home, "worktree", "openmeld-home", "skills");
      await writeSkillStore({
        storeDir: foreignStoreDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const targetDir = join(home, ".claude", "skills");
      await mkdir(targetDir, { recursive: true });
      await symlink(join(foreignStoreDir, SKILL_ID), join(targetDir, SKILL_ID));

      const state = await resolveSkillInstallStateForTarget({
        skill: buildLocalSkill(storeDir),
        target: { id: "claude-code", dir: targetDir, type: "agent" },
      });

      expect(state.state).toBe("outdated");
      expect(state.reason).toContain("different OpenMeld skills store");
    });
  });

  it("treats a dangling managed link as outdated so reinstall can repair it", async () => {
    await withTempHome(async (home) => {
      const storeDir = join(home, ".openmeld", "skills");
      await writeSkillStore({
        storeDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const foreignStoreDir = join(home, "worktree", "openmeld-home", "skills");
      await writeSkillStore({
        storeDir: foreignStoreDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const targetDir = join(home, ".claude", "skills");
      await mkdir(targetDir, { recursive: true });
      await symlink(join(foreignStoreDir, SKILL_ID), join(targetDir, SKILL_ID));
      await rm(join(home, "worktree"), { recursive: true, force: true });

      const state = await resolveSkillInstallStateForTarget({
        skill: buildLocalSkill(storeDir),
        target: { id: "claude-code", dir: targetDir, type: "agent" },
      });

      expect(state.state).toBe("outdated");
    });
  });
});

describe("skill install state for copied targets", () => {
  it("keeps a copy with matching hash and version up to date", async () => {
    await withTempHome(async (home) => {
      const storeDir = join(home, ".openmeld", "skills");
      await writeSkillStore({
        storeDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const targetDir = join(home, ".claude", "skills");
      const targetSkillDir = join(targetDir, SKILL_ID);
      await mkdir(targetSkillDir, { recursive: true });
      await writeFile(
        join(targetSkillDir, "SKILL.md"),
        "# OpenMeld CLI skill\n"
      );
      await writeFile(
        join(targetSkillDir, ".openmeld-skill.json"),
        `${JSON.stringify({
          managedBy: "openmeld",
          skillId: SKILL_ID,
          mode: "copy",
          contentHash: CONTENT_HASH,
          version: VERSION,
          updatedAt: "2026-08-08T00:00:00.000Z",
        })}\n`
      );

      const state = await resolveSkillInstallStateForTarget({
        skill: buildLocalSkill(storeDir),
        target: { id: "claude-code", dir: targetDir, type: "agent" },
      });

      expect(state.state).toBe("up_to_date");
    });
  });

  it("treats a copy with matching hash but stale version as outdated", async () => {
    await withTempHome(async (home) => {
      const storeDir = join(home, ".openmeld", "skills");
      await writeSkillStore({
        storeDir,
        contentHash: CONTENT_HASH,
        version: VERSION,
      });
      const targetDir = join(home, ".claude", "skills");
      const targetSkillDir = join(targetDir, SKILL_ID);
      await mkdir(targetSkillDir, { recursive: true });
      await writeFile(
        join(targetSkillDir, "SKILL.md"),
        "# OpenMeld CLI skill\n"
      );
      await writeFile(
        join(targetSkillDir, ".openmeld-skill.json"),
        `${JSON.stringify({
          managedBy: "openmeld",
          skillId: SKILL_ID,
          mode: "copy",
          contentHash: CONTENT_HASH,
          version: "0.3.24",
          updatedAt: "2026-08-08T00:00:00.000Z",
        })}\n`
      );

      const state = await resolveSkillInstallStateForTarget({
        skill: buildLocalSkill(storeDir),
        target: { id: "claude-code", dir: targetDir, type: "agent" },
      });

      expect(state.state).toBe("outdated");
    });
  });
});
