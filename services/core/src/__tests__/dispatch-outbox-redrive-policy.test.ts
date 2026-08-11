import { describe, expect, it } from "vitest";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../dispatch/rules/dispatch-lifecycle-contract";
import { DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS } from "../dispatch/rules/dispatch-runtime-constants";
import {
  resolveActiveAttemptWatchdogDecision,
  resolveHandedOffOutboxCandidatePolicyDecision,
  resolveHandedOffOutboxCandidateRecoveryReason,
  shouldSkipOutboxCandidateForActiveAttempt,
  shouldSkipOutboxCandidateForRecentInflight,
  shouldSuspectOutboxRedriveLoop,
} from "../space/rules/policy/dispatch-outbox-redrive-policy";

describe("dispatch outbox redrive policy", () => {
  it("retires handed-off seeds after durable dispatch intake and leaves untracked candidates ready to submit", () => {
    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "pending",
        ledgerRow: null,
        nowMs: 2000,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "submit" });

    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: null,
        nowMs: 2000,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "skip" });

    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: {
          status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
          lastAttemptAtMs: 1000,
          latestAttemptStatus: "dispatching",
          latestAttemptErrorCode: null,
          daemonSessionId: null,
          connectionGeneration: null,
          leaseEpoch: null,
        },
        nowMs: 1000 + 10_000,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "delete" });
  });

  it("retires intake-confirmed handoff evidence without using attempt state as outbox authority", () => {
    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: {
          status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
          lastAttemptAtMs: 1000,
          latestAttemptStatus: "succeeded",
          latestAttemptErrorCode: null,
          daemonSessionId: null,
          connectionGeneration: null,
          leaseEpoch: null,
        },
        nowMs: 2000,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "delete" });

    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: {
          status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
          lastAttemptAtMs: 1000,
          latestAttemptStatus: "waiting_result",
          latestAttemptErrorCode: null,
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 2,
        },
        nowMs: 1000 + 30_000,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "delete" });
  });

  it("keeps explicit recovery reasons as diagnostic evidence, not redrive authority", () => {
    expect(
      resolveHandedOffOutboxCandidateRecoveryReason({
        latestAttemptErrorCode: "daemon.session.connection_replaced",
      })
    ).toBe("connection_replaced");
    expect(
      resolveHandedOffOutboxCandidateRecoveryReason({
        latestAttemptErrorCode: "daemon.session.not_found",
      })
    ).toBe("route_lost");
    expect(
      resolveHandedOffOutboxCandidateRecoveryReason({
        latestAttemptErrorCode: "other",
      })
    ).toBeNull();

    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: {
          status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
          lastAttemptAtMs: 1000,
          latestAttemptStatus: "failed_retryable",
          latestAttemptErrorCode: "daemon.session.not_found",
          daemonSessionId: null,
          connectionGeneration: null,
          leaseEpoch: null,
        },
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "delete" });

    expect(
      resolveHandedOffOutboxCandidatePolicyDecision({
        outboxStatus: "handed_off",
        ledgerRow: {
          status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
          lastAttemptAtMs: 1000,
          latestAttemptStatus: "failed_retryable",
          latestAttemptErrorCode: null,
          daemonSessionId: null,
          connectionGeneration: null,
          leaseEpoch: null,
        },
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
        recentInflightSkipWithinMs: 20_000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "delete" });
  });

  it("keeps helper semantics aligned for active attempts, inflight skip, and watchdog routing", () => {
    expect(
      shouldSkipOutboxCandidateForActiveAttempt({
        latestAttemptStatus: "waiting_result",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      })
    ).toBe(true);
    expect(
      shouldSkipOutboxCandidateForActiveAttempt({
        latestAttemptStatus: "failed_terminal",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      })
    ).toBe(false);

    expect(
      shouldSkipOutboxCandidateForRecentInflight({
        status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
        lastAttemptAtMs: 1000,
        nowMs: 1000 + 10_000,
        skipWithinMs: 20_000,
      })
    ).toBe(true);
    expect(
      shouldSkipOutboxCandidateForRecentInflight({
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        lastAttemptAtMs: 1000,
        nowMs: 1000 + 10_000,
        skipWithinMs: 20_000,
      })
    ).toBe(false);

    expect(
      shouldSuspectOutboxRedriveLoop({
        outboxStatus: "handed_off",
        ledgerStatus: OPENMELD_DAEMON_DISPATCH_STATE.queued,
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toBe(true);

    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: 0,
        latestAttemptStatus: "waiting_result",
        routeOwnershipState: "connection_replaced",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: 0,
        latestAttemptStatus: "waiting_result",
        routeOwnershipState: "route_lost",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS - 1,
        latestAttemptStatus: "waiting_result",
        routeOwnershipState: "ownership_unknown",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS - 1,
        latestAttemptStatus: "waiting_result",
        routeOwnershipState: "still_owned",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        latestAttemptStatus: "waiting_result",
        routeOwnershipState: "still_owned",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        latestAttemptStatus: "dispatching",
        routeOwnershipState: "route_lost",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "route_lost",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        latestAttemptStatus: "dispatching",
        routeOwnershipState: "connection_replaced",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "connection_replaced",
    });
    expect(
      resolveActiveAttemptWatchdogDecision({
        lastAttemptAgeMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        latestAttemptStatus: "dispatching",
        routeOwnershipState: "still_owned",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "skip",
      reason: "still_owned",
    });
  });
});
