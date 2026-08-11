import type { OpenMeldDaemonDispatchDeliveryRecoveryReason } from "@openmeld/schemas/types";
import {
  isActiveDispatchAttemptState,
  isInFlightDispatchState,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../../../dispatch/rules/dispatch-lifecycle-contract";

export type ActiveAttemptWatchdogReason =
  OpenMeldDaemonDispatchDeliveryRecoveryReason;
export type ActiveAttemptWatchdogResumeReason = "still_owned_wait_stale";
export type ActiveAttemptWatchdogSkipReason =
  | "accepted_attempt_waiting_result"
  | "connection_replaced"
  | "ownership_unknown"
  | "route_lost"
  | "still_owned";
export type ActiveAttemptRouteOwnershipState =
  | "still_owned"
  | "ownership_unknown"
  | OpenMeldDaemonDispatchDeliveryRecoveryReason;
export type ActiveAttemptWatchdogDecision =
  | {
      kind: "submit";
      reason: ActiveAttemptWatchdogReason;
    }
  | {
      kind: "resume_wait";
      reason: ActiveAttemptWatchdogResumeReason;
    }
  | {
      kind: "skip";
      reason: ActiveAttemptWatchdogSkipReason;
    };

export type DispatchOutboxLedgerStatusSnapshot = {
  status: string;
  lastAttemptAtMs: number;
  latestAttemptStatus: string | null;
  latestAttemptErrorCode: string | null;
  daemonSessionId: string | null;
  connectionGeneration: number | null;
  leaseEpoch: number | null;
};

export type HandedOffOutboxCandidatePolicyDecision =
  | { kind: "submit" }
  | { kind: "delete" }
  | { kind: "skip" }
  | { kind: "check_active_attempt_watchdog" }
  | {
      kind: "submit";
      deliveryRecoveryReason: ActiveAttemptWatchdogReason;
      loopSuspected: boolean;
    }
  | {
      kind: "submit";
      loopSuspected: boolean;
    };

export const resolveHandedOffOutboxCandidateRecoveryReason = (input: {
  latestAttemptErrorCode: string | null;
}): ActiveAttemptWatchdogReason | null => {
  switch (input.latestAttemptErrorCode) {
    case "daemon.session.connection_replaced":
      return "connection_replaced";
    case "daemon.session.not_found":
      return "route_lost";
    default:
      return null;
  }
};

export const shouldSkipOutboxCandidateForActiveAttempt = (input: {
  latestAttemptStatus: string | null;
  daemonSessionId: string | null;
  leaseEpoch: number | null;
}): boolean => {
  return Boolean(
    isActiveDispatchAttemptState(input.latestAttemptStatus) &&
      input.daemonSessionId &&
      typeof input.leaseEpoch === "number" &&
      input.leaseEpoch > 0
  );
};

export const shouldSkipOutboxCandidateForRecentInflight = (input: {
  status: string;
  lastAttemptAtMs: number;
  nowMs: number;
  skipWithinMs: number;
}): boolean => {
  return (
    isInFlightDispatchState(input.status) &&
    input.nowMs - input.lastAttemptAtMs <= input.skipWithinMs
  );
};

export const resolveActiveAttemptWatchdogDecision = (input: {
  lastAttemptAgeMs: number;
  latestAttemptStatus: string | null;
  routeOwnershipState: ActiveAttemptRouteOwnershipState;
  staleReclaimMs: number;
}): ActiveAttemptWatchdogDecision => {
  if (input.latestAttemptStatus === "waiting_result") {
    return {
      kind: "skip",
      reason: "accepted_attempt_waiting_result",
    };
  }
  if (input.routeOwnershipState === "connection_replaced") {
    return {
      kind: "skip",
      reason: "connection_replaced",
    };
  }
  if (input.routeOwnershipState === "route_lost") {
    return {
      kind: "skip",
      reason: "route_lost",
    };
  }
  return {
    kind: "skip",
    reason:
      input.routeOwnershipState === "ownership_unknown"
        ? "ownership_unknown"
        : "still_owned",
  };
};

export const shouldSuspectOutboxRedriveLoop = (input: {
  outboxStatus: string;
  ledgerStatus: string;
  lastAttemptAgeMs: number;
  staleReclaimMs: number;
}): boolean => {
  return (
    input.outboxStatus === "handed_off" &&
    input.ledgerStatus === OPENMELD_DAEMON_DISPATCH_STATE.queued &&
    input.lastAttemptAgeMs >= input.staleReclaimMs
  );
};

export const resolveHandedOffOutboxCandidatePolicyDecision = (input: {
  outboxStatus: string;
  ledgerRow: DispatchOutboxLedgerStatusSnapshot | null;
  nowMs: number;
  recentInflightSkipWithinMs: number;
  staleReclaimMs: number;
}): HandedOffOutboxCandidatePolicyDecision => {
  if (input.outboxStatus !== "handed_off") {
    return { kind: "submit" };
  }
  if (input.ledgerRow) {
    return { kind: "delete" };
  }
  return { kind: "skip" };
};
