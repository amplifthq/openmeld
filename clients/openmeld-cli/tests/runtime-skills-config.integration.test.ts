import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setProfileDefaultView } from "../src/config/profile-view";
import {
  getConfiguredSkillsConfig,
  setConfiguredBaseUrl,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

const CUSTOM_TARGET_ID_REGEX = /^custom-/;

describe("runtime skills config", () => {
  it("preserves skills settings when saving base url and default view", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        agents: {
          codex: {
            globalSkillsDir: "/tmp/codex/skills",
          },
        },
        customTargets: [
          {
            name: "custom-agent",
            dir: "/tmp/custom-agent/skills",
          },
        ],
        installs: [
          {
            targetId: "custom-agent",
            targetDir: "/tmp/custom-agent/skills",
            mode: "symlink",
            status: "installed",
            skillIds: ["openmeld-cli"],
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      await setConfiguredBaseUrl("http://127.0.0.1:8080/");
      await setProfileDefaultView({
        openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
        view: "agent",
      });

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.agents?.codex?.globalSkillsDir).toBe("/tmp/codex/skills");
      expect(skills?.customTargets?.[0]?.dir).toBe("/tmp/custom-agent/skills");
      expect(skills?.installs?.[0]?.skillIds).toEqual(["openmeld-cli"]);
    });
  });

  it("trims install skillIds when reading runtime config", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        installs: [
          {
            targetId: "custom-agent",
            targetDir: "/tmp/custom-agent/skills",
            mode: "copy",
            status: "installed",
            skillIds: ["  openmeld-cli  ", " ", " custom-tool "],
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.installs?.[0]?.skillIds).toEqual([
        "openmeld-cli",
        "custom-tool",
      ]);
    });
  });

  it("backfills stable id for legacy customTargets without id", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            name: "custom-agent",
            dir: "/tmp/custom-agent/skills",
          },
        ],
      });

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.customTargets?.[0]?.id).toMatch(CUSTOM_TARGET_ID_REGEX);
    });
  });

  it("reuses legacy custom target id from installs and normalizes install dirs", async () => {
    await withTempHome(async (home) => {
      const configPath = join(home, ".openmeld", "config.json");
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            v: 1,
            skills: {
              customTargets: [
                {
                  name: "legacy-target",
                  dir: "/tmp/legacy-target/skills/",
                },
              ],
              installs: [
                {
                  targetId: "custom-legacy-id",
                  targetDir: "/tmp/legacy-target/skills///",
                  mode: "symlink",
                  status: "installed",
                  skillIds: ["openmeld-cli"],
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: "2026-02-25T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.customTargets?.[0]?.id).toBe("custom-legacy-id");
      expect(skills?.customTargets?.[0]?.dir).toBe("/tmp/legacy-target/skills");
      expect(skills?.installs?.[0]?.targetDir).toBe(
        "/tmp/legacy-target/skills///"
      );
    });
  });

  it("keeps explicit custom target id even when installs has legacy custom id", async () => {
    await withTempHome(async (home) => {
      const configPath = join(home, ".openmeld", "config.json");
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            v: 1,
            skills: {
              customTargets: [
                {
                  id: "custom-explicit-id",
                  name: "explicit-target",
                  dir: "/tmp/explicit-target/skills/",
                },
              ],
              installs: [
                {
                  targetId: "custom-legacy-id",
                  targetDir: "/tmp/explicit-target/skills",
                  mode: "symlink",
                  status: "installed",
                  skillIds: ["openmeld-cli"],
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: "2026-02-25T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.customTargets?.[0]?.id).toBe("custom-explicit-id");
    });
  });

  it("does not reuse installs target id when id is non-custom or dir does not match", async () => {
    await withTempHome(async (home) => {
      const configPath = join(home, ".openmeld", "config.json");
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            v: 1,
            skills: {
              customTargets: [
                {
                  name: "non-custom-install-id",
                  dir: "/tmp/non-custom/skills/",
                },
                {
                  name: "different-dir",
                  dir: "/tmp/dir-a/skills/",
                },
              ],
              installs: [
                {
                  targetId: "legacy-non-custom-id",
                  targetDir: "/tmp/non-custom/skills",
                  mode: "symlink",
                  status: "installed",
                  skillIds: ["openmeld-cli"],
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
                {
                  targetId: "custom-other-dir-id",
                  targetDir: "/tmp/dir-b/skills",
                  mode: "symlink",
                  status: "installed",
                  skillIds: ["openmeld-cli"],
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: "2026-02-25T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const skills = await getConfiguredSkillsConfig();
      expect(skills?.customTargets).toHaveLength(2);
      const nonCustomInstallTarget = skills?.customTargets?.find(
        (target) => target.name === "non-custom-install-id"
      );
      const differentDirTarget = skills?.customTargets?.find(
        (target) => target.name === "different-dir"
      );
      expect(nonCustomInstallTarget?.id).toMatch(CUSTOM_TARGET_ID_REGEX);
      expect(nonCustomInstallTarget?.id).not.toBe("legacy-non-custom-id");
      expect(differentDirTarget?.id).toMatch(CUSTOM_TARGET_ID_REGEX);
      expect(differentDirTarget?.id).not.toBe("custom-other-dir-id");
    });
  });
});
