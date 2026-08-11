import {
  projectTargetWakeLifecycleIdentity,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type {
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadWaitingBoundary,
} from "../runtime-transport/application/runtime-coordinator-authority";
import { processRuntimeCoordinatorHeadAcceptedHandoffAlarm } from "../runtime-transport/application/runtime-coordinator-head-accepted-handoff-alarm";

const NOW_MS = 1_700_000_000_000;

const buildTargetWakeLifecycleIdentity = (dispatchId: string) =>
  projectTargetWakeLifecycleIdentity({
    clientMessageId: "client-message-1",
    dispatchId,
    sourceSignalId: "signal-1",
    spaceId: "space-1",
    targetProfileId: "agent-1",
  });

const buildHeadLifecycleRecord = (
  overrides: Partial<RuntimeCoordinatorHeadLifecycleRecord> = {}
): RuntimeCoordinatorHeadLifecycleRecord => {
  const primaryDispatchId = overrides.primaryDispatchId ?? "dispatch-1";
  const targetWakeLifecycleIdentity =
    overrides.targetWakeLifecycleIdentity ??
    buildTargetWakeLifecycleIdentity(primaryDispatchId);
  return {
    createdAtMs:
      NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 1000,
    duplicateDispatches: [],
    executionLinkedAtMs: null,
    modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
    ownerUserId: "owner-1",
    primaryDispatchId,
    primaryIdempotencyKey: "idempotency-1",
    runtimeCoordinatorExecutionId: null,
    status: "accepted",
    targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    targetWakeLifecycleIdentity,
    updatedAtMs: NOW_MS - 5000,
    ...overrides,
  };
};

const buildWaitingBoundary = (
  overrides: Partial<RuntimeCoordinatorHeadWaitingBoundary> = {}
): RuntimeCoordinatorHeadWaitingBoundary => ({
  deadlineAtMs: NOW_MS + 300_000,
  deadlineOutcome: "publication_intent_ready",
  observedAtMs: NOW_MS,
  reasonCode: "daemon.profile.offline",
  softDeadlineAtMs: NOW_MS + 30_000,
  trigger: "openmeld_service_route_connected",
  triggerOwner: "runtime_coordinator",
  userRecoveryAction: "start_or_restart_openmeld_service",
  userVisibleState: "waiting_for_openmeld_service",
  waitingCategory: "service_not_connected",
  waitingFor: "openmeld_service_route_connection",
  waitingSinceMs: NOW_MS,
  ...overrides,
});

const buildHeadWaitingResponse = (
  request: RuntimeTransportRuntimeCoordinatorHeadWaitingRequest
): RuntimeTransportRuntimeCoordinatorHeadWaitingResponse => ({
  deadlineAtMs: request.observedAtMs + 300_000,
  nextTriggerAtMs: request.observedAtMs + 30_000,
  ok: true,
  primaryDispatchId: request.dispatchId,
  reasonCode: request.reasonCode,
  runtimeCoordinatorExecutionId: null,
  softDeadlineAtMs: request.observedAtMs + 30_000,
  status: "waiting",
  targetWakeLifecycleId:
    request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
  userRecoveryAction: request.userRecoveryAction,
  waitingCategory: request.waitingCategory,
});

describe("RuntimeCoordinator head accepted-handoff alarm processor", () => {
  it("records due accepted heads as waiting through explicit ports", async () => {
    const dueAtBoundary = buildHeadLifecycleRecord({
      createdAtMs: NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS,
      ownerUserId: "owner-boundary",
      primaryDispatchId: "dispatch-boundary",
      primaryIdempotencyKey: "idempotency-boundary",
    });
    const dueBeforeBoundary = buildHeadLifecycleRecord({
      createdAtMs:
        NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 1,
      ownerUserId: "owner-before",
      primaryDispatchId: "dispatch-before",
      primaryIdempotencyKey: "idempotency-before",
    });
    const readRecords = vi.fn(() =>
      Promise.resolve([dueAtBoundary, dueBeforeBoundary])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const recordHeadWaitingBoundary = vi.fn((request) =>
      Promise.resolve(buildHeadWaitingResponse(request))
    );

    await processRuntimeCoordinatorHeadAcceptedHandoffAlarm({
      nowMs: NOW_MS,
      ports: {
        readRecords,
        recordHeadWaitingBoundary,
        reserveWorkUnit,
      },
    });

    expect(readRecords).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(
      recordHeadWaitingBoundary.mock.calls.map(([request]) => ({
        dispatchId: request.dispatchId,
        idempotencyKey: request.idempotencyKey,
        observedAtMs: request.observedAtMs,
        ownerUserId: request.ownerUserId,
        reasonCode: request.reasonCode,
        targetWakeLifecycleId:
          request.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        userRecoveryAction: request.userRecoveryAction,
        v: request.v,
        waitingCategory: request.waitingCategory,
      }))
    ).toEqual([
      {
        dispatchId: "dispatch-boundary",
        idempotencyKey: "idempotency-boundary",
        observedAtMs: NOW_MS,
        ownerUserId: "owner-boundary",
        reasonCode: "daemon.profile.offline",
        targetWakeLifecycleId:
          dueAtBoundary.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        userRecoveryAction: "start_or_restart_openmeld_service",
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        waitingCategory: "service_not_connected",
      },
      {
        dispatchId: "dispatch-before",
        idempotencyKey: "idempotency-before",
        observedAtMs: NOW_MS,
        ownerUserId: "owner-before",
        reasonCode: "daemon.profile.offline",
        targetWakeLifecycleId:
          dueBeforeBoundary.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        userRecoveryAction: "start_or_restart_openmeld_service",
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        waitingCategory: "service_not_connected",
      },
    ]);
  });

  it("stops before the writer when the budget port rejects work", async () => {
    const readRecords = vi.fn(() =>
      Promise.resolve([
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-due",
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => false);
    const recordHeadWaitingBoundary = vi.fn((request) =>
      Promise.resolve(buildHeadWaitingResponse(request))
    );

    await processRuntimeCoordinatorHeadAcceptedHandoffAlarm({
      nowMs: NOW_MS,
      ports: {
        readRecords,
        recordHeadWaitingBoundary,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(1);
    expect(recordHeadWaitingBoundary).not.toHaveBeenCalled();
  });

  it("ignores future, waiting, linked, and already-decided records through the planner", async () => {
    const readRecords = vi.fn(() =>
      Promise.resolve([
        buildHeadLifecycleRecord({
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS + 1,
          primaryDispatchId: "dispatch-future",
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting",
          status: "waiting",
          waitingBoundary: buildWaitingBoundary(),
        }),
        buildHeadLifecycleRecord({
          executionLinkedAtMs: NOW_MS - 1000,
          primaryDispatchId: "dispatch-linked",
          runtimeCoordinatorExecutionId: "rce-linked",
          status: "execution_linked",
        }),
        buildHeadLifecycleRecord({
          noExecutionDecision: {
            decidedAtMs: NOW_MS - 1000,
            publicationCategory: "service_not_connected",
            reasonCode: "daemon.profile.offline",
            source: "runtime_coordinator_head_waiting_deadline",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
          primaryDispatchId: "dispatch-decided",
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const recordHeadWaitingBoundary = vi.fn((request) =>
      Promise.resolve(buildHeadWaitingResponse(request))
    );

    await processRuntimeCoordinatorHeadAcceptedHandoffAlarm({
      nowMs: NOW_MS,
      ports: {
        readRecords,
        recordHeadWaitingBoundary,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(recordHeadWaitingBoundary).not.toHaveBeenCalled();
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
      const recordHeadWaitingBoundary = vi.fn((request) =>
        Promise.resolve(buildHeadWaitingResponse(request))
      );

      await processRuntimeCoordinatorHeadAcceptedHandoffAlarm({
        nowMs: NOW_MS,
        ports: {
          readRecords: vi.fn(() => Promise.resolve([record])),
          recordHeadWaitingBoundary,
          reserveWorkUnit: vi.fn(() => true),
        },
      });

      expect(recordHeadWaitingBoundary).toHaveBeenCalledWith({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-due",
        idempotencyKey: "idempotency-1",
        observedAtMs: NOW_MS,
        ownerUserId: "owner-1",
        reasonCode: "daemon.profile.offline",
        targetWakeLifecycleIdentity: record.targetWakeLifecycleIdentity,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      });
      expect(dateNow).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});
