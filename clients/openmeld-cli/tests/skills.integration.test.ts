import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectInstalledSkillsAgentsMock } = vi.hoisted(() => ({
  detectInstalledSkillsAgentsMock: vi.fn(),
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
  runSkillsEnsure,
  runSkillsInstall,
  runSkillsList,
  runSkillsUninstall,
  runSkillsUpdate,
} from "../src/commands/skills";
import {
  getConfiguredSkillsConfig,
  type RuntimeSkillsConfig,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { computeDirectoryContentHash } from "../src/skills/content-hash";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const CUSTOM_TARGET_ID_REGEX = /^custom-/;
const REQUIRED_SKILL_DOC_RELATIVE_PATHS = [
  "SKILL.md",
  "playbooks/agent-onboarding.md",
  "playbooks/space-ops.md",
  "playbooks/space-reads.md",
  "references/commands.md",
  "references/runtime-resolution.md",
] as const;

describe("openmeld skills", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledSkillsAgentsMock.mockReset();
  });

  it("requires explicit install params in non-interactive mode", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        try {
          await runSkillsInstall({
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(stdout).toContain('"code":"skills.install.agent_overview"');
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills install requires explicit target selection"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills install --all"
      );
    });
  });

  it("requires explicit ensure params in non-interactive mode", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        try {
          await runSkillsEnsure({
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(stdout).toContain('"code":"skills.ensure.agent_overview"');
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills ensure requires explicit target selection"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills ensure --all"
      );
    });
  });

  it("keeps ensure guidance when explicit ensure targets cannot resolve", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        try {
          await runSkillsEnsure({
            all: true,
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(stdout).toContain('"code":"skills.ensure.agent_overview"');
      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain("openmeld skills ensure --dir <absolute-path>");
      expect(message).toContain("openmeld skills ensure --guide");
      expect(message).not.toContain("openmeld skills install");
    });
  });

  it("requires explicit uninstall params in non-interactive mode", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        try {
          await runSkillsUninstall({
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(stdout).toContain('"code":"skills.uninstall.agent_overview"');
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills uninstall requires explicit target selection"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills uninstall --all"
      );
    });
  });

  it("rejects conflicting install selectors instead of silently picking one", async () => {
    await withTempHome(async () => {
      await expect(
        runSkillsInstall({
          all: true,
          agent: ["codex"],
          view: "agent",
        })
      ).rejects.toThrow(
        "use exactly one of --all, --agent <id...>, --dir <absolute-path>, or --guide"
      );
    });
  });

  it("rejects conflicting uninstall selectors instead of silently picking one", async () => {
    await withTempHome(async () => {
      await expect(
        runSkillsUninstall({
          all: true,
          agent: ["codex"],
          view: "agent",
        })
      ).rejects.toThrow(
        "use exactly one of --all, --agent <id...>, or --dir <absolute-path>"
      );
    });
  });

  it("throws dual-view guide for menu command in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        try {
          await runSkills({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("skills.menu.agent_overview");
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills menu is interactive in human view only."
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "[FOR HUMAN OPERATORS]"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "[FOR AGENTS]"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills install --all"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills check"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld skills update"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "OpenMeld skills store:"
      );
    });
  });

  it("emits overview before skills list payload in agent view", async () => {
    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsList({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("skills.list.agent_overview");
      expect(envelopes[1]?.code).toBe("skills.list");
    });
  });

  it("ensures bundled skills are available and listable", async () => {
    await withTempHome(async (home) => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsList({
          view: "human",
        });
      });

      expect(stdout).toContain("OpenMeld Skills Store");
      expect(stdout).toContain("Local OpenMeld Skills (1)");
      expect(stdout).toContain("openmeld-cli");

      await assertLayeredSkillDocsExist(
        join(home, ".openmeld", "skills", "openmeld-cli")
      );
    });
  });

  it("installs OpenMeld skills into a custom target directory", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      await assertLayeredSkillDocsExist(join(customDir, "openmeld-cli"));
      const markerRaw = await readFile(
        join(customDir, "openmeld-cli", ".openmeld-skill.json"),
        "utf8"
      );
      const marker = JSON.parse(markerRaw) as { managedBy?: string };
      expect(marker.managedBy).toBe("openmeld");

      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        skillsConfig?.customTargets?.some((item) => item.dir === customDir)
      ).toBe(true);
    });
  });

  it("ensures OpenMeld skills into a custom target directory", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsEnsure({
        dir: customDir,
        view: "agent",
      });

      await assertLayeredSkillDocsExist(join(customDir, "openmeld-cli"));
      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        skillsConfig?.customTargets?.some((item) => item.dir === customDir)
      ).toBe(true);
    });
  });

  it("keeps ensure scoped to the explicit target selection", async () => {
    await withTempHome(async (home) => {
      const trackedDir = join(home, "tracked-agent", "skills");
      const selectedDir = join(home, "selected-agent", "skills");
      await mkdir(trackedDir, { recursive: true });
      await mkdir(selectedDir, { recursive: true });

      await runSkillsInstall({
        dir: trackedDir,
        view: "human",
      });
      // A symlink shares its source. Detach this target to exercise selection.
      const detached = join(home, "detached-skill");
      await cp(join(trackedDir, "openmeld-cli"), detached, {
        recursive: true,
        dereference: true,
      });
      await rm(join(trackedDir, "openmeld-cli"), {
        recursive: true,
        force: true,
      });
      await cp(detached, join(trackedDir, "openmeld-cli"), { recursive: true });
      await writeFile(join(trackedDir, "openmeld-cli", "SKILL.md"), "STALE\n");

      await runSkillsEnsure({
        dir: selectedDir,
        view: "agent",
      });

      await expect(
        readFile(join(trackedDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).resolves.toBe("STALE\n");
      await assertLayeredSkillDocsExist(join(selectedDir, "openmeld-cli"));
    });
  });

  it("accepts symlink directories for --dir install target", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const linkedDir = join(home, "custom-agent-link");
      await mkdir(customDir, { recursive: true });
      await symlink(customDir, linkedDir);

      await runSkillsInstall({
        dir: linkedDir,
        view: "human",
      });

      await expect(
        readFile(join(customDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).resolves.toContain("name:");

      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        skillsConfig?.customTargets?.some((item) => item.dir === linkedDir)
      ).toBe(true);
    });
  });

  it("assigns a stable custom target id for repeated installs", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      const firstConfig = await getConfiguredSkillsConfig();
      const firstTarget = firstConfig?.customTargets?.find(
        (target) => target.dir === customDir
      );

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      const secondConfig = await getConfiguredSkillsConfig();
      const secondTarget = secondConfig?.customTargets?.find(
        (target) => target.dir === customDir
      );

      expect(firstTarget?.id).toMatch(CUSTOM_TARGET_ID_REGEX);
      expect(secondTarget?.id).toBe(firstTarget?.id);
    });
  });

  it("prefers explicit custom target id over install fallback id", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-explicit-id",
            name: "custom-agent",
            dir: customDir,
          },
        ],
        installs: [
          {
            targetId: "custom-legacy-id",
            targetDir: customDir,
            mode: "symlink",
            status: "installed",
            skillIds: ["openmeld-cli"],
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "agent" });
      });
      const result = parseAgentResultEnvelope(stdout, "skills.check.summary");
      const targets = (
        result.payload as
          | { targets?: Array<{ id?: string; dir?: string }> }
          | undefined
      )?.targets;
      const customTarget = targets?.find((target) => target.dir === customDir);

      expect(customTarget?.id).toBe("custom-explicit-id");
    });
  });

  it("deduplicates repeated explicit --agent targets", async () => {
    await withTempHome(async (home) => {
      const isolatedPochiSkillsDir = join(home, "isolated-pochi", "skills");
      await mkdir(isolatedPochiSkillsDir, { recursive: true });
      const nextSkillsConfig: RuntimeSkillsConfig = {
        storeDir: join(home, ".openmeld", "skills"),
        agents: {
          pochi: {
            globalSkillsDir: isolatedPochiSkillsDir,
          },
        },
      };
      await setConfiguredSkillsConfig(nextSkillsConfig);

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsInstall({
          agent: ["pochi", "pochi"],
          view: "human",
        });
      });

      expect(stdout).toContain("Installed: 1");
      expect(stdout).toContain("Installed Targets (1)");
      expect(stdout).toContain("pochi: openmeld-cli");
      const skillsConfig = await getConfiguredSkillsConfig();
      const dedupedRecord = skillsConfig?.installs?.find(
        (record) => record.targetId === "pochi"
      );
      expect(dedupedRecord?.skillIds).toEqual(["openmeld-cli"]);
    });
  });

  it("renders human install summary inside cards", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsInstall({
          dir: customDir,
          view: "human",
        });
      });

      expect(stdout).toContain("OpenMeld Skills Installation Summary");
      expect(stdout).toContain("Store:");
      expect(stdout).toContain("Installed: 1");
      expect(stdout).toContain("Installed Targets (1)");
      expect(stdout).toContain("└");
    });
  });

  it("does not overwrite non-OpenMeld skills with the same name", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const existingSkillDir = join(customDir, "openmeld-cli");
      await mkdir(existingSkillDir, { recursive: true });

      const existingContent = "CUSTOM SKILL\n";
      await writeFile(join(existingSkillDir, "SKILL.md"), existingContent);

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsInstall({
          dir: customDir,
          view: "human",
        });
      });

      await expect(
        readFile(join(existingSkillDir, "SKILL.md"), "utf8")
      ).resolves.toBe(existingContent);
      expect(stdout).toContain("skipped");
      await expect(
        readFile(join(existingSkillDir, ".openmeld-skill.json"), "utf8")
      ).rejects.toThrow();
    });
  });

  it("skips reinstall when selected target is already up to date", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsInstall({
          dir: customDir,
          view: "human",
        });
      });

      expect(stdout).toContain("Installed: 0");
      expect(stdout).toContain("Skipped: 1");
      expect(stdout).toContain("already up-to-date");
    });
  });

  it("keeps quiet agent ensure silent when selected target is already up to date", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsEnsure({
        dir: customDir,
        suppressAgentOverview: true,
        view: "agent",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsEnsure({
          dir: customDir,
          quiet: true,
          suppressAgentOverview: true,
          view: "agent",
        });
      });

      expect(stdout).not.toContain("skills.install.summary");
      expect(stdout).not.toContain("already up-to-date");
    });
  });

  it("reports up-to-date from skills check after install", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain(
        "OpenMeld skills are up to date on all detected agents and saved installs."
      );
      expect(stdout).toContain("Up-to-date Installs (1)");
    });
  });

  it("shows a no-target status card from skills check when nothing is tracked", async () => {
    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("OpenMeld Skills Status");
      expect(stdout).toContain(
        "No agents or saved OpenMeld skills installs were found."
      );
      expect(stdout).toContain("Next Steps");
      expect(stdout).toContain("known agents:");
      expect(stdout).toContain("openmeld skills install --all");
      expect(stdout).toContain("custom path:");
      expect(stdout).toContain("openmeld skills install --dir <absolute-path>");
    });
  });

  it("reports outdated from skills check when OpenMeld marker hash is stale", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const skillDir = join(customDir, "openmeld-cli");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "name: OpenMeld CLI\n");
      await writeFile(
        join(skillDir, ".openmeld-skill.json"),
        `${JSON.stringify(
          {
            managedBy: "openmeld",
            skillId: "openmeld-cli",
            mode: "copy",
            contentHash: await computeDirectoryContentHash({
              rootDir: skillDir,
            }),
            version: "0.0.0",
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`
      );

      await setConfiguredSkillsConfig({
        customTargets: [{ name: "custom-agent", dir: customDir }],
        installs: [
          {
            targetId: "custom",
            targetDir: customDir,
            mode: "copy",
            status: "installed",
            skillIds: ["openmeld-cli"],
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("outdated: 1");
      expect(stdout).toContain("Run `openmeld skills update`");
    });
  });

  it("treats an old OpenMeld skill symlink as outdated instead of a conflict", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const legacySkillDir = join(
        home,
        "old-openmeld-home",
        "skills",
        "openmeld-cli"
      );
      await mkdir(customDir, { recursive: true });
      await mkdir(legacySkillDir, { recursive: true });
      await writeFile(
        join(legacySkillDir, "SKILL.md"),
        "name: OpenMeld CLI\nold\n"
      );
      await symlink(legacySkillDir, join(customDir, "openmeld-cli"), "dir");
      await writeFile(
        join(legacySkillDir, ".openmeld-skill.json"),
        JSON.stringify({
          managedBy: "openmeld",
          skillId: "openmeld-cli",
          mode: "source",
          version: "0.0.0",
          updatedAt: new Date().toISOString(),
        })
      );

      await setConfiguredSkillsConfig({
        customTargets: [{ name: "custom-agent", dir: customDir }],
        installs: [],
      });

      const { plainStdout: checkStdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(checkStdout).toContain("outdated: 1");
      expect(checkStdout).toContain("needs review: 0");
      expect(checkStdout).toContain("Updates Available (1)");
      expect(checkStdout).not.toContain("Needs Review (1)");
      expect(checkStdout).toContain("Run `openmeld skills update`");

      const { plainStdout: updateStdout } = await withCapturedStdio(
        async () => {
          await runSkillsUpdate({ view: "human" });
        }
      );

      expect(updateStdout).toContain("Installed: 1");
      await expect(
        readFile(
          join(customDir, "openmeld-cli", ".openmeld-skill.json"),
          "utf8"
        )
      ).resolves.toContain('"managedBy": "openmeld"');
    });
  });

  it("reports missing from skills check when OpenMeld skill was manually removed", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      await rm(join(customDir, "openmeld-cli"), {
        recursive: true,
        force: true,
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("missing: 1");
      expect(stdout).toContain("openmeld skills install --all");
    });
  });

  it("reports legacy unmanaged OpenMeld skill copies from skills check", async () => {
    await withTempHome(async (home) => {
      const skillRoot = join(home, ".agents", "skills");
      const legacySkillDir = join(skillRoot, "openmeld-cli-guide");
      await mkdir(legacySkillDir, { recursive: true });
      await writeFile(
        join(legacySkillDir, "SKILL.md"),
        "name: OpenMeld CLI Guide\nOfficial public OpenMeld CLI guide.\n"
      );

      const { plainStdout: humanStdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(humanStdout).toContain("Legacy OpenMeld Skill Copies (1)");
      expect(humanStdout).toContain(legacySkillDir);
      expect(humanStdout).toContain(
        "Install the current OpenMeld skill into this skill root"
      );

      process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";
      const currentInstallCommand = `openmeld-dev skills ensure --dir '${skillRoot}' --view agent`;
      const verificationCommand = "openmeld-dev skills check --view agent";
      const { plainStdout: agentStdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "agent" });
      });
      const attention = parseAgentEnvelopes(agentStdout).find(
        (line) => line.code === "skills.check.legacy_attention_required"
      );
      const result = parseAgentResultEnvelope(
        agentStdout,
        "skills.check.summary"
      );
      const legacyFindings = (
        result.payload as
          | {
              legacyFindings?: Array<{
                cleanupCommands?: string[];
                currentInstallCommand?: string;
                skillId?: string;
                skillDir?: string;
                reasonCode?: string;
                verificationCommand?: string;
              }>;
              legacyReview?: {
                installCommands?: string[];
                nextActions?: string[];
                priority?: string;
                paths?: string[];
                nextStep?: string;
                verificationCommand?: string;
              } | null;
            }
          | undefined
      )?.legacyFindings;
      const legacyReview = (
        result.payload as
          | {
              legacyReview?: {
                installCommands?: string[];
                nextActions?: string[];
                priority?: string;
                paths?: string[];
                nextStep?: string;
                verificationCommand?: string;
              } | null;
            }
          | undefined
      )?.legacyReview;

      expect(legacyFindings).toEqual([
        expect.objectContaining({
          skillId: "openmeld-cli-guide",
          skillDir: legacySkillDir,
          reasonCode: "legacy_openmeld_skill_id",
          currentInstallCommand,
          cleanupCommands: expect.arrayContaining([
            `rm -rf '${legacySkillDir}'`,
            `mv '${legacySkillDir}' '${legacySkillDir}.legacy'`,
          ]),
          verificationCommand,
        }),
      ]);
      expect(attention).toMatchObject({
        type: "line",
        code: "skills.check.legacy_attention_required",
        text: expect.stringContaining(legacySkillDir),
      });
      expect(attention?.text).toContain(
        "can make agents read old OpenMeld instructions"
      );
      expect(attention?.text).toContain(
        "Do not read or follow those skill instructions."
      );
      expect(attention?.text).toContain(
        `Next: run \`${currentInstallCommand}\`.`
      );
      expect(attention?.text).toContain(
        "OpenMeld will not do this automatically"
      );
      expect(attention?.text).toContain(
        `Then rerun \`${verificationCommand}\`.`
      );
      expect(legacyReview).toMatchObject({
        priority: "high",
        paths: [legacySkillDir],
        nextStep:
          "Do not read or follow the listed legacy OpenMeld skill instructions. Run each install command, then remove or rename each listed legacy directory, then rerun the OpenMeld skills check.",
        installCommands: [currentInstallCommand],
        verificationCommand,
      });
      expect(legacyReview?.nextActions).toEqual(
        expect.arrayContaining([
          "Do not read or follow instructions from the listed legacy OpenMeld skill directories.",
          `Run ${currentInstallCommand}.`,
          `Rerun ${verificationCommand}.`,
        ])
      );
    });
  });

  it("reports legacy unmanaged OpenMeld skill copies from skills ensure", async () => {
    await withTempHome(async (home) => {
      detectInstalledSkillsAgentsMock.mockResolvedValue(["codex"]);
      const skillRoot = join(home, ".agents", "skills");
      const legacySkillDir = join(skillRoot, "openmeld-cli-guide");
      await mkdir(legacySkillDir, { recursive: true });
      await writeFile(
        join(legacySkillDir, "SKILL.md"),
        "name: OpenMeld CLI Guide\nOfficial public OpenMeld CLI guide.\n"
      );

      process.env.OPENMELD_USER_FACING_CLI_COMMAND = "npx -y openmeld@latest";
      const currentInstallCommand = `npx -y openmeld@latest skills ensure --dir '${skillRoot}' --view agent`;
      const verificationCommand =
        "npx -y openmeld@latest skills check --view agent";
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsEnsure({
          all: true,
          view: "agent",
        });
      });
      const attention = parseAgentEnvelopes(stdout).find(
        (line) => line.code === "skills.install.legacy_attention_required"
      );
      const result = parseAgentResultEnvelope(stdout, "skills.install.summary");
      const legacyFindings = (
        result.payload as
          | {
              legacyFindings?: Array<{
                cleanupCommands?: string[];
                currentInstallCommand?: string;
                skillId?: string;
                skillDir?: string;
                reasonCode?: string;
                verificationCommand?: string;
              }>;
              legacyReview?: {
                installCommands?: string[];
                nextActions?: string[];
                priority?: string;
                paths?: string[];
                verificationCommand?: string;
              } | null;
            }
          | undefined
      )?.legacyFindings;
      const legacyReview = (
        result.payload as
          | {
              legacyReview?: {
                installCommands?: string[];
                nextActions?: string[];
                priority?: string;
                paths?: string[];
                verificationCommand?: string;
              } | null;
            }
          | undefined
      )?.legacyReview;

      expect(legacyFindings).toEqual([
        expect.objectContaining({
          skillId: "openmeld-cli-guide",
          skillDir: legacySkillDir,
          reasonCode: "legacy_openmeld_skill_id",
          currentInstallCommand,
          cleanupCommands: expect.arrayContaining([
            `rm -rf '${legacySkillDir}'`,
            `mv '${legacySkillDir}' '${legacySkillDir}.legacy'`,
          ]),
          verificationCommand,
        }),
      ]);
      expect(attention).toMatchObject({
        type: "line",
        code: "skills.install.legacy_attention_required",
        text: expect.stringContaining(legacySkillDir),
      });
      expect(attention?.text).toContain(
        "can make agents read old OpenMeld instructions"
      );
      expect(attention?.text).toContain(
        "Do not read or follow those skill instructions."
      );
      expect(attention?.text).toContain(
        `Next: run \`${currentInstallCommand}\`.`
      );
      expect(attention?.text).toContain(
        `Then rerun \`${verificationCommand}\`.`
      );
      expect(legacyReview).toMatchObject({
        priority: "high",
        paths: [legacySkillDir],
        installCommands: [currentInstallCommand],
        verificationCommand,
      });
      expect(legacyReview?.nextActions).toEqual(
        expect.arrayContaining([
          "Do not read or follow instructions from the listed legacy OpenMeld skill directories.",
          `Run ${currentInstallCommand}.`,
          `Rerun ${verificationCommand}.`,
        ])
      );
    });
  });

  it("prints human-view cards with concise action groups", async () => {
    await withTempHome(async (home) => {
      const upToDateDir = join(home, "agent-up-to-date", "skills");
      const outdatedDir = join(home, "agent-outdated", "skills");
      const missingDir = join(home, "agent-missing", "skills");
      const conflictDir = join(home, "agent-conflict", "skills");
      await mkdir(upToDateDir, { recursive: true });
      await mkdir(join(outdatedDir, "openmeld-cli"), { recursive: true });
      await mkdir(missingDir, { recursive: true });
      await mkdir(join(conflictDir, "openmeld-cli"), { recursive: true });
      await writeFile(
        join(outdatedDir, "openmeld-cli", "SKILL.md"),
        "name: OpenMeld CLI\n"
      );
      await writeFile(
        join(outdatedDir, "openmeld-cli", ".openmeld-skill.json"),
        `${JSON.stringify(
          {
            managedBy: "openmeld",
            skillId: "openmeld-cli",
            mode: "copy",
            contentHash: await computeDirectoryContentHash({
              rootDir: join(outdatedDir, "openmeld-cli"),
            }),
            version: "0.0.0",
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`
      );
      await writeFile(
        join(conflictDir, "openmeld-cli", "SKILL.md"),
        "name: external-skill\n"
      );

      await runSkillsInstall({
        dir: upToDateDir,
        view: "human",
      });

      const installedConfig = await getConfiguredSkillsConfig();
      await setConfiguredSkillsConfig({
        customTargets: [
          ...(installedConfig?.customTargets ?? []),
          { name: "agent-outdated", dir: outdatedDir },
          { name: "agent-missing", dir: missingDir },
          { name: "agent-conflict", dir: conflictDir },
        ],
        installs: installedConfig?.installs ?? [],
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("Updates Available (1)");
      expect(stdout).toContain("Missing Skills (1)");
      expect(stdout).toContain("Needs Review (1)");
      expect(stdout).not.toContain("Installed Targets");
      expect(stdout).not.toContain("Up-to-date Installs");
      expect(stdout).not.toContain("latest: yes");
      expect(stdout).not.toContain("installed: yes");
      expect(stdout).not.toContain("[outdated]");
      expect(stdout).not.toContain(`dir: ${upToDateDir}`);
      expect(stdout).toContain(`dir: ${outdatedDir}`);
      expect(stdout).toContain(`dir: ${missingDir}`);
      expect(stdout).toContain(`dir: ${conflictDir}`);
      expect(stdout).toContain("outdated skills: openmeld-cli");
      expect(stdout).toContain("missing skills: openmeld-cli");
      expect(stdout).toContain("non-OpenMeld skills: openmeld-cli");
    });
  });

  it("includes aggregated target states in agent-view payload", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      await rm(join(customDir, "openmeld-cli"), {
        recursive: true,
        force: true,
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "agent" });
      });
      const result = parseAgentResultEnvelope(stdout, "skills.check.summary");
      const payload = result.payload as
        | {
            targetStates?: Array<{
              targetId?: string;
              targetDir?: string;
              targetType?: string;
              targetLabel?: string;
              targetName?: string;
              targetNameKind?: string;
              installed?: boolean;
              latest?: boolean;
              missingSkillIds?: string[];
              outdatedSkillIds?: string[];
              conflictSkillIds?: string[];
            }>;
          }
        | undefined;
      const targetState = payload?.targetStates?.find(
        (item) => item.targetDir === customDir
      );

      expect(Array.isArray(payload?.targetStates)).toBe(true);
      expect(targetState?.targetType).toBe("custom");
      expect(targetState?.targetLabel).toContain("custom");
      expect(targetState?.targetName).toBeTruthy();
      expect(targetState?.targetNameKind).toBe("custom");
      expect(targetState?.installed).toBe(false);
      expect(targetState?.latest).toBe(false);
      expect(targetState?.missingSkillIds).toEqual(["openmeld-cli"]);
      expect(targetState?.outdatedSkillIds).toEqual([]);
      expect(targetState?.conflictSkillIds).toEqual([]);
    });
  });

  it("returns up-to-date without rewrite when running skills update with no changes", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUpdate({ view: "human" });
      });

      expect(stdout).toContain("All tracked OpenMeld skills are up to date.");
    });
  });

  it("does not rewrite local OpenMeld source marker when content is unchanged", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const sourceMarkerPath = join(
        home,
        ".openmeld",
        "skills",
        "openmeld-cli",
        ".openmeld-skill.json"
      );
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      const firstMarkerRaw = await readFile(sourceMarkerPath, "utf8");
      const firstMarker = JSON.parse(firstMarkerRaw) as { updatedAt?: string };

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      const secondMarkerRaw = await readFile(sourceMarkerPath, "utf8");
      const secondMarker = JSON.parse(secondMarkerRaw) as {
        updatedAt?: string;
      };

      expect(firstMarker.updatedAt).toBeTypeOf("string");
      expect(secondMarker.updatedAt).toBe(firstMarker.updatedAt);
    });
  });

  it("skips stale tracked targets when target directory is missing", async () => {
    await withTempHome(async (home) => {
      const staleTargetDir = join(home, "deleted-agent", "skills");
      await setConfiguredSkillsConfig({
        installs: [
          {
            targetId: "custom",
            targetDir: staleTargetDir,
            mode: "symlink",
            status: "installed",
            skillIds: ["openmeld-cli"],
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "agent" });
      });
      const result = parseAgentResultEnvelope(stdout, "skills.check.summary");
      const targets = (
        result.payload as { targets?: Array<{ dir?: string }> } | undefined
      )?.targets;

      expect(targets?.some((target) => target.dir === staleTargetDir)).toBe(
        false
      );
    });
  });

  it("checks custom target from config when OpenMeld skill exists even without installs records", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      await setConfiguredSkillsConfig({
        customTargets: [{ name: "custom-agent", dir: customDir }],
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("targets: 1");
      expect(stdout).toContain(
        "OpenMeld skills are up to date on all detected agents and saved installs."
      );
    });
  });

  it("backfills installs records from skills check when target is OpenMeld-managed", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });
      await setConfiguredSkillsConfig({
        customTargets: [{ name: "custom-agent", dir: customDir }],
      });

      await runSkillsCheck({ view: "human" });

      const skillsConfig = await getConfiguredSkillsConfig();
      const installRecord = (skillsConfig?.installs ?? []).find(
        (record) => record.targetDir === customDir
      );
      expect(installRecord).toBeDefined();
      expect(installRecord?.status).toBe("installed");
      expect(installRecord?.skillIds).toEqual(["openmeld-cli"]);
    });
  });

  it("uninstalls OpenMeld skill from custom target and prunes skills config state", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUninstall({
          dir: customDir,
          view: "human",
        });
      });

      expect(stdout).toContain("removed: 1");
      await expect(
        readFile(join(customDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).rejects.toThrow();

      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        (skillsConfig?.installs ?? []).some(
          (item) => item.targetDir === customDir
        )
      ).toBe(false);
      expect(
        (skillsConfig?.customTargets ?? []).some(
          (item) => item.dir === customDir
        )
      ).toBe(false);
    });
  });

  it("retains tracked target state when uninstall is blocked by non-OpenMeld skill", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const skillDir = join(customDir, "openmeld-cli");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      await rm(skillDir, { recursive: true, force: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "CUSTOM SKILL\n", "utf8");

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUninstall({
          dir: customDir,
          view: "human",
        });
      });

      expect(stdout).toContain("blocked: 1");
      expect(stdout).toContain("existing non-OpenMeld skill detected; blocked");

      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        (skillsConfig?.installs ?? []).some(
          (item) => item.targetDir === customDir
        )
      ).toBe(true);
      expect(
        (skillsConfig?.customTargets ?? []).some(
          (item) => item.dir === customDir
        )
      ).toBe(true);
    });
  });

  it("emits blocked uninstall summary payload in agent view", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      const skillDir = join(customDir, "openmeld-cli");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      await rm(skillDir, { recursive: true, force: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "CUSTOM SKILL\n", "utf8");

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUninstall({
          dir: customDir,
          view: "agent",
        });
      });

      const result = parseAgentResultEnvelope(
        stdout,
        "skills.uninstall.summary"
      );
      expect(result.payload).toBeDefined();
      const payload = result.payload as {
        summary: {
          blocked: number;
        };
        results: Array<{
          status: string;
        }>;
      };
      expect(payload.summary.blocked).toBe(1);
      expect(payload.results.some((entry) => entry.status === "blocked")).toBe(
        true
      );
    });
  });

  it("supports uninstall dry-run without removing files", async () => {
    await withTempHome(async (home) => {
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUninstall({
          dir: customDir,
          dryRun: true,
          view: "human",
        });
      });

      expect(stdout).toContain("OpenMeld Skills Uninstall Dry Run");
      expect(stdout).toContain("Target Preview (1)");
      expect(stdout).toContain(customDir);
      expect(stdout).toContain("dry-run complete: no files were removed.");
      await expect(
        readFile(join(customDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).resolves.toContain("name:");
    });
  });

  it("requires allow-external-targets for --all uninstall outside OPENMELD_HOME", async () => {
    await withTempHome(async (home) => {
      const externalSkillsDir = join(home, "external-agent", "skills");
      await mkdir(externalSkillsDir, { recursive: true });
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);

      await setConfiguredSkillsConfig({
        agents: {
          pochi: {
            globalSkillsDir: externalSkillsDir,
          },
        },
      });

      await runSkillsInstall({
        agent: ["pochi"],
        view: "human",
      });

      await expect(
        runSkillsUninstall({
          all: true,
          view: "agent",
        })
      ).rejects.toThrow(
        "skills uninstall detected targets outside this OpenMeld installation"
      );

      await runSkillsUninstall({
        all: true,
        allowExternalTargets: true,
        view: "agent",
      });

      await expect(
        readFile(join(externalSkillsDir, "openmeld-cli", "SKILL.md"), "utf8")
      ).rejects.toThrow();
    });
  });

  it("treats OPENMELD_HOME symlink targets as external during --all uninstall audit", async () => {
    await withTempHome(async (home) => {
      if (process.platform === "win32") {
        return;
      }
      const externalSkillsDir = join(home, "external-agent", "skills");
      const linkedSkillsDir = join(
        home,
        ".openmeld",
        "runtime",
        "pochi-linked"
      );
      await mkdir(externalSkillsDir, { recursive: true });
      await mkdir(join(home, ".openmeld", "runtime"), { recursive: true });
      await symlink(externalSkillsDir, linkedSkillsDir);
      detectInstalledSkillsAgentsMock.mockResolvedValue(["pochi"]);

      await setConfiguredSkillsConfig({
        agents: {
          pochi: {
            globalSkillsDir: linkedSkillsDir,
          },
        },
      });

      await runSkillsInstall({
        agent: ["pochi"],
        view: "human",
      });

      await expect(
        runSkillsUninstall({
          all: true,
          view: "agent",
        })
      ).rejects.toThrow(
        "skills uninstall detected targets outside this OpenMeld installation"
      );
    });
  });

  it("retains tracked target state when uninstall fails for that target", async () => {
    await withTempHome(async (home) => {
      if (process.platform === "win32") {
        return;
      }
      const customDir = join(home, "custom-agent", "skills");
      await mkdir(customDir, { recursive: true });

      await runSkillsInstall({
        dir: customDir,
        view: "human",
      });

      try {
        await chmod(customDir, 0o555);
        const { plainStdout: stdout } = await withCapturedStdio(async () => {
          await runSkillsUninstall({
            dir: customDir,
            view: "human",
          });
        });

        expect(stdout).toContain("failed: 1");
      } finally {
        await chmod(customDir, 0o755);
      }

      const skillsConfig = await getConfiguredSkillsConfig();
      expect(
        (skillsConfig?.installs ?? []).some(
          (item) => item.targetDir === customDir
        )
      ).toBe(true);
      expect(
        (skillsConfig?.customTargets ?? []).some(
          (item) => item.dir === customDir
        )
      ).toBe(true);
    });
  });
});

function parseAgentResultEnvelope(
  stdout: string,
  code: string
): { payload?: unknown } {
  for (const parsed of parseAgentEnvelopes(stdout)) {
    if (parsed.type === "result" && parsed.code === code) {
      return { payload: parsed.payload };
    }
  }

  return {};
}

function parseAgentEnvelopes(stdout: string): Array<{
  data?: Record<string, unknown>;
  type?: string;
  code?: string;
  payload?: unknown;
  text?: string;
}> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const envelopes: Array<{
    type?: string;
    code?: string;
    payload?: unknown;
  }> = [];
  for (const line of lines) {
    try {
      envelopes.push(
        JSON.parse(line) as {
          data?: Record<string, unknown>;
          type?: string;
          code?: string;
          payload?: unknown;
          text?: string;
        }
      );
    } catch {
      // Ignore non-JSON stdout lines in mixed human/agent test captures.
    }
  }
  return envelopes;
}

async function assertLayeredSkillDocsExist(
  skillRootDir: string
): Promise<void> {
  for (const relativePath of REQUIRED_SKILL_DOC_RELATIVE_PATHS) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await readFile(join(skillRootDir, relativePath), "utf8");
    if (raw.trim().length === 0) {
      throw new Error(`empty skill doc detected: ${relativePath}`);
    }
  }
}
