import { describe, expect, it } from "vitest";
import {
  type DispatchClaimExistingLedgerSnapshot,
  type DispatchClaimLatestAttemptSnapshot,
  resolveDispatchAttemptClaimDecision,
} from "../dispatch/rules/dispatch-attempt-claim-policy";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../dispatch/rules/dispatch-lifecycle-contract";
import {
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
} from "../dispatch/rules/dispatch-runtime-constants";
import {
  DISPATCH_ATTEMPT_TRANSITION_MATRIX,
  DISPATCH_LEDGER_TRANSITION_MATRIX,
  resolveDispatchAttemptTransitionForClaimDecision,
  resolveDispatchAttemptTransitionForSettledStatus,
  resolveDispatchAttemptTransitionForWaitingResult,
  resolveDispatchLedgerTransitionForClaimDecision,
  resolveDispatchLedgerTransitionForSettledStatus,
  resolveDispatchLedgerTransitionForWaitingResult,
  resolveSupersededAttemptTransition,
} from "../dispatch/rules/dispatch-state-transition-contract";

const buildExisting = (
  overrides?: Partial<NonNullable<DispatchClaimExistingLedgerSnapshot>>
): NonNullable<DispatchClaimExistingLedgerSnapshot> => ({
  attemptCount: 1,
  dispatchId: "dispatch-1",
  firstSeenAtMs: 1000,
  lastAttemptAtMs: 2000,
  latestAttemptId: "attempt-1",
  status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  ...overrides,
});

const buildLatestAttempt = (
  overrides?: Partial<NonNullable<DispatchClaimLatestAttemptSnapshot>>
): NonNullable<DispatchClaimLatestAttemptSnapshot> => ({
  attemptId: "attempt-1",
  attemptNo: 1,
  status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  errorCode: null,
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  leaseEpoch: 1,
  ...overrides,
});

describe("dispatch state transition contract", () => {
  it("maps every claim decision to a single ledger transition", () => {
    const cases = [
      {
        existingStatus: null,
        latestAttemptStatus: null,
        decision: resolveDispatchAttemptClaimDecision({
          existing: null,
          latestAttempt: null,
          nowMs: 2000,
          staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        }),
        expectedLedger: DISPATCH_LEDGER_TRANSITION_MATRIX.claimNewDispatch,
        expectedAttempt: DISPATCH_ATTEMPT_TRANSITION_MATRIX.startNewAttempt,
      },
      {
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        latestAttemptStatus:
          OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
        decision: resolveDispatchAttemptClaimDecision({
          existing: buildExisting({
            status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
          }),
          latestAttempt: buildLatestAttempt({
            status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
          }),
          nowMs: 5000,
          staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        }),
        expectedLedger:
          DISPATCH_LEDGER_TRANSITION_MATRIX.continueExistingDispatch,
        expectedAttempt:
          DISPATCH_ATTEMPT_TRANSITION_MATRIX.continueExistingAttempt,
      },
      {
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.queued,
        latestAttemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
        decision: resolveDispatchAttemptClaimDecision({
          existing: buildExisting({
            status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
            lastAttemptAtMs: 1000,
          }),
          latestAttempt: buildLatestAttempt(),
          nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
          staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        }),
        expectedLedger: DISPATCH_LEDGER_TRANSITION_MATRIX.reclaimStaleQueued,
        expectedAttempt:
          DISPATCH_ATTEMPT_TRANSITION_MATRIX.startReclaimedQueuedAttempt,
      },
      {
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        latestAttemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
        decision: resolveDispatchAttemptClaimDecision({
          existing: buildExisting({
            status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
            lastAttemptAtMs: 1000,
          }),
          latestAttempt: buildLatestAttempt(),
          nowMs: 1000 + DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS + 1,
          staleReclaimMs: DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS,
        }),
        expectedLedger:
          DISPATCH_LEDGER_TRANSITION_MATRIX.reclaimStaleDispatching,
        expectedAttempt:
          DISPATCH_ATTEMPT_TRANSITION_MATRIX.startReclaimedDispatchingAttempt,
      },
      {
        existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
        latestAttemptStatus:
          OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        decision: resolveDispatchAttemptClaimDecision({
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
        }),
        expectedLedger: DISPATCH_LEDGER_TRANSITION_MATRIX.resetExistingDispatch,
        expectedAttempt: DISPATCH_ATTEMPT_TRANSITION_MATRIX.startResetAttempt,
      },
    ] as const;

    for (const sample of cases) {
      expect(
        resolveDispatchLedgerTransitionForClaimDecision({
          existingStatus: sample.existingStatus,
          decision: sample.decision,
        })
      ).toEqual(sample.expectedLedger);
      expect(
        resolveDispatchAttemptTransitionForClaimDecision({
          latestAttemptStatus: sample.latestAttemptStatus,
          decision: sample.decision,
        })
      ).toEqual(sample.expectedAttempt);
    }
  });

  it("keeps waiting-result and settled transitions explicit", () => {
    expect(resolveDispatchLedgerTransitionForWaitingResult()).toEqual(
      DISPATCH_LEDGER_TRANSITION_MATRIX.markWaitingResultDispatch
    );
    expect(
      resolveDispatchAttemptTransitionForWaitingResult({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      })
    ).toEqual(DISPATCH_ATTEMPT_TRANSITION_MATRIX.markAttemptWaitingResult);

    expect(
      resolveDispatchLedgerTransitionForSettledStatus({
        fromState: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
        nextState: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
      })
    ).toEqual(DISPATCH_LEDGER_TRANSITION_MATRIX.settleDispatchSucceeded);
    expect(
      resolveDispatchAttemptTransitionForSettledStatus({
        fromState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
        dispatchStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    ).toEqual(DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptFailedRetryable);
    expect(
      resolveDispatchAttemptTransitionForSettledStatus({
        fromState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
        dispatchStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      })
    ).toEqual(DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptTimedOut);
  });

  it("keeps stale-attempt supersede as an explicit attempt transition", () => {
    expect(
      resolveSupersededAttemptTransition({
        latestAttemptStatus:
          OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
      })
    ).toEqual(DISPATCH_ATTEMPT_TRANSITION_MATRIX.supersedeStaleAttempt);
  });

  it("rejects impossible transition mappings", () => {
    expect(() =>
      resolveDispatchLedgerTransitionForSettledStatus({
        fromState: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
        nextState: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
      })
    ).toThrow("does not allow");
    expect(() =>
      resolveDispatchAttemptTransitionForWaitingResult({
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      })
    ).toThrow("does not allow");
  });
});
