import process from "node:process";
import {
  acquireLock,
  buildOpenMeldOrphanedLockAction,
  isOpenMeldLockError,
  type OpenMeldLock,
  type OpenMeldLockError,
  type OpenMeldLockMeta,
  releaseLockSync,
  runWithHeldLock,
} from "../config/lock";
import {
  createActiveSetupConcurrencyIssue,
  createOrphanedSetupConcurrencyIssue,
  LocalMachineFailureError,
} from "../system/local-machine-recovery";
import { errLine, outJsonLine, outLine } from "../ui/io";

// Setup is single-instance per computer: only one `openmeld setup` may mutate local
// setup state at a time. The lock guards that. This module owns the contention
// policy on top of the lock primitives: bounded takeover when a deliberate new
// Web-issued command arrives, a view-aware contended message, a global setup
// deadline that guarantees exit + lock release, and a cooperative stand-down
// handler so the lock holder yields gracefully instead of being force-killed.

export const SETUP_COMMAND_LOCK_PROFILE = "setup";
export const SETUP_COMMAND_LOCK_KEY = "setup-command";

// Hard ceiling for a single `openmeld setup` invocation. Step-level waits inside the
// prepare-session executor (terminal step writes, stream settle, and the
// service gate) block on the WebSocket staying open; if Core/Web never sends a
// matching snapshot the executor pass can hang indefinitely while the outer
// reconnect loop never trips (it only reacts to socket close). This deadline is
// the coarse global backstop: on expiry setup fails cleanly, releases the lock,
// and exits so a stuck setup can never hold the single-instance lock forever.
export const SETUP_GLOBAL_DEADLINE_MS = 15 * 60 * 1000;

// A deliberate new Web-issued setup command may ask a still-running holder to
// stand down. This is the bounded window we wait for the lock to free before
// falling back to the actionable rejection.
export const SETUP_TAKEOVER_WINDOW_MS = 10_000;
const SETUP_TAKEOVER_POLL_MS = 250;

const SETUP_DEADLINE_SUPPORT_CODE = "setup.deadline_exceeded";
const SETUP_SUPERSEDED_SUPPORT_CODE = "setup.superseded";

type PidLiveness = "alive" | "dead" | "unsignalable";
type TermOutcome = "sent" | "gone" | "not_permitted";

type SetupLockContention = {
  lockError: OpenMeldLockError;
  pid: number | null;
  startedAtLabel: string | null;
  takeoverAttempted: boolean;
};

export type SetupLockAcquisition =
  | { lock: OpenMeldLock; status: "acquired" }
  | ({ status: "contended" } & SetupLockContention);

type SetupLockTryAcquireResult =
  | { lock: OpenMeldLock; ok: true }
  | { error: OpenMeldLockError; ok: false };

export type SetupLockTakeoverDeps = {
  now: () => number;
  pollIntervalMs: number;
  probePid: (pid: number) => PidLiveness;
  selfPid: number;
  sendTerm: (pid: number) => TermOutcome;
  sleep: (ms: number) => Promise<void>;
  takeoverWindowMs: number;
  tryAcquire: (meta: OpenMeldLockMeta) => Promise<SetupLockTryAcquireResult>;
};

export async function withSetupCommandLock<T>(input: {
  lockMeta: OpenMeldLockMeta;
  run: () => Promise<T>;
  startSession?: string;
  view?: string;
}): Promise<T> {
  const acquisition = await acquireSetupCommandLockWithTakeover({
    lockMeta: input.lockMeta,
    startSession: input.startSession,
  });
  if (acquisition.status === "contended") {
    throw buildSetupLockContentionError({
      contention: acquisition,
      view: input.view,
    });
  }

  const { lock } = acquisition;
  const standDown = installSetupStandDownHandler({ lock, view: input.view });
  const deadline = createSetupGlobalDeadline({
    onExpire: () => handleSetupGlobalDeadlineExpiry({ lock, view: input.view }),
  });
  deadline.arm();

  try {
    return await runWithHeldLock({
      lock,
      run: input.run,
      releaseContext: {
        openMeldProfileId: SETUP_COMMAND_LOCK_PROFILE,
        component: "setup_command",
        lockKey: SETUP_COMMAND_LOCK_KEY,
      },
    });
  } finally {
    deadline.disarm();
    standDown.remove();
  }
}

export async function acquireSetupCommandLockWithTakeover(input: {
  deps?: Partial<SetupLockTakeoverDeps>;
  lockMeta: OpenMeldLockMeta;
  startSession?: string;
}): Promise<SetupLockAcquisition> {
  const deps: SetupLockTakeoverDeps = {
    ...defaultTakeoverDeps(),
    ...input.deps,
  };

  const first = await deps.tryAcquire(input.lockMeta);
  if (first.ok) {
    return { lock: first.lock, status: "acquired" };
  }

  const lockError = first.error;
  const pid = resolveLockHolderPid(lockError);
  const startedAtLabel = resolveLockStartedAtLabel(lockError);
  const contendedBase = { lockError, pid, startedAtLabel };

  // Only a deliberate new Web-issued command (carrying a start-session token)
  // may take over a live holder. A plain `openmeld setup` double-run is far more
  // likely an accidental second window, so it must not disturb the first.
  const carriesToken = normalizeOptionalString(input.startSession) !== null;
  if (
    !(
      carriesToken &&
      pid !== null &&
      pid !== deps.selfPid &&
      deps.probePid(pid) === "alive"
    )
  ) {
    return {
      status: "contended",
      ...contendedBase,
      takeoverAttempted: false,
    };
  }

  // Never SIGKILL: the holder may be mid lifecycle change. SIGTERM lets it run
  // its stand-down handler (or, on older builds, terminate so the lock's
  // stale-pid recovery can reclaim the file). We then wait a bounded window.
  const term = deps.sendTerm(pid);
  if (term === "not_permitted") {
    return {
      status: "contended",
      ...contendedBase,
      takeoverAttempted: true,
    };
  }

  let lastError = lockError;
  const until = deps.now() + deps.takeoverWindowMs;
  while (deps.now() < until) {
    const retry = await deps.tryAcquire(input.lockMeta);
    if (retry.ok) {
      return { lock: retry.lock, status: "acquired" };
    }
    lastError = retry.error;
    await deps.sleep(deps.pollIntervalMs);
  }

  const finalTry = await deps.tryAcquire(input.lockMeta);
  if (finalTry.ok) {
    return { lock: finalTry.lock, status: "acquired" };
  }

  return {
    status: "contended",
    lockError: finalTry.ok ? lastError : finalTry.error,
    pid,
    startedAtLabel,
    takeoverAttempted: true,
  };
}

export function buildSetupLockContentionError(input: {
  contention: SetupLockContention;
  view?: string;
}): Error {
  if (input.contention.lockError.contentionState === "orphaned") {
    const primaryAction = buildOrphanedSetupLockAction();
    if (input.view === "agent") {
      return new LocalMachineFailureError({
        issue: createOrphanedSetupConcurrencyIssue({
          detail: input.contention.lockError.message,
          primaryAction,
        }),
        cause: input.contention.lockError,
      });
    }
    return new Error(
      `OpenMeld found a setup lock left by an older version. ${primaryAction}`
    );
  }

  // Agent View keeps the full structured lock diagnostics (path + raw meta).
  if (input.view === "agent") {
    return new LocalMachineFailureError({
      issue: createActiveSetupConcurrencyIssue({
        detail: input.contention.lockError.message,
        primaryAction: buildHumanSetupLockAction(),
      }),
      cause: input.contention.lockError,
    });
  }
  return new Error(buildHumanSetupLockLine(input.contention));
}

function buildHumanSetupLockLine(contention: SetupLockContention): string {
  const descriptorParts: string[] = [];
  if (contention.startedAtLabel) {
    descriptorParts.push(`started ${contention.startedAtLabel}`);
  }
  if (contention.pid !== null) {
    descriptorParts.push(`pid ${contention.pid}`);
  }
  const descriptor =
    descriptorParts.length > 0 ? ` (${descriptorParts.join(", ")})` : "";
  const state = contention.takeoverAttempted
    ? "did not stop after OpenMeld asked it to stand down"
    : "is still running";
  return `Another OpenMeld setup${descriptor} ${state} on this computer. ${buildHumanSetupLockAction()}`;
}

function buildHumanSetupLockAction(): string {
  return "Wait for the other setup to finish, then try again.";
}

function buildOrphanedSetupLockAction(): string {
  return buildOpenMeldOrphanedLockAction();
}

export function createSetupGlobalDeadline(input: {
  clock?: DeadlineClock;
  deadlineMs?: number;
  onExpire: () => void;
}): { arm(): void; disarm(): void } {
  const clock = input.clock ?? realDeadlineClock;
  const deadlineMs = input.deadlineMs ?? SETUP_GLOBAL_DEADLINE_MS;
  let handle: DeadlineTimerHandle | null = null;
  return {
    arm() {
      if (handle !== null) {
        return;
      }
      handle = clock.setTimer(() => {
        handle = null;
        input.onExpire();
      }, deadlineMs);
    },
    disarm() {
      if (handle === null) {
        return;
      }
      clock.clearTimer(handle);
      handle = null;
    },
  };
}

export function handleSetupGlobalDeadlineExpiry(input: {
  deadlineMs?: number;
  emitAgent?: (payload: Record<string, unknown>) => void;
  emitHuman?: (line: string) => void;
  exit?: (code: number) => void;
  lock: OpenMeldLock;
  releaseLockSync?: (lock: OpenMeldLock) => void;
  view?: string;
}): void {
  const deadlineMs = input.deadlineMs ?? SETUP_GLOBAL_DEADLINE_MS;
  const minutes = Math.max(1, Math.round(deadlineMs / 60_000));
  const message = `OpenMeld setup did not finish within ${minutes} minutes on this computer and was stopped. This computer's setup lock has been released. Return to OpenMeld Web to see the current connection state and recovery action.`;

  // Release the lock file before exiting: the run promise stays pending (it is
  // hung), so runWithHeldLock's cleanup never runs. Releasing here is what
  // guarantees the single-instance lock is freed for the next attempt.
  runSafely(() => (input.releaseLockSync ?? releaseLockSync)(input.lock));
  runSafely(() => {
    if (input.view === "agent") {
      (input.emitAgent ?? defaultEmitAgent)({
        code: SETUP_DEADLINE_SUPPORT_CODE,
        message,
        type: "error",
      });
      return;
    }
    (input.emitHuman ?? defaultEmitErrorLine)(
      `error: ${message} (support code: ${SETUP_DEADLINE_SUPPORT_CODE})`
    );
  });
  (input.exit ?? defaultExit)(1);
}

export function installSetupStandDownHandler(input: {
  emitAgent?: (payload: Record<string, unknown>) => void;
  emitHuman?: (line: string) => void;
  exit?: (code: number) => void;
  lock: OpenMeldLock;
  register?: (handler: () => void) => void;
  releaseLockSync?: (lock: OpenMeldLock) => void;
  unregister?: (handler: () => void) => void;
  view?: string;
}): { remove(): void } {
  const message =
    "OpenMeld setup was asked to stop and has released this computer's setup lock. You can close this window.";
  const handler = (): void => {
    runSafely(() => (input.releaseLockSync ?? releaseLockSync)(input.lock));
    runSafely(() => {
      if (input.view === "agent") {
        (input.emitAgent ?? defaultEmitAgent)({
          code: SETUP_SUPERSEDED_SUPPORT_CODE,
          message,
          type: "info",
        });
        return;
      }
      (input.emitHuman ?? defaultEmitOutLine)(message);
    });
    (input.exit ?? defaultExit)(0);
  };
  const register =
    input.register ?? ((h: () => void) => process.once("SIGTERM", h));
  const unregister =
    input.unregister ??
    ((h: () => void) => {
      process.removeListener("SIGTERM", h);
    });
  register(handler);
  return {
    remove() {
      unregister(handler);
    },
  };
}

type DeadlineTimerHandle = unknown;

type DeadlineClock = {
  clearTimer(handle: DeadlineTimerHandle): void;
  setTimer(callback: () => void, ms: number): DeadlineTimerHandle;
};

const realDeadlineClock: DeadlineClock = {
  clearTimer: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
  // Deliberately not unref'd: the watchdog keeps the loop alive until it either
  // fires or is cleared, so it reliably trips on any hang shape (including a
  // stalled promise with no other pending I/O). It is always cleared on normal
  // completion or failure via withSetupCommandLock's finally.
  setTimer: (callback, ms) => setTimeout(callback, ms),
};

function defaultTakeoverDeps(): SetupLockTakeoverDeps {
  return {
    now: () => Date.now(),
    pollIntervalMs: SETUP_TAKEOVER_POLL_MS,
    probePid: defaultProbePid,
    selfPid: process.pid,
    sendTerm: defaultSendTerm,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    takeoverWindowMs: SETUP_TAKEOVER_WINDOW_MS,
    tryAcquire: defaultTryAcquireSetupLock,
  };
}

async function defaultTryAcquireSetupLock(
  meta: OpenMeldLockMeta
): Promise<SetupLockTryAcquireResult> {
  try {
    const lock = await acquireLock({
      openMeldProfileId: SETUP_COMMAND_LOCK_PROFILE,
      key: SETUP_COMMAND_LOCK_KEY,
      meta,
    });
    return { lock, ok: true };
  } catch (error) {
    if (isOpenMeldLockError(error)) {
      return { error, ok: false };
    }
    throw error;
  }
}

function defaultProbePid(pid: number): PidLiveness {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return getErrorCode(error) === "ESRCH" ? "dead" : "unsignalable";
  }
}

function defaultSendTerm(pid: number): TermOutcome {
  try {
    process.kill(pid, "SIGTERM");
    return "sent";
  } catch (error) {
    return getErrorCode(error) === "ESRCH" ? "gone" : "not_permitted";
  }
}

function defaultEmitAgent(payload: Record<string, unknown>): void {
  outJsonLine(payload);
}

function defaultEmitErrorLine(line: string): void {
  errLine(line);
}

function defaultEmitOutLine(line: string): void {
  outLine(line);
}

function defaultExit(code: number): void {
  process.exit(code);
}

function runSafely(action: () => void): void {
  try {
    action();
  } catch {
    // Best-effort: the forced-exit paths must not throw before releasing the
    // lock or exiting.
  }
}

function resolveLockHolderPid(error: OpenMeldLockError): number | null {
  const fromMeta = readPidValue(error.meta);
  if (fromMeta !== null) {
    return fromMeta;
  }
  return readPidValue(safeParseJson(error.metaRaw));
}

function resolveLockStartedAtLabel(error: OpenMeldLockError): string | null {
  const at =
    readStringValue(error.meta, "at") ??
    readStringValue(safeParseJson(error.metaRaw), "at");
  if (!at) {
    return null;
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function readPidValue(source: unknown): number | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const pid = (source as { pid?: unknown }).pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0
    ? pid
    : null;
}

function readStringValue(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeParseJson(value: string | null): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
