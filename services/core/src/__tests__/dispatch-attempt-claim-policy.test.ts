import { describe, expect, it } from "vitest";
import {
  type DispatchClaimExistingLedgerSnapshot,
  type DispatchClaimLatestAttemptSnapshot,
  resolveDispatchAttemptClaimDecision,
  resolveDispatchDeliveryRecoveryReason,
} from "../dispatch/rules/dispatch-attempt-claim-policy";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../dispatch/rules/dispatch-lifecycle-contract";
import {
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
} from "../dispatch/rules/dispatch-runtime-constants";

const buildExisting = (
  overrides?: Partial<NonNullable<DispatchClaimExistingLedgerSnapshot>>
): NonNullable<DispatchClaimExistingLedgerSnapshot> => {
  return {
    attemptCount: 1,
    dispatchId: "dispatch-1",
    firstSeenAtMs: 1000,
    lastAttemptAtMs: 2000,
    latestAttemptId: "attempt-1",
    status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    ...overrides,
  };
};

const buildLatestAttempt = (
  overrides?: Partial<NonNullable<DispatchClaimLatestAttemptSnapshot>>
): NonNullable<DispatchClaimLatestAttemptSnapshot> => {
  return {
    attemptId: "attempt-1",
    attemptNo: 1,
    status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    errorCode: null,
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    leaseEpoch: 2,
    ...overrides,
  };
};

describe("dispatch attempt claim policy", () => {
  it("claims new dispatches when no ledger row exists", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: null,
        latestAttempt: null,
        nowMs: 2000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "claim_new" });
  });

  it("resolves recovery reasons from explicit requests and failed retryable attempts", () => {
    expect(
      resolveDispatchDeliveryRecoveryReason({
        requestedRecoveryReason: "route_lost",
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        latestAttempt: null,
      })
    ).toBe("route_lost");

    expect(
      resolveDispatchDeliveryRecoveryReason({
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        latestAttempt: buildLatestAttempt({
          errorCode: "daemon.session.connection_replaced",
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        }),
      })
    ).toBe("connection_replaced");
  });

  it("claims an explicit coordinator promotion only from the matching queue-wait attempt", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting(),
        latestAttempt: buildLatestAttempt({
          connectionGeneration: null,
          daemonSessionId: null,
          leaseEpoch: null,
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting,
        }),
        nowMs: 5000,
        requestedDispatchId: "dispatch-1",
        requestedRecoveryReason: "agent_profile_work_coordinator_promoted",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      deliveryRecoveryReason: "agent_profile_work_coordinator_promoted",
      kind: "claim_recovery",
    });

    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting(),
        latestAttempt: buildLatestAttempt(),
        nowMs: 5000,
        requestedDispatchId: "dispatch-1",
        requestedRecoveryReason: "agent_profile_work_coordinator_promoted",
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "dedupe" });
  });

  it("continues waiting-result attempts that still own a daemon lease", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        }),
        latestAttempt: buildLatestAttempt({
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
        }),
        nowMs: 5000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "continue_existing",
      attemptId: "attempt-1",
      attemptNo: 1,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 2,
    });
  });

  it("dedupes fresh queued and terminal dispatches inside the idempotency window", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
          lastAttemptAtMs: 4500,
        }),
        latestAttempt: buildLatestAttempt(),
        nowMs: 5000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "dedupe" });

    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        }),
        latestAttempt: buildLatestAttempt({
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
        }),
        nowMs: 5000,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({ kind: "dedupe" });
  });

  it("reclaims stale queued and dispatching rows once the reclaim window passes", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
          lastAttemptAtMs: 1000,
        }),
        latestAttempt: buildLatestAttempt(),
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "reclaim_stale_queued",
      deliveryRecoveryReason: null,
    });

    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
          lastAttemptAtMs: 1000,
        }),
        latestAttempt: buildLatestAttempt({
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
        }),
        nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "reclaim_stale_dispatching",
      deliveryRecoveryReason: null,
    });
  });

  it.each([
    "queued",
    "dispatching",
    "accepted",
    "succeeded",
    "cancelled",
    "replaced_attempt",
    "workstation_owned",
  ] as const)("resumes hosted admission only while the original unaccepted attempt owns the dispatch: %s", (scenario) => {
    const decision = resolveDispatchAttemptClaimDecision({
      existing: buildExisting({
        status: (
          {
            queued: "queued",
            dispatching: "dispatching",
            accepted: "dispatching",
            succeeded: "succeeded",
            cancelled: "cancelled",
            replaced_attempt: "queued",
            workstation_owned: "queued",
          } as const
        )[scenario],
        latestAttemptId:
          scenario === "replaced_attempt" ? "attempt-2" : "attempt-1",
      }),
      latestAttempt: buildLatestAttempt({
        connectionGeneration: null,
        daemonSessionId:
          scenario === "workstation_owned" ? "daemon-session-1" : null,
        leaseEpoch: null,
        status: scenario === "accepted" ? "waiting_result" : "dispatching",
      }),
      nowMs: 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1,
      requestedDispatchId: "dispatch-1",
      requestedRecoveryReason: "hosted_admission_incomplete",
      staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
    });
    expect(decision).toEqual(
      scenario === "queued" || scenario === "dispatching"
        ? {
            kind: "resume_hosted_admission",
            attemptId: "attempt-1",
            attemptNo: 1,
          }
        : { kind: "dedupe" }
    );
  });

  it("resets existing rows after the idempotency window expires", () => {
    expect(
      resolveDispatchAttemptClaimDecision({
        existing: buildExisting({
          firstSeenAtMs: 1000,
          status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        }),
        latestAttempt: buildLatestAttempt({
          errorCode: "daemon.delivery.timeout",
          status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        }),
        nowMs: 1000 + DISPATCH_IDEMPOTENCY_WINDOW_MS + 1,
        staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
      })
    ).toEqual({
      kind: "reset_existing",
      deliveryRecoveryReason: "route_lost",
    });
  });
});
