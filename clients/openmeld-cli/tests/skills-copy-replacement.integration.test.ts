import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ copyDenied: false }));
vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  return {
    ...actual,
    // Node's permission-error contract for machines without link privileges.
    symlink: () =>
      Promise.reject(
        Object.assign(new Error("symlink denied"), { code: "EPERM" })
      ),
    cp: (...args: Parameters<typeof actual.cp>) =>
      faults.copyDenied
        ? Promise.reject(
            Object.assign(new Error("copy denied"), { code: "EACCES" })
          )
        : actual.cp(...args),
  };
});

import { installSkillsToTargets } from "../src/skills/installer";
import { ensureLocalSkills } from "../src/skills/store";
import { withTempHome } from "./helpers/fs";

afterEach(() => {
  faults.copyDenied = false;
});

describe("Skill copy fallback", () => {
  it("installs without symlink privileges and preserves the working copy if its update fails", async () => {
    await withTempHome(async (home) => {
      const skills = await ensureLocalSkills();
      const target = {
        id: "test-agent",
        dir: join(home, "Agent With Spaces", "skills"),
        type: "custom" as const,
      };
      const initial = await installSkillsToTargets({
        skills,
        targets: [target],
      });
      expect(initial[0]).toMatchObject({ status: "installed", mode: "copy" });
      const entry = join(target.dir, "openmeld-cli/SKILL.md");
      const before = await readFile(entry, "utf8");
      const markerPath = join(target.dir, "openmeld-cli/.openmeld-skill.json");
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      await writeFile(
        markerPath,
        JSON.stringify({ ...marker, version: "0.0.0" })
      );
      faults.copyDenied = true;
      const failed = await installSkillsToTargets({
        skills,
        targets: [target],
      });
      expect(failed[0]).toMatchObject({
        status: "failed",
        reason: "copy denied",
      });
      expect(await readFile(entry, "utf8")).toBe(before);
      faults.copyDenied = false;
      expect(
        (await installSkillsToTargets({ skills, targets: [target] }))[0]?.status
      ).toBe("installed");
      expect(JSON.parse(await readFile(markerPath, "utf8")).version).toBe(
        marker.version
      );
    });
  });

  it("preserves a user-edited copy and an unowned same-name directory", async () => {
    await withTempHome(async (home) => {
      const skills = await ensureLocalSkills();
      const target = {
        id: "test-agent",
        dir: join(home, "skills"),
        type: "custom" as const,
      };
      await installSkillsToTargets({ skills, targets: [target] });
      const entry = join(target.dir, "openmeld-cli/SKILL.md");
      await writeFile(entry, "My private local instructions");
      expect(
        (await installSkillsToTargets({ skills, targets: [target] }))[0]
      ).toMatchObject({ status: "skipped" });
      expect(await readFile(entry, "utf8")).toBe(
        "My private local instructions"
      );
      const unowned = { ...target, dir: join(home, "unowned") };
      await mkdir(join(unowned.dir, "openmeld-cli"), { recursive: true });
      await writeFile(
        join(unowned.dir, "openmeld-cli/SKILL.md"),
        "My instructions"
      );
      expect(
        (await installSkillsToTargets({ skills, targets: [unowned] }))[0]
          ?.status
      ).toBe("skipped");
    });
  });
});
