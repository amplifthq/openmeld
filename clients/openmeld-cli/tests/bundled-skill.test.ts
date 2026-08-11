import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBundledOpenMeldCliSkillDocument } from "../src/skills/bundled-assets";

describe("bundled OpenMeld CLI skill", () => {
  it("reads the packaged SKILL.md raw", async () => {
    const skillFilePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "skills",
      "openmeld-cli",
      "SKILL.md"
    );
    const expected = await readFile(skillFilePath, "utf8");

    await expect(readBundledOpenMeldCliSkillDocument()).resolves.toBe(expected);
  });
});
