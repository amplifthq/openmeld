import { describe, expect, it } from "vitest";
import {
  DISPATCH_ATTEMPT_TRANSITION_MATRIX,
  DISPATCH_LEDGER_TRANSITION_MATRIX,
  type DispatchAttemptTransitionKind,
  type DispatchLedgerTransitionKind,
} from "../dispatch/rules/dispatch-state-transition-contract";
import {
  OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX,
  type OutboxResponsibilityTransitionKind,
} from "../space/rules/policy/dispatch-outbox-transition-contract";

const EXPECTED_LEDGER_TRANSITION_KINDS: Record<
  DispatchLedgerTransitionKind,
  true
> = {
  claim_existing_dispatch: true,
  claim_new_dispatch: true,
  claim_recovery_dispatch: true,
  continue_existing_dispatch: true,
  dedupe_existing_dispatch: true,
  mark_waiting_result_dispatch: true,
  reclaim_stale_dispatching: true,
  reclaim_stale_queued: true,
  reset_existing_dispatch: true,
  settle_dispatch_blocked: true,
  settle_dispatch_failed_retryable: true,
  settle_dispatch_failed_terminal: true,
  settle_dispatch_succeeded: true,
};

const EXPECTED_ATTEMPT_TRANSITION_KINDS: Record<
  DispatchAttemptTransitionKind,
  true
> = {
  continue_existing_attempt: true,
  dedupe_existing_attempt: true,
  mark_attempt_waiting_result: true,
  settle_attempt_blocked: true,
  settle_attempt_failed_retryable: true,
  settle_attempt_failed_terminal: true,
  settle_attempt_succeeded: true,
  settle_attempt_timed_out: true,
  start_existing_window_attempt: true,
  start_new_attempt: true,
  start_reclaimed_dispatching_attempt: true,
  start_reclaimed_queued_attempt: true,
  start_recovery_attempt: true,
  start_reset_attempt: true,
  supersede_stale_attempt: true,
};

const EXPECTED_OUTBOX_TRANSITION_KINDS: Record<
  OutboxResponsibilityTransitionKind,
  true
> = {
  defer_active_attempt_watchdog: true,
  delete_terminal_candidate: true,
  hand_off_pending_outbox: true,
  redrive_handed_off_outbox: true,
  submit_watchdog_redrive: true,
  retain_still_owned_active_attempt: true,
  resume_still_owned_wait: true,
  skip_recent_inflight_candidate: true,
};

const sortStrings = (values: Iterable<string>): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

describe("dispatch transition matrix coverage", () => {
  it("keeps ledger transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      DISPATCH_LEDGER_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_LEDGER_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(DISPATCH_LEDGER_TRANSITION_MATRIX)) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });

  it("keeps attempt transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      DISPATCH_ATTEMPT_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_ATTEMPT_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(
      DISPATCH_ATTEMPT_TRANSITION_MATRIX
    )) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });

  it("keeps outbox responsibility transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_OUTBOX_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX
    )) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });
});
