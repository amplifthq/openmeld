import type { OpenMeldDaemonDispatchDeliveryRecoveryReason as SharedOpenMeldDaemonDispatchDeliveryRecoveryReason } from "@openmeld/schemas/types";
import {
  isDispatchLifecycleFresh,
  isTerminalDispatchState,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  type OpenMeldDaemonDispatchAttemptState,
  type OpenMeldDaemonDispatchState,
} from "./dispatch-lifecycle-contract";
import { shouldDedupeWithinWindow } from "./dispatch-runtime-constants";

export type OpenMeldDaemonDispatchDeliveryRecoveryReason =
  SharedOpenMeldDaemonDispatchDeliveryRecoveryReason;

export type DispatchClaimExistingLedgerSnapshot = {
  attemptCount: number;
  dispatchId: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number;
  latestAttemptId: string | null;
  status: OpenMeldDaemonDispatchState | null;
} | null;

export type DispatchClaimLatestAttemptSnapshot = {
  attemptId: string;
  attemptNo: number;
  status: OpenMeldDaemonDispatchAttemptState | null;
  errorCode: string | null;
  connectionGeneration: number | null;
  daemonSessionId: string | null;
  leaseEpoch: number | null;
} | null;

export type DispatchAttemptClaimDecision =
  | { kind: "claim_new" }
  | {
      kind: "claim_recovery";
      deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason;
    }
  | {
      kind: "continue_existing";
      attemptId: string;
      attemptNo: number;
      connectionGeneration: number;
      daemonSessionId: string;
      leaseEpoch: number;
    }
  | { kind: "dedupe" }
  | {
      kind: "reclaim_stale_queued";
      deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
    }
  | {
      kind: "reclaim_stale_dispatching";
      deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
    }
  | {
      kind: "claim_existing_inside_window";
      deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
    }
  | {
      kind: "reset_existing";
      deliveryRecoveryReason: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
    };

export const resolveDispatchDeliveryRecoveryReason = (input: {
  requestedRecoveryReason?: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
  existingStatus: OpenMeldDaemonDispatchState | null;
  latestAttempt: {
    errorCode: string | null;
    status: OpenMeldDaemonDispatchAttemptState | null;
  } | null;
}): OpenMeldDaemonDispatchDeliveryRecoveryReason | null => {
  if (
    input.requestedRecoveryReason === "connection_replaced" ||
    input.requestedRecoveryReason === "route_lost"
  ) {
    return input.requestedRecoveryReason;
  }

  if (
    input.existingStatus !== OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable ||
    !input.latestAttempt
  ) {
    return null;
  }

  if (input.latestAttempt.errorCode === "daemon.session.connection_replaced") {
    return "connection_replaced";
  }

  if (
    input.latestAttempt.errorCode === "daemon.delivery.timeout" ||
    input.latestAttempt.errorCode === "daemon.session.not_found"
  ) {
    return "route_lost";
  }

  return null;
};

export const resolveDispatchAttemptClaimDecision = (input: {
  existing: DispatchClaimExistingLedgerSnapshot;
  latestAttempt: DispatchClaimLatestAttemptSnapshot;
  nowMs: number;
  requestedRecoveryReason?: OpenMeldDaemonDispatchDeliveryRecoveryReason | null;
  staleReclaimMs: number;
}): DispatchAttemptClaimDecision => {
  if (!input.existing) {
    return { kind: "claim_new" };
  }

  const deliveryRecoveryReason = resolveDispatchDeliveryRecoveryReason({
    requestedRecoveryReason: input.requestedRecoveryReason,
    existingStatus: input.existing.status,
    latestAttempt: input.latestAttempt,
  });

  const isInsideIdempotencyWindow = shouldDedupeWithinWindow({
    firstSeenAtMs: input.existing.firstSeenAtMs,
    nowMs: input.nowMs,
  });
  if (!isInsideIdempotencyWindow) {
    return {
      kind: "reset_existing",
      deliveryRecoveryReason,
    };
  }

  if (deliveryRecoveryReason) {
    return {
      kind: "claim_recovery",
      deliveryRecoveryReason,
    };
  }

  if (
    input.existing.status === OPENMELD_DAEMON_DISPATCH_STATE.dispatching &&
    input.latestAttempt?.status ===
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult &&
    input.latestAttempt.daemonSessionId &&
    typeof input.latestAttempt.leaseEpoch === "number" &&
    input.latestAttempt.leaseEpoch > 0
  ) {
    return {
      kind: "continue_existing",
      attemptId: input.latestAttempt.attemptId,
      attemptNo: input.latestAttempt.attemptNo,
      connectionGeneration: input.latestAttempt.connectionGeneration ?? 1,
      daemonSessionId: input.latestAttempt.daemonSessionId,
      leaseEpoch: input.latestAttempt.leaseEpoch,
    };
  }

  const isFreshDispatching =
    input.existing.status === OPENMELD_DAEMON_DISPATCH_STATE.dispatching &&
    isDispatchLifecycleFresh({
      lastAttemptAtMs: input.existing.lastAttemptAtMs,
      nowMs: input.nowMs,
      staleAfterMs: input.staleReclaimMs,
    });
  const isFreshQueued =
    input.existing.status === OPENMELD_DAEMON_DISPATCH_STATE.queued &&
    isDispatchLifecycleFresh({
      lastAttemptAtMs: input.existing.lastAttemptAtMs,
      nowMs: input.nowMs,
      staleAfterMs: input.staleReclaimMs,
    });
  if (
    input.existing.status &&
    (isTerminalDispatchState(input.existing.status) ||
      isFreshQueued ||
      isFreshDispatching)
  ) {
    return { kind: "dedupe" };
  }

  if (input.existing.status === OPENMELD_DAEMON_DISPATCH_STATE.dispatching) {
    return {
      kind: "reclaim_stale_dispatching",
      deliveryRecoveryReason,
    };
  }

  if (input.existing.status === OPENMELD_DAEMON_DISPATCH_STATE.queued) {
    return {
      kind: "reclaim_stale_queued",
      deliveryRecoveryReason,
    };
  }

  return {
    kind: "claim_existing_inside_window",
    deliveryRecoveryReason,
  };
};
