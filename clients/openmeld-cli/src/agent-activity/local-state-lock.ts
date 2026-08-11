import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { resolveOpenMeldRootDir } from "../config/paths";

const POLL_MS = 20;
const OWNER_INITIALIZATION_GRACE_MS = 1000;
const PROCESS_START_IDENTITY =
  readProcessStartIdentity(process.pid) ??
  `fallback:${process.pid}:${Math.floor(Date.now() - process.uptime() * 1000)}`;

type LeaseOwner = {
  expiresAtMs: number;
  ownerPid: number;
  ownerProcessStartedAt: string;
  token: string;
  version: 1;
};

export async function withAgentActivityLocalStateLock<T>(
  input: { rootDir?: string },
  operation: () => Promise<T>
): Promise<T> {
  return await withDirectoryLease(input, "state", 5000, 30_000, operation);
}

/** Serializes delivery with opt-out without blocking the Node event loop. */
export async function withAgentActivityDeliveryLock<T>(
  input: { rootDir?: string },
  operation: () => Promise<T>
): Promise<T> {
  return await withDirectoryLease(input, "delivery", 35_000, 60_000, operation);
}

async function withDirectoryLease<T>(
  input: { rootDir?: string },
  name: "delivery" | "state",
  waitMs: number,
  leaseMs: number,
  operation: () => Promise<T>
): Promise<T> {
  const root = await ensureLeaseRoot(input);
  const path = join(root, `${name}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while (!(await tryClaimLease(path, token, leaseMs))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Agent Activity ${name} lock.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  let leaseLost = false;
  let renewal: Promise<void> | null = null;
  const heartbeat = setInterval(
    () => {
      if (renewal) {
        return;
      }
      renewal = renewLease(path, token, leaseMs)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
          }
        })
        .catch((error: unknown) => {
          leaseLost = true;
          process.stderr.write(
            `[openmeld.agent_activity.${name}_lock_renew_failed] ${error instanceof Error ? error.message : String(error)}\n`
          );
        })
        .finally(() => {
          renewal = null;
        });
    },
    Math.min(1000, Math.floor(leaseMs / 3))
  );
  heartbeat.unref();

  try {
    const result = await operation();
    if (leaseLost) {
      throw new Error(`Agent Activity ${name} lock lease was lost.`);
    }
    return result;
  } finally {
    clearInterval(heartbeat);
    await renewal;
    try {
      await releaseLease(path, token);
    } catch (error) {
      process.stderr.write(
        `[openmeld.agent_activity.${name}_lock_release_failed] ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

async function ensureLeaseRoot(input: { rootDir?: string }) {
  const root = join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    ".locks"
  );
  await mkdir(root, { mode: 0o700, recursive: true });
  await chmod(root, 0o700);
  return root;
}

async function tryClaimLease(path: string, token: string, leaseMs: number) {
  try {
    await mkdir(path, { mode: 0o700 });
    try {
      await writeLeaseOwner(path, currentLeaseOwner(token, leaseMs));
      return true;
    } catch (error) {
      await rm(path, { force: true, recursive: true });
      throw error;
    }
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      throw error;
    }
  }

  const current = await readLeaseOwner(path);
  if (current && isLeaseOwnerStillRunning(current)) {
    return false;
  }
  if (!(current || (await isUninitializedLeaseStale(path)))) {
    return false;
  }
  const stalePath = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, stalePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  await rm(stalePath, { force: true, recursive: true });
  return false;
}

async function renewLease(path: string, token: string, leaseMs: number) {
  const current = await readLeaseOwner(path);
  if (!isCurrentOwner(current, token)) {
    return false;
  }
  await writeLeaseOwner(path, currentLeaseOwner(token, leaseMs));
  return true;
}

async function releaseLease(path: string, token: string) {
  const current = await readLeaseOwner(path);
  if (!isCurrentOwner(current, token)) {
    return;
  }
  const releasePath = `${path}.release-${token}`;
  try {
    await rename(path, releasePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  await rm(releasePath, { force: true, recursive: true });
}

async function readLeaseOwner(path: string): Promise<LeaseOwner | null> {
  const raw = await readFile(join(path, "owner.json"), "utf8").catch(
    (error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  );
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!(value && typeof value === "object")) {
      return null;
    }
    const owner = value as Partial<LeaseOwner>;
    return owner.version === 1 &&
      typeof owner.token === "string" &&
      Number.isSafeInteger(owner.ownerPid) &&
      Number(owner.ownerPid) > 0 &&
      typeof owner.ownerProcessStartedAt === "string" &&
      owner.ownerProcessStartedAt.length > 0 &&
      Number.isFinite(owner.expiresAtMs)
      ? (owner as LeaseOwner)
      : null;
  } catch {
    return null;
  }
}

async function writeLeaseOwner(path: string, owner: LeaseOwner) {
  const target = join(path, "owner.json");
  const temporary = join(path, `.owner.${owner.token}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function isUninitializedLeaseStale(path: string) {
  const metadata = await stat(path).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  return Boolean(
    metadata && Date.now() - metadata.mtimeMs >= OWNER_INITIALIZATION_GRACE_MS
  );
}

function currentLeaseOwner(token: string, leaseMs: number): LeaseOwner {
  return {
    expiresAtMs: Date.now() + leaseMs,
    ownerPid: process.pid,
    ownerProcessStartedAt: PROCESS_START_IDENTITY,
    token,
    version: 1,
  };
}

function isCurrentOwner(owner: LeaseOwner | null, token: string) {
  return Boolean(
    owner &&
      owner.token === token &&
      owner.ownerPid === process.pid &&
      owner.ownerProcessStartedAt === PROCESS_START_IDENTITY
  );
}

function isLeaseOwnerStillRunning(owner: LeaseOwner) {
  if (!isProcessAlive(owner.ownerPid)) {
    return false;
  }
  const observedIdentity = readProcessStartIdentity(owner.ownerPid);
  if (
    observedIdentity?.startsWith("ps:") &&
    owner.ownerProcessStartedAt.startsWith("ps:")
  ) {
    return observedIdentity === owner.ownerProcessStartedAt;
  }
  // Correctness wins over liveness when process identity cannot be verified.
  // Stealing from a still-live owner could let an older upload continue after
  // a user has opted out. `activity health` can surface a genuinely stuck row.
  return true;
}

function readProcessStartIdentity(pid: number): string | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      windowsHide: true,
    }).trim();
    return output.length > 0 ? `ps:${output}` : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

function isNodeError(error: unknown, code: string) {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
