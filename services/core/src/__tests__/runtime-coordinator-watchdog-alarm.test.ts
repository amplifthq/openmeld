import { RUNTIME_TRANSPORT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  hasRuntimeCoordinatorLocalProgressStaleTerminalExpired,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
  type RuntimeCoordinatorRunCommandState,
} from "../runtime-transport/application/runtime-coordinator-authority";
import {
  processRuntimeCoordinatorWatchdogAlarm,
  type RuntimeCoordinatorWatchdogAlarmPorts,
} from "../runtime-transport/application/runtime-coordinator-watchdog-alarm";

const NOW_MS = 1_700_000_000_000;

type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const buildCommandState = (
  overrides: Partial<RuntimeCoordinatorRunCommandState> = {}
): RuntimeCoordinatorRunCommandState => ({
  activeRunId: "run-1",
  attemptId: "attempt-1",
  createdAtMs: NOW_MS - 31_000,
  dispatchId: "dispatch-1",
  lastCommandReasonCode: null,
  lastDeliveryProvenance: {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    leaseEpoch: 1,
  },
  lastWatchdogCheckAtMs: null,
  localProgress: {
    acceptedLocalAtMs: null,
    completedLocalAtMs: null,
    lastLifecycleAtMs: null,
    phase: "starting",
    resultReceivedAtMs: null,
    runningAtMs: null,
  },
  modelVersion: RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
  ownerUserId: "owner-1",
  profileId: "agent-1",
  redeliveryCount: 0,
  runtimeCoordinatorExecutionId: "rce-1",
  sanitizedDeliveryRequest: {
    code: "daemon.dispatch.deliver",
    payload: {
      dispatchId: "dispatch-1",
      spaceId: "space-1",
    },
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
  } as unknown as RuntimeTransportDeliverDispatchRequest,
  sourceClientMessageId: "client-message-1",
  targetProfileId: "agent-1",
  updatedAtMs: NOW_MS - 31_000,
  ...overrides,
});

describe("RuntimeCoordinator watchdog alarm processor", () => {
  it("keeps the communication window anchored to accepted progress, without extending other deadlines", () => {
    const baseline = NOW_MS - 9 * 60_000;
    const commandState = buildCommandState({
      communicationRecoveryBaselineAtMs: baseline,
      lastWatchdogCheckAtMs: NOW_MS,
      localProgress: {
        acceptedLocalAtMs: baseline,
        completedLocalAtMs: null,
        lastLifecycleAtMs: baseline,
        phase: "running",
        resultReceivedAtMs: null,
        runningAtMs: baseline,
      },
    });
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState,
        nowMs: NOW_MS,
      })
    ).toBe(false);
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState,
        nowMs: baseline + 30 * 60_000,
      })
    ).toBe(true);
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState: {
          ...commandState,
          communicationRecoveryBaselineAtMs: undefined,
        },
        nowMs: NOW_MS,
      })
    ).toBe(true);
    // New accepted evidence ends uncertainty for the old gap; a still-connected
    // controller that subsequently stops reporting uses the ordinary policy.
    expect(
      hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
        commandState: {
          ...commandState,
          localProgress: {
            ...commandState.localProgress,
            lastLifecycleAtMs: baseline + 1,
          },
        },
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });
  it("processes due command states through a high-level delegate in index order", async () => {
    const dueFirst = buildCommandState({
      dispatchId: "dispatch-first",
      runtimeCoordinatorExecutionId: "rce-first",
    });
    const dueSecond = buildCommandState({
      dispatchId: "dispatch-second",
      runtimeCoordinatorExecutionId: "rce-second",
    });
    const readCommandStates = vi.fn(() =>
      Promise.resolve([dueFirst, dueSecond])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processWatchdogDue = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorWatchdogAlarm({
      nowMs: NOW_MS,
      ports: {
        processWatchdogDue,
        readCommandStates,
        reserveWorkUnit,
      },
    });

    expect(readCommandStates).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(processWatchdogDue.mock.calls).toEqual([
      [
        {
          commandState: dueFirst,
          nextCheckAtMs: dueFirst.createdAtMs + 30_001,
          nowMs: NOW_MS,
        },
      ],
      [
        {
          commandState: dueSecond,
          nextCheckAtMs: dueSecond.createdAtMs + 30_001,
          nowMs: NOW_MS,
        },
      ],
    ]);
  });

  it("stops before the delegate when the budget port rejects work", async () => {
    const readCommandStates = vi.fn(() =>
      Promise.resolve([buildCommandState()])
    );
    const reserveWorkUnit = vi.fn(() => false);
    const processWatchdogDue = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorWatchdogAlarm({
      nowMs: NOW_MS,
      ports: {
        processWatchdogDue,
        readCommandStates,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(1);
    expect(processWatchdogDue).not.toHaveBeenCalled();
  });

  it("ignores command states whose next watchdog check is not due", async () => {
    const readCommandStates = vi.fn(() =>
      Promise.resolve([
        buildCommandState({
          createdAtMs: NOW_MS - 29_000,
          updatedAtMs: NOW_MS - 29_000,
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processWatchdogDue = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorWatchdogAlarm({
      nowMs: NOW_MS,
      ports: {
        processWatchdogDue,
        readCommandStates,
        reserveWorkUnit,
      },
    });

    expect(readCommandStates).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(processWatchdogDue).not.toHaveBeenCalled();
  });

  it("ignores command states that already received a result", async () => {
    const readCommandStates = vi.fn(() =>
      Promise.resolve([
        buildCommandState({
          localProgress: {
            acceptedLocalAtMs: NOW_MS - 20_000,
            completedLocalAtMs: NOW_MS - 10_000,
            lastLifecycleAtMs: NOW_MS - 10_000,
            phase: "result_received",
            resultReceivedAtMs: NOW_MS - 5000,
            runningAtMs: NOW_MS - 15_000,
          },
        }),
      ])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processWatchdogDue = vi.fn(() => Promise.resolve());

    await processRuntimeCoordinatorWatchdogAlarm({
      nowMs: NOW_MS,
      ports: {
        processWatchdogDue,
        readCommandStates,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).not.toHaveBeenCalled();
    expect(processWatchdogDue).not.toHaveBeenCalled();
  });

  it("uses injected time and ports instead of ambient runtime APIs", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchSpy,
    });
    const readCommandStates = vi.fn(() =>
      Promise.resolve([buildCommandState()])
    );
    const reserveWorkUnit = vi.fn(() => true);
    const processWatchdogDue = vi.fn(() => Promise.resolve());

    try {
      await processRuntimeCoordinatorWatchdogAlarm({
        nowMs: NOW_MS,
        ports: {
          processWatchdogDue,
          readCommandStates,
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

  it("keeps the port surface limited to one high-level watchdog delegate", () => {
    type ActualKeys = keyof RuntimeCoordinatorWatchdogAlarmPorts;
    type ExpectedKeys =
      | "processWatchdogDue"
      | "readCommandStates"
      | "reserveWorkUnit";
    const exact: IsExact<ActualKeys, ExpectedKeys> = true;

    expect(exact).toBe(true);
  });
});
