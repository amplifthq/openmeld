import { writeFileSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  readLockMeta,
  releaseLock,
  repairOrphanedLegacyLock,
  repairOrphanedLegacyLocks,
  runWithHeldLock,
  tryCleanupStaleLock,
} from "../src/config/lock";
import { withTempHome } from "./helpers/fs";

const PROFILE_KEY = "aaaaaaaa-0000-0000-0000-000000000000";

describe("lock recovery", () => {
  it("creates runtime lock under the profile scope", async () => {
    await withTempHome(async () => {
      const lock = await acquireLock({
        openMeldProfileId: PROFILE_KEY,
        key: "demo",
      });
      expect(lock.path).toContain(
        join(".openmeld", "runtime", "locks", PROFILE_KEY)
      );
      await expect(lstat(lock.path)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      expect((await lstat(lock.path)).isDirectory()).toBe(true);
      await expect(readdir(lock.path)).resolves.toEqual([
        `${lock.ownerId}.owner.json`,
      ]);
      await expect(access(lock.path)).resolves.toBeUndefined();
      await releaseLock(lock);
      await expect(access(lock.path)).rejects.toThrow();
    });
  });

  it("does not let an old holder remove a replacement lock", async () => {
    await withTempHome(async () => {
      const originalLock = await acquireLock({
        openMeldProfileId: PROFILE_KEY,
        key: "demo",
      });
      await rm(originalLock.path, { force: true, recursive: true });
      await mkdir(originalLock.path);
      await writeFile(
        join(originalLock.path, "replacement-owner.owner.json"),
        `${JSON.stringify({
          pid: process.pid,
          ownerId: "replacement-owner",
          marker: "replacement-lock",
        })}\n`,
        "utf8"
      );

      await releaseLock(originalLock);

      await expect(access(originalLock.path)).resolves.toBeUndefined();
      await expect(
        readLockMeta({ openMeldProfileId: PROFILE_KEY, key: "demo" })
      ).resolves.toMatchObject({
        ownerId: "replacement-owner",
        marker: "replacement-lock",
      });
    });
  });

  it("does not remove a replacement directory during its publication window", async () => {
    await withTempHome(async () => {
      const originalLock = await acquireLock({
        openMeldProfileId: PROFILE_KEY,
        key: "demo",
      });
      await rm(originalLock.path, { force: true, recursive: true });
      await mkdir(originalLock.path);

      await releaseLock(originalLock);

      await expect(access(originalLock.path)).resolves.toBeUndefined();
      await expect(readdir(originalLock.path)).resolves.toEqual([]);
    });
  });

  it("does not reclaim lock when PID liveness check returns EPERM", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4242 })}\n`, "utf8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error(
          "operation not permitted"
        ) as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(
          acquireLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).rejects.toMatchObject({
          contentionState: "active",
          message: expect.stringContaining("space is locked"),
        });
        await expect(access(lockPath)).resolves.toBeUndefined();
        await expect(
          repairOrphanedLegacyLock({
            openMeldProfileId: PROFILE_KEY,
            key: "demo",
          })
        ).resolves.toBe(false);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("keeps a stale legacy file lock during mixed-version rollout", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4343 })}\n`, "utf8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(
          acquireLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).rejects.toMatchObject({
          contentionState: "orphaned",
          message: expect.stringContaining("openmeld repair local-state"),
        });
        await expect(access(lockPath)).resolves.toBeUndefined();
        await expect(repairOrphanedLegacyLocks()).resolves.toEqual({
          removedOrphanedLegacyLocks: 1,
        });

        const lock = await acquireLock({
          openMeldProfileId: PROFILE_KEY,
          key: "demo",
        });
        await releaseLock(lock);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("repairs orphaned legacy locks across command owners and preserves live locks", async () => {
    await withTempHome(async (home) => {
      const locksRoot = join(home, ".openmeld", "runtime", "locks");
      const staleLockPaths = [
        join(locksRoot, "runtime-config", "write.lock"),
        join(locksRoot, "space-connect", "space-123.lock"),
      ] as const;
      const liveLockPath = join(locksRoot, "daemon-lifecycle", "service.lock");
      await Promise.all(
        [...staleLockPaths, liveLockPath].map(async (lockPath) => {
          await mkdir(dirname(lockPath), { recursive: true });
        })
      );
      await Promise.all([
        writeFile(staleLockPaths[0], `${JSON.stringify({ pid: 5001 })}\n`),
        writeFile(staleLockPaths[1], `${JSON.stringify({ pid: 5002 })}\n`),
        writeFile(liveLockPath, `${JSON.stringify({ pid: 5003 })}\n`),
      ]);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid) => {
        if (pid === 5003) {
          return true;
        }
        const error = new Error("no such process") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }) as typeof process.kill);

      try {
        await expect(repairOrphanedLegacyLocks()).resolves.toEqual({
          removedOrphanedLegacyLocks: 2,
        });
        await Promise.all(
          staleLockPaths.map(async (lockPath) => {
            await expect(access(lockPath)).rejects.toThrow();
          })
        );
        await expect(access(liveLockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("reclaims a stale owner-scoped directory lock without a publication gap", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        join(lockPath, "stale-owner.owner.json"),
        `${JSON.stringify({ ownerId: "stale-owner", pid: 4444 })}\n`,
        "utf8"
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill);

      try {
        const lock = await acquireLock({
          openMeldProfileId: PROFILE_KEY,
          key: "demo",
        });
        await expect(readdir(lock.path)).resolves.toEqual([
          `${lock.ownerId}.owner.json`,
        ]);
        await releaseLock(lock);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("keeps an abandoned empty legacy file lock during mixed-version rollout", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, "", "utf8");
      const abandonedAt = new Date(Date.now() - 60_000);
      await utimes(lockPath, abandonedAt, abandonedAt);

      await expect(
        tryCleanupStaleLock({
          openMeldProfileId: PROFILE_KEY,
          key: "demo",
        })
      ).resolves.toBe(false);
      await expect(
        acquireLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
      ).rejects.toThrow("space is locked");
      await expect(access(lockPath)).resolves.toBeUndefined();
      await expect(
        repairOrphanedLegacyLock({
          openMeldProfileId: PROFILE_KEY,
          key: "demo",
        })
      ).resolves.toBe(true);
    });
  });

  it("keeps a fresh empty lock during the publication safety window", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, "", "utf8");

      await expect(
        acquireLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
      ).rejects.toThrow("space is locked");
      await expect(access(lockPath)).resolves.toBeUndefined();
    });
  });

  it("returns stale lock metadata without removing the file while reading lock metadata", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4545 })}\n`, "utf8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(
          readLockMeta({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).resolves.toEqual({ pid: 4545 });
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("does not remove a stale lock when contents change before cleanup confirmation", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4747 })}\n`, "utf8");

      let staleCheckObserved = false;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(((
        pid: number | NodeJS.Signals,
        signal?: number | NodeJS.Signals
      ) => {
        if (pid === 4747 && signal === 0 && !staleCheckObserved) {
          staleCheckObserved = true;
          writeFileSync(
            lockPath,
            `${JSON.stringify({ pid: process.pid, marker: "replaced" })}\n`,
            "utf8"
          );
          const err = new Error("no such process") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      }) as typeof process.kill);

      try {
        await expect(
          tryCleanupStaleLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).resolves.toBe(false);
        await expect(
          readLockMeta({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).resolves.toEqual({
          pid: process.pid,
          marker: "replaced",
        });
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("keeps the replacement lock and throws locked when cleanup confirmation sees changed contents", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4848 })}\n`, "utf8");

      let staleCheckObserved = false;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(((
        pid: number | NodeJS.Signals,
        signal?: number | NodeJS.Signals
      ) => {
        if (pid === 4848 && signal === 0 && !staleCheckObserved) {
          staleCheckObserved = true;
          writeFileSync(
            lockPath,
            `${JSON.stringify({ pid: process.pid, marker: "replacement-lock" })}\n`,
            "utf8"
          );
          const err = new Error("no such process") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      }) as typeof process.kill);

      try {
        await expect(
          acquireLock({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).rejects.toThrow("space is locked");
        await expect(
          readLockMeta({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).resolves.toEqual({
          pid: process.pid,
          marker: "replacement-lock",
        });
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("keeps lock while reading metadata when PID liveness check returns EPERM", async () => {
    await withTempHome(async (home) => {
      const lockPath = join(
        home,
        ".openmeld",
        "runtime",
        "locks",
        PROFILE_KEY,
        "demo.lock"
      );
      await mkdir(join(home, ".openmeld", "runtime", "locks", PROFILE_KEY), {
        recursive: true,
      });
      await writeFile(lockPath, `${JSON.stringify({ pid: 4646 })}\n`, "utf8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error(
          "operation not permitted"
        ) as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(
          readLockMeta({ openMeldProfileId: PROFILE_KEY, key: "demo" })
        ).resolves.toEqual({ pid: 4646 });
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("rethrows the original callback error when release succeeds", async () => {
    await withTempHome(async () => {
      const lock = await acquireLock({
        openMeldProfileId: PROFILE_KEY,
        key: "demo",
      });
      const callbackError = new Error("callback failed");

      await expect(
        runWithHeldLock({
          lock,
          run: () => Promise.reject(callbackError),
        })
      ).rejects.toBe(callbackError);
      await expect(access(lock.path)).rejects.toThrow();
    });
  });

  it("throws the release failure when the callback succeeds", async () => {
    const invalidLock = {
      ownerId: "invalid-owner",
      path: "\0",
    };

    await expect(
      runWithHeldLock({
        lock: invalidLock,
        run: async () => "ok",
      })
    ).rejects.toThrow();
  });

  it("warns once and preserves the original callback error when release also fails", async () => {
    const invalidLock = {
      ownerId: "invalid-owner",
      path: "\0",
    };
    const callbackError = new Error("callback failed");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return undefined;
    });

    try {
      await expect(
        runWithHeldLock({
          lock: invalidLock,
          run: () => Promise.reject(callbackError),
          releaseContext: {
            component: "lock.test",
          },
        })
      ).rejects.toBe(callbackError);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[openmeld.lock.release.warning]",
        expect.objectContaining({
          lockPath: "\0",
          releaseError: expect.any(String),
          releaseContext: {
            component: "lock.test",
          },
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
