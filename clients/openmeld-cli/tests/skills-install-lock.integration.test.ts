import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withSkillsInstallLock } from "../src/skills/installer";
import { withTempHome } from "./helpers/fs";

describe("skills install lock", () => {
  it("removes stale lock and continues installation", async () => {
    await withTempHome(async (home) => {
      const lockDir = join(home, ".openmeld", "runtime", "logs");
      const lockPath = join(lockDir, "skills-install.lock");
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({
          pid: 999_999_999,
          createdAt: "2026-02-16T00:00:00.000Z",
        })}\n`,
        "utf8"
      );

      const result = await withSkillsInstallLock(async () => "ok");
      expect(result).toBe("ok");
    });
  });

  it("fails when lock owner is still alive", async () => {
    await withTempHome(async (home) => {
      const lockDir = join(home, ".openmeld", "runtime", "logs");
      const lockPath = join(lockDir, "skills-install.lock");
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({
          pid: process.pid,
          createdAt: "2026-02-16T00:00:00.000Z",
        })}\n`,
        "utf8"
      );

      await expect(
        withSkillsInstallLock(async () => "should-not-run")
      ).rejects.toThrow("another skills installation is already running");
    });
  });
});
