import type { DispatchAttemptClaimDecision } from "./dispatch-attempt-claim-policy";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  type OpenMeldDaemonDispatchAttemptState,
  type OpenMeldDaemonDispatchState,
  resolveAttemptStateForDispatchState,
} from "./dispatch-lifecycle-contract";

export type CoreDispatchLedgerLifecycleState =
  OpenMeldDaemonDispatchState | null;
export type CoreDispatchAttemptLifecycleState =
  OpenMeldDaemonDispatchAttemptState | null;

type DispatchTransitionCategory =
  | "claim"
  | "continue"
  | "dedupe"
  | "reclaim"
  | "reset"
  | "progress"
  | "settle";

export type DispatchLedgerTransitionKind =
  | "claim_new_dispatch"
  | "reset_existing_dispatch"
  | "claim_recovery_dispatch"
  | "continue_existing_dispatch"
  | "dedupe_existing_dispatch"
  | "reclaim_stale_dispatching"
  | "reclaim_stale_queued"
  | "claim_existing_dispatch"
  | "mark_waiting_result_dispatch"
  | "settle_dispatch_succeeded"
  | "settle_dispatch_failed_retryable"
  | "settle_dispatch_failed_terminal"
  | "settle_dispatch_blocked";

export type DispatchAttemptTransitionKind =
  | "start_new_attempt"
  | "start_reset_attempt"
  | "start_recovery_attempt"
  | "continue_existing_attempt"
  | "dedupe_existing_attempt"
  | "supersede_stale_attempt"
  | "start_reclaimed_dispatching_attempt"
  | "start_reclaimed_queued_attempt"
  | "start_existing_window_attempt"
  | "mark_attempt_waiting_result"
  | "settle_attempt_succeeded"
  | "settle_attempt_failed_retryable"
  | "settle_attempt_failed_terminal"
  | "settle_attempt_blocked"
  | "settle_attempt_timed_out";

export type DispatchLedgerTransition = {
  kind: DispatchLedgerTransitionKind;
  category: DispatchTransitionCategory;
  allowedFromStates: readonly CoreDispatchLedgerLifecycleState[];
  toState: OpenMeldDaemonDispatchState;
};

export type DispatchAttemptTransition = {
  kind: DispatchAttemptTransitionKind;
  category: DispatchTransitionCategory;
  allowedFromStates: readonly CoreDispatchAttemptLifecycleState[];
  toState: OpenMeldDaemonDispatchAttemptState | null;
};

const ALL_DISPATCH_LEDGER_STATES: readonly OpenMeldDaemonDispatchState[] = [
  OPENMELD_DAEMON_DISPATCH_STATE.queued,
  OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
  OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
  OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
  OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  OPENMELD_DAEMON_DISPATCH_STATE.deduped,
  OPENMELD_DAEMON_DISPATCH_STATE.blocked,
] as const;

const ALL_DISPATCH_ATTEMPT_STATES: readonly OpenMeldDaemonDispatchAttemptState[] =
  [
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
  ] as const;

export const DISPATCH_LEDGER_TRANSITION_MATRIX = {
  claimNewDispatch: {
    kind: "claim_new_dispatch",
    category: "claim",
    allowedFromStates: [null],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  resetExistingDispatch: {
    kind: "reset_existing_dispatch",
    category: "reset",
    allowedFromStates: ALL_DISPATCH_LEDGER_STATES,
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  claimRecoveryDispatch: {
    kind: "claim_recovery_dispatch",
    category: "claim",
    allowedFromStates: ALL_DISPATCH_LEDGER_STATES,
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  continueExistingDispatch: {
    kind: "continue_existing_dispatch",
    category: "continue",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_STATE.dispatching],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
  },
  dedupeExistingDispatch: {
    kind: "dedupe_existing_dispatch",
    category: "dedupe",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
      OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      OPENMELD_DAEMON_DISPATCH_STATE.deduped,
      OPENMELD_DAEMON_DISPATCH_STATE.blocked,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.deduped,
  },
  reclaimStaleDispatching: {
    kind: "reclaim_stale_dispatching",
    category: "reclaim",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_STATE.dispatching],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  reclaimStaleQueued: {
    kind: "reclaim_stale_queued",
    category: "reclaim",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_STATE.queued],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  claimExistingDispatch: {
    kind: "claim_existing_dispatch",
    category: "claim",
    allowedFromStates: [null, OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.queued,
  },
  markWaitingResultDispatch: {
    kind: "mark_waiting_result_dispatch",
    category: "progress",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_STATE.dispatching],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
  },
  settleDispatchSucceeded: {
    kind: "settle_dispatch_succeeded",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
  },
  settleDispatchFailedRetryable: {
    kind: "settle_dispatch_failed_retryable",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
  },
  settleDispatchFailedTerminal: {
    kind: "settle_dispatch_failed_terminal",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_STATE.queued,
      OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  },
  settleDispatchBlocked: {
    kind: "settle_dispatch_blocked",
    category: "settle",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_STATE.queued],
    toState: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
  },
} as const satisfies Record<string, DispatchLedgerTransition>;

export const DISPATCH_ATTEMPT_TRANSITION_MATRIX = {
  startNewAttempt: {
    kind: "start_new_attempt",
    category: "claim",
    allowedFromStates: [null],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  startResetAttempt: {
    kind: "start_reset_attempt",
    category: "reset",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  startRecoveryAttempt: {
    kind: "start_recovery_attempt",
    category: "claim",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  continueExistingAttempt: {
    kind: "continue_existing_attempt",
    category: "continue",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
  },
  dedupeExistingAttempt: {
    kind: "dedupe_existing_attempt",
    category: "dedupe",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: null,
  },
  supersedeStaleAttempt: {
    kind: "supersede_stale_attempt",
    category: "reclaim",
    allowedFromStates: [
      null,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
  },
  startReclaimedDispatchingAttempt: {
    kind: "start_reclaimed_dispatching_attempt",
    category: "reclaim",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  startReclaimedQueuedAttempt: {
    kind: "start_reclaimed_queued_attempt",
    category: "reclaim",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  startExistingWindowAttempt: {
    kind: "start_existing_window_attempt",
    category: "claim",
    allowedFromStates: [null, ...ALL_DISPATCH_ATTEMPT_STATES],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
  },
  markAttemptWaitingResult: {
    kind: "mark_attempt_waiting_result",
    category: "progress",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
  },
  settleAttemptSucceeded: {
    kind: "settle_attempt_succeeded",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
  },
  settleAttemptFailedRetryable: {
    kind: "settle_attempt_failed_retryable",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
  },
  settleAttemptFailedTerminal: {
    kind: "settle_attempt_failed_terminal",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
  },
  settleAttemptBlocked: {
    kind: "settle_attempt_blocked",
    category: "settle",
    allowedFromStates: [OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked,
  },
  settleAttemptTimedOut: {
    kind: "settle_attempt_timed_out",
    category: "settle",
    allowedFromStates: [
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
    ],
    toState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
  },
} as const satisfies Record<string, DispatchAttemptTransition>;

const validateLedgerTransition = (
  transition: DispatchLedgerTransition,
  fromState: CoreDispatchLedgerLifecycleState
): DispatchLedgerTransition => {
  if (!transition.allowedFromStates.includes(fromState)) {
    throw new Error(
      `dispatch ledger transition ${transition.kind} does not allow ${String(fromState)}`
    );
  }
  return transition;
};

const validateAttemptTransition = (
  transition: DispatchAttemptTransition,
  fromState: CoreDispatchAttemptLifecycleState
): DispatchAttemptTransition => {
  if (!transition.allowedFromStates.includes(fromState)) {
    throw new Error(
      `dispatch attempt transition ${transition.kind} does not allow ${String(fromState)}`
    );
  }
  return transition;
};

export const resolveDispatchLedgerTransitionForClaimDecision = (input: {
  existingStatus: CoreDispatchLedgerLifecycleState;
  decision: DispatchAttemptClaimDecision;
}): DispatchLedgerTransition => {
  switch (input.decision.kind) {
    case "claim_new":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.claimNewDispatch,
        input.existingStatus
      );
    case "reset_existing":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.resetExistingDispatch,
        input.existingStatus
      );
    case "claim_recovery":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.claimRecoveryDispatch,
        input.existingStatus
      );
    case "continue_existing":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.continueExistingDispatch,
        input.existingStatus
      );
    case "dedupe":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.dedupeExistingDispatch,
        input.existingStatus
      );
    case "reclaim_stale_dispatching":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.reclaimStaleDispatching,
        input.existingStatus
      );
    case "reclaim_stale_queued":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.reclaimStaleQueued,
        input.existingStatus
      );
    case "claim_existing_inside_window":
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.claimExistingDispatch,
        input.existingStatus
      );
    default: {
      const neverDecision: never = input.decision;
      throw new Error(`unsupported dispatch claim decision: ${neverDecision}`);
    }
  }
};

export const resolveDispatchAttemptTransitionForClaimDecision = (input: {
  latestAttemptStatus: CoreDispatchAttemptLifecycleState;
  decision: DispatchAttemptClaimDecision;
}): DispatchAttemptTransition => {
  switch (input.decision.kind) {
    case "claim_new":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startNewAttempt,
        input.latestAttemptStatus
      );
    case "reset_existing":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startResetAttempt,
        input.latestAttemptStatus
      );
    case "claim_recovery":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startRecoveryAttempt,
        input.latestAttemptStatus
      );
    case "continue_existing":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.continueExistingAttempt,
        input.latestAttemptStatus
      );
    case "dedupe":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.dedupeExistingAttempt,
        input.latestAttemptStatus
      );
    case "reclaim_stale_dispatching":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startReclaimedDispatchingAttempt,
        input.latestAttemptStatus
      );
    case "reclaim_stale_queued":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startReclaimedQueuedAttempt,
        input.latestAttemptStatus
      );
    case "claim_existing_inside_window":
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.startExistingWindowAttempt,
        input.latestAttemptStatus
      );
    default: {
      const neverDecision: never = input.decision;
      throw new Error(`unsupported dispatch claim decision: ${neverDecision}`);
    }
  }
};

export const resolveSupersededAttemptTransition = (input: {
  latestAttemptStatus: CoreDispatchAttemptLifecycleState;
}): DispatchAttemptTransition =>
  validateAttemptTransition(
    DISPATCH_ATTEMPT_TRANSITION_MATRIX.supersedeStaleAttempt,
    input.latestAttemptStatus
  );

export const resolveDispatchLedgerTransitionForWaitingResult =
  (): DispatchLedgerTransition =>
    DISPATCH_LEDGER_TRANSITION_MATRIX.markWaitingResultDispatch;

export const resolveDispatchAttemptTransitionForWaitingResult = (input: {
  attemptStatus: CoreDispatchAttemptLifecycleState;
}): DispatchAttemptTransition =>
  validateAttemptTransition(
    DISPATCH_ATTEMPT_TRANSITION_MATRIX.markAttemptWaitingResult,
    input.attemptStatus
  );

export const resolveDispatchLedgerTransitionForSettledStatus = (input: {
  fromState: CoreDispatchLedgerLifecycleState;
  nextState: OpenMeldDaemonDispatchState;
}): DispatchLedgerTransition => {
  switch (input.nextState) {
    case OPENMELD_DAEMON_DISPATCH_STATE.succeeded:
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.settleDispatchSucceeded,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable:
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.settleDispatchFailedRetryable,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal:
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.settleDispatchFailedTerminal,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_STATE.blocked:
      return validateLedgerTransition(
        DISPATCH_LEDGER_TRANSITION_MATRIX.settleDispatchBlocked,
        input.fromState
      );
    default:
      throw new Error(`unsupported settled dispatch state: ${input.nextState}`);
  }
};

export const resolveDispatchAttemptTransitionForSettledStatus = (input: {
  fromState: CoreDispatchAttemptLifecycleState;
  dispatchStatus: OpenMeldDaemonDispatchState;
  attemptStatus?: OpenMeldDaemonDispatchAttemptState;
}): DispatchAttemptTransition => {
  const explicitAttemptStatus =
    input.attemptStatus ??
    resolveAttemptStateForDispatchState(input.dispatchStatus);
  switch (explicitAttemptStatus) {
    case OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded:
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptSucceeded,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable:
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptFailedRetryable,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal:
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptFailedTerminal,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked:
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptBlocked,
        input.fromState
      );
    case OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut:
      return validateAttemptTransition(
        DISPATCH_ATTEMPT_TRANSITION_MATRIX.settleAttemptTimedOut,
        input.fromState
      );
    default:
      throw new Error(
        `unsupported settled dispatch attempt state: ${explicitAttemptStatus}`
      );
  }
};
