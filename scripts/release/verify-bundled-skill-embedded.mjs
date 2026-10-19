import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root =
  process.env.OPENMELD_RELEASE_SOURCE_ROOT ??
  fileURLToPath(new URL("../../", import.meta.url));

export function verifyBundledSkillEmbedded() {
  const temp = mkdtempSync(join(tmpdir(), "openmeld-embedded-skills-"));
  try {
    const module = join(
      root,
      "clients/openmeld-cli/src/skills/bundled-assets-embedded.ts"
    );
    const entry = join(temp, "entry.ts");
    const binary = join(
      temp,
      process.platform === "win32" ? "probe.exe" : "probe"
    );
    writeFileSync(
      entry,
      `import {loadEmbeddedBundledSkillAssets} from ${JSON.stringify(module)};\nconsole.log(JSON.stringify((await loadEmbeddedBundledSkillAssets()).map(a => [a.relativePath, a.content.toString('base64')])));`
    );
    const built = spawnSync(
      "bun",
      ["build", "--compile", entry, "--outfile", binary],
      { encoding: "utf8" }
    );
    if (built.status !== 0) {
      throw new Error(
        `Embedded Skill probe could not compile: ${built.error?.message ?? built.stderr}`
      );
    }
    // Run the compiled executable outside the checkout: no channel or filesystem fallback.
    const run = spawnSync(binary, [], { cwd: temp, encoding: "utf8" });
    if (run.status !== 0) {
      throw new Error(
        `Embedded Skill probe could not run: ${run.error?.message ?? run.stderr}`
      );
    }
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
          relative(skills, full).split(sep).join("/"),
          readFileSync(full).toString("base64"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b));
    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(
        "Compiled embedded Skill paths or contents differ from the bundled Skill source."
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
