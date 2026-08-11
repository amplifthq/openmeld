import { describe, expect, it, vi } from "vitest";
import {
  isCapacityError,
  MAX_CLEANUP_BATCHES_PER_REQUEST,
  POST_CLEANUP_DEBOUNCE_MS,
  persistSignalWithRetention,
  RETENTION_DELETE_BATCH_ROWS,
  SOFT_LIMIT_BYTES,
  TARGET_BYTES,
} from "../src/space/infrastructure/sql/space-retention-repo";

describe("space retention", () => {
  it("runs pre-check cleanup before insert when over soft limit", () => {
    let size = SOFT_LIMIT_BYTES + 200;
    const events: string[] = [];

    const result = persistSignalWithRetention({
      insertSignal: () => {
        events.push("insert");
      },
      deleteOldestSignalsBatch: (limit) => {
        events.push(`cleanup:${limit}`);
        size = TARGET_BYTES - 100;
        return 30;
      },
      readDatabaseSizeBytes: () => size,
      nowMs: 10_000,
      lastPostCleanupAtMs: 0,
      setLastPostCleanupAtMs: vi.fn(),
    });

    expect(events[0]).toBe(`cleanup:${RETENTION_DELETE_BATCH_ROWS}`);
    expect(events.at(-1)).toBe("insert");
    expect(result.preCleanup?.batchesUsed).toBe(1);
    expect(result.capacityRetryAttempted).toBe(false);
  });

  it("runs throttled post-check cleanup when still above soft and debounce window passed", () => {
    let size = SOFT_LIMIT_BYTES - 10;
    const setPostCleanupAt = vi.fn();
    const cleanup = vi.fn(() => {
      size = TARGET_BYTES - 1;
      return 20;
    });

    const result = persistSignalWithRetention({
      insertSignal: () => {
        size = SOFT_LIMIT_BYTES + 20;
      },
      deleteOldestSignalsBatch: cleanup,
      readDatabaseSizeBytes: () => size,
      nowMs: 20_000,
      lastPostCleanupAtMs: 20_000 - POST_CLEANUP_DEBOUNCE_MS - 1,
      setLastPostCleanupAtMs: setPostCleanupAt,
    });

    expect(result.postCleanup?.batchesUsed).toBe(1);
    expect(setPostCleanupAt).toHaveBeenCalledWith(20_000);
    expect(cleanup).toHaveBeenCalledWith(RETENTION_DELETE_BATCH_ROWS);
  });

  it("retries exactly once on capacity error with emergency cleanup", () => {
    let size = SOFT_LIMIT_BYTES + 100;
    let insertAttempts = 0;

    const result = persistSignalWithRetention({
      insertSignal: () => {
        insertAttempts += 1;
        if (insertAttempts === 1) {
          throw new Error("SQLITE_FULL: database or disk is full");
        }
        size = TARGET_BYTES - 5;
      },
      deleteOldestSignalsBatch: () => {
        size = TARGET_BYTES - 10;
        return 40;
      },
      readDatabaseSizeBytes: () => size,
      nowMs: 30_000,
      lastPostCleanupAtMs: 0,
      setLastPostCleanupAtMs: vi.fn(),
    });

    expect(result.capacityRetryAttempted).toBe(true);
    expect(result.emergencyCleanup?.batchesUsed).toBe(1);
    expect(insertAttempts).toBe(2);
  });

  it("still runs one emergency cleanup batch when request budget is exhausted", () => {
    let size = SOFT_LIMIT_BYTES + 1000;
    let cleanupCalls = 0;
    let insertAttempts = 0;

    const result = persistSignalWithRetention({
      insertSignal: () => {
        insertAttempts += 1;
        if (insertAttempts === 1) {
          throw new Error("SQLITE_FULL: database or disk is full");
        }
        size = TARGET_BYTES - 1;
      },
      deleteOldestSignalsBatch: () => {
        cleanupCalls += 1;
        if (cleanupCalls <= MAX_CLEANUP_BATCHES_PER_REQUEST) {
          size -= 1;
          return 1;
        }
        size = TARGET_BYTES - 5;
        return 10;
      },
      readDatabaseSizeBytes: () => size,
      nowMs: 31_000,
      lastPostCleanupAtMs: 0,
      setLastPostCleanupAtMs: vi.fn(),
    });

    expect(result.preCleanup?.batchesUsed).toBe(
      MAX_CLEANUP_BATCHES_PER_REQUEST
    );
    expect(result.emergencyCleanup?.batchesUsed).toBe(1);
    expect(cleanupCalls).toBe(MAX_CLEANUP_BATCHES_PER_REQUEST + 1);
    expect(insertAttempts).toBe(2);
  });

  it("does not cleanup-retry on non-capacity errors", () => {
    let cleanupCalls = 0;

    expect(() =>
      persistSignalWithRetention({
        insertSignal: () => {
          throw new Error("validation failed");
        },
        deleteOldestSignalsBatch: () => {
          cleanupCalls += 1;
          return 0;
        },
        readDatabaseSizeBytes: () => TARGET_BYTES - 1,
        nowMs: 40_000,
        lastPostCleanupAtMs: 0,
        setLastPostCleanupAtMs: vi.fn(),
      })
    ).toThrow("validation failed");

    expect(cleanupCalls).toBe(0);
  });

  it("reports retention debt when cleanup budget is exhausted and write still succeeds", () => {
    let size = SOFT_LIMIT_BYTES + 1000;
    let cleanupCalls = 0;
    const retentionDebt = vi.fn();

    const result = persistSignalWithRetention({
      insertSignal: () => {
        size += 10;
      },
      deleteOldestSignalsBatch: () => {
        cleanupCalls += 1;
        size -= 1;
        return 1;
      },
      readDatabaseSizeBytes: () => size,
      nowMs: 50_000,
      lastPostCleanupAtMs: 0,
      setLastPostCleanupAtMs: vi.fn(),
      onRetentionDebt: retentionDebt,
    });

    expect(cleanupCalls).toBe(MAX_CLEANUP_BATCHES_PER_REQUEST);
    expect(result.retentionDebtReported).toBe(true);
    expect(retentionDebt).toHaveBeenCalledTimes(1);
    expect(retentionDebt).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "budget_exhausted_still_over_soft",
        softLimitBytes: SOFT_LIMIT_BYTES,
        targetBytes: TARGET_BYTES,
        databaseSizeBytes: expect.any(Number),
      })
    );
  });

  it("treats post-check cleanup failure as best-effort after successful insert", () => {
    let size = SOFT_LIMIT_BYTES - 10;
    const onPostCleanupFailure = vi.fn();

    const result = persistSignalWithRetention({
      insertSignal: () => {
        size = SOFT_LIMIT_BYTES + 20;
      },
      deleteOldestSignalsBatch: () => {
        throw new Error("post cleanup failed");
      },
      readDatabaseSizeBytes: () => size,
      nowMs: 60_000,
      lastPostCleanupAtMs: 0,
      setLastPostCleanupAtMs: vi.fn(),
      onPostCleanupFailure,
    });

    expect(result.capacityRetryAttempted).toBe(false);
    expect(result.postCleanup).toBeNull();
    expect(onPostCleanupFailure).toHaveBeenCalledTimes(1);
  });

  it("detects capacity errors by common sqlite/full text", () => {
    expect(isCapacityError(new Error("SQLITE_FULL"))).toBe(true);
    expect(isCapacityError(new Error("database or disk is full"))).toBe(true);
    expect(isCapacityError(new Error("ENOSPC: no space left on device"))).toBe(
      true
    );
    expect(isCapacityError(new Error("quota exceeded"))).toBe(true);
    expect(isCapacityError(new Error("validation failed"))).toBe(false);
  });
});
