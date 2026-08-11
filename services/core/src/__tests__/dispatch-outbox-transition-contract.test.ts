import { describe, expect, it } from "vitest";
import {
  OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
  OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
} from "../space/infrastructure/outbox/dispatch-outbox-repo";
import {
  OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX,
  resolveOutboxTransitionForCandidateDecision,
  resolveOutboxTransitionForTransportHandoff,
  resolveOutboxTransitionForWatchdogDecision,
} from "../space/rules/policy/dispatch-outbox-transition-contract";

describe("dispatch outbox transition contract", () => {
  it("maps pending records and handed-off candidate decisions to explicit transitions", () => {
    expect(
      resolveOutboxTransitionForTransportHandoff({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      })
    ).toEqual(OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.handOffPendingOutbox);

    expect(
      resolveOutboxTransitionForCandidateDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "delete",
        },
      })
    ).toEqual(OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.deleteTerminalCandidate);
    expect(
      resolveOutboxTransitionForCandidateDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "skip",
        },
      })
    ).toEqual(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.skipRecentInflightCandidate
    );
    expect(
      resolveOutboxTransitionForCandidateDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "check_active_attempt_watchdog",
        },
      })
    ).toEqual(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.deferActiveAttemptWatchdog
    );
    expect(
      resolveOutboxTransitionForCandidateDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "submit",
          loopSuspected: true,
        },
      })
    ).toEqual(OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.redriveHandedOffOutbox);
  });

  it("maps watchdog decisions to explicit outbox responsibility transitions", () => {
    expect(
      resolveOutboxTransitionForWatchdogDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "submit",
          reason: "route_lost",
        },
      })
    ).toEqual(OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.submitWatchdogRedrive);
    expect(
      resolveOutboxTransitionForWatchdogDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "resume_wait",
          reason: "still_owned_wait_stale",
        },
      })
    ).toEqual(OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.resumeStillOwnedWait);
    expect(
      resolveOutboxTransitionForWatchdogDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
        decision: {
          kind: "skip",
          reason: "still_owned",
        },
      })
    ).toEqual(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.retainStillOwnedActiveAttempt
    );
  });

  it("rejects impossible outbox transitions", () => {
    expect(() =>
      resolveOutboxTransitionForWatchdogDecision({
        outboxStatus: OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
        decision: {
          kind: "skip",
          reason: "still_owned",
        },
      })
    ).toThrow("does not allow");
  });
});
