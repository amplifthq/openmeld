import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PACKAGE_JSON = "package.json";

export type BundledSkillsLocation = {
  cliRootDir: string;
  skillsRootDir: string;
};

/**
 * Locate the on-disk bundled skills directory for the npm distribution by
 * walking up from this module to the CLI package root (a directory that has
 * both package.json and skills/). Returns null under the binary distribution,
 * where import.meta.url is a virtual path and the skills are embedded instead —
 * callers in that mode go through bundled-assets.ts, not this function.
 */
export function resolveBundledSkillsLocation(): BundledSkillsLocation | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const cliRootDir = resolveCliRootDir(moduleDir);
  if (!cliRootDir) {
    return null;
  }
  return {
    cliRootDir,
    skillsRootDir: path.join(cliRootDir, "skills"),
  };
}

function resolveCliRootDir(fromDir: string): string | null {
  let current = fromDir;
  for (;;) {
    const packageJsonPath = path.join(current, CLI_PACKAGE_JSON);
    const hasPackageJson = existsSync(packageJsonPath);
    const hasSkillsDir = existsSync(path.join(current, "skills"));
    if (hasPackageJson && hasSkillsDir) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
