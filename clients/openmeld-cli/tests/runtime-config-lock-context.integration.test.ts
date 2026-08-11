import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

describe("runtime config lock release context", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("../src/config/lock");
  });

  it("uses openMeldProfileId in release metadata", async () => {
    const acquireLockMock = vi.fn(async () => ({
      path: "/tmp/runtime-config.lock",
    }));
    const runWithHeldLockMock = vi.fn(
      async (input: {
        run: () => Promise<unknown>;
        releaseContext?: Record<string, unknown>;
      }) => await input.run()
    );

    vi.doMock("../src/config/lock", async () => {
      const actual =
        await vi.importActual<typeof import("../src/config/lock")>(
          "../src/config/lock"
        );
      return {
        ...actual,
        acquireLock: acquireLockMock,
        runWithHeldLock: runWithHeldLockMock,
      };
    });

    const { setConfiguredBaseUrl } = await import(
      "../src/config/runtime-config"
    );

    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
    });

    expect(acquireLockMock).toHaveBeenCalledWith({
      openMeldProfileId: "__system__",
      key: "runtime-config",
    });
    expect(runWithHeldLockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseContext: {
          component: "runtime_config",
          lockKey: "runtime-config",
          openMeldProfileId: "__system__",
        },
      })
    );
  });

  it("does not retry an orphaned legacy runtime config lock", async () => {
    const { OpenMeldLockError } =
      await vi.importActual<typeof import("../src/config/lock")>(
        "../src/config/lock"
      );
    const error = new OpenMeldLockError({
      key: "runtime-config",
      path: "/tmp/runtime-config.lock",
      contentionState: "orphaned",
    });
    const acquireLockMock = vi.fn().mockRejectedValue(error);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.doMock("../src/config/lock", async () => {
      const actual =
        await vi.importActual<typeof import("../src/config/lock")>(
          "../src/config/lock"
        );
      return {
        ...actual,
        acquireLock: acquireLockMock,
      };
    });

    const { setConfiguredBaseUrl } = await import(
      "../src/config/runtime-config"
    );

    const caught = await withTempHome(
      async () =>
        await setConfiguredBaseUrl("https://gateway.example.com/").catch(
          (caughtError) => caughtError
        )
    );

    expect(caught).toBe(error);
    expect(acquireLockMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});
