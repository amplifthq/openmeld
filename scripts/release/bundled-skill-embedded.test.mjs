import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("compiled standalone fallback contains every bundled skill with exact bytes", () => {
  const temp = mkdtempSync(join(tmpdir(), "openmeld-embedded-skills-"));
  try {
    const module = join(
      root,
      "clients/openmeld-cli/src/skills/bundled-assets-embedded.ts"
    );
    const entry = join(temp, "entry.ts");
    const binary = join(temp, "probe");
    writeFileSync(
      entry,
      `import {loadEmbeddedBundledSkillAssets} from ${JSON.stringify(module)};\nconsole.log(JSON.stringify((await loadEmbeddedBundledSkillAssets()).map(a => [a.relativePath, a.content.toString('base64')])));`
    );
    const built = spawnSync(
      "bun",
      ["build", "--compile", entry, "--outfile", binary],
      { encoding: "utf8" }
    );
    assert.equal(built.status, 0, built.stderr);
    // Run the compiled executable outside the checkout: no channel or filesystem fallback.
    const run = spawnSync(binary, [], { cwd: temp, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const actual = JSON.parse(run.stdout).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const skills = join(root, "clients/openmeld-cli/skills");
    const expected = readdirSync(skills, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(entry.parentPath, entry.name);
        return [
          full.slice(skills.length + 1),
          readFileSync(full).toString("base64"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b));
    assert.deepEqual(actual, expected);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
