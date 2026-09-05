import { cp, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { withSkillsInstallLock } from "./install-lock";

// biome-ignore lint/performance/noBarrelFile: Keep the existing installer lock API while the source store shares its owner.
export { withSkillsInstallLock } from "./install-lock";

import {
  recoverSkillReplacement,
  replaceSkillDirectory,
} from "./replace-directory";
import type { SkillInstallStateResult } from "./state";
import { resolveSkillInstallStateForTarget } from "./state";
import type { LocalSkill } from "./store";
import { writeOpenMeldSkillMarker } from "./store";

export type SkillsInstallMode = "symlink" | "copy" | "unknown";
export type SkillsInstallStatus = "installed" | "skipped" | "failed";

export type SkillsInstallTarget = {
  id: string;
  dir: string;
  type: "agent" | "custom";
};

export type SkillsInstallResult = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  skillId: string;
  status: SkillsInstallStatus;
  mode: SkillsInstallMode;
  degraded: boolean;
  reason?: string;
};

export function installSkillsToTargets(input: {
  skills: LocalSkill[];
  targets: SkillsInstallTarget[];
}): Promise<SkillsInstallResult[]> {
  return withSkillsInstallLock(() => installSkillsToTargetsLocked(input));
}

async function installSkillsToTargetsLocked(input: {
  skills: LocalSkill[];
  targets: SkillsInstallTarget[];
}): Promise<SkillsInstallResult[]> {
  const results: SkillsInstallResult[] = [];

  for (const target of input.targets) {
    for (const skill of input.skills) {
      const result = await installOneSkillToTarget({
        skill,
        target,
      });
      results.push(result);
    }
  }

  return results;
}

async function installOneSkillToTarget(input: {
  skill: LocalSkill;
  target: SkillsInstallTarget;
}): Promise<SkillsInstallResult> {
  const targetDir = input.target.dir;
  const failInstall = (reason: string): SkillsInstallResult => ({
    targetId: input.target.id,
    targetDir,
    targetType: input.target.type,
    skillId: input.skill.id,
    status: "failed",
    mode: "unknown",
    degraded: false,
    reason,
  });

  if (!isAbsolute(targetDir)) {
    return failInstall("target dir must be an absolute path");
  }

  const skillId = input.skill.id;
  if (
    skillId.trim().length === 0 ||
    isAbsolute(skillId) ||
    skillId === "." ||
    skillId === ".." ||
    skillId.includes("/") ||
    skillId.includes("\\")
  ) {
    return failInstall("skill id would escape target dir");
  }

  const resolvedTargetDir = resolve(targetDir);
  const resolvedSkillDir = resolve(resolvedTargetDir, skillId);
  const skillRelativePath = relative(resolvedTargetDir, resolvedSkillDir);
  if (
    skillRelativePath === ".." ||
    skillRelativePath.startsWith("../") ||
    skillRelativePath.startsWith("..\\")
  ) {
    return failInstall("skill id would escape target dir");
  }

  const skillTargetDir = resolvedSkillDir;

  await mkdir(targetDir, { recursive: true });
  await recoverSkillReplacement(skillTargetDir);
  const state = await resolveSkillInstallStateForTarget({
    skill: input.skill,
    target: input.target,
  });
  if (state.state === "external_conflict") {
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "skipped",
      mode: resolveSkippedInstallMode(state),
      degraded: false,
      reason: state.reason,
    };
  }

  if (state.state === "up_to_date") {
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "skipped",
      mode: resolveSkippedInstallMode(state),
      degraded: false,
      reason: state.reason,
    };
  }

  const installation: { mode: SkillsInstallMode } = { mode: "symlink" };
  try {
    await readFile(join(input.skill.absolutePath, "SKILL.md"), "utf8");
    await replaceSkillDirectory(skillTargetDir, async (stagedDir) => {
      const symlinked = await tryCreateSymlink({
        sourceDir: input.skill.absolutePath,
        targetDir: stagedDir,
      });
      if (symlinked) {
        return;
      }
      installation.mode = "copy";
      await cp(input.skill.absolutePath, stagedDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await writeOpenMeldSkillMarker({
        skillDir: stagedDir,
        skillId: input.skill.id,
        mode: "copy",
        ...(input.skill.contentHash
          ? { contentHash: input.skill.contentHash }
          : {}),
        ...(input.skill.version ? { version: input.skill.version } : {}),
      });
    });
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "installed",
      mode: installation.mode,
      degraded: installation.mode === "copy",
      ...(installation.mode === "copy"
        ? { reason: "symlink failed; fell back to copy" }
        : {}),
    };
  } catch (error) {
    return failInstall(
      error instanceof Error
        ? error.message
        : "failed to install skill to target"
    );
  }
}

function resolveSkippedInstallMode(
  state: SkillInstallStateResult
): SkillsInstallMode {
  if (state.targetMode === "copy") {
    return "copy";
  }
  if (state.targetMode === "symlink") {
    return "symlink";
  }
  return "unknown";
}

async function tryCreateSymlink(input: {
  sourceDir: string;
  targetDir: string;
}): Promise<boolean> {
  try {
    await mkdir(dirname(input.targetDir), { recursive: true });

    const targetParentDir = dirname(input.targetDir);
    const resolvedTargetParentDir = await realpath(targetParentDir).catch(
      () => targetParentDir
    );
    const resolvedSourceDir = await realpath(input.sourceDir).catch(
      () => input.sourceDir
    );
    const relativeTarget = relative(resolvedTargetParentDir, resolvedSourceDir);
    await symlink(
      process.platform === "win32" ? resolvedSourceDir : relativeTarget,
      input.targetDir,
      process.platform === "win32" ? "junction" : undefined
    );
    return true;
  } catch {
    return false;
  }
}
