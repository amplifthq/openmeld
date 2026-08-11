import { createHash } from "node:crypto";
import { isBinaryDistribution } from "../runtime/distribution";
import { loadFsBundledSkillAssets } from "./bundled-assets-fs";

/**
 * One bundled skill file, addressed by its POSIX path relative to the skills/
 * root (e.g. "README.md", "openmeld-cli/SKILL.md"). This is the single shape
 * both distribution forms produce, so downstream skill install and bundle-hash
 * logic never branches on how the files were sourced.
 */
export type BundledSkillAsset = {
  relativePath: string;
  content: Buffer;
};

/**
 * Load the OpenMeld-managed skill files that ship with this CLI build.
 *
 * - npm distribution: read from the on-disk `skills/` directory.
 * - binary distribution: read from files embedded into the single binary at
 *   compile time. The embedded module is a Bun-only island resolved only by
 *   `bun build --compile`; the npm build never reaches this branch and marks
 *   the module external, so its `with { type: "file" }` imports are never
 *   parsed by tsdown.
 */
export async function loadBundledSkillAssets(): Promise<BundledSkillAsset[]> {
  if (isBinaryDistribution()) {
    const embedded = await import("./bundled-assets-embedded");
    return embedded.loadEmbeddedBundledSkillAssets();
  }
  return loadFsBundledSkillAssets();
}

/**
 * Content hash over an ordered list of skill assets. Byte-for-byte compatible
 * with `computeDirectoryContentHash` (same `file:<relativePath>\n<content>\n`
 * framing) so the embedded and on-disk sources produce identical hashes as long
 * as `assets` is sorted by relative path (as `loadBundledSkillAssets` returns
 * it). This is the single skills-hash algorithm for both distribution forms.
 */
export function hashBundledSkillAssets(assets: BundledSkillAsset[]): string {
  const hash = createHash("sha256");
  for (const asset of assets) {
    hash.update(`file:${asset.relativePath}\n`);
    hash.update(asset.content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

const OPENMELD_CLI_SKILL_ID = "openmeld-cli";
const OPENMELD_CLI_SKILL_FILE = "SKILL.md";

/**
 * Read one OpenMeld CLI skill document by its path relative to the skill root
 * (e.g. "SKILL.md", "references/commands.md"). Works in both distribution forms
 * via loadBundledSkillAssets, so `openmeld prompt --raw` renders the bundled
 * markdown from the embedded binary too.
 */
export async function readBundledOpenMeldCliSkillDocumentByPath(
  skillRelativePath: string
): Promise<string> {
  const targetPath = `${OPENMELD_CLI_SKILL_ID}/${skillRelativePath}`;
  const assets = await loadBundledSkillAssets();
  const asset = assets.find((item) => item.relativePath === targetPath);
  if (!asset) {
    throw new Error(
      `bundled OpenMeld CLI skill document is missing: ${skillRelativePath}`
    );
  }
  return asset.content.toString("utf8");
}

export function readBundledOpenMeldCliSkillDocument(): Promise<string> {
  return readBundledOpenMeldCliSkillDocumentByPath(OPENMELD_CLI_SKILL_FILE);
}
