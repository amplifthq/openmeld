import { randomUUID } from "node:crypto";
import { lstat, readFile, readlink, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

// Callers hold the skills install lock. Recover a process exit between renames.
export async function recoverSkillReplacement(target: string): Promise<void> {
  const previous = join(
    dirname(target),
    `.${basename(target)}.openmeld-previous`
  );
  if (!(await exists(previous))) {
    return;
  }
  if (!(await isManagedReplacement(previous, basename(target)))) {
    throw new Error("OpenMeld Skill backup conflicts with an unmanaged path");
  }
  if (await exists(target)) {
    if (!(await isManagedReplacement(target, basename(target)))) {
      throw new Error("OpenMeld Skill recovery would affect an unmanaged path");
    }
    await rm(previous, { recursive: true, force: true });
  } else {
    await rename(previous, target);
  }
}

export async function replaceSkillDirectory(
  target: string,
  prepare: (staged: string) => Promise<void>
): Promise<void> {
  await recoverSkillReplacement(target);
  const staged = join(
    dirname(target),
    `.${basename(target)}.openmeld-staged-${randomUUID()}`
  );
  const previous = join(
    dirname(target),
    `.${basename(target)}.openmeld-previous`
  );
  try {
    await prepare(staged);
    const hadPrevious = await exists(target);
    if (hadPrevious) {
      await rename(target, previous);
    }
    try {
      await rename(staged, target);
    } catch (error) {
      if (hadPrevious) {
        await rename(previous, target);
      }
      throw error;
    }
    // A cleanup failure must not roll back a committed replacement.
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function isManagedReplacement(
  path: string,
  skillId: string
): Promise<boolean> {
  const raw = await readFile(join(path, ".openmeld-skill.json"), "utf8").catch(
    () => null
  );
  if (raw) {
    try {
      const marker = JSON.parse(raw);
      return marker.managedBy === "openmeld" && marker.skillId === skillId;
    } catch {
      return false;
    }
  }
  // Legacy dangling links have no readable marker and carry no directory data.
  if ((await lstat(path)).isSymbolicLink()) {
    const destination = resolve(dirname(path), await readlink(path));
    return basename(destination) === skillId && !(await exists(destination));
  }
  return false;
}

function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  );
}
