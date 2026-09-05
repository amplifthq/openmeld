import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withSkillsInstallLock } from "../src/skills/installer";
import { withTempHome } from "./helpers/fs";

describe("skills install lock", () => {
  it("serializes concurrent local checks while allowing a nested installation", async () => {
    await withTempHome(async () => {
      const order: string[] = [];
      await Promise.all([
        withSkillsInstallLock(async () => {
          order.push("first");
          await withSkillsInstallLock(() =>
            Promise.resolve(order.push("nested"))
          );
          order.push("finished");
        }),
        withSkillsInstallLock(() => Promise.resolve(order.push("second"))),
      ]);
      expect(order).toEqual(["first", "nested", "finished", "second"]);
    });
  });

  it("does not steal a recently created partial lock file", async () => {
    await withTempHome(async (home) => {
      const lockDir = join(home, ".openmeld", "runtime", "logs");
      await mkdir(lockDir, { recursive: true });
      await writeFile(join(lockDir, "skills-install.lock"), '{"pid":');
      await expect(withSkillsInstallLock(async () => "wrong")).rejects.toThrow(
        "already running"
      );
    });
  });
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
