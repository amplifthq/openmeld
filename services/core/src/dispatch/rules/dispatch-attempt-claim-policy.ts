import type { OpenMeldDaemonDispatchQueueRecoveryReason } from "@openmeld/schemas/types";
import {
  isDispatchLifecycleFresh,
  isTerminalDispatchState,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  type OpenMeldDaemonDispatchAttemptState,
  type OpenMeldDaemonDispatchState,
} from "./dispatch-lifecycle-contract";
import { shouldDedupeWithinWindow } from "./dispatch-runtime-constants";

type DispatchQueueRecoveryReason = OpenMeldDaemonDispatchQueueRecoveryReason;

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
      attemptId: string;
      attemptNo: number;
      kind: "resume_hosted_admission";
    }
  | {
      kind: "claim_recovery";
      deliveryRecoveryReason: DispatchQueueRecoveryReason;
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
      deliveryRecoveryReason: DispatchQueueRecoveryReason | null;
    }
  | {
      kind: "reclaim_stale_dispatching";
      deliveryRecoveryReason: DispatchQueueRecoveryReason | null;
    }
  | {
      kind: "claim_existing_inside_window";
      deliveryRecoveryReason: DispatchQueueRecoveryReason | null;
    }
  | {
      kind: "reset_existing";
      deliveryRecoveryReason: DispatchQueueRecoveryReason | null;
    };

export const resolveDispatchDeliveryRecoveryReason = (input: {
  requestedRecoveryReason?: DispatchQueueRecoveryReason | null;
  existingStatus: OpenMeldDaemonDispatchState | null;
  latestAttempt: {
    errorCode: string | null;
    status: OpenMeldDaemonDispatchAttemptState | null;
  } | null;
}): DispatchQueueRecoveryReason | null => {
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
  requestedDispatchId?: string;
  requestedRecoveryReason?: DispatchQueueRecoveryReason | null;
  staleReclaimMs: number;
}): DispatchAttemptClaimDecision => {
  if (!input.existing) {
    return { kind: "claim_new" };
  }

  const profileQueuePromotionDecision =
    resolveProfileQueuePromotionDecision(input);
  if (profileQueuePromotionDecision) {
    return profileQueuePromotionDecision;
  }
  if (
    input.requestedRecoveryReason === "agent_profile_work_coordinator_promoted"
  ) {
    return { kind: "dedupe" };
  }

  const hostedAdmissionRecoveryDecision =
    resolveHostedAdmissionRecoveryDecision(input);
  if (hostedAdmissionRecoveryDecision) {
    return hostedAdmissionRecoveryDecision;
  }
  if (input.requestedRecoveryReason === "hosted_admission_incomplete") {
    return { kind: "dedupe" };
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

const resolveProfileQueuePromotionDecision = (input: {
  existing: DispatchClaimExistingLedgerSnapshot;
  latestAttempt: DispatchClaimLatestAttemptSnapshot;
  requestedDispatchId?: string;
  requestedRecoveryReason?: DispatchQueueRecoveryReason | null;
}): Extract<
  DispatchAttemptClaimDecision,
  { kind: "claim_recovery" }
> | null => {
  if (
    input.requestedRecoveryReason !==
      "agent_profile_work_coordinator_promoted" ||
    !input.existing ||
    input.existing.dispatchId !== input.requestedDispatchId ||
    input.existing.status !== OPENMELD_DAEMON_DISPATCH_STATE.queued ||
    input.latestAttempt?.attemptId !== input.existing.latestAttemptId ||
    input.latestAttempt.status !==
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting
  ) {
    return null;
  }
  return {
    deliveryRecoveryReason: "agent_profile_work_coordinator_promoted",
    kind: "claim_recovery",
  };
};

const resolveHostedAdmissionRecoveryDecision = (input: {
  existing: DispatchClaimExistingLedgerSnapshot;
  latestAttempt: DispatchClaimLatestAttemptSnapshot;
  requestedDispatchId?: string;
  requestedRecoveryReason?: DispatchQueueRecoveryReason | null;
}): Extract<
  DispatchAttemptClaimDecision,
  { kind: "resume_hosted_admission" }
> | null => {
  if (
    input.requestedRecoveryReason !== "hosted_admission_incomplete" ||
    !input.existing ||
    input.existing.dispatchId !== input.requestedDispatchId ||
    (input.existing.status !== OPENMELD_DAEMON_DISPATCH_STATE.queued &&
      input.existing.status !== OPENMELD_DAEMON_DISPATCH_STATE.dispatching) ||
    !input.latestAttempt?.attemptId ||
    input.latestAttempt.attemptId !== input.existing.latestAttemptId ||
    input.latestAttempt.daemonSessionId !== null ||
    input.latestAttempt.connectionGeneration !== null ||
    input.latestAttempt.leaseEpoch !== null ||
    input.latestAttempt.status !==
      OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching
  ) {
    return null;
  }
  return {
    attemptId: input.latestAttempt.attemptId,
    attemptNo: input.latestAttempt.attemptNo,
    kind: "resume_hosted_admission",
  };
};
