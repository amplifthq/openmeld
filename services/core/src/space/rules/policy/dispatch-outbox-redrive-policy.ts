import { RUNTIME_COORDINATOR_DEVICE_WAITING_REASON_CODE } from "@openmeld/schemas";
import type { OpenMeldDaemonDispatchQueueRecoveryReason } from "@openmeld/schemas/types";
import {
  isActiveDispatchAttemptState,
  isInFlightDispatchState,
  isTerminalDispatchState,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../../../dispatch/rules/dispatch-lifecycle-contract";

export type ActiveAttemptWatchdogReason =
  OpenMeldDaemonDispatchQueueRecoveryReason;
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
  | OpenMeldDaemonDispatchQueueRecoveryReason;
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

export type HostedNativeDeliveryHandoffState =
  | "admission_incomplete"
  | "durably_owned"
  | "evidence_unavailable"
  | "not_applicable";

export type HandedOffOutboxCandidatePolicyDecision =
  | {
      kind: "submit";
      deliveryRecoveryReason?: ActiveAttemptWatchdogReason;
      loopSuspected?: boolean;
    }
  | { kind: "delete" }
  | { kind: "skip" }
  | { kind: "check_active_attempt_watchdog" };

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
  hostedNativeDeliveryHandoffState?: HostedNativeDeliveryHandoffState;
  outboxStatus: string;
  ledgerRow: DispatchOutboxLedgerStatusSnapshot | null;
  nowMs: number;
  recentInflightSkipWithinMs: number;
  staleReclaimMs: number;
}): HandedOffOutboxCandidatePolicyDecision => {
  const hostedHandoffState =
    input.hostedNativeDeliveryHandoffState ?? "not_applicable";
  if (!input.ledgerRow) {
    if (hostedHandoffState === "evidence_unavailable") {
      return { kind: "skip" };
    }
    if (hostedHandoffState === "admission_incomplete") {
      return {
        kind: "submit",
        deliveryRecoveryReason: "hosted_admission_incomplete",
      };
    }
    return { kind: input.outboxStatus === "pending" ? "submit" : "skip" };
  }
  if (isTerminalDispatchState(input.ledgerRow.status)) {
    return { kind: "delete" };
  }
  if (input.ledgerRow.latestAttemptStatus === "profile_queue_waiting") {
    return { kind: "skip" };
  }
  if (
    input.ledgerRow.latestAttemptErrorCode ===
    RUNTIME_COORDINATOR_DEVICE_WAITING_REASON_CODE
  ) {
    // RuntimeCoordinator has accepted responsibility. Keep the payload for its
    // exact route/heartbeat redrive; an ordinary conveyor alarm cannot start it.
    return { kind: "skip" };
  }
  if (hostedHandoffState === "evidence_unavailable") {
    return { kind: "skip" };
  }
  if (hostedHandoffState === "admission_incomplete") {
    if (
      shouldSkipOutboxCandidateForRecentInflight({
        lastAttemptAtMs: input.ledgerRow.lastAttemptAtMs,
        nowMs: input.nowMs,
        skipWithinMs: input.recentInflightSkipWithinMs,
        status: input.ledgerRow.status,
      })
    ) {
      return { kind: "skip" };
    }
    return {
      deliveryRecoveryReason: "hosted_admission_incomplete",
      kind: "submit",
      loopSuspected: false,
    };
  }
  if (hostedHandoffState === "durably_owned") {
    return { kind: "delete" };
  }
  if (input.ledgerRow.latestAttemptStatus === "waiting_result") {
    return { kind: "delete" };
  }
  if (input.ledgerRow.latestAttemptStatus === "dispatching") {
    return { kind: "skip" };
  }
  return { kind: "delete" };
};
