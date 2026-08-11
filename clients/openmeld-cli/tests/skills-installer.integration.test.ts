import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/skills/state", () => {
  return {
    resolveSkillInstallStateForTarget: vi.fn(),
  };
});

import { installSkillsToTargets } from "../src/skills/installer";
import { resolveSkillInstallStateForTarget } from "../src/skills/state";
import { withTempHome } from "./helpers/fs";

describe("skills installer skipped mode resolution", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("uses marker mode for external conflicts", async () => {
    await withTempHome(async (home) => {
      const targetDir = join(home, "custom-agent", "skills");
      await mkdir(targetDir, { recursive: true });

      vi.mocked(resolveSkillInstallStateForTarget).mockResolvedValueOnce({
        targetId: "custom-target",
        targetDir,
        targetType: "custom",
        skillId: "openmeld-cli",
        skillDir: join(targetDir, "openmeld-cli"),
        state: "external_conflict",
        targetMode: "copy",
        reason:
          "existing non-OpenMeld skill detected; skipped to avoid overwrite",
      });

      const results = await installSkillsToTargets({
        skills: [
          {
            id: "openmeld-cli",
            name: "OpenMeld CLI",
            absolutePath: join(home, ".openmeld", "skills", "openmeld-cli"),
            relativePath: "openmeld-cli",
          },
        ],
        targets: [
          {
            id: "custom-target",
            dir: targetDir,
            type: "custom",
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("skipped");
      expect(results[0]?.mode).toBe("copy");
    });
  });

  it("falls back to unknown mode when skipped state has no marker mode", async () => {
    await withTempHome(async (home) => {
      const targetDir = join(home, "custom-agent", "skills");
      await mkdir(targetDir, { recursive: true });

      vi.mocked(resolveSkillInstallStateForTarget).mockResolvedValueOnce({
        targetId: "custom-target",
        targetDir,
        targetType: "custom",
        skillId: "openmeld-cli",
        skillDir: join(targetDir, "openmeld-cli"),
        state: "up_to_date",
        reason: "already up-to-date",
      });

      const results = await installSkillsToTargets({
        skills: [
          {
            id: "openmeld-cli",
            name: "OpenMeld CLI",
            absolutePath: join(home, ".openmeld", "skills", "openmeld-cli"),
            relativePath: "openmeld-cli",
          },
        ],
        targets: [
          {
            id: "custom-target",
            dir: targetDir,
            type: "custom",
          },
        ],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("skipped");
      expect(results[0]?.mode).toBe("unknown");
    });
  });

  it("returns unknown mode when target dir is not absolute", async () => {
    const results = await installSkillsToTargets({
      skills: [
        {
          id: "openmeld-cli",
          name: "OpenMeld CLI",
          absolutePath: "/tmp/openmeld-cli",
          relativePath: "openmeld-cli",
        },
      ],
      targets: [
        {
          id: "custom-target",
          dir: "relative/skills",
          type: "custom",
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "failed",
      mode: "unknown",
      reason: "target dir must be an absolute path",
    });
    expect(resolveSkillInstallStateForTarget).not.toHaveBeenCalled();
  });
});
