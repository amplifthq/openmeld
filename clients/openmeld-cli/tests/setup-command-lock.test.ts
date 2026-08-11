import { describe, expect, it, vi } from "vitest";
import {
  acquireSetupCommandLockWithTakeover,
  buildSetupLockContentionError,
  createSetupGlobalDeadline,
  handleSetupGlobalDeadlineExpiry,
  installSetupStandDownHandler,
  type SetupLockTakeoverDeps,
} from "../src/commands/setup-command-lock";
import { type OpenMeldLock, OpenMeldLockError } from "../src/config/lock";
import { LocalMachineFailureError } from "../src/system/local-machine-recovery";

const HOLDER_PID = 86_238;
const SELF_PID = 999_999;
const LOCK_META = {
  command: "openmeld setup",
  path: "delegated_or_profile_setup",
};
const TEST_LOCK: OpenMeldLock = {
  ownerId: "setup-command-test-owner",
  path: "/tmp/setup-command.lock",
};

function buildLockError(
  pid: number = HOLDER_PID,
  at = "2026-07-03T03:36:00.000Z",
  contentionState: "active" | "orphaned" | "unknown" = "active"
): OpenMeldLockError {
  return new OpenMeldLockError({
    path: "/tmp/setup-command.lock",
    key: "setup-command",
    metaRaw: JSON.stringify({ pid, command: "openmeld setup", at }),
    contentionState,
  });
}

function acquiredResult(): { lock: OpenMeldLock; ok: true } {
  return { lock: TEST_LOCK, ok: true };
}

function buildTakeoverDeps(
  overrides: Partial<SetupLockTakeoverDeps>
): Partial<SetupLockTakeoverDeps> {
  let clock = 0;
  return {
    now: () => clock,
    pollIntervalMs: 100,
    probePid: () => "alive",
    selfPid: SELF_PID,
    sendTerm: () => "sent",
    sleep: vi.fn(() => {
      clock += 100;
      return Promise.resolve();
    }),
    takeoverWindowMs: 10_000,
    ...overrides,
  };
}

describe("acquireSetupCommandLockWithTakeover", () => {
  it("returns the lock immediately when it is free", async () => {
    const sendTerm = vi.fn(() => "sent" as const);
    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({
        sendTerm,
        tryAcquire: vi.fn(async () => acquiredResult()),
      }),
    });

    expect(result.status).toBe("acquired");
    expect(sendTerm).not.toHaveBeenCalled();
  });

  it("does not take over a plain double-run that carries no start-session token", async () => {
    const sendTerm = vi.fn(() => "sent" as const);
    const probePid = vi.fn(() => "alive" as const);
    const tryAcquire = vi.fn(async () => ({
      error: buildLockError(),
      ok: false as const,
    }));

    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      deps: buildTakeoverDeps({ sendTerm, probePid, tryAcquire }),
    });

    expect(result.status).toBe("contended");
    if (result.status === "contended") {
      expect(result.takeoverAttempted).toBe(false);
      expect(result.pid).toBe(HOLDER_PID);
    }
    expect(sendTerm).not.toHaveBeenCalled();
    expect(probePid).not.toHaveBeenCalled();
    expect(tryAcquire).toHaveBeenCalledTimes(1);
  });

  it("does not signal a holder whose pid is no longer alive", async () => {
    const sendTerm = vi.fn(() => "sent" as const);
    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({
        sendTerm,
        probePid: () => "dead",
        tryAcquire: vi.fn(async () => ({
          error: buildLockError(),
          ok: false as const,
        })),
      }),
    });

    expect(result.status).toBe("contended");
    expect(sendTerm).not.toHaveBeenCalled();
  });

  it("does not signal a holder that cannot be signalled (EPERM)", async () => {
    const sendTerm = vi.fn(() => "sent" as const);
    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({
        sendTerm,
        probePid: () => "unsignalable",
        tryAcquire: vi.fn(async () => ({
          error: buildLockError(),
          ok: false as const,
        })),
      }),
    });

    expect(result.status).toBe("contended");
    expect(sendTerm).not.toHaveBeenCalled();
  });

  it("never signals its own pid", async () => {
    const sendTerm = vi.fn(() => "sent" as const);
    const probePid = vi.fn(() => "alive" as const);
    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({
        sendTerm,
        probePid,
        selfPid: HOLDER_PID,
        tryAcquire: vi.fn(async () => ({
          error: buildLockError(),
          ok: false as const,
        })),
      }),
    });

    expect(result.status).toBe("contended");
    expect(sendTerm).not.toHaveBeenCalled();
    expect(probePid).not.toHaveBeenCalled();
  });

  it("takes over a live holder that stands down within the window", async () => {
    let attempts = 0;
    const tryAcquire = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({ error: buildLockError(), ok: false as const });
      }
      return Promise.resolve(acquiredResult());
    });
    const sendTerm = vi.fn(() => "sent" as const);

    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({ sendTerm, tryAcquire }),
    });

    expect(result.status).toBe("acquired");
    expect(sendTerm).toHaveBeenCalledWith(HOLDER_PID);
  });

  it("reads the holder pid from raw meta when the parsed field is unavailable", async () => {
    const rawOnlyError = {
      code: "openmeld.locked",
      metaRaw: JSON.stringify({ pid: 4321, at: "2026-07-03T03:36:00.000Z" }),
    } as unknown as OpenMeldLockError;
    let attempts = 0;
    const tryAcquire = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({ error: rawOnlyError, ok: false as const });
      }
      return Promise.resolve(acquiredResult());
    });
    const sendTerm = vi.fn(() => "sent" as const);

    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({ sendTerm, tryAcquire }),
    });

    expect(result.status).toBe("acquired");
    expect(sendTerm).toHaveBeenCalledWith(4321);
  });

  it("falls back to contention when the holder never stands down", async () => {
    let clock = 0;
    const tryAcquire = vi.fn(async () => ({
      error: buildLockError(),
      ok: false as const,
    }));
    const sendTerm = vi.fn(() => "sent" as const);

    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: {
        now: () => clock,
        pollIntervalMs: 100,
        probePid: () => "alive",
        selfPid: SELF_PID,
        sendTerm,
        sleep: vi.fn(() => {
          clock += 4000;
          return Promise.resolve();
        }),
        takeoverWindowMs: 10_000,
        tryAcquire,
      },
    });

    expect(result.status).toBe("contended");
    if (result.status === "contended") {
      expect(result.takeoverAttempted).toBe(true);
      expect(result.pid).toBe(HOLDER_PID);
    }
    expect(sendTerm).toHaveBeenCalledTimes(1);
  });

  it("does not wait when it lacks permission to signal the holder", async () => {
    const sleep = vi.fn(async () => undefined);
    const result = await acquireSetupCommandLockWithTakeover({
      lockMeta: LOCK_META,
      startSession: "preptok_new",
      deps: buildTakeoverDeps({
        sendTerm: () => "not_permitted",
        sleep,
        tryAcquire: vi.fn(async () => ({
          error: buildLockError(),
          ok: false as const,
        })),
      }),
    });

    expect(result.status).toBe("contended");
    if (result.status === "contended") {
      expect(result.takeoverAttempted).toBe(true);
    }
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("buildSetupLockContentionError", () => {
  it("renders one actionable line without raw JSON in human view", () => {
    const error = buildSetupLockContentionError({
      view: "human",
      contention: {
        lockError: buildLockError(),
        pid: HOLDER_PID,
        startedAtLabel: "03:36",
        takeoverAttempted: false,
      },
    });

    expect(error.message).toContain("Another OpenMeld setup");
    expect(error.message).toContain("started 03:36");
    expect(error.message).toContain(`pid ${HOLDER_PID}`);
    expect(error.message).toContain(
      "Wait for the other setup to finish, then try again."
    );
    expect(error.message).not.toContain(`kill ${HOLDER_PID}`);
    expect(error.message).toContain("is still running");
    expect(error.message).not.toContain("{");
    expect(error.message).not.toContain(".lock");
    expect(error.message).not.toContain("Meta:");
  });

  it("explains a failed stand-down when takeover was attempted", () => {
    const error = buildSetupLockContentionError({
      view: "human",
      contention: {
        lockError: buildLockError(),
        pid: HOLDER_PID,
        startedAtLabel: "03:36",
        takeoverAttempted: true,
      },
    });

    expect(error.message).toContain(
      "did not stop after OpenMeld asked it to stand down"
    );
    expect(error.message).not.toContain("{");
  });

  it("maps active setup contention to the shared local computer issue", () => {
    const lockError = buildLockError();
    const error = buildSetupLockContentionError({
      view: "agent",
      contention: {
        lockError,
        pid: HOLDER_PID,
        startedAtLabel: "03:36",
        takeoverAttempted: true,
      },
    });

    expect(error).toBeInstanceOf(LocalMachineFailureError);
    expect(error).toMatchObject({
      code: "local_machine.concurrency.active",
      issue: {
        operation: "create_lock",
        recoveryPolicy: "user_action",
      },
      cause: lockError,
    });
    expect(error.message).toContain(
      "Another OpenMeld setup is already running on this computer."
    );
    expect(error.message).toContain(
      "Wait for the other setup to finish, then try again."
    );
    expect(error.message).not.toContain(`kill ${HOLDER_PID}`);
    expect(
      (error as LocalMachineFailureError).issue.diagnostics.detail
    ).toContain("Meta:");
  });

  it("gives an orphaned legacy setup lock a repair action instead of asking the user to wait", () => {
    const lockError = buildLockError(
      HOLDER_PID,
      "2026-07-03T03:36:00.000Z",
      "orphaned"
    );
    const humanError = buildSetupLockContentionError({
      view: "human",
      contention: {
        lockError,
        pid: HOLDER_PID,
        startedAtLabel: "03:36",
        takeoverAttempted: false,
      },
    });
    const agentError = buildSetupLockContentionError({
      view: "agent",
      contention: {
        lockError,
        pid: HOLDER_PID,
        startedAtLabel: "03:36",
        takeoverAttempted: false,
      },
    });

    expect(humanError.message).toContain(
      "OpenMeld found a setup lock left by an older version."
    );
    expect(humanError.message).toContain(
      "Close any other OpenMeld commands, then run `openmeld repair local-state` and try again."
    );
    expect(humanError.message).not.toContain("Wait for");
    expect(agentError).toMatchObject({
      code: "local_machine.concurrency.orphaned",
      issue: {
        recoveryPolicy: "user_action",
      },
    });
  });
});

describe("createSetupGlobalDeadline", () => {
  function fakeClock() {
    let scheduled: (() => void) | null = null;
    const clearTimer = vi.fn();
    return {
      clearTimer,
      fire: () => scheduled?.(),
      setTimer: (callback: () => void) => {
        scheduled = callback;
        return { token: "timer" };
      },
    };
  }

  it("fires onExpire once when the timer elapses", () => {
    const clock = fakeClock();
    const onExpire = vi.fn();
    const deadline = createSetupGlobalDeadline({
      clock,
      deadlineMs: 1000,
      onExpire,
    });

    deadline.arm();
    expect(onExpire).not.toHaveBeenCalled();
    clock.fire();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("arms only once", () => {
    const clock = fakeClock();
    const setTimer = vi.spyOn(clock, "setTimer");
    const deadline = createSetupGlobalDeadline({
      clock,
      deadlineMs: 1000,
      onExpire: vi.fn(),
    });

    deadline.arm();
    deadline.arm();
    expect(setTimer).toHaveBeenCalledTimes(1);
  });

  it("clears the timer when disarmed before it fires", () => {
    const clock = fakeClock();
    const onExpire = vi.fn();
    const deadline = createSetupGlobalDeadline({
      clock,
      deadlineMs: 1000,
      onExpire,
    });

    deadline.arm();
    deadline.disarm();
    expect(clock.clearTimer).toHaveBeenCalledTimes(1);
  });
});

describe("handleSetupGlobalDeadlineExpiry", () => {
  it("releases the lock before exiting and reports a support code in human view", () => {
    const order: string[] = [];
    const releaseLockSync = vi.fn(() => order.push("release"));
    const exit = vi.fn(() => order.push("exit"));
    const emitHuman = vi.fn();

    handleSetupGlobalDeadlineExpiry({
      lock: TEST_LOCK,
      view: "human",
      deadlineMs: 15 * 60 * 1000,
      emitHuman,
      exit,
      releaseLockSync,
    });

    expect(releaseLockSync).toHaveBeenCalledWith(TEST_LOCK);
    expect(emitHuman).toHaveBeenCalledWith(
      expect.stringContaining("15 minutes")
    );
    expect(emitHuman).toHaveBeenCalledWith(
      expect.stringContaining("setup.deadline_exceeded")
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(order).toEqual(["release", "exit"]);
  });

  it("emits structured deadline output in agent view", () => {
    const emitAgent = vi.fn();
    handleSetupGlobalDeadlineExpiry({
      lock: TEST_LOCK,
      view: "agent",
      deadlineMs: 15 * 60 * 1000,
      emitAgent,
      exit: vi.fn(),
      releaseLockSync: vi.fn(),
    });

    expect(emitAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        code: "setup.deadline_exceeded",
      })
    );
  });
});

describe("installSetupStandDownHandler", () => {
  it("releases the lock and exits cleanly when signalled to stand down", () => {
    const captured: Array<() => void> = [];
    const register = vi.fn((handler: () => void) => {
      captured.push(handler);
    });
    const unregister = vi.fn();
    const releaseLockSync = vi.fn();
    const emitHuman = vi.fn();
    const exit = vi.fn();

    const handle = installSetupStandDownHandler({
      lock: TEST_LOCK,
      view: "human",
      register,
      unregister,
      releaseLockSync,
      emitHuman,
      exit,
    });

    expect(register).toHaveBeenCalledTimes(1);
    captured[0]?.();
    expect(releaseLockSync).toHaveBeenCalledWith(TEST_LOCK);
    expect(emitHuman).toHaveBeenCalledWith(
      expect.stringContaining("released this computer's setup lock")
    );
    expect(exit).toHaveBeenCalledWith(0);

    handle.remove();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
