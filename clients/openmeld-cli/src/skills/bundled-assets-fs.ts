import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveBundledSkillsLocation } from "./bundled";
import type { BundledSkillAsset } from "./bundled-assets";

/**
 * npm-distribution source: read the bundled skills from the on-disk `skills/`
 * directory next to the CLI package. Assets are sorted by relative path so the
 * order (and therefore any content hash computed from them) is stable and
 * matches the embedded distribution.
 */
export async function loadFsBundledSkillAssets(): Promise<BundledSkillAsset[]> {
  const location = resolveBundledSkillsLocation();
  if (!location) {
    throw new Error("unable to resolve bundled OpenMeld skills directory");
  }
  const assets = await collectSkillAssets(
    location.skillsRootDir,
    location.skillsRootDir
  );
  return sortBundledSkillAssets(assets);
}

export function sortBundledSkillAssets(
  assets: BundledSkillAsset[]
): BundledSkillAsset[] {
  return [...assets].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

async function collectSkillAssets(
  dir: string,
  rootDir: string
): Promise<BundledSkillAsset[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const assets: BundledSkillAsset[] = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      assets.push(...(await collectSkillAssets(absolutePath, rootDir)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    assets.push({
      relativePath: toPosixRelativePath(relative(rootDir, absolutePath)),
      content: await readFile(absolutePath),
    });
  }
  return assets;
}

function toPosixRelativePath(value: string): string {
  return value.split("\\").join("/");
}
