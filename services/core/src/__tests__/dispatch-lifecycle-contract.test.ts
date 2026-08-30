import { describe, expect, it } from "vitest";
import {
  isActiveDispatchAttemptState,
  isDispatchLifecycleFresh,
  isDispatchLifecycleStale,
  isInFlightDispatchState,
  isTerminalDispatchAttemptState,
  isTerminalDispatchState,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  resolveAttemptStateForDispatchState,
  toOpenMeldDaemonDispatchAttemptState,
  toOpenMeldDaemonDispatchState,
} from "../dispatch/rules/dispatch-lifecycle-contract";
import { DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS } from "../dispatch/rules/dispatch-runtime-constants";

describe("dispatch lifecycle contract", () => {
  it("parses dispatch and attempt states without widening semantics", () => {
    expect(toOpenMeldDaemonDispatchState("queued")).toBe(
      OPENMELD_DAEMON_DISPATCH_STATE.queued
    );
    expect(toOpenMeldDaemonDispatchState("unknown")).toBeNull();
    expect(toOpenMeldDaemonDispatchState(null)).toBeNull();

    expect(toOpenMeldDaemonDispatchAttemptState("waiting_result")).toBe(
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult
    );
    expect(toOpenMeldDaemonDispatchAttemptState("profile_queue_waiting")).toBe(
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting
    );
    expect(toOpenMeldDaemonDispatchAttemptState("unknown")).toBeNull();
    expect(toOpenMeldDaemonDispatchAttemptState(undefined)).toBeNull();
  });

  it("keeps dispatch and attempt state groupings aligned", () => {
    expect(
      isTerminalDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.succeeded)
    ).toBe(true);
    expect(
      isTerminalDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.deduped)
    ).toBe(true);
    expect(
      isTerminalDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.cancelled)
    ).toBe(true);
    expect(isTerminalDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.queued)).toBe(
      false
    );

    expect(isInFlightDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.queued)).toBe(
      true
    );
    expect(
      isInFlightDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.dispatching)
    ).toBe(true);
    expect(
      isInFlightDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal)
    ).toBe(false);

    expect(
      isTerminalDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal
      )
    ).toBe(true);
    expect(
      isTerminalDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded
      )
    ).toBe(true);
    expect(
      isTerminalDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching
      )
    ).toBe(false);

    expect(
      isActiveDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching
      )
    ).toBe(true);
    expect(
      isActiveDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult
      )
    ).toBe(true);
    expect(
      isActiveDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable
      )
    ).toBe(false);
    expect(
      isActiveDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting
      )
    ).toBe(false);
    expect(
      isTerminalDispatchAttemptState(
        OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting
      )
    ).toBe(false);
  });

  it("maps final dispatch states to attempt states and preserves stale threshold semantics", () => {
    expect(
      resolveAttemptStateForDispatchState(
        OPENMELD_DAEMON_DISPATCH_STATE.succeeded
      )
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded);
    expect(
      resolveAttemptStateForDispatchState(
        OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
      )
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable);
    expect(
      resolveAttemptStateForDispatchState(
        OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal
      )
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal);
    expect(
      resolveAttemptStateForDispatchState(
        OPENMELD_DAEMON_DISPATCH_STATE.blocked
      )
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked);
    expect(
      resolveAttemptStateForDispatchState(
        OPENMELD_DAEMON_DISPATCH_STATE.cancelled
      )
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded);
    expect(
      resolveAttemptStateForDispatchState(OPENMELD_DAEMON_DISPATCH_STATE.queued)
    ).toBe(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching);

    expect(
      isDispatchLifecycleFresh({
        lastAttemptAtMs: 1000,
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS - 1,
      })
    ).toBe(true);
    expect(
      isDispatchLifecycleStale({
        lastAttemptAtMs: 1000,
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toBe(true);
  });
});
