import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function isCliSkillCheckPath(path) {
  return (
    path.startsWith("release/openmeld-cli-skill/") ||
    path.startsWith("clients/web/public/skills/openmeld-cli/") ||
    path === "scripts/release/cli-skill.mjs" ||
    path === "scripts/release/cli-skill-check.mjs" ||
    path === "packages/schemas/src/official-cli-skill.ts" ||
    path === "packages/schemas/src/index.ts" ||
    path === "packages/schemas/package.json" ||
    path === "pnpm-lock.yaml"
  );
}

// Control owns the verifier and its schema; cwd supplies only release data.
// Use Node directly: no schema build or platform-specific pnpm shim is needed.
export function checkCliSkill(input = {}) {
  const run = input.run ?? spawnSync;
  const cwd = resolve(input.cwd ?? process.cwd());
  const result = run(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("./cli-skill.mjs", import.meta.url)),
      "check",
    ],
    {
      cwd,
      env: { ...process.env, OPENMELD_VERIFICATION_ROOT: cwd },
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      "CLI Skill verification failed. Inspect the error above; for content changes, increment release/openmeld-cli-skill/release.json revision, run node scripts/release/cli-skill.mjs build with the existing signing key, and commit source and generated public files together."
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  checkCliSkill();
}
