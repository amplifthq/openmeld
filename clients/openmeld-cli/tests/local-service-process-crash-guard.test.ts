import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  installDaemonProcessCrashGuard,
  recordDaemonProcessCrash,
} from "../src/local-service/lifecycle/daemon-process-crash-guard";

type CrashGuardOptions = NonNullable<
  Parameters<typeof installDaemonProcessCrashGuard>[0]
>;
type CrashGuardProcess = NonNullable<CrashGuardOptions["process"]>;

describe("daemon process crash guard", () => {
  it("records the crash cause and clears stale runtime state", async () => {
    const emitLifecycleEvent = vi.fn(async () => undefined);
    const clearRuntimeState = vi.fn(async () => undefined);
    const crash = new Error("ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC");
    crash.name = "TLSSocketError";

    await recordDaemonProcessCrash({
      clearRuntimeState,
      emitLifecycleEvent,
      event: "uncaughtException",
      reason: crash,
    });

    expect(emitLifecycleEvent).toHaveBeenCalledWith({
      type: "daemon.crash",
      result: "failed",
      metadata: expect.objectContaining({
        errorMessage: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
        errorName: "TLSSocketError",
        event: "uncaughtException",
      }),
      command: "openmeld service run",
      intent: "run_background",
    });
    expect(clearRuntimeState).toHaveBeenCalledTimes(1);
  });

  it("turns a process-level socket error into journal evidence before non-zero exit", async () => {
    const processEvents = new EventEmitter();
    const fakeProcess: CrashGuardProcess = {
      off: (eventName, listener) => {
        processEvents.off(eventName, listener);
        return fakeProcess;
      },
      on: (eventName, listener) => {
        processEvents.on(eventName, listener);
        return fakeProcess;
      },
    };
    const emitLifecycleEvent = vi.fn(async () => undefined);
    const clearRuntimeState = vi.fn(async () => undefined);
    const exit = vi.fn();
    const guard = installDaemonProcessCrashGuard({
      clearRuntimeState,
      emitLifecycleEvent,
      exit,
      process: fakeProcess,
    });

    processEvents.emit(
      "uncaughtException",
      new Error("socket hang up after TLS record failure")
    );

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "daemon.crash",
        metadata: expect.objectContaining({
          errorMessage: "socket hang up after TLS record failure",
          event: "uncaughtException",
        }),
      })
    );
    expect(clearRuntimeState).toHaveBeenCalledTimes(1);

    guard.dispose();
    expect(processEvents.listenerCount("uncaughtException")).toBe(0);
    expect(processEvents.listenerCount("unhandledRejection")).toBe(0);
  });
});
