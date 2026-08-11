import {
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { runtimeLogsDir } from "../config/paths";
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

const LOCK_FILE_NAME = "skills-install.lock";
const LOCK_ACQUIRE_MAX_ATTEMPTS = 3;

export async function withSkillsInstallLock<T>(
  run: () => Promise<T>
): Promise<T> {
  const logsDir = runtimeLogsDir();
  await mkdir(logsDir, { recursive: true });
  const lockPath = join(logsDir, LOCK_FILE_NAME);

  let acquired = false;
  const lockContents = `${JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
  })}\n`;
  for (let attempt = 0; attempt < LOCK_ACQUIRE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await writeFile(lockPath, lockContents, {
        encoding: "utf8",
        flag: "wx",
      });
      acquired = true;
      break;
    } catch (error) {
      if (getErrorCode(error) !== "EEXIST") {
        throw error;
      }

      const recovered = await recoverStaleSkillsInstallLock(lockPath);
      if (!recovered) {
        throw new Error(
          "another skills installation is already running; retry after it finishes"
        );
      }

      try {
        await writeFile(lockPath, lockContents, {
          encoding: "utf8",
          flag: "wx",
        });
        acquired = true;
        break;
      } catch (retryError) {
        if (getErrorCode(retryError) !== "EEXIST") {
          throw retryError;
        }
      }
    }
  }

  if (!acquired) {
    throw new Error(
      "another skills installation is already running; retry after it finishes"
    );
  }

  try {
    return await run();
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function recoverStaleSkillsInstallLock(
  lockPath: string
): Promise<boolean> {
  const lockRaw = await readFile(lockPath, "utf8").catch((error: unknown) => {
    if (getErrorCode(error) === "ENOENT") {
      return "";
    }
    throw error;
  });
  if (!lockRaw) {
    return true;
  }

  const parsed = parseLockMeta(lockRaw);
  const pid = resolveLockPid(parsed);
  if (pid && isPidAlive(pid)) {
    return false;
  }

  const latestLockRaw = await readFile(lockPath, "utf8").catch(
    (error: unknown) => {
      if (getErrorCode(error) === "ENOENT") {
        return "";
      }
      throw error;
    }
  );
  if (!latestLockRaw) {
    return true;
  }
  const latestParsed = parseLockMeta(latestLockRaw);
  const latestPid = resolveLockPid(latestParsed);
  if (
    !isSameLockSnapshot({
      beforeRaw: lockRaw,
      beforePid: pid,
      afterRaw: latestLockRaw,
      afterPid: latestPid,
    })
  ) {
    return false;
  }

  await rm(lockPath, { force: true }).catch((error: unknown) => {
    if (getErrorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  return true;
}

function parseLockMeta(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveLockPid(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const pid = (meta as Record<string, unknown>).pid;
  return typeof pid === "number" && Number.isInteger(pid) ? pid : null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return getErrorCode(error) !== "ESRCH";
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isSameLockSnapshot(input: {
  beforeRaw: string;
  beforePid: number | null;
  afterRaw: string;
  afterPid: number | null;
}): boolean {
  if (input.beforeRaw !== input.afterRaw) {
    return false;
  }
  return input.beforePid === input.afterPid;
}

export async function installSkillsToTargets(input: {
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

  if (state.state === "outdated") {
    await rm(skillTargetDir, { recursive: true, force: true });
  }

  const symlinked = await tryCreateSymlink({
    sourceDir: input.skill.absolutePath,
    targetDir: skillTargetDir,
  });
  if (symlinked) {
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "installed",
      mode: "symlink",
      degraded: false,
    };
  }

  try {
    await rm(skillTargetDir, { recursive: true, force: true });
    await cp(input.skill.absolutePath, skillTargetDir, {
      recursive: true,
      force: true,
    });
    await writeOpenMeldSkillMarker({
      skillDir: skillTargetDir,
      skillId: input.skill.id,
      mode: "copy",
      ...(input.skill.contentHash
        ? { contentHash: input.skill.contentHash }
        : {}),
      ...(input.skill.version ? { version: input.skill.version } : {}),
    });
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "installed",
      mode: "copy",
      degraded: true,
      reason: "symlink failed; fell back to copy",
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "failed to install skill to target";
    return {
      targetId: input.target.id,
      targetDir,
      targetType: input.target.type,
      skillId: input.skill.id,
      status: "failed",
      mode: "copy",
      degraded: true,
      reason,
    };
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
    await rm(input.targetDir, { recursive: true, force: true });
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
      relativeTarget,
      input.targetDir,
      process.platform === "win32" ? "junction" : undefined
    );
    return true;
  } catch {
    return false;
  }
}
