import {
  DEFAULT_DISPATCH_FINALIZATION_TIMEOUT_MS,
  DEFAULT_DISPATCH_START_TIMEOUT_MS,
  DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS,
  isLeaseMatch,
} from "@openmeld/agent-runtime";
import type { RuntimeTransportDispatchLifecycleSnapshot } from "@openmeld/schemas/types";
import {
  RUNTIME_TRANSPORT_RESULT_TTL_MS,
  RUNTIME_TRANSPORT_WAIT_RESULT_DEFAULT_TIMEOUT_MS,
  RUNTIME_TRANSPORT_WAIT_RESULT_MAX_TIMEOUT_MS,
} from "../../strategy-constants";
import type {
  PendingDispatchState,
  RuntimeTransportMutableState,
  WaitDispatchResultRequest,
  WaitDispatchResultResponse,
  Waiter,
} from "./runtime-transport-state";
import { buildDispatchAttemptKey } from "./runtime-transport-state";

const RESULT_TTL_MS = RUNTIME_TRANSPORT_RESULT_TTL_MS;
const WAIT_RESULT_DEFAULT_TIMEOUT_MS =
  RUNTIME_TRANSPORT_WAIT_RESULT_DEFAULT_TIMEOUT_MS;
const WAIT_RESULT_MAX_TIMEOUT_MS = RUNTIME_TRANSPORT_WAIT_RESULT_MAX_TIMEOUT_MS;

export const waitDispatchResult = async (
  state: RuntimeTransportMutableState,
  request: WaitDispatchResultRequest
): Promise<WaitDispatchResultResponse> => {
  const nowMs = Date.now();
  const dispatchAttemptKey = buildDispatchAttemptKey(
    request.dispatchId,
    request.attemptId
  );

  cleanupCompletedResults(state, nowMs);
  cleanupExpiredPendingDispatches(state, nowMs);

  const existingCompleted =
    state.completedDispatchResults.get(dispatchAttemptKey);
  if (existingCompleted) {
    const ownershipMismatch = resolveDispatchOwnershipMismatch({
      actualConnectionGeneration: request.connectionGeneration,
      actualDaemonSessionId: request.daemonSessionId,
      actualLeaseEpoch: request.leaseEpoch,
      allowConnectionGenerationMismatch: true,
      expectedConnectionGeneration: existingCompleted.connectionGeneration,
      expectedDaemonSessionId: existingCompleted.daemonSessionId,
      expectedLeaseEpoch: existingCompleted.leaseEpoch,
    });
    if (ownershipMismatch) {
      return {
        state: "failed",
        reasonCode: ownershipMismatch,
      };
    }
    return {
      state: "completed",
      taskResult: existingCompleted.taskResult,
    };
  }

  const pending = state.pendingDispatches.get(dispatchAttemptKey);
  if (!pending) {
    return {
      state: "failed",
      reasonCode: resolveMissingPendingDispatchReason({
        state,
        request,
      }),
    };
  }

  const ownershipMismatch = resolveDispatchOwnershipMismatch({
    actualConnectionGeneration: request.connectionGeneration,
    actualDaemonSessionId: request.daemonSessionId,
    actualLeaseEpoch: request.leaseEpoch,
    allowConnectionGenerationMismatch:
      hasLocalRuntimeOwnershipEvidence(pending),
    expectedConnectionGeneration: pending.connectionGeneration,
    expectedDaemonSessionId: pending.daemonSessionId,
    expectedLeaseEpoch: pending.leaseEpoch,
  });
  if (ownershipMismatch) {
    return {
      state: "failed",
      reasonCode: ownershipMismatch,
    };
  }

  const timeoutMs = normalizeWaitTimeoutMs(request.timeoutMs);
  return await new Promise<WaitDispatchResultResponse>((resolve) => {
    const waiter: Waiter = {
      resolve,
      timeoutId: null,
    };

    const waiterSet =
      state.pendingResultWaiters.get(dispatchAttemptKey) ?? new Set<Waiter>();
    waiterSet.add(waiter);
    state.pendingResultWaiters.set(dispatchAttemptKey, waiterSet);

    waiter.timeoutId = setTimeout(() => {
      const latestWaiterSet =
        state.pendingResultWaiters.get(dispatchAttemptKey);
      if (!latestWaiterSet?.has(waiter)) {
        return;
      }
      removePendingResultWaiter(state, dispatchAttemptKey, waiter);
      waiter.resolve(
        resolveTimedOutWaiterResponse({
          state,
          dispatchAttemptKey,
          request,
        })
      );
    }, timeoutMs);
  });
};

export const resolvePendingResultWaiters = (
  state: RuntimeTransportMutableState,
  dispatchAttemptKey: string,
  response: WaitDispatchResultResponse
): void => {
  const waiters = state.pendingResultWaiters.get(dispatchAttemptKey);
  if (!waiters) {
    return;
  }

  for (const waiter of waiters) {
    clearResultWaiterTimeout(waiter);
    waiter.resolve(response);
  }
  state.pendingResultWaiters.delete(dispatchAttemptKey);
};

export const failPendingDispatchResultWaiters = (
  state: RuntimeTransportMutableState,
  dispatchAttemptKey: string,
  response: WaitDispatchResultResponse
): void => {
  state.pendingDispatches.delete(dispatchAttemptKey);
  resolvePendingResultWaiters(state, dispatchAttemptKey, response);
};

export const failPendingDispatchResultWaitersForSession = (
  state: RuntimeTransportMutableState,
  daemonSessionId: string,
  response: WaitDispatchResultResponse
): void => {
  for (const [
    dispatchAttemptKey,
    pending,
  ] of state.pendingDispatches.entries()) {
    if (pending.daemonSessionId !== daemonSessionId) {
      continue;
    }
    failPendingDispatchResultWaiters(state, dispatchAttemptKey, response);
  }
};

export const failPendingDispatchResultWaitersForConnectionGeneration = (
  state: RuntimeTransportMutableState,
  daemonSessionId: string,
  connectionGeneration: number,
  response: WaitDispatchResultResponse
): void => {
  for (const [
    dispatchAttemptKey,
    pending,
  ] of state.pendingDispatches.entries()) {
    if (pending.daemonSessionId !== daemonSessionId) {
      continue;
    }
    if (pending.connectionGeneration !== connectionGeneration) {
      continue;
    }
    if (hasLocalRuntimeOwnershipEvidence(pending)) {
      continue;
    }
    failPendingDispatchResultWaiters(state, dispatchAttemptKey, response);
  }
};

export const cleanupExpiredPendingDispatches = (
  state: RuntimeTransportMutableState,
  nowMs: number
): void => {
  for (const [
    dispatchAttemptKey,
    pending,
  ] of state.pendingDispatches.entries()) {
    const currentLease = state.profileLeasesByProfileId.get(pending.profileId);
    if (
      (!currentLease ||
        currentLease.daemonSessionId !== pending.daemonSessionId ||
        currentLease.leaseEpoch !== pending.leaseEpoch) &&
      !hasLocalRuntimeOwnershipEvidence(pending)
    ) {
      failPendingDispatchResultWaiters(state, dispatchAttemptKey, {
        state: "failed",
        reasonCode: "daemon.session.stale_lease",
      });
      continue;
    }

    const session = state.sessionsById.get(pending.daemonSessionId);
    if (
      session &&
      session.connectionGeneration !== pending.connectionGeneration &&
      !hasLocalRuntimeOwnershipEvidence(pending)
    ) {
      failPendingDispatchResultWaiters(state, dispatchAttemptKey, {
        state: "failed",
        reasonCode: "daemon.session.connection_replaced",
      });
      continue;
    }

    const expiredReason = resolvePendingDispatchExpiryReason({
      nowMs,
      pending,
    });
    if (expiredReason) {
      failPendingDispatchResultWaiters(state, dispatchAttemptKey, {
        lifecycle: buildPendingDispatchLifecycleSnapshot(pending),
        state: "failed",
        reasonCode: expiredReason,
      });
    }
  }

  cleanupCompletedResults(state, nowMs);
};

export const cleanupCompletedResults = (
  state: RuntimeTransportMutableState,
  nowMs: number
): void => {
  for (const [
    dispatchAttemptKey,
    result,
  ] of state.completedDispatchResults.entries()) {
    if (nowMs - result.receivedAtMs <= RESULT_TTL_MS) {
      continue;
    }
    state.completedDispatchResults.delete(dispatchAttemptKey);
  }
};

export const resolveNextDispatchCleanupAtMs = (
  state: Pick<
    RuntimeTransportMutableState,
    "completedDispatchResults" | "pendingDispatches"
  >
): number | null => {
  let nextCleanupAtMs: number | null = null;

  for (const pending of state.pendingDispatches.values()) {
    const expiresAtMs = resolvePendingDispatchDeadlineAtMs(pending);
    nextCleanupAtMs =
      nextCleanupAtMs === null
        ? expiresAtMs
        : Math.min(nextCleanupAtMs, expiresAtMs);
  }

  for (const result of state.completedDispatchResults.values()) {
    const expiresAtMs = result.receivedAtMs + RESULT_TTL_MS;
    nextCleanupAtMs =
      nextCleanupAtMs === null
        ? expiresAtMs
        : Math.min(nextCleanupAtMs, expiresAtMs);
  }

  return nextCleanupAtMs;
};

const clearResultWaiterTimeout = (waiter: Waiter): void => {
  if (waiter.timeoutId !== null) {
    clearTimeout(waiter.timeoutId);
    waiter.timeoutId = null;
  }
};

const removePendingResultWaiter = (
  state: RuntimeTransportMutableState,
  dispatchAttemptKey: string,
  waiter: Waiter
): void => {
  const waiterSet = state.pendingResultWaiters.get(dispatchAttemptKey);
  if (!waiterSet) {
    return;
  }

  waiterSet.delete(waiter);
  clearResultWaiterTimeout(waiter);
  if (waiterSet.size === 0) {
    state.pendingResultWaiters.delete(dispatchAttemptKey);
  }
};

const resolveTimedOutWaiterResponse = (input: {
  state: RuntimeTransportMutableState;
  dispatchAttemptKey: string;
  request: WaitDispatchResultRequest;
}): WaitDispatchResultResponse => {
  const pending = input.state.pendingDispatches.get(input.dispatchAttemptKey);
  if (!pending) {
    return {
      state: "failed",
      reasonCode: resolveMissingPendingDispatchReason({
        state: input.state,
        request: input.request,
      }),
    };
  }

  const requestOwnershipMismatch = resolveDispatchOwnershipMismatch({
    actualConnectionGeneration: input.request.connectionGeneration,
    actualDaemonSessionId: input.request.daemonSessionId,
    actualLeaseEpoch: input.request.leaseEpoch,
    allowConnectionGenerationMismatch:
      hasLocalRuntimeOwnershipEvidence(pending),
    expectedConnectionGeneration: pending.connectionGeneration,
    expectedDaemonSessionId: pending.daemonSessionId,
    expectedLeaseEpoch: pending.leaseEpoch,
  });
  if (requestOwnershipMismatch) {
    return {
      state: "failed",
      reasonCode: requestOwnershipMismatch,
    };
  }

  const currentLease = input.state.profileLeasesByProfileId.get(
    pending.profileId
  );
  const pendingStillOwned =
    currentLease &&
    currentLease.daemonSessionId === pending.daemonSessionId &&
    currentLease.leaseEpoch === pending.leaseEpoch;
  if (!(pendingStillOwned || hasLocalRuntimeOwnershipEvidence(pending))) {
    failPendingDispatchResultWaiters(input.state, input.dispatchAttemptKey, {
      state: "failed",
      reasonCode: "daemon.session.stale_lease",
    });
    return {
      state: "failed",
      reasonCode: "daemon.session.stale_lease",
    };
  }

  const currentSession = input.state.sessionsById.get(pending.daemonSessionId);
  if (
    currentSession &&
    currentSession.connectionGeneration !== pending.connectionGeneration &&
    !hasLocalRuntimeOwnershipEvidence(pending)
  ) {
    failPendingDispatchResultWaiters(input.state, input.dispatchAttemptKey, {
      state: "failed",
      reasonCode: "daemon.session.connection_replaced",
    });
    return {
      state: "failed",
      reasonCode: "daemon.session.connection_replaced",
    };
  }

  return buildPendingWaitResponse(pending);
};

const normalizeWaitTimeoutMs = (timeoutMs: number | undefined): number => {
  const normalized =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? Math.trunc(timeoutMs)
      : WAIT_RESULT_DEFAULT_TIMEOUT_MS;

  return Math.min(WAIT_RESULT_MAX_TIMEOUT_MS, Math.max(1000, normalized));
};

const resolveMissingPendingDispatchReason = (input: {
  state: RuntimeTransportMutableState;
  request: WaitDispatchResultRequest;
}): "daemon.delivery.timeout" | "daemon.session.connection_replaced" => {
  const currentSession = input.state.sessionsById.get(
    input.request.daemonSessionId
  );
  if (
    currentSession &&
    currentSession.connectionGeneration !== input.request.connectionGeneration
  ) {
    return "daemon.session.connection_replaced";
  }
  return "daemon.delivery.timeout";
};

const buildPendingWaitResponse = (
  pending: PendingDispatchState
): WaitDispatchResultResponse => {
  return {
    lifecycle: buildPendingDispatchLifecycleSnapshot(pending),
    state: "pending",
  };
};

const buildPendingDispatchLifecycleSnapshot = (
  pending: PendingDispatchState
): RuntimeTransportDispatchLifecycleSnapshot => {
  return {
    phase: pending.phase,
    createdAtMs: pending.createdAtMs,
    acceptedLocalAtMs: pending.acceptedLocalAtMs,
    runningAtMs: pending.runningAtMs,
    completedLocalAtMs: pending.completedLocalAtMs,
    lastLifecycleAtMs: pending.lastLifecycleAtMs,
  };
};

const hasLocalRuntimeOwnershipEvidence = (
  pending: PendingDispatchState
): boolean => {
  return (
    pending.phase !== "starting" ||
    pending.acceptedLocalAtMs !== null ||
    pending.runningAtMs !== null ||
    pending.completedLocalAtMs !== null
  );
};

const resolvePendingDispatchExpiryReason = (input: {
  nowMs: number;
  pending: PendingDispatchState;
}):
  | "daemon.delivery.execution_stalled"
  | "daemon.delivery.finalization_timeout"
  | "daemon.delivery.start_timeout"
  | null => {
  const expiresAtMs = resolvePendingDispatchDeadlineAtMs(input.pending);
  if (input.nowMs <= expiresAtMs) {
    return null;
  }

  switch (input.pending.phase) {
    case "starting":
      return "daemon.delivery.start_timeout";
    case "completed_local":
      return "daemon.delivery.finalization_timeout";
    default:
      return "daemon.delivery.execution_stalled";
  }
};

const resolvePendingDispatchDeadlineAtMs = (
  pending: PendingDispatchState
): number => {
  if (pending.phase === "starting") {
    return pending.createdAtMs + DEFAULT_DISPATCH_START_TIMEOUT_MS;
  }
  if (pending.phase === "completed_local") {
    return (
      (pending.completedLocalAtMs ?? pending.lastLifecycleAtMs) +
      DEFAULT_DISPATCH_FINALIZATION_TIMEOUT_MS
    );
  }
  return (
    pending.lastLifecycleAtMs + DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS
  );
};

const resolveDispatchOwnershipMismatch = (input: {
  actualConnectionGeneration: number;
  actualDaemonSessionId: string;
  actualLeaseEpoch: number;
  allowConnectionGenerationMismatch?: boolean;
  expectedConnectionGeneration: number;
  expectedDaemonSessionId: string;
  expectedLeaseEpoch: number;
}):
  | "daemon.session.connection_replaced"
  | "daemon.session.stale_lease"
  | null => {
  const leaseMatched = isLeaseMatch({
    expectedDaemonSessionId: input.expectedDaemonSessionId,
    expectedLeaseEpoch: input.expectedLeaseEpoch,
    actualDaemonSessionId: input.actualDaemonSessionId,
    actualLeaseEpoch: input.actualLeaseEpoch,
  });
  if (!leaseMatched) {
    return "daemon.session.stale_lease";
  }

  if (input.allowConnectionGenerationMismatch) {
    return null;
  }

  return input.expectedConnectionGeneration === input.actualConnectionGeneration
    ? null
    : "daemon.session.connection_replaced";
};
