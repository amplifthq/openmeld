import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path, { dirname, join, relative } from "node:path";
import { skillsDir } from "../config/paths";
import {
  type BundledSkillAsset,
  hashBundledSkillAssets,
} from "./bundled-assets";
import { sortBundledSkillAssets } from "./bundled-assets-fs";
import { computeDirectoryContentHash } from "./content-hash";
import { withSkillsInstallLock } from "./install-lock";
import { loadSelectedSkillAssets } from "./official-release";
import {
  recoverSkillReplacement,
  replaceSkillDirectory,
} from "./replace-directory";

export const OPENMELD_SKILL_MARKER_FILE = ".openmeld-skill.json";

export type OpenMeldSkillMarker = {
  managedBy: "openmeld";
  skillId: string;
  mode: "source" | "symlink" | "copy";
  contentHash?: string;
  version?: string;
  updatedAt: string;
};

export type LocalSkill = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  contentHash?: string;
  version?: string;
};

const OPENMELD_CLI_SKILL_FILE = "SKILL.md";
const SKILL_NAME_REGEX = /^name:\s*(.+)$/m;

export function ensureLocalSkills(): Promise<LocalSkill[]> {
  return withSkillsInstallLock(ensureLocalSkillsLocked);
}

async function ensureLocalSkillsLocked(): Promise<LocalSkill[]> {
  const storePath = skillsDir();
  await mkdir(storePath, { recursive: true });

  const { assets, version: bundledVersion } = await loadSelectedSkillAssets();
  if (assets.length === 0) {
    return listLocalSkills();
  }
  const skillGroups = groupAssetsBySkill(assets);

  for (const [skillId, skillAssets] of skillGroups) {
    const targetDir = join(storePath, skillId);
    await recoverSkillReplacement(targetDir);
    const sourceContentHash = hashBundledSkillAssets(skillAssets);
    const existingMarker = await readOpenMeldSkillMarker(targetDir);
    const existing = await lstat(targetDir).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    );
    if (existing && (!existingMarker || existing.isSymbolicLink())) {
      throw new Error(
        `OpenMeld Skill source conflicts with an unmanaged path: ${targetDir}`
      );
    }
    const isUpToDate =
      existingMarker?.managedBy === "openmeld" &&
      existingMarker.skillId === skillId &&
      existingMarker.mode === "source" &&
      existingMarker.contentHash === sourceContentHash &&
      existingMarker.version === bundledVersion &&
      (await computeDirectoryContentHash({
        rootDir: targetDir,
        ignoredNames: [OPENMELD_SKILL_MARKER_FILE],
      })) === sourceContentHash;
    if (isUpToDate) {
      continue;
    }

    await replaceSkillDirectory(targetDir, async (stagedDir) => {
      for (const asset of skillAssets) {
        const filePath = join(stagedDir, asset.relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, asset.content);
      }
      await writeOpenMeldSkillMarker({
        skillDir: stagedDir,
        skillId,
        mode: "source",
        contentHash: sourceContentHash,
        version: bundledVersion,
      });
    });
  }

  return listLocalSkills();
}

// Group loaded assets by their first path segment (the skill id). Top-level
// files (e.g. skills/README.md) belong to no skill and are dropped, and a group
// without a SKILL.md is dropped too — matching the previous "only install skill
// directories that contain SKILL.md" behavior. Each group's paths are made
// skill-relative and sorted so the per-skill hash matches the source tree.
function groupAssetsBySkill(
  assets: BundledSkillAsset[]
): Map<string, BundledSkillAsset[]> {
  const groups = new Map<string, BundledSkillAsset[]>();
  for (const asset of assets) {
    const slashIndex = asset.relativePath.indexOf("/");
    if (slashIndex < 0) {
      continue;
    }
    const skillId = asset.relativePath.slice(0, slashIndex);
    const skillRelativePath = asset.relativePath.slice(slashIndex + 1);
    const group = groups.get(skillId) ?? [];
    group.push({ relativePath: skillRelativePath, content: asset.content });
    groups.set(skillId, group);
  }
  for (const [skillId, group] of [...groups.entries()]) {
    if (group.some((asset) => asset.relativePath === OPENMELD_CLI_SKILL_FILE)) {
      groups.set(skillId, sortBundledSkillAssets(group));
    } else {
      groups.delete(skillId);
    }
  }
  return groups;
}

export async function listLocalSkills(): Promise<LocalSkill[]> {
  const storePath = skillsDir();
  const skillDirs = await discoverSkillDirs(storePath, 0, 6);
  const skills: LocalSkill[] = [];

  for (const skillDir of skillDirs) {
    const skillFile = join(skillDir, "SKILL.md");
    const raw = await readFile(skillFile, "utf8").catch(() => "");
    if (!raw) {
      continue;
    }
    const skillId = path.basename(skillDir);
    const skillName = readSkillName(raw) ?? skillId;
    const marker = await readOpenMeldSkillMarker(skillDir);
    skills.push({
      id: skillId,
      name: skillName,
      absolutePath: skillDir,
      relativePath: relative(storePath, skillDir) || skillId,
      ...(marker?.contentHash ? { contentHash: marker.contentHash } : {}),
      ...(marker?.version ? { version: marker.version } : {}),
    });
  }

  skills.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return skills;
}

export async function writeOpenMeldSkillMarker(input: {
  skillDir: string;
  skillId: string;
  mode: "source" | "symlink" | "copy";
  contentHash?: string;
  version?: string;
}): Promise<void> {
  const markerPath = join(input.skillDir, OPENMELD_SKILL_MARKER_FILE);
  const marker: OpenMeldSkillMarker = {
    managedBy: "openmeld",
    skillId: input.skillId,
    mode: input.mode,
    ...(input.contentHash ? { contentHash: input.contentHash } : {}),
    ...(input.version ? { version: input.version } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

export async function isOpenMeldManagedSkillDir(
  skillDir: string
): Promise<boolean> {
  const marker = await readOpenMeldSkillMarker(skillDir);
  return marker?.managedBy === "openmeld";
}

export async function readOpenMeldSkillMarker(
  skillDir: string
): Promise<OpenMeldSkillMarker | null> {
  const markerPath = join(skillDir, OPENMELD_SKILL_MARKER_FILE);
  const raw = await readFile(markerPath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OpenMeldSkillMarker>;
    if (parsed.managedBy !== "openmeld") {
      return null;
    }
    if (
      typeof parsed.skillId !== "string" ||
      parsed.skillId.trim().length === 0
    ) {
      return null;
    }
    if (
      parsed.mode !== "source" &&
      parsed.mode !== "symlink" &&
      parsed.mode !== "copy"
    ) {
      return null;
    }
    return {
      managedBy: "openmeld",
      skillId: parsed.skillId.trim(),
      mode: parsed.mode,
      ...(typeof parsed.contentHash === "string" &&
      parsed.contentHash.trim().length > 0
        ? { contentHash: parsed.contentHash.trim() }
        : {}),
      ...(typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? { version: parsed.version.trim() }
        : {}),
      updatedAt:
        typeof parsed.updatedAt === "string" &&
        parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function discoverSkillDirs(
  dir: string,
  depth: number,
  maxDepth: number
): Promise<string[]> {
  if (depth > maxDepth) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) {
    return [];
  }

  const hasSkill = entries.some(
    (entry) => entry.isFile() && entry.name === "SKILL.md"
  );
  if (hasSkill) {
    return [dir];
  }

  const nested = await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && !entry.name.includes(".openmeld-")
      )
      .map((entry) =>
        discoverSkillDirs(join(dir, entry.name), depth + 1, maxDepth)
      )
  );

  return nested.flat();
}

function readSkillName(rawSkillFile: string): string | undefined {
  const match = rawSkillFile.match(SKILL_NAME_REGEX);
  if (!match) {
    return undefined;
  }
  const candidate = match[1]?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}
