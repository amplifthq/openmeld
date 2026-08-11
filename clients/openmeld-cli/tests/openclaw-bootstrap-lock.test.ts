import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireLockMock = vi.hoisted(() => vi.fn());
const releaseLockMock = vi.hoisted(() => vi.fn());
const runWithHeldLockMock = vi.hoisted(() => vi.fn());
const delayMock = vi.hoisted(() => vi.fn());

vi.mock("node:timers/promises", () => ({
  setTimeout: (...args: Parameters<typeof delayMock>) => delayMock(...args),
}));

vi.mock("../src/config/lock", async () => {
  const actual =
    await vi.importActual<typeof import("../src/config/lock")>(
      "../src/config/lock"
    );
  return {
    ...actual,
    acquireLock: (...args: Parameters<typeof acquireLockMock>) =>
      acquireLockMock(...args),
    releaseLock: (...args: Parameters<typeof releaseLockMock>) =>
      releaseLockMock(...args),
    runWithHeldLock: (...args: Parameters<typeof runWithHeldLockMock>) =>
      runWithHeldLockMock(...args),
  };
});

import {
  OpenMeldLockError,
  runWithCleanupPreservingRunError,
} from "../src/config/lock";
import { withOpenClawBootstrapLock } from "../src/provider-hosts/openclaw/bootstrap-lock";

describe("openclaw bootstrap lock", () => {
  beforeEach(() => {
    acquireLockMock.mockReset();
    releaseLockMock.mockReset().mockResolvedValue(undefined);
    runWithHeldLockMock.mockImplementation(
      async (input: { lock: { path: string }; run: () => Promise<unknown> }) =>
        await runWithCleanupPreservingRunError({
          run: input.run,
          cleanup: () => releaseLockMock(input.lock),
        })
    );
    delayMock.mockReset().mockResolvedValue(undefined);
  });

  it("retries lock acquisition when another process is holding the bootstrap lock", async () => {
    acquireLockMock
      .mockRejectedValueOnce(
        new OpenMeldLockError({
          key: "openclaw-bootstrap",
          path: "/tmp/openclaw-bootstrap.lock",
        })
      )
      .mockResolvedValueOnce({
        path: "/tmp/openclaw-bootstrap.lock",
      });
    const run = vi.fn().mockResolvedValue("ok");

    await expect(
      withOpenClawBootstrapLock({
        openMeldProfileId: "agt_demo",
        run,
      })
    ).resolves.toBe("ok");

    expect(acquireLockMock).toHaveBeenCalledTimes(2);
    expect(delayMock).toHaveBeenCalledWith(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(releaseLockMock).toHaveBeenCalledWith({
      path: "/tmp/openclaw-bootstrap.lock",
    });
  });

  it("does not retry an orphaned legacy bootstrap lock", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    delayMock.mockImplementation(() => {
      nowMs += 100;
      return Promise.resolve();
    });
    const error = new OpenMeldLockError({
      key: "openclaw-bootstrap",
      path: "/tmp/openclaw-bootstrap.lock",
      contentionState: "orphaned",
    });
    acquireLockMock.mockRejectedValue(error);

    await expect(
      withOpenClawBootstrapLock({
        openMeldProfileId: "agt_demo",
        run: vi.fn(),
      })
    ).rejects.toBe(error);

    expect(acquireLockMock).toHaveBeenCalledTimes(1);
    expect(delayMock).not.toHaveBeenCalled();
  });

  it("preserves the bootstrap error when release also fails", async () => {
    acquireLockMock.mockResolvedValue({
      path: "/tmp/openclaw-bootstrap.lock",
    });
    releaseLockMock.mockRejectedValueOnce(new Error("release failed"));
    const bootstrapError = new Error("bootstrap failed");

    await expect(
      withOpenClawBootstrapLock({
        openMeldProfileId: "agt_demo",
        run: () => Promise.reject(bootstrapError),
      })
    ).rejects.toBe(bootstrapError);
  });
});
