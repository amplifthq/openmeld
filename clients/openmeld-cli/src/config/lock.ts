import { randomUUID } from "node:crypto";
import { rmdirSync, unlinkSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { LocalMachineIssue } from "@openmeld/schemas";
import {
  createOrphanedLocalConcurrencyIssue,
  toRecognizedLocalMachineFailureError,
} from "../system/local-machine-recovery";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isProcessIdentityAlive,
  readProcessStartIdentity,
} from "../system/process-identity";
import { resolveOpenMeldLaneDescriptor } from "./openmeld-lane-descriptor";
import {
  normalizeOpenMeldProfileId,
  type OpenMeldPathResolutionInput,
  locksDir as resolveLocksDir,
  runtimeDir as resolveRuntimeDir,
} from "./paths";
import { resolveCliContextId } from "./session-profile";

export type OpenMeldLock = {
  ownerId: string;
  path: string;
};

export type OpenMeldLockMeta = Record<string, unknown>;
export type OpenMeldLockContentionState = "active" | "orphaned" | "unknown";
export type OpenMeldLegacyLockRepairReport = {
  removedOrphanedLegacyLocks: number;
};
type HeldLockReleaseContext = Record<string, unknown>;
const MALFORMED_LOCK_RECOVERY_GRACE_MS = 30_000;
const OPENMELD_ORPHANED_LOCK_SUMMARY =
  "OpenMeld found a local command lock left by an older version.";

export class OpenMeldLockError extends Error {
  readonly code = "openmeld.locked";
  readonly lockPath: string;
  readonly lockKey: string;
  readonly metaRaw: string | null;
  readonly meta: OpenMeldLockMeta | null;
  readonly contentionState: OpenMeldLockContentionState;

  constructor(input: {
    path: string;
    key: string;
    metaRaw?: string;
    contentionState?: OpenMeldLockContentionState;
  }) {
    const normalizedMetaRaw = normalizeMetaRaw(input.metaRaw);
    const contentionState = input.contentionState ?? "unknown";
    super(
      buildOpenMeldLockErrorMessage(
        input.path,
        normalizedMetaRaw,
        contentionState
      )
    );
    this.name = "OpenMeldLockError";
    this.lockPath = input.path;
    this.lockKey = input.key;
    this.metaRaw = normalizedMetaRaw;
    this.meta = parseOpenMeldLockMeta(normalizedMetaRaw);
    this.contentionState = contentionState;
  }
}

export function isOpenMeldLockError(
  error: unknown
): error is OpenMeldLockError {
  return error instanceof OpenMeldLockError;
}

export function isOpenMeldOrphanedLockError(
  error: unknown
): error is OpenMeldLockError {
  return isOpenMeldLockError(error) && error.contentionState === "orphaned";
}

export function resolveOpenMeldOrphanedLockIssue(
  error: unknown
): LocalMachineIssue | null {
  if (!isOpenMeldOrphanedLockError(error)) {
    return null;
  }
  return createOrphanedLocalConcurrencyIssue({
    summary: OPENMELD_ORPHANED_LOCK_SUMMARY,
    primaryAction: buildOpenMeldOrphanedLockAction(),
    detail: error.message,
  });
}

export function buildOpenMeldOrphanedLockAction(): string {
  const repairCommand = resolveOpenMeldLaneDescriptor().repairCommand;
  return `Close any other OpenMeld commands, then run \`${repairCommand}\` and try again.`;
}

export async function acquireLock(input: {
  openMeldProfileId: string;
  key: string;
  meta?: OpenMeldLockMeta;
  pathResolution?: OpenMeldPathResolutionInput;
}): Promise<OpenMeldLock> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const sessionId = resolveCliContextId();
  const dir = resolveLocksDir(openMeldProfileId, input.pathResolution);
  const path = resolveLockPath({
    openMeldProfileId,
    key: input.key,
    pathResolution: input.pathResolution,
  });
  const ownerId = randomUUID();
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    throwRecognizedLocalMachineFailure({
      operation: "create_lock",
      error,
    });
  }

  // A directory is the atomic ownership boundary. Its owner-specific entry
  // lets release remove only the lock it acquired, even if another process
  // publishes a replacement at the same canonical path.
  for (let attempt = 0; attempt < 2; attempt++) {
    const contents = `${JSON.stringify({
      ...(input.meta ? { ...input.meta } : {}),
      pid: process.pid,
      ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
      openMeldProfileId,
      ...(sessionId ? { sessionId } : {}),
      at: new Date().toISOString(),
      ownerId,
    })}\n`;
    let published: boolean;
    try {
      published = await tryPublishLock(path, ownerId, contents);
    } catch (error) {
      throwRecognizedLocalMachineFailure({
        operation: "create_lock",
        error,
      });
    }
    if (published) {
      return { ownerId, path };
    }

    try {
      const existingLock = await readLockSnapshot(path);
      if (
        !existingLock.exists ||
        (await tryCleanupStaleLockPath(path, existingLock))
      ) {
        continue;
      }

      throw new OpenMeldLockError({
        path,
        key: input.key,
        metaRaw: existingLock.metaRaw ?? undefined,
        contentionState: resolveLockContentionState(existingLock),
      });
    } catch (error) {
      if (isOpenMeldLockError(error)) {
        throw error;
      }
      throwRecognizedLocalMachineFailure({
        operation: "create_lock",
        error,
      });
    }
  }

  throw new OpenMeldLockError({
    path,
    key: input.key,
  });
}

export async function releaseLock(lock: OpenMeldLock): Promise<void> {
  const removedOwnerEntry = await unlinkOwnedDirectoryEntry(lock);
  if (!removedOwnerEntry) {
    return;
  }
  await rmdir(lock.path).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY"].includes(getErrorCode(error) ?? "")) {
      throw error;
    }
  });
}

/** Attach a waiting native process before granting it permission to exec. */
export async function attachLockProcess(
  lock: OpenMeldLock,
  pid: number
): Promise<OpenMeldLock> {
  const ownerProcessStartedAt = readProcessStartIdentity(pid);
  if (!ownerProcessStartedAt?.startsWith("ps:")) {
    throw new Error("Cannot establish native command process identity.");
  }
  const parent = await open(
    resolveOwnerEntryPath(lock.path, lock.ownerId),
    "r"
  );
  try {
    const meta = parseOpenMeldLockMeta(await parent.readFile("utf8"));
    if (
      meta?.ownerId !== lock.ownerId ||
      meta.pid !== process.pid ||
      meta.ownerProcessStartedAt !== CURRENT_PROCESS_START_IDENTITY
    ) {
      throw new Error("Native command does not own the lifecycle lock.");
    }
    const participant = { path: lock.path, ownerId: randomUUID() };
    const contents = `${JSON.stringify({
      ownerId: participant.ownerId,
      parentOwnerId: lock.ownerId,
      pid,
      ownerProcessStartedAt,
      at: new Date().toISOString(),
    })}\n`;
    await writeFile(
      resolveOwnerEntryPath(lock.path, participant.ownerId),
      contents,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      }
    );
    // A failed attachment must never grant execution. Keep its entry until
    // the waiting process exits; subsequent recovery proves that identity dead.
    const snapshot = await readLockSnapshot(lock.path);
    if (
      readProcessStartIdentity(pid) !== ownerProcessStartedAt ||
      !(snapshot.ownerEntryNames ?? [snapshot.ownerEntryName]).includes(
        `${encodeURIComponent(participant.ownerId)}.owner.json`
      )
    ) {
      throw new Error(
        "Native command lifecycle attachment could not be verified."
      );
    }
    return participant;
  } finally {
    await parent.close();
  }
}

export function releaseLockSync(lock: OpenMeldLock): void {
  try {
    unlinkSync(resolveOwnerEntryPath(lock.path, lock.ownerId));
  } catch (error) {
    if (getErrorCode(error) === "ENOENT" || getErrorCode(error) === "ENOTDIR") {
      return;
    }
    throw error;
  }

  try {
    rmdirSync(lock.path);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function runWithCleanupPreservingRunError<T>(input: {
  run: () => Promise<T>;
  cleanup: () => Promise<void>;
  onCleanupErrorAfterRunFailure?: (cleanupError: unknown) => void;
}): Promise<T> {
  let runResult: T | undefined;
  let runSucceeded = false;
  let runError: unknown;

  try {
    runResult = await input.run();
    runSucceeded = true;
  } catch (error) {
    runError = error;
  }

  try {
    await input.cleanup();
  } catch (cleanupError) {
    if (!runSucceeded) {
      input.onCleanupErrorAfterRunFailure?.(cleanupError);
      throw runError;
    }
    throw cleanupError;
  }

  if (!runSucceeded) {
    throw runError;
  }

  return runResult as T;
}

export async function runWithHeldLock<T>(input: {
  lock: OpenMeldLock;
  run: () => Promise<T>;
  releaseContext?: HeldLockReleaseContext;
}): Promise<T> {
  return await runWithCleanupPreservingRunError({
    run: input.run,
    cleanup: () => releaseLock(input.lock),
    onCleanupErrorAfterRunFailure: (releaseError) => {
      warnLockReleaseFailure({
        error: releaseError,
        lock: input.lock,
        releaseContext: input.releaseContext,
      });
    },
  });
}

export async function readLockMeta(input: {
  openMeldProfileId: string;
  key: string;
  pathResolution?: OpenMeldPathResolutionInput;
}): Promise<OpenMeldLockMeta | null> {
  const existingLock = await readLockSnapshot(
    resolveLockPath({
      openMeldProfileId: input.openMeldProfileId,
      key: input.key,
      pathResolution: input.pathResolution,
    })
  );
  return existingLock.meta;
}

export async function tryCleanupStaleLock(input: {
  openMeldProfileId: string;
  key: string;
  pathResolution?: OpenMeldPathResolutionInput;
}): Promise<boolean> {
  return await tryCleanupStaleLockPath(
    resolveLockPath({
      openMeldProfileId: input.openMeldProfileId,
      key: input.key,
      pathResolution: input.pathResolution,
    })
  );
}

export async function repairOrphanedLegacyLock(input: {
  openMeldProfileId: string;
  key: string;
}): Promise<boolean> {
  const path = resolveLockPath({
    openMeldProfileId: input.openMeldProfileId,
    key: input.key,
  });
  return await repairOrphanedLegacyLockPath(path);
}

export async function repairOrphanedLegacyLocks(): Promise<OpenMeldLegacyLockRepairReport> {
  const locksRootPath = join(resolveRuntimeDir(), "locks");
  const profileEntries = await readDirectoryEntries(locksRootPath);
  let removedOrphanedLegacyLocks = 0;

  for (const profileEntry of profileEntries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!profileEntry.isDirectory()) {
      continue;
    }
    const profileLocksPath = join(locksRootPath, profileEntry.name);
    const lockEntries = await readDirectoryEntries(profileLocksPath);
    for (const lockEntry of lockEntries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!(lockEntry.isFile() && lockEntry.name.endsWith(".lock"))) {
        continue;
      }
      if (
        await repairOrphanedLegacyLockPath(
          join(profileLocksPath, lockEntry.name)
        )
      ) {
        removedOrphanedLegacyLocks += 1;
      }
    }
  }

  return { removedOrphanedLegacyLocks };
}

async function repairOrphanedLegacyLockPath(path: string): Promise<boolean> {
  const firstSnapshot = await readLockSnapshot(path);
  if (
    firstSnapshot.storageKind !== "legacy_file" ||
    !isRecoverableStaleLock(firstSnapshot)
  ) {
    return false;
  }

  const confirmedSnapshot = await readLockSnapshot(path);
  if (!isSameRecoverableLockSnapshot(firstSnapshot, confirmedSnapshot)) {
    return false;
  }

  try {
    // Ordinary lock acquisition never unlinks legacy files because an older
    // client may replace one concurrently. This path is reserved for the
    // explicit local-state repair action after the user has closed other
    // OpenMeld commands that could publish a legacy lock at this path.
    await unlink(path);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT" || getErrorCode(error) === "EISDIR") {
      return false;
    }
    throw error;
  }
}

async function readDirectoryEntries(path: string) {
  return await readdir(path, { withFileTypes: true }).catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  });
}

type LockSnapshot = {
  exists: boolean;
  fileIdentity: string | null;
  ownerEntryName: string | null;
  ownerEntryNames?: string[];
  modifiedAtMs: number | null;
  metaRaw: string | null;
  meta: OpenMeldLockMeta | null;
  pid: number | null;
  hasStaleOwner: boolean;
  storageKind: "directory" | "legacy_file" | null;
};

function resolveLockPath(input: {
  openMeldProfileId: string;
  key: string;
  pathResolution?: OpenMeldPathResolutionInput;
}): string {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  return join(
    resolveLocksDir(openMeldProfileId, input.pathResolution),
    `${sanitizeFilename(input.key)}.lock`
  );
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeMetaRaw(metaRaw: string | undefined): string | null {
  if (typeof metaRaw !== "string") {
    return null;
  }
  const normalized = metaRaw.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOpenMeldLockMeta(
  metaRaw: string | null
): OpenMeldLockMeta | null {
  if (!metaRaw) {
    return null;
  }
  const parsed = safeParse(metaRaw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed as OpenMeldLockMeta;
}

function buildOpenMeldLockErrorMessage(
  path: string,
  metaRaw: string | null,
  contentionState: OpenMeldLockContentionState
): string {
  const lockDetail = metaRaw
    ? `space is locked (${path}). Meta: ${metaRaw}`
    : `space is locked (${path})`;
  if (contentionState !== "orphaned") {
    return lockDetail;
  }
  return `${lockDetail}. ${OPENMELD_ORPHANED_LOCK_SUMMARY} ${buildOpenMeldOrphanedLockAction()}`;
}

function getPidFromMeta(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const pid = (meta as Record<string, unknown>).pid;
  return typeof pid === "number" ? pid : null;
}

function missingLockSnapshot(): LockSnapshot {
  return {
    exists: false,
    fileIdentity: null,
    ownerEntryName: null,
    modifiedAtMs: null,
    metaRaw: null,
    meta: null,
    pid: null,
    hasStaleOwner: false,
    storageKind: null,
  };
}

async function readLockSnapshot(
  path: string,
  remainingRaceRetries = 2
): Promise<LockSnapshot> {
  const pathStats = await lstat(path).catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!pathStats) {
    return missingLockSnapshot();
  }

  if (pathStats.isDirectory()) {
    try {
      return await readDirectoryLockSnapshot(path, pathStats);
    } catch (error) {
      if (
        remainingRaceRetries > 0 &&
        (getErrorCode(error) === "ENOENT" || getErrorCode(error) === "ENOTDIR")
      ) {
        return await readLockSnapshot(path, remainingRaceRetries - 1);
      }
      throw error;
    }
  }

  const handle = await open(path, "r").catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    if (remainingRaceRetries > 0 && getErrorCode(error) === "EISDIR") {
      return "retry" as const;
    }
    throw error;
  });
  if (handle === "retry") {
    return await readLockSnapshot(path, remainingRaceRetries - 1);
  }
  if (!handle) {
    return missingLockSnapshot();
  }

  try {
    const [metaRaw, stats] = await Promise.all([
      handle.readFile("utf8"),
      handle.stat(),
    ]);
    const normalizedMetaRaw = normalizeMetaRaw(metaRaw);
    const meta = parseOpenMeldLockMeta(normalizedMetaRaw);
    const pid = getPidFromMeta(meta);
    return {
      exists: true,
      fileIdentity: `${stats.dev}:${stats.ino}:${stats.mtimeMs}:${stats.size}`,
      ownerEntryName: null,
      modifiedAtMs: stats.mtimeMs,
      metaRaw: normalizedMetaRaw,
      meta,
      pid,
      hasStaleOwner: isLockOwnerStale({ meta, pid }),
      storageKind: "legacy_file",
    };
  } finally {
    await handle.close();
  }
}

async function readDirectoryLockSnapshot(
  path: string,
  pathStats: Awaited<ReturnType<typeof lstat>>,
  selectedEntry?: string
): Promise<LockSnapshot> {
  const ownerEntries = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".owner.json"))
    .map((entry) => entry.name)
    .sort();
  const ownerEntryName =
    selectedEntry ?? (ownerEntries.length === 1 ? ownerEntries[0] : null);
  const directoryIdentity = `${pathStats.dev}:${pathStats.ino}:${pathStats.mtimeMs}`;

  if (!selectedEntry && ownerEntries.length > 1) {
    const snapshots = await Promise.all(
      ownerEntries.map((entry) =>
        readDirectoryLockSnapshot(path, pathStats, entry)
      )
    );
    const recognized = snapshots.every(
      (snapshot) =>
        typeof snapshot.meta?.ownerId === "string" &&
        snapshot.ownerEntryName ===
          `${encodeURIComponent(snapshot.meta.ownerId)}.owner.json` &&
        typeof snapshot.meta.ownerProcessStartedAt === "string" &&
        snapshot.meta.ownerProcessStartedAt.startsWith("ps:") &&
        snapshot.pid !== null
    );
    return {
      exists: true,
      fileIdentity: snapshots
        .map((snapshot) => snapshot.fileIdentity)
        .join("|"),
      ownerEntryName: null,
      ownerEntryNames: recognized ? ownerEntries : undefined,
      modifiedAtMs: Number(pathStats.mtimeMs),
      metaRaw: null,
      meta: null,
      pid: recognized ? (snapshots[0]?.pid ?? null) : null,
      hasStaleOwner:
        recognized && snapshots.every((snapshot) => snapshot.hasStaleOwner),
      storageKind: "directory",
    };
  }

  if (!ownerEntryName) {
    return {
      exists: true,
      fileIdentity: `${directoryIdentity}:empty-or-malformed`,
      ownerEntryName: null,
      modifiedAtMs: Number(pathStats.mtimeMs),
      metaRaw: null,
      meta: null,
      pid: null,
      hasStaleOwner: false,
      storageKind: "directory",
    };
  }

  const ownerEntryPath = join(path, ownerEntryName);
  const handle = await open(ownerEntryPath, "r");
  try {
    const [metaRaw, stats] = await Promise.all([
      handle.readFile("utf8"),
      handle.stat(),
    ]);
    const normalizedMetaRaw = normalizeMetaRaw(metaRaw);
    const meta = parseOpenMeldLockMeta(normalizedMetaRaw);
    const pid = getPidFromMeta(meta);
    return {
      exists: true,
      fileIdentity: `${directoryIdentity}:${ownerEntryName}:${stats.dev}:${stats.ino}:${stats.mtimeMs}:${stats.size}`,
      ownerEntryName,
      modifiedAtMs: stats.mtimeMs,
      metaRaw: normalizedMetaRaw,
      meta,
      pid,
      hasStaleOwner: isLockOwnerStale({ meta, pid }),
      storageKind: "directory",
    };
  } finally {
    await handle.close();
  }
}

async function tryCleanupStaleLockPath(
  path: string,
  initialSnapshot?: LockSnapshot
): Promise<boolean> {
  const firstSnapshot = initialSnapshot ?? (await readLockSnapshot(path));

  if (!isRecoverableStaleLock(firstSnapshot)) {
    return false;
  }

  // A legacy client can replace a stale file lock with a live file lock at the
  // same path between inspection and unlink. Without owner-scoped storage,
  // cleanup cannot prove that it is removing the same owner, so fail closed
  // throughout the mixed-version rollout.
  if (firstSnapshot.storageKind === "legacy_file") {
    return false;
  }

  const confirmedSnapshot = await readLockSnapshot(path);
  if (!isSameRecoverableLockSnapshot(firstSnapshot, confirmedSnapshot)) {
    return false;
  }

  if (confirmedSnapshot.storageKind === "directory") {
    return await cleanupStaleDirectoryLock(path, confirmedSnapshot);
  }

  return false;
}

function isSameRecoverableLockSnapshot(
  firstSnapshot: LockSnapshot,
  confirmedSnapshot: LockSnapshot
): boolean {
  return (
    confirmedSnapshot.exists &&
    confirmedSnapshot.fileIdentity === firstSnapshot.fileIdentity &&
    confirmedSnapshot.ownerEntryName === firstSnapshot.ownerEntryName &&
    confirmedSnapshot.metaRaw === firstSnapshot.metaRaw &&
    confirmedSnapshot.pid === firstSnapshot.pid &&
    confirmedSnapshot.storageKind === firstSnapshot.storageKind &&
    isRecoverableStaleLock(confirmedSnapshot)
  );
}

function resolveLockContentionState(
  snapshot: LockSnapshot
): OpenMeldLockContentionState {
  if (
    snapshot.storageKind === "legacy_file" &&
    isRecoverableStaleLock(snapshot)
  ) {
    return "orphaned";
  }
  if (
    snapshot.storageKind !== null &&
    (snapshot.pid === null || !snapshot.hasStaleOwner)
  ) {
    return "active";
  }
  return "unknown";
}

async function cleanupStaleDirectoryLock(
  path: string,
  snapshot: LockSnapshot
): Promise<boolean> {
  for (const entry of snapshot.ownerEntryNames ??
    (snapshot.ownerEntryName ? [snapshot.ownerEntryName] : [])) {
    try {
      await unlink(join(path, entry));
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    }
  }
  try {
    await rmdir(path);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return true;
    }
    if (getErrorCode(error) === "ENOTEMPTY") {
      return false;
    }
    throw error;
  }
}

async function tryPublishLock(
  path: string,
  ownerId: string,
  contents: string
): Promise<boolean> {
  try {
    await mkdir(path);
  } catch (error) {
    if (getErrorCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }

  const ownerEntryPath = resolveOwnerEntryPath(path, ownerId);
  try {
    await writeFile(ownerEntryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    await unlink(ownerEntryPath).catch((cleanupError) => {
      if (getErrorCode(cleanupError) !== "ENOENT") {
        console.warn("[openmeld.lock.owner_entry_cleanup_warning]", {
          ownerEntryPath,
          cleanupError: toErrorMessage(cleanupError),
        });
      }
    });
    await rmdir(path).catch((cleanupError) => {
      if (getErrorCode(cleanupError) !== "ENOENT") {
        console.warn("[openmeld.lock.directory_cleanup_warning]", {
          lockPath: path,
          cleanupError: toErrorMessage(cleanupError),
        });
      }
    });
    throw error;
  }
}

async function unlinkOwnedDirectoryEntry(lock: OpenMeldLock): Promise<boolean> {
  try {
    await unlink(resolveOwnerEntryPath(lock.path, lock.ownerId));
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT" || getErrorCode(error) === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function resolveOwnerEntryPath(path: string, ownerId: string): string {
  return join(path, `${encodeURIComponent(ownerId)}.owner.json`);
}

function isRecoverableStaleLock(snapshot: LockSnapshot): boolean {
  if (!snapshot.exists) {
    return false;
  }
  if (snapshot.pid !== null) {
    return snapshot.hasStaleOwner;
  }
  return (
    snapshot.modifiedAtMs !== null &&
    Date.now() - snapshot.modifiedAtMs >= MALFORMED_LOCK_RECOVERY_GRACE_MS
  );
}

function isLockOwnerStale(input: {
  meta: OpenMeldLockMeta | null;
  pid: number | null;
}): boolean {
  if (input.pid === null) {
    return false;
  }
  const ownerProcessStartedAt = getProcessStartIdentityFromMeta(input.meta);
  if (!ownerProcessStartedAt) {
    // Locks from older clients do not carry process-start identity. Keep them
    // while their PID is live, but preserve the existing dead-PID recovery.
    return !isPidAlive(input.pid);
  }
  return !isProcessIdentityAlive({
    ownerPid: input.pid,
    ownerProcessStartedAt,
  });
}

function getProcessStartIdentityFromMeta(meta: unknown): string | null {
  if (!(meta && typeof meta === "object")) {
    return null;
  }
  const value = (meta as Record<string, unknown>).ownerProcessStartedAt;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (getErrorCode(err) === "ESRCH") {
      return false;
    }
    return true;
  }
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function throwRecognizedLocalMachineFailure(input: {
  operation: "create_lock";
  error: unknown;
}): never {
  const recognizedFailure = toRecognizedLocalMachineFailureError(input);
  throw recognizedFailure ?? input.error;
}

function warnLockReleaseFailure(input: {
  error: unknown;
  lock: OpenMeldLock;
  releaseContext?: HeldLockReleaseContext;
}): void {
  console.warn("[openmeld.lock.release.warning]", {
    lockPath: input.lock.path,
    releaseError: toErrorMessage(input.error),
    releaseContext: input.releaseContext ?? {},
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
