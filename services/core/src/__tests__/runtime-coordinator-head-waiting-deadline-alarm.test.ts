import { projectTargetWakeLifecycleIdentity } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadWaitingBoundary,
} from "../runtime-transport/application/runtime-coordinator-authority";
import {
  processRuntimeCoordinatorHeadWaitingDeadlineAlarm,
  type RuntimeCoordinatorHeadWaitingDeadlineAlarmPorts,
} from "../runtime-transport/application/runtime-coordinator-head-waiting-deadline-alarm";

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

const buildWaitingBoundary = (
  overrides: Partial<
    Extract<
      RuntimeCoordinatorHeadWaitingBoundary,
      { reasonCode: "daemon.profile.offline" }
    >
  > = {}
): RuntimeCoordinatorHeadWaitingBoundary => ({
  deadlineAtMs: NOW_MS - 1,
  deadlineOutcome: "publication_intent_ready",
  observedAtMs: NOW_MS - 300_000,
  reasonCode: "daemon.profile.offline",
  softDeadlineAtMs: NOW_MS - 30_000,
  trigger: "openmeld_service_route_connected",
  triggerOwner: "runtime_coordinator",
  userRecoveryAction: "start_or_restart_openmeld_service",
  userVisibleState: "waiting_for_openmeld_service",
  waitingCategory: "service_not_connected",
  waitingFor: "openmeld_service_route_connection",
  waitingSinceMs: NOW_MS - 300_000,
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
    runtimeCoordinatorExecutionId: null,
    status: "waiting",
    targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    targetWakeLifecycleIdentity,
    updatedAtMs: NOW_MS - 5000,
    waitingBoundary: buildWaitingBoundary(),
    ...overrides,
  };
};

describe("RuntimeCoordinator head-waiting deadline alarm processor", () => {
  it("escalates due waiting records through a high-level delegate in planner order", async () => {
    const dueAtBoundary = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-boundary",
      waitingBoundary: buildWaitingBoundary({ deadlineAtMs: NOW_MS }),
    });
    const dueBeforeBoundary = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-before",
      waitingBoundary: buildWaitingBoundary({ deadlineAtMs: NOW_MS - 1 }),
    });
    const readRecords = vi.fn(() =>
      Promise.resolve([dueAtBoundary, dueBeforeBoundary])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const escalateHeadWaitingDeadline = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadWaitingDeadlineAlarm({
      nowMs: NOW_MS,
      ports: {
        escalateHeadWaitingDeadline,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(readRecords).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(escalateHeadWaitingDeadline.mock.calls).toEqual([
      [{ nowMs: NOW_MS, record: dueAtBoundary }],
      [{ nowMs: NOW_MS, record: dueBeforeBoundary }],
    ]);
  });

  it("stops before the delegate when the budget port rejects work", async () => {
    const readRecords = vi.fn(() =>
      Promise.resolve([
        buildHeadLifecycleRecord({ primaryDispatchId: "dispatch-due" }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => false);
    const escalateHeadWaitingDeadline = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadWaitingDeadlineAlarm({
      nowMs: NOW_MS,
      ports: {
        escalateHeadWaitingDeadline,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(1);
    expect(escalateHeadWaitingDeadline).not.toHaveBeenCalled();
  });

  it("ignores future, non-waiting, missing-boundary, and already-ready records through the planner", async () => {
    const readRecords = vi.fn(() =>
      Promise.resolve([
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-future",
          waitingBoundary: buildWaitingBoundary({ deadlineAtMs: NOW_MS + 1 }),
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-accepted",
          status: "accepted",
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-missing-boundary",
          waitingBoundary: undefined,
        }),
        buildHeadLifecycleRecord({
          noExecutionDecision: {
            decidedAtMs: NOW_MS - 1000,
            publicationCategory: "service_not_connected",
            reasonCode: "daemon.profile.offline",
            source: "runtime_coordinator_head_waiting_deadline",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
          primaryDispatchId: "dispatch-publication-ready",
          publicationIntent: {
            intentId: "rcpi:no_execution:dispatch-publication-ready",
            kind: "no_execution_failure",
            publicationCategory: "service_not_connected",
            readyAtMs: NOW_MS - 1000,
            reasonCode: "daemon.profile.offline",
            status: "ready_for_phase_6",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
          status: "publication_intent_ready",
          waitingBoundary: undefined,
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const escalateHeadWaitingDeadline = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorHeadWaitingDeadlineAlarm({
      nowMs: NOW_MS,
      ports: {
        escalateHeadWaitingDeadline,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(escalateHeadWaitingDeadline).not.toHaveBeenCalled();
  });

  it("uses injected time and ports instead of ambient runtime APIs", async () => {
    const record = buildHeadLifecycleRecord({
      primaryDispatchId: "dispatch-due",
    });
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("processor must use injected nowMs");
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("processor must not fetch"));
    try {
      const escalateHeadWaitingDeadline = vi.fn(() => Promise.resolve());

      await processRuntimeCoordinatorHeadWaitingDeadlineAlarm({
        nowMs: NOW_MS,
        ports: {
          escalateHeadWaitingDeadline,
          readRecords: vi.fn(() => Promise.resolve([record])),
          reserveWorkUnit: vi.fn(() => true),
        },
      });

      expect(escalateHeadWaitingDeadline).toHaveBeenCalledWith({
        nowMs: NOW_MS,
        record,
      });
      expect(dateNow).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("exposes only the high-level escalation delegate as the write-side port", () => {
    const portKeysAreExact: IsExact<
      keyof RuntimeCoordinatorHeadWaitingDeadlineAlarmPorts,
      "escalateHeadWaitingDeadline" | "readRecords" | "reserveWorkUnit"
    > = true;
    const ports = {
      escalateHeadWaitingDeadline: vi.fn(() => Promise.resolve()),
      readRecords: vi.fn(() => Promise.resolve([])),
      reserveWorkUnit: vi.fn(() => true),
    } satisfies RuntimeCoordinatorHeadWaitingDeadlineAlarmPorts;

    expect(portKeysAreExact).toBe(true);
    expect(Object.keys(ports).sort()).toEqual([
      "escalateHeadWaitingDeadline",
      "readRecords",
      "reserveWorkUnit",
    ]);
  });
});
