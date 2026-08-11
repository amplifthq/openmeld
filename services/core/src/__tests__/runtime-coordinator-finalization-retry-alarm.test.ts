import { describe, expect, it, vi } from "vitest";
import type { RuntimeCoordinatorFinalizationRetryEntry } from "../runtime-transport/application/runtime-coordinator-authority";
import {
  processRuntimeCoordinatorFinalizationRetryAlarm,
  type RuntimeCoordinatorFinalizationRetryAlarmPorts,
} from "../runtime-transport/application/runtime-coordinator-finalization-retry-alarm";

const NOW_MS = 1_700_000_000_000;

type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const buildFinalizationRetryEntry = (
  overrides: Partial<RuntimeCoordinatorFinalizationRetryEntry> = {}
): RuntimeCoordinatorFinalizationRetryEntry => ({
  attemptCount: 1,
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  executionTokenRunId: "run-1",
  finalizationCommandId: "finalization-command-1",
  firstFailureAtMs: NOW_MS - 60_000,
  nextReplayAtMs: NOW_MS,
  runtimeCoordinatorExecutionId: "rce-1",
  spaceId: "space-1",
  targetProfileId: "agent-1",
  updatedAtMs: NOW_MS - 30_000,
  ...overrides,
});

describe("RuntimeCoordinator finalization retry alarm processor", () => {
  it("processes due retry entries through a high-level delegate in planner order", async () => {
    const dueAtBoundary = buildFinalizationRetryEntry({
      dispatchId: "dispatch-boundary",
      finalizationCommandId: "finalization-boundary",
      nextReplayAtMs: NOW_MS,
    });
    const dueBeforeBoundary = buildFinalizationRetryEntry({
      dispatchId: "dispatch-before",
      finalizationCommandId: "finalization-before",
      nextReplayAtMs: NOW_MS - 1,
    });
    const readRetryEntries = vi.fn(() =>
      Promise.resolve([dueAtBoundary, dueBeforeBoundary])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processFinalizationRetry = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorFinalizationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        processFinalizationRetry,
        readRetryEntries,
        reserveWorkUnit,
      },
    });

    expect(readRetryEntries).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(processFinalizationRetry.mock.calls).toEqual([
      [{ nowMs: NOW_MS, retryEntry: dueAtBoundary }],
      [{ nowMs: NOW_MS, retryEntry: dueBeforeBoundary }],
    ]);
  });

  it("stops before the delegate when the budget port rejects work", async () => {
    const readRetryEntries = vi.fn(() =>
      Promise.resolve([
        buildFinalizationRetryEntry({ dispatchId: "dispatch-due" }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => false);
    const processFinalizationRetry = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorFinalizationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        processFinalizationRetry,
        readRetryEntries,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(1);
    expect(processFinalizationRetry).not.toHaveBeenCalled();
  });

  it("isolates a bad retry entry without blocking the rest of the alarm batch", async () => {
    const badEntry = buildFinalizationRetryEntry({
      dispatchId: "dispatch-bad",
      finalizationCommandId: "finalization-bad",
      runtimeCoordinatorExecutionId: "rce-bad",
    });
    const goodEntry = buildFinalizationRetryEntry({
      dispatchId: "dispatch-good",
      finalizationCommandId: "finalization-good",
      runtimeCoordinatorExecutionId: "rce-good",
    });
    const readRetryEntries = vi.fn(() =>
      Promise.resolve([badEntry, goodEntry])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processFinalizationRetry = vi
      .fn()
      .mockRejectedValueOnce(new Error("poisoned retry entry"))
      .mockResolvedValueOnce(undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await processRuntimeCoordinatorFinalizationRetryAlarm({
        nowMs: NOW_MS,
        ports: {
          processFinalizationRetry,
          readRetryEntries,
          reserveWorkUnit,
        },
      });

      expect(processFinalizationRetry.mock.calls).toEqual([
        [{ nowMs: NOW_MS, retryEntry: badEntry }],
        [{ nowMs: NOW_MS, retryEntry: goodEntry }],
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_entry_failed]",
        expect.objectContaining({
          dispatchId: "dispatch-bad",
          error: "poisoned retry entry",
          finalizationCommandId: "finalization-bad",
          runtimeCoordinatorExecutionId: "rce-bad",
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("ignores retry entries that are not due yet", async () => {
    const readRetryEntries = vi.fn(() =>
      Promise.resolve([
        buildFinalizationRetryEntry({
          dispatchId: "dispatch-future",
          nextReplayAtMs: NOW_MS + 1,
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processFinalizationRetry = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorFinalizationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        processFinalizationRetry,
        readRetryEntries,
        reserveWorkUnit,
      },
    });

    expect(readRetryEntries).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(processFinalizationRetry).not.toHaveBeenCalled();
  });

  it("uses injected time and ports instead of ambient runtime APIs", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchSpy,
    });
    const readRetryEntries = vi.fn(() =>
      Promise.resolve([buildFinalizationRetryEntry()])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processFinalizationRetry = vi.fn(() => Promise.resolve());

    try {
      await processRuntimeCoordinatorFinalizationRetryAlarm({
        nowMs: NOW_MS,
        ports: {
          processFinalizationRetry,
          readRetryEntries,
          reserveWorkUnit,
        },
      });
    } finally {
      dateNowSpy.mockRestore();
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }

    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the port surface limited to one high-level finalization delegate", () => {
    type ActualKeys = keyof RuntimeCoordinatorFinalizationRetryAlarmPorts;
    type ExpectedKeys =
      | "processFinalizationRetry"
      | "readRetryEntries"
      | "reserveWorkUnit";
    const exact: IsExact<ActualKeys, ExpectedKeys> = true;

    expect(exact).toBe(true);
  });
});
