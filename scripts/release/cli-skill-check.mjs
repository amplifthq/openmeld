import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

// Both PR validation and release control use the source checkout as cwd.
// Turbo reuses the schema build; this never builds Web or signs new content.
export function checkCliSkill(input = {}) {
  const run = input.run ?? spawnSync;
  for (const [command, args] of [
    ["pnpm", ["exec", "turbo", "run", "build", "--filter=@openmeld/schemas"]],
    [process.execPath, ["scripts/release/cli-skill.mjs", "check"]],
  ]) {
    const result = run(command, args, {
      cwd: input.cwd ?? process.cwd(),
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        "CLI Skill verification failed. Inspect the error above; for content changes, increment release/openmeld-cli-skill/release.json revision, run node scripts/release/cli-skill.mjs build with the existing signing key, and commit source and generated public files together."
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkCliSkill();
}
