import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSkillsEnsure, runSkillsInstall } from "../src/commands/skills";
import { isPublishedOpenMeldHome } from "../src/config/paths";
import {
  canManageRegistryAgentSkillTargets,
  detectInstalledRuntimeAgents,
  detectInstalledSkillsAgents,
  type SkillsAgentRegistryEntry,
} from "../src/skills/agents";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

function buildRegistryEntry(
  overrides: Partial<SkillsAgentRegistryEntry>
): SkillsAgentRegistryEntry {
  return {
    name: "fake-agent",
    displayName: "Fake Agent",
    skillsDir: "/tmp/fake-agent/project-skills",
    globalSkillsDir: "/tmp/fake-agent/skills",
    globalSkillsDirSource: "registry-default",
    detectInstalled: async () => true,
    lifecycleStatus: "active",
    runtimeSupported: false,
    skillsInstallable: true,
    transportModes: [],
    ...overrides,
  };
}

const LANE_ERROR_RE = /published OpenMeld home/;

function useLaneOpenMeldHome(home: string): void {
  // Simulate an isolated dev lane: the OpenMeld home is redirected into a
  // worktree-local directory while HOME (and the agent skills dirs under it)
  // stays untouched. withTempHome restores OPENMELD_HOME afterwards.
  process.env.OPENMELD_HOME = join(home, "worktree", "openmeld-home");
}

describe("published OpenMeld home detection", () => {
  it("treats the default home as published and lane homes as not published", () => {
    const argv = ["/usr/local/bin/node", "/usr/local/bin/openmeld"];
    expect(
      isPublishedOpenMeldHome({ homeDir: "/tmp/home", env: {}, argv })
    ).toBe(true);
    expect(
      isPublishedOpenMeldHome({
        homeDir: "/tmp/home",
        env: { OPENMELD_HOME: "/tmp/home/worktree/openmeld-home" },
        argv,
      })
    ).toBe(false);
    expect(
      isPublishedOpenMeldHome({
        homeDir: "/tmp/home",
        env: { OPENMELD_HOME: "/tmp/home/.openmeld" },
        argv,
      })
    ).toBe(true);
    expect(
      isPublishedOpenMeldHome({
        homeDir: "/tmp/home",
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
      })
    ).toBe(false);
  });
});

describe("registry agent skill targets under a lane-specific home", () => {
  it("detects registry-default agents only from the published home", async () => {
    await withTempHome(async (home) => {
      const registry = {
        "fake-agent": buildRegistryEntry({}),
      };

      expect(await detectInstalledSkillsAgents(registry)).toEqual([
        "fake-agent",
      ]);

      useLaneOpenMeldHome(home);
      expect(canManageRegistryAgentSkillTargets()).toBe(false);
      expect(await detectInstalledSkillsAgents(registry)).toEqual([]);
    });
  });

  it("keeps config-override agents detectable from a lane home", async () => {
    await withTempHome(async (home) => {
      useLaneOpenMeldHome(home);
      const registry = {
        "fake-agent": buildRegistryEntry({
          globalSkillsDirSource: "config-override",
        }),
      };

      expect(await detectInstalledSkillsAgents(registry)).toEqual([
        "fake-agent",
      ]);
    });
  });

  it("still detects runnable local agents without managing their shared skills directories", async () => {
    await withTempHome(async (home) => {
      useLaneOpenMeldHome(home);
      const registry = {
        "fake-agent": buildRegistryEntry({
          runtimeSupported: true,
        }),
      };

      expect(await detectInstalledSkillsAgents(registry)).toEqual([]);
      expect(await detectInstalledRuntimeAgents(registry)).toEqual([
        "fake-agent",
      ]);
    });
  });

  it("rejects explicit --agent targets from a lane home with a lane-specific error", async () => {
    await withTempHome(async (home) => {
      useLaneOpenMeldHome(home);

      await expect(
        withCapturedStdio(async () => {
          await runSkillsInstall({
            agent: ["claude-code"],
            view: "human",
          });
        })
      ).rejects.toThrow(LANE_ERROR_RE);
    });
  });

  it("keeps ensure --all a safe no-op from a lane home", async () => {
    await withTempHome(async (home) => {
      useLaneOpenMeldHome(home);

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        const result = await runSkillsEnsure({
          all: true,
          quiet: true,
          view: "human",
        });
        expect(result).toBe("completed");
      });

      expect(stdout).not.toContain("Installed Targets");
    });
  });

  it("still installs into an explicit --dir from a lane home", async () => {
    await withTempHome(async (home) => {
      useLaneOpenMeldHome(home);
      const customDir = join(home, "lane-local", "skills");
      await mkdir(customDir, { recursive: true });

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsInstall({
          dir: customDir,
          view: "human",
        });
      });

      expect(stdout).toContain("Installed: 1");
    });
  });
});
