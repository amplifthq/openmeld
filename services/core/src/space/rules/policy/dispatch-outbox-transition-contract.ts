import {
  OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
  OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
  type OpenMeldDaemonOutboxStatus,
} from "../../infrastructure/outbox/dispatch-outbox-repo";
import type {
  ActiveAttemptWatchdogDecision,
  HandedOffOutboxCandidatePolicyDecision,
} from "./dispatch-outbox-redrive-policy";

export type CoreOutboxResponsibilityState = OpenMeldDaemonOutboxStatus;

export type OutboxResponsibilityTransitionKind =
  | "hand_off_pending_outbox"
  | "delete_terminal_candidate"
  | "skip_recent_inflight_candidate"
  | "defer_active_attempt_watchdog"
  | "redrive_handed_off_outbox"
  | "submit_watchdog_redrive"
  | "resume_still_owned_wait"
  | "retain_still_owned_active_attempt";

export type OutboxResponsibilityTransition = {
  kind: OutboxResponsibilityTransitionKind;
  allowedFromStates: readonly CoreOutboxResponsibilityState[];
  nextState?: OpenMeldDaemonOutboxStatus;
  terminal: boolean;
};

export const OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX = {
  handOffPendingOutbox: {
    kind: "hand_off_pending_outbox",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_PENDING],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  deleteTerminalCandidate: {
    kind: "delete_terminal_candidate",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    terminal: true,
  },
  skipRecentInflightCandidate: {
    kind: "skip_recent_inflight_candidate",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  deferActiveAttemptWatchdog: {
    kind: "defer_active_attempt_watchdog",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  redriveHandedOffOutbox: {
    kind: "redrive_handed_off_outbox",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  submitWatchdogRedrive: {
    kind: "submit_watchdog_redrive",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  resumeStillOwnedWait: {
    kind: "resume_still_owned_wait",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
  retainStillOwnedActiveAttempt: {
    kind: "retain_still_owned_active_attempt",
    allowedFromStates: [OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF],
    nextState: OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF,
    terminal: false,
  },
} as const satisfies Record<string, OutboxResponsibilityTransition>;

const validateOutboxTransition = (
  transition: OutboxResponsibilityTransition,
  fromState: CoreOutboxResponsibilityState
): OutboxResponsibilityTransition => {
  if (!transition.allowedFromStates.includes(fromState)) {
    throw new Error(
      `outbox transition ${transition.kind} does not allow ${fromState}`
    );
  }
  return transition;
};

export const resolveOutboxTransitionForTransportHandoff = (input: {
  outboxStatus: OpenMeldDaemonOutboxStatus;
}): OutboxResponsibilityTransition => {
  if (input.outboxStatus === OPENMELD_DAEMON_OUTBOX_STATUS_PENDING) {
    return validateOutboxTransition(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.handOffPendingOutbox,
      input.outboxStatus
    );
  }
  return validateOutboxTransition(
    OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.redriveHandedOffOutbox,
    input.outboxStatus
  );
};

export const resolveOutboxTransitionForCandidateDecision = (input: {
  outboxStatus: OpenMeldDaemonOutboxStatus;
  decision: HandedOffOutboxCandidatePolicyDecision;
}): OutboxResponsibilityTransition => {
  if (input.outboxStatus === OPENMELD_DAEMON_OUTBOX_STATUS_PENDING) {
    return validateOutboxTransition(
      OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.handOffPendingOutbox,
      input.outboxStatus
    );
  }

  switch (input.decision.kind) {
    case "delete":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.deleteTerminalCandidate,
        input.outboxStatus
      );
    case "skip":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.skipRecentInflightCandidate,
        input.outboxStatus
      );
    case "check_active_attempt_watchdog":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.deferActiveAttemptWatchdog,
        input.outboxStatus
      );
    case "submit":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.redriveHandedOffOutbox,
        input.outboxStatus
      );
    default: {
      const neverDecision: never = input.decision;
      throw new Error(
        `unsupported outbox candidate decision: ${neverDecision}`
      );
    }
  }
};

export const resolveOutboxTransitionForWatchdogDecision = (input: {
  outboxStatus: OpenMeldDaemonOutboxStatus;
  decision: ActiveAttemptWatchdogDecision;
}): OutboxResponsibilityTransition => {
  switch (input.decision.kind) {
    case "submit":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.submitWatchdogRedrive,
        input.outboxStatus
      );
    case "resume_wait":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.resumeStillOwnedWait,
        input.outboxStatus
      );
    case "skip":
      return validateOutboxTransition(
        OUTBOX_RESPONSIBILITY_TRANSITION_MATRIX.retainStillOwnedActiveAttempt,
        input.outboxStatus
      );
    default: {
      const neverDecision: never = input.decision;
      throw new Error(`unsupported watchdog decision: ${neverDecision}`);
    }
  }
};
