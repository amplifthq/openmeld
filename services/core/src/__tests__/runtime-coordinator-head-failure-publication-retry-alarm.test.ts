import { projectTargetWakeLifecycleIdentity } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadPublicationRetryState,
} from "../runtime-transport/application/runtime-coordinator-authority";
import {
  processRuntimeCoordinatorHeadFailurePublicationRetryAlarm,
  type RuntimeCoordinatorHeadFailurePublicationRetryAlarmPorts,
} from "../runtime-transport/application/runtime-coordinator-head-failure-publication-retry-alarm";

const NOW_MS = 1_700_000_000_000;

type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const buildTargetWakeLifecycleIdentity = (dispatchId: string) =>
  projectTargetWakeLifecycleIdentity({
    clientMessageId: "client-message-1",
    dispatchId,
    sourceSignalId: "signal-1",
    spaceId: "space-1",
    targetProfileId: "agent-1",
  });

const buildPublicationRetry = (
  overrides: Partial<RuntimeCoordinatorHeadPublicationRetryState> = {}
): RuntimeCoordinatorHeadPublicationRetryState => ({
  attemptCount: 1,
  firstFailureAtMs: NOW_MS - 2000,
  lastFailureAtMs: NOW_MS - 1000,
  lastReasonCode: "space.unavailable",
  nextRetryAtMs: NOW_MS - 1,
  status: "retry_scheduled",
  ...overrides,
});

const buildHeadLifecycleRecord = (
  overrides: Partial<RuntimeCoordinatorHeadLifecycleRecord> = {}
): RuntimeCoordinatorHeadLifecycleRecord => {
  const primaryDispatchId = overrides.primaryDispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    buildTargetWakeLifecycleIdentity(primaryDispatchId);
  return {
    createdAtMs: NOW_MS - 300_000,
    duplicateDispatches: [],
    executionLinkedAtMs: null,
    modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
    ownerUserId: "owner-1",
    primaryDispatchId,
    primaryIdempotencyKey: "idempotency-1",
    publicationRetry: buildPublicationRetry(),
    runtimeCoordinatorExecutionId: null,
    status: "publication_intent_ready",
    targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    targetWakeLifecycleIdentity,
    updatedAtMs: NOW_MS - 5000,
    ...overrides,
  };
};

describe("RuntimeCoordinator head failure-publication retry alarm processor", () => {
  it("publishes due retry records through a high-level delegate in planner order", async () => {
    const dueAtBoundary = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-boundary",
      publicationRetry: buildPublicationRetry({ nextRetryAtMs: NOW_MS }),
    });
    const dueBeforeBoundary = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-before",
      publicationRetry: buildPublicationRetry({ nextRetryAtMs: NOW_MS - 1 }),
    });
    const readRecords = vi.fn(() =>
      Promise.resolve([dueAtBoundary, dueBeforeBoundary])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const publishHeadFailureNotice = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadFailurePublicationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        publishHeadFailureNotice,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(readRecords).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(publishHeadFailureNotice.mock.calls).toEqual([
      [dueAtBoundary],
      [dueBeforeBoundary],
    ]);
  });

  it("stops before the delegate when the budget port rejects work", async () => {
    const firstDue = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-first",
    });
    const rejectedDue = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-rejected",
    });
    const unvisitedDue = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-unvisited",
    });
    const readRecords = vi.fn(() =>
      Promise.resolve([firstDue, rejectedDue, unvisitedDue])
    );
    const reserveWorkUnit = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const publishHeadFailureNotice = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadFailurePublicationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        publishHeadFailureNotice,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(publishHeadFailureNotice.mock.calls).toEqual([[firstDue]]);
  });

  it("ignores non retry-scheduled, future retry, and wrong-status records through the planner", async () => {
    const nonRetryScheduled = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-not-retry-scheduled",
      publicationRetry: {
        ...buildPublicationRetry(),
        status: "retry_completed",
      } as unknown as RuntimeCoordinatorHeadPublicationRetryState,
    });
    const futureRetry = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-future",
      publicationRetry: buildPublicationRetry({ nextRetryAtMs: NOW_MS + 1 }),
    });
    const wrongStatus = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-accepted",
      status: "accepted",
    });
    const missingRetry = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-missing-retry",
      publicationRetry: undefined,
    });
    const readRecords = vi.fn(() =>
      Promise.resolve([
        nonRetryScheduled,
        futureRetry,
        wrongStatus,
        missingRetry,
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const publishHeadFailureNotice = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadFailurePublicationRetryAlarm({
      nowMs: NOW_MS,
      ports: {
        publishHeadFailureNotice,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(publishHeadFailureNotice).not.toHaveBeenCalled();
  });

  it("uses injected time and ports instead of ambient runtime APIs", async () => {
    const record = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-due",
      publicationRetry: buildPublicationRetry({ nextRetryAtMs: NOW_MS }),
    });
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("processor must use injected nowMs");
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("processor must not fetch"));
    try {
      const publishHeadFailureNotice = vi.fn(() => Promise.resolve());

      await processRuntimeCoordinatorHeadFailurePublicationRetryAlarm({
        nowMs: NOW_MS,
        ports: {
          publishHeadFailureNotice,
          readRecords: vi.fn(() => Promise.resolve([record])),
          reserveWorkUnit: vi.fn(() => true),
        },
      });

      expect(publishHeadFailureNotice).toHaveBeenCalledWith(record);
      expect(dateNow).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("exposes only the high-level publication delegate as the write-side port", () => {
    const portKeysAreExact: IsExact<
      keyof RuntimeCoordinatorHeadFailurePublicationRetryAlarmPorts,
      "publishHeadFailureNotice" | "readRecords" | "reserveWorkUnit"
    > = true;
    const ports = {
      publishHeadFailureNotice: vi.fn(() => Promise.resolve()),
      readRecords: vi.fn(() => Promise.resolve([])),
      reserveWorkUnit: vi.fn(() => true),
    } satisfies RuntimeCoordinatorHeadFailurePublicationRetryAlarmPorts;

    expect(portKeysAreExact).toBe(true);
    expect(Object.keys(ports).sort()).toEqual([
      "publishHeadFailureNotice",
      "readRecords",
      "reserveWorkUnit",
    ]);
  });
});
