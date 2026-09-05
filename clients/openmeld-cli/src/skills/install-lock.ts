import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeLogsDir } from "../config/paths";

const heldLock = new AsyncLocalStorage<boolean>();
const pendingLocks = new Map<string, Promise<unknown>>();
export function withSkillsInstallLock<T>(run: () => Promise<T>): Promise<T> {
  if (heldLock.getStore()) {
    return run();
  }
  const key = runtimeLogsDir();
  const previous = pendingLocks.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => acquireSkillsInstallLock(() => heldLock.run(true, run)));
  pendingLocks.set(key, current);
  return current.finally(() => {
    if (pendingLocks.get(key) === current) {
      pendingLocks.delete(key);
    }
  });
}

const LOCK_FILE_NAME = "skills-install.lock";
const LOCK_ACQUIRE_MAX_ATTEMPTS = 3;

async function acquireSkillsInstallLock<T>(run: () => Promise<T>): Promise<T> {
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
  if (!pid) {
    const metadata = await stat(lockPath).catch(() => null);
    if (metadata && Date.now() - metadata.mtimeMs < 30_000) {
      return false;
    }
  }
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
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0
    ? pid
    : null;
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
