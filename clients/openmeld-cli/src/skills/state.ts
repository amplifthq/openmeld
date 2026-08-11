import { lstat, readlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { SkillsInstallTarget } from "./installer";
import {
  type LocalSkill,
  type OpenMeldSkillMarker,
  readOpenMeldSkillMarker,
} from "./store";

export type SkillInstallState =
  | "missing"
  | "outdated"
  | "up_to_date"
  | "external_conflict";

export type SkillInstallStateResult = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  skillId: string;
  skillDir: string;
  state: SkillInstallState;
  targetMode?: OpenMeldSkillMarker["mode"];
  sourceHash?: string;
  targetHash?: string;
  sourceVersion?: string;
  targetVersion?: string;
  reason?: string;
};

type SourceSnapshot = {
  hash?: string;
  version?: string;
};

type TargetSnapshot =
  | {
      exists: false;
    }
  | {
      exists: true;
      isSymlink: boolean;
      marker: OpenMeldSkillMarker | null;
      symlinkTargetPath: string;
    };

export async function resolveSkillsInstallStates(input: {
  skills: LocalSkill[];
  targets: SkillsInstallTarget[];
}): Promise<SkillInstallStateResult[]> {
  const states: SkillInstallStateResult[] = [];
  for (const target of input.targets) {
    for (const skill of input.skills) {
      states.push(
        await resolveSkillInstallStateForTarget({
          skill,
          target,
        })
      );
    }
  }
  return states;
}

export async function resolveSkillInstallStateForTarget(input: {
  skill: LocalSkill;
  target: SkillsInstallTarget;
}): Promise<SkillInstallStateResult> {
  const base = createBaseResult(input);
  const source = await resolveSourceSnapshot(input.skill);
  const target = await resolveTargetSnapshot(base.skillDir);

  if (!target.exists) {
    return createStateResult({
      base,
      source,
      state: "missing",
    });
  }

  if (target.marker?.managedBy !== "openmeld") {
    if (
      isLegacyOpenMeldSkillSymlink({
        skillId: input.skill.id,
        target,
      })
    ) {
      return createStateResult({
        base,
        source,
        state: "outdated",
        targetMode: "symlink",
        reason: "legacy OpenMeld skill link found; update required",
      });
    }

    return createStateResult({
      base,
      source,
      state: "external_conflict",
      reason:
        "existing non-OpenMeld skill detected; skipped to avoid overwrite",
    });
  }

  const upToDate = isUpToDate({
    source,
    targetMarker: target.marker,
    isSymlink: target.isSymlink,
    symlinkTargetPath: target.symlinkTargetPath,
    sourceSkillDir: input.skill.absolutePath,
  });
  if (upToDate) {
    return createStateResult({
      base,
      source,
      targetMarker: target.marker,
      state: "up_to_date",
      reason: "already up-to-date",
    });
  }

  return createStateResult({
    base,
    source,
    targetMarker: target.marker,
    state: "outdated",
    reason: target.isSymlink
      ? "OpenMeld skill link points to a different OpenMeld skills store; update required"
      : "OpenMeld skill content changed; update required",
  });
}

function createBaseResult(input: {
  skill: LocalSkill;
  target: SkillsInstallTarget;
}): Omit<SkillInstallStateResult, "state"> {
  const skillDir = join(input.target.dir, input.skill.id);
  return {
    targetId: input.target.id,
    targetDir: input.target.dir,
    targetType: input.target.type,
    skillId: input.skill.id,
    skillDir,
  };
}

async function resolveSourceSnapshot(
  skill: LocalSkill
): Promise<SourceSnapshot> {
  const sourceMarker = await readOpenMeldSkillMarker(skill.absolutePath);
  return {
    ...((skill.contentHash ?? sourceMarker?.contentHash)
      ? { hash: skill.contentHash ?? sourceMarker?.contentHash }
      : {}),
    ...((skill.version ?? sourceMarker?.version)
      ? { version: skill.version ?? sourceMarker?.version }
      : {}),
  };
}

async function resolveTargetSnapshot(
  skillDir: string
): Promise<TargetSnapshot> {
  const stats = await lstat(skillDir).catch(() => null);
  if (!stats) {
    return { exists: false };
  }

  let marker = await readOpenMeldSkillMarker(skillDir);
  let symlinkTargetPath = "";
  if (stats.isSymbolicLink()) {
    symlinkTargetPath = await resolveSymlinkTarget(skillDir).catch(() => "");
    if (!marker && symlinkTargetPath) {
      marker = await readOpenMeldSkillMarker(symlinkTargetPath);
    }
  }

  return {
    exists: true,
    isSymlink: stats.isSymbolicLink(),
    marker,
    symlinkTargetPath,
  };
}

function isLegacyOpenMeldSkillSymlink(input: {
  skillId: string;
  target: Extract<TargetSnapshot, { exists: true }>;
}): boolean {
  if (!(input.target.isSymlink && input.target.symlinkTargetPath)) {
    return false;
  }

  return basename(input.target.symlinkTargetPath) === input.skillId;
}

function isUpToDate(input: {
  source: SourceSnapshot;
  targetMarker: OpenMeldSkillMarker;
  isSymlink: boolean;
  symlinkTargetPath: string;
  sourceSkillDir: string;
}): boolean {
  if (input.isSymlink) {
    // A symlinked target mirrors whatever store it points at, and its marker is
    // read through the link, so a matching hash/version only proves that other
    // store's state. The link is current only when it resolves to this store's
    // skill directory; anything else must be reinstalled before the foreign
    // store drifts or disappears.
    return (
      input.symlinkTargetPath.length > 0 &&
      pathsEqual(input.symlinkTargetPath, input.sourceSkillDir)
    );
  }
  return hasMatchingHashAndVersion(input.source, input.targetMarker);
}

function hasMatchingHashAndVersion(
  source: SourceSnapshot,
  targetMarker: OpenMeldSkillMarker
): boolean {
  if (
    !(
      source.hash &&
      targetMarker.contentHash &&
      source.hash === targetMarker.contentHash
    )
  ) {
    return false;
  }
  return (
    !(source.version && targetMarker.version) ||
    source.version === targetMarker.version
  );
}

function createStateResult(input: {
  base: Omit<SkillInstallStateResult, "state">;
  source: SourceSnapshot;
  state: SkillInstallState;
  targetMode?: OpenMeldSkillMarker["mode"];
  targetMarker?: OpenMeldSkillMarker;
  reason?: string;
}): SkillInstallStateResult {
  return {
    ...input.base,
    state: input.state,
    ...(input.source.hash ? { sourceHash: input.source.hash } : {}),
    ...(input.source.version ? { sourceVersion: input.source.version } : {}),
    ...(input.targetMarker?.contentHash
      ? { targetHash: input.targetMarker.contentHash }
      : {}),
    ...(input.targetMarker?.mode
      ? { targetMode: input.targetMarker.mode }
      : {}),
    ...(input.targetMode ? { targetMode: input.targetMode } : {}),
    ...(input.targetMarker?.version
      ? { targetVersion: input.targetMarker.version }
      : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  const target = await readlink(linkPath);
  return resolve(dirname(linkPath), target);
}

function pathsEqual(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}
