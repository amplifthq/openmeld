import { mkdir, rm, writeFile } from "node:fs/promises";
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
  runSkillsInstall,
  runSkillsUninstall,
  runSkillsUpdate,
} from "../src/commands/skills";
import { setConfiguredSkillsConfig } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("skills command copy", () => {
  beforeEach(() => {
    detectInstalledSkillsAgentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    detectInstalledSkillsAgentsMock.mockReset();
  });

  it("renders human skills help with openmeld-dev commands", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkills({ view: "human" });
      });

      expect(stdout).toContain("OpenMeld Skills Command Reference");
      expect(stdout).toContain("openmeld-dev skills:");
      expect(stdout).toContain("Custom Agent Install");
      expect(stdout).toContain(
        "Run `openmeld-dev skills install --dir <absolute-path>` to install OpenMeld skills."
      );
      expect(stdout).toContain(
        "If you do not know the path, run `openmeld-dev skills install --guide`."
      );
    });
  });

  it("renders skills check follow-up with openmeld-dev when skills are missing", async () => {
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
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("missing: 1");
      expect(stdout).toContain(
        "Run `openmeld-dev skills install --all` or `openmeld-dev skills install --agent <id...>` to install missing OpenMeld skills."
      );
    });
  });

  it("renders skills check follow-up with openmeld-canary when skills are outdated", async () => {
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
            contentHash: "stale-hash",
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
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-canary");

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsCheck({ view: "human" });
      });

      expect(stdout).toContain("outdated: 1");
      expect(stdout).toContain(
        "Run `openmeld-canary skills update` to update OpenMeld CLI skills to the latest version."
      );
    });
  });

  it("renders skills update install guidance for npx entry", async () => {
    await withTempHome(async () => {
      vi.stubEnv("npm_command", "exec");
      vi.stubEnv("npm_lifecycle_script", '"openmeld"');
      vi.stubEnv(
        "npm_config_user_agent",
        "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
      );

      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runSkillsUpdate({ view: "human" });
      });

      expect(stdout).toContain(
        "No tracked OpenMeld skills install targets found."
      );
      expect(stdout).toContain(
        "Install first with `npx -y openmeld@latest skills install`."
      );
    });
  });

  it("renders install non-interactive errors with openmeld-dev examples", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

      await expect(
        runSkillsInstall({
          view: "agent",
        })
      ).rejects.toThrow("openmeld-dev skills install --all");
    });
  });

  it("renders uninstall non-interactive errors with npx examples", async () => {
    await withTempHome(async () => {
      vi.stubEnv("npm_command", "exec");
      vi.stubEnv("npm_lifecycle_script", '"openmeld"');
      vi.stubEnv(
        "npm_config_user_agent",
        "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
      );

      await expect(
        runSkillsUninstall({
          view: "agent",
        })
      ).rejects.toThrow("npx -y openmeld@latest skills uninstall --all");
    });
  });

  it("renders custom dir recovery with openmeld-canary guide command", async () => {
    await withTempHome(async (home) => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-canary");

      await expect(
        runSkillsInstall({
          dir: join(home, "missing-agent", "skills"),
          view: "human",
        })
      ).rejects.toThrow("openmeld-canary skills install --guide");
    });
  });
});
