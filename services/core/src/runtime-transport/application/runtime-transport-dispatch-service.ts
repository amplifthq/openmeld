import { isLeaseMatch } from "@openmeld/agent-runtime";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldRequestContext,
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDeliverDispatchResponse,
  RuntimeTransportDispatchLifecycleRequest,
  RuntimeTransportSubmitTaskResultRequest,
  RuntimeTransportSubmitTaskResultResponse,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_POLL_INTERVAL_MS,
  RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS,
} from "../../strategy-constants";
import { isDaemonExecutionCompatible } from "./daemon-execution-compatibility";
import type {
  CompletedDispatchResultState,
  PendingDispatchState,
  RuntimeTransportMutableState,
  RuntimeTransportSessionState,
  WaitDispatchResultResponse,
} from "./runtime-transport-state";
import { buildDispatchAttemptKey } from "./runtime-transport-state";

type DispatchServiceDependencies = {
  reapExpiredLeases: (nowMs: number) => void;
  prepareAcceptedDelivery?: (
    request: RuntimeTransportDeliverDispatchRequest
  ) => Promise<
    | {
        ok: true;
        request: RuntimeTransportDeliverDispatchRequest;
      }
    | {
        ok: false;
        reasonCode:
          | "runtime_coordinator.head_execution_link_unavailable"
          | "runtime_coordinator.pre_agent_stop_requested"
          | "runtime_coordinator.execution_token_scope_mismatch"
          | "runtime_coordinator.execution_token_unavailable";
      }
  >;
  onAcceptedDeliverySent?: (
    request: RuntimeTransportDeliverDispatchRequest
  ) => void;
  sendFrame: (
    socket: WebSocket,
    input: {
      code: string;
      payload: Record<string, unknown>;
    }
  ) => void;
  resolvePendingResultWaiters: (
    dispatchAttemptKey: string,
    response: WaitDispatchResultResponse
  ) => void;
  cleanupCompletedResults: (nowMs: number) => void;
  profileConfigurationConvergence?: {
    sleep: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
    timeoutMs?: number;
    now?: () => number;
  };
};

type ExecutionIncompatibleDeliveryReason =
  | "daemon.runtime_contract.missing"
  | "daemon.runtime_contract.mismatch";

type DispatchResultAcceptance = {
  acceptedAtMs: number;
  attemptId: string;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string | null;
  submittedConnectionGeneration: number;
  targetProfileId: string;
  taskId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
};

type DurableDispatchResultAcceptance = DispatchResultAcceptance & {
  finalizationRequired: boolean;
  spaceId: string | null;
};

type AcceptedResultStatus = "accepted" | "already_accepted";

type SettledDurableDispatchFinalization = {
  command: RuntimeCoordinatorFinalizationCommand;
  outcome: RuntimeCoordinatorFinalizationOutcome;
};

type RuntimeCoordinatorAcceptedResultPointer = {
  executionTokenFingerprint: string;
  executionTokenRunId: string;
  runtimeCoordinatorExecutionId: string;
};

type AcceptDispatchResult = (result: DispatchResultAcceptance) => Promise<
  | {
      ok: true;
      status: "accepted" | "already_accepted";
    }
  | {
      ok: false;
      status: "retry_later";
      reasonCode:
        | "daemon.result.finalization_unavailable"
        | "daemon.result.inbox_unavailable";
    }
  | {
      ok: false;
      status: "rejected_terminal";
      reasonCode:
        | "daemon.result.conflict"
        | "daemon.result.identity_mismatch"
        | "daemon.session.stale_lease";
    }
>;

type FinalizeDurableDispatchResult = (
  result: DurableDispatchResultAcceptance & {
    acceptedResultStatus: AcceptedResultStatus;
    settledFinalization?: SettledDurableDispatchFinalization | null;
  }
) => Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      status: "retry_later";
      reasonCode: "daemon.result.finalization_unavailable";
    }
>;

type SettleDurableDispatchResult = (
  result: DurableDispatchResultAcceptance
) => Promise<
  | {
      ok: true;
      settledFinalization: SettledDurableDispatchFinalization | null;
    }
  | {
      ok: false;
      status: "review_required";
      reasonCode: "space.agent_reply.context_changed";
    }
  | {
      ok: false;
      status: "retry_later";
      reasonCode: "daemon.result.finalization_unavailable";
    }
>;

type ResolveDurableDispatchResultAcceptance = (input: {
  attemptId: string;
  connectionGeneration: number;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string | null;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}) => Promise<
  | {
      ok: true;
      result: DurableDispatchResultAcceptance;
    }
  | {
      ok: false;
      status: "retry_later";
      reasonCode: "daemon.result.inbox_unavailable";
    }
  | {
      ok: false;
      status: "rejected_terminal";
      reasonCode:
        | "daemon.result.identity_mismatch"
        | "daemon.session.stale_lease"
        | "daemon.delivery.timeout";
    }
>;

type SubmitTaskResultDependencies = Pick<
  DispatchServiceDependencies,
  "resolvePendingResultWaiters" | "cleanupCompletedResults"
> & {
  acceptDispatchResult: AcceptDispatchResult;
  acceptedResultRuntimeCoordinatorPointer?: RuntimeCoordinatorAcceptedResultPointer | null;
  finalizeDurableDispatchResult?: FinalizeDurableDispatchResult;
  resolveDurableDispatchResultAcceptance?: ResolveDurableDispatchResultAcceptance;
  settleDurableDispatchResult?: SettleDurableDispatchResult;
};

export const deliverDispatch = async (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportDeliverDispatchRequest,
  deps: DispatchServiceDependencies
): Promise<RuntimeTransportDeliverDispatchResponse> => {
  const nowMs = Date.now();
  const dispatchAttemptKey = buildDispatchAttemptKey(
    request.dispatchId,
    request.attemptId
  );
  deps.reapExpiredLeases(nowMs);

  if (state.ownerUserId && state.ownerUserId !== request.ownerUserId) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.reject_conflict",
    };
  }

  const lease = state.profileLeasesByProfileId.get(request.profileId);
  if (!lease) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.profile.offline",
    };
  }

  const leaseMatched = isLeaseMatch({
    expectedDaemonSessionId: lease.daemonSessionId,
    expectedLeaseEpoch: lease.leaseEpoch,
    actualDaemonSessionId: request.daemonSessionId,
    actualLeaseEpoch: request.leaseEpoch,
  });
  if (!leaseMatched) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.stale_lease",
    };
  }

  const leaseCompatibilityRejection = rejectIncompatibleDaemonExecution({
    compatibility: lease.executionCompatibility,
    request,
    source: "lease",
  });
  if (leaseCompatibilityRejection) {
    return leaseCompatibilityRejection;
  }

  const existingPending = state.pendingDispatches.get(dispatchAttemptKey);
  if (
    existingPending &&
    existingPending.profileId === request.profileId &&
    existingPending.daemonSessionId === request.daemonSessionId &&
    existingPending.connectionGeneration === request.connectionGeneration &&
    existingPending.leaseEpoch === request.leaseEpoch
  ) {
    console.info("[core.runtime_transport.dispatch_replayed_while_pending]", {
      attemptId: request.attemptId,
      dispatchId: request.dispatchId,
      profileId: request.profileId,
      daemonSessionId: request.daemonSessionId,
      connectionGeneration: request.connectionGeneration,
      leaseEpoch: request.leaseEpoch,
    });
    return {
      accepted: true,
      status: "already_pending",
      existingAttemptId: existingPending.attemptId,
    };
  }

  const pendingSameDispatchTask = findPendingDispatchForSameDispatchTask(
    state,
    request
  );
  if (pendingSameDispatchTask) {
    console.info("[core.runtime_transport.dispatch_duplicate_while_pending]", {
      attemptId: request.attemptId,
      dispatchId: request.dispatchId,
      profileId: request.profileId,
      daemonSessionId: request.daemonSessionId,
      leaseEpoch: request.leaseEpoch,
      pendingAttemptId: pendingSameDispatchTask.attemptId,
    });
    return {
      accepted: true,
      status: "already_pending",
      existingAttemptId: pendingSameDispatchTask.attemptId,
    };
  }

  const existingCompleted = findCompletedDispatchResultByDispatchTask(
    state,
    request
  );
  if (existingCompleted) {
    console.info(
      "[core.runtime_transport.dispatch_replayed_after_completion]",
      {
        attemptId: request.attemptId,
        dispatchId: request.dispatchId,
        profileId: request.profileId,
        daemonSessionId: request.daemonSessionId,
        leaseEpoch: request.leaseEpoch,
        completedAttemptId: existingCompleted.attemptId,
        completedDaemonSessionId: existingCompleted.daemonSessionId,
        completedLeaseEpoch: existingCompleted.leaseEpoch,
        completedReceivedAtMs: existingCompleted.receivedAtMs,
      }
    );
    return {
      accepted: true,
      status: "already_completed",
      completedAttemptId: existingCompleted.attemptId,
    };
  }

  const session = state.sessionsById.get(request.daemonSessionId);
  if (!session?.socket) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.profile.offline",
    };
  }
  if (session.connectionGeneration !== request.connectionGeneration) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.connection_replaced",
    };
  }

  const sessionCompatibilityRejection = rejectIncompatibleDaemonExecution({
    compatibility: session.executionCompatibility,
    request,
    source: "session",
  });
  if (sessionCompatibilityRejection) {
    return sessionCompatibilityRejection;
  }

  // Delivery preparation contains asynchronous fences. Serialize the whole
  // pre-send section by logical dispatch task so concurrent queue redrives
  // cannot both pass the last pending check and execute the same local task.
  // This transient claim is deliberately separate from `pendingDispatches`:
  // pending means the delivery was actually sent, while callers sharing this
  // claim receive no accepted outcome until the owning attempt really does.
  const inFlightKey = buildInFlightDispatchDeliveryKey(request);
  const existingInFlight = state.inFlightDispatchDeliveries.get(inFlightKey);
  if (existingInFlight) {
    const response = await existingInFlight.response;
    return response.accepted
      ? {
          accepted: true,
          existingAttemptId: existingInFlight.attemptId,
          status: "already_pending",
        }
      : response;
  }

  const responsePromise = finalizeDeliveryAgainstSessionBoundRequest({
    deps,
    nowMs,
    request,
    state,
  });
  const inFlight = {
    attemptId: request.attemptId,
    response: responsePromise,
  };
  state.inFlightDispatchDeliveries.set(inFlightKey, inFlight);
  try {
    return await responsePromise;
  } finally {
    if (state.inFlightDispatchDeliveries.get(inFlightKey) === inFlight) {
      state.inFlightDispatchDeliveries.delete(inFlightKey);
    }
  }
};

const PROFILE_CONFIGURATION_CONVERGENCE_REFRESH_REASON =
  "profile_configuration_convergence";

// Canonical single-source profile configuration comparison for both the
// admission/convergence path and the final fence. Deriving one explicit
// assessment prevents semantic drift between "should we wait" and "may we
// deliver".
//
// Observable states:
// - stripped: the Service predates the revision capability; Core strips the
//   additive identity fields and preserves legacy behavior.
// - matched: applied identity equals the frozen dispatch identity.
// - converging: same Binding id, older applied revision — the ordinary
//   post-settings-write propagation race, safe to wait out in place.
// - not_synced: genuine drift or missing evidence; fail closed immediately.
type ProfileConfigurationSyncAssessment = {
  appliedBindingId: string | null;
  appliedConfigurationRevision: number | null;
  expectedBindingId: string | null;
  expectedConfigurationRevision: number | null;
  state: "converging" | "matched" | "not_synced" | "stripped";
};

const assessProfileConfigurationSync = (input: {
  request: RuntimeTransportDeliverDispatchRequest;
  session: RuntimeTransportSessionState | undefined;
}): ProfileConfigurationSyncAssessment => {
  if (input.session?.capabilities.profileConfigurationRevision !== true) {
    return {
      appliedBindingId: null,
      appliedConfigurationRevision: null,
      expectedBindingId: null,
      expectedConfigurationRevision: null,
      state: "stripped",
    };
  }
  const { bindingId, configurationRevision } =
    input.request.payload.controllerSnapshot;
  const appliedConfiguration =
    input.session.localWakeRouteReport?.profileConfigurationRevisions?.find(
      (candidate) => candidate.profileId === input.request.profileId
    );
  const base = {
    appliedBindingId: appliedConfiguration?.bindingId ?? null,
    appliedConfigurationRevision:
      typeof appliedConfiguration?.configurationRevision === "number"
        ? appliedConfiguration.configurationRevision
        : null,
    expectedBindingId: bindingId ?? null,
    expectedConfigurationRevision: configurationRevision ?? null,
  };
  if (!(bindingId && configurationRevision && appliedConfiguration)) {
    return { ...base, state: "not_synced" };
  }
  if (
    appliedConfiguration.bindingId === bindingId &&
    base.appliedConfigurationRevision !== null &&
    base.appliedConfigurationRevision < configurationRevision
  ) {
    return { ...base, state: "converging" };
  }
  if (
    appliedConfiguration.bindingId === bindingId &&
    base.appliedConfigurationRevision === configurationRevision
  ) {
    return { ...base, state: "matched" };
  }
  return { ...base, state: "not_synced" };
};

const finalizeDeliveryAgainstSessionBoundRequest = async (input: {
  deps: DispatchServiceDependencies;
  nowMs: number;
  request: RuntimeTransportDeliverDispatchRequest;
  state: RuntimeTransportMutableState;
}): Promise<RuntimeTransportDeliverDispatchResponse> => {
  const sessionBoundRequest =
    await resolveSessionBoundDispatchRequestWithConvergence({
      deps: input.deps,
      request: input.request,
      state: input.state,
    });
  if (!sessionBoundRequest.ok) {
    return sessionBoundRequest.response;
  }

  const preparedDelivery = input.deps.prepareAcceptedDelivery
    ? await input.deps.prepareAcceptedDelivery(sessionBoundRequest.request)
    : { ok: true as const, request: sessionBoundRequest.request };
  if (!preparedDelivery.ok) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: preparedDelivery.reasonCode,
    };
  }

  const currentSession = input.state.sessionsById.get(
    input.request.daemonSessionId
  );
  if (
    !currentSession?.socket ||
    currentSession.connectionGeneration !== input.request.connectionGeneration
  ) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.connection_replaced",
    };
  }
  const currentSessionBoundRequest = resolveProfileConfigurationFence({
    request: preparedDelivery.request,
    session: currentSession,
  });
  if (!currentSessionBoundRequest.ok) {
    return currentSessionBoundRequest.response;
  }
  const acceptedRequest = currentSessionBoundRequest.request;

  input.state.pendingDispatches.set(
    buildDispatchAttemptKey(
      acceptedRequest.dispatchId,
      acceptedRequest.attemptId
    ),
    buildPendingDispatchStateFromAcceptedRequest({
      acceptedRequest,
      nowMs: input.nowMs,
    })
  );

  try {
    input.deps.sendFrame(currentSession.socket, {
      code: "daemon.dispatch.deliver",
      payload: acceptedRequest,
    });
    input.deps.onAcceptedDeliverySent?.(acceptedRequest);
  } catch {
    input.state.pendingDispatches.delete(
      buildDispatchAttemptKey(
        acceptedRequest.dispatchId,
        acceptedRequest.attemptId
      )
    );
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.profile.offline",
    };
  }

  return {
    accepted: true,
    status: "delivered",
  };
};

const buildInFlightDispatchDeliveryKey = (
  request: RuntimeTransportDeliverDispatchRequest
): string =>
  `${request.dispatchId}::${request.payload.taskId}::${request.profileId}`;

const defaultConvergenceSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sanitizeTransportErrorForLog = (error: unknown): string => {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
};

// The recorded socket failed a refresh send. Never relabel this as
// configuration synchronization and never expose raw socket details: let the
// live session record decide which existing route/session outcome applies.
const resolveNudgeFailureResponse = (input: {
  request: RuntimeTransportDeliverDispatchRequest;
  state: RuntimeTransportMutableState;
}): Extract<RuntimeTransportDeliverDispatchResponse, { accepted: false }> => {
  const liveSession = input.state.sessionsById.get(
    input.request.daemonSessionId
  );
  if (!liveSession) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.not_found",
    };
  }
  if (liveSession.connectionGeneration !== input.request.connectionGeneration) {
    return {
      accepted: false,
      status: "rejected",
      reasonCode: "daemon.session.connection_replaced",
    };
  }
  return {
    accepted: false,
    status: "rejected",
    reasonCode: "daemon.profile.offline",
  };
};

// An acknowledged settings write increments the Binding revision after the
// dispatch identity was frozen. When a capability-aware Service still reports
// an OLDER revision for the SAME binding, this is ordinary route-catalog
// propagation, not drift: nudge the Service to re-sync its expected routes,
// then hold delivery inside the bounded convergence window until its next
// register report matches, or fail closed with the regular not-synced fence.
// Nothing executes stale configuration while waiting; nothing mutates or
// duplicates execution authority.
const resolveSessionBoundDispatchRequestWithConvergence = async (input: {
  deps: DispatchServiceDependencies;
  request: RuntimeTransportDeliverDispatchRequest;
  state: RuntimeTransportMutableState;
}): Promise<
  | { ok: true; request: RuntimeTransportDeliverDispatchRequest }
  | { ok: false; response: RuntimeTransportDeliverDispatchResponse }
> => {
  const startSession = input.state.sessionsById.get(
    input.request.daemonSessionId
  );
  const startAssessment = assessProfileConfigurationSync({
    request: input.request,
    session: startSession,
  });
  if (!startSession || startAssessment.state !== "converging") {
    return resolveProfileConfigurationFence({
      request: input.request,
      session: startSession,
    });
  }

  const timeoutMs =
    input.deps.profileConfigurationConvergence?.timeoutMs ??
    RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS;
  const pollIntervalMs =
    input.deps.profileConfigurationConvergence?.pollIntervalMs ??
    RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_POLL_INTERVAL_MS;
  const sleep =
    input.deps.profileConfigurationConvergence?.sleep ??
    defaultConvergenceSleep;
  const nowMs = input.deps.profileConfigurationConvergence?.now ?? Date.now;

  if (startSession.socket) {
    try {
      input.deps.sendFrame(startSession.socket, {
        code: "daemon.route_catalog.changed",
        payload: { reason: PROFILE_CONFIGURATION_CONVERGENCE_REFRESH_REASON },
      });
    } catch (nudgeError) {
      const nudgeFailureResponse = resolveNudgeFailureResponse({
        request: input.request,
        state: input.state,
      });
      console.warn(
        "[core.runtime_transport.profile_configuration_convergence_nudge_failed]",
        {
          dispatchId: input.request.dispatchId,
          error: sanitizeTransportErrorForLog(nudgeError),
          profileId: input.request.profileId,
          reasonCode: nudgeFailureResponse.reasonCode ?? null,
        }
      );
      // Fail fast on live transport evidence instead of waiting out the full
      // window and misreporting a dead/replaced session as not-synced.
      return {
        ok: false,
        response: nudgeFailureResponse,
      };
    }
  }
  console.info(
    "[core.runtime_transport.profile_configuration_convergence_wait]",
    {
      appliedBindingId: startAssessment.appliedBindingId,
      appliedConfigurationRevision:
        startAssessment.appliedConfigurationRevision,
      dispatchId: input.request.dispatchId,
      expectedBindingId: startAssessment.expectedBindingId,
      expectedConfigurationRevision:
        startAssessment.expectedConfigurationRevision,
      profileId: input.request.profileId,
      timeoutMs,
    }
  );

  const deadlineAtMs = nowMs() + timeoutMs;
  for (;;) {
    const remainingMs = deadlineAtMs - nowMs();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
    const sessionNow = input.state.sessionsById.get(
      input.request.daemonSessionId
    );
    if (!sessionNow) {
      break;
    }
    if (
      assessProfileConfigurationSync({
        request: input.request,
        session: sessionNow,
      }).state !== "converging"
    ) {
      break;
    }
  }

  // The fence owns the final verdict and diagnostics so a timed-out wait can
  // never produce a different rejection shape than a plain not-synced check.
  return resolveProfileConfigurationFence({
    request: input.request,
    session: input.state.sessionsById.get(input.request.daemonSessionId),
  });
};

const resolveProfileConfigurationFence = (input: {
  request: RuntimeTransportDeliverDispatchRequest;
  session: RuntimeTransportSessionState | undefined;
}):
  | {
      ok: true;
      request: RuntimeTransportDeliverDispatchRequest;
    }
  | {
      ok: false;
      response: RuntimeTransportDeliverDispatchResponse;
    } => {
  if (!input.session) {
    return {
      ok: false,
      response: {
        accepted: false,
        reasonCode: "daemon.session.not_found",
        status: "rejected",
      },
    };
  }

  const assessment = assessProfileConfigurationSync(input);
  if (assessment.state === "stripped") {
    return {
      ok: true,
      request: stripProfileConfigurationIdentity(input.request),
    };
  }
  if (assessment.state === "matched") {
    return {
      ok: true,
      request: input.request,
    };
  }

  console.warn("[core.runtime_transport.profile_configuration_not_synced]", {
    appliedBindingId: assessment.appliedBindingId,
    appliedConfigurationRevision: assessment.appliedConfigurationRevision,
    dispatchId: input.request.dispatchId,
    expectedBindingId: assessment.expectedBindingId,
    expectedConfigurationRevision: assessment.expectedConfigurationRevision,
    profileId: input.request.profileId,
    reasonCode: "daemon.profile.configuration_not_synced",
  });
  return {
    ok: false,
    response: {
      accepted: false,
      reasonCode: "daemon.profile.configuration_not_synced",
      status: "rejected",
    },
  };
};

const stripProfileConfigurationIdentity = (
  request: RuntimeTransportDeliverDispatchRequest
): RuntimeTransportDeliverDispatchRequest => {
  const { agentControllerRef, targetBindingEnabled, targetBindingState } =
    request.payload.controllerSnapshot;
  return {
    ...request,
    payload: {
      ...request.payload,
      controllerSnapshot: {
        agentControllerRef,
        targetBindingEnabled,
        targetBindingState,
      },
    },
  };
};

export const buildPendingDispatchStateFromAcceptedRequest = (input: {
  acceptedRequest: RuntimeTransportDeliverDispatchRequest;
  nowMs: number;
}): PendingDispatchState => ({
  attemptId: input.acceptedRequest.attemptId,
  acceptedLocalAtMs: null,
  completedLocalAtMs: null,
  dispatchId: input.acceptedRequest.dispatchId,
  daemonSessionId: input.acceptedRequest.daemonSessionId,
  executionIdentity: input.acceptedRequest.payload.executionIdentity,
  executionTokenFingerprint:
    input.acceptedRequest.payload.executionToken?.tokenFingerprint ?? null,
  executionTokenRunId:
    input.acceptedRequest.payload.executionToken?.runId ?? null,
  connectionGeneration: input.acceptedRequest.connectionGeneration,
  lastLifecycleAtMs: input.nowMs,
  leaseEpoch: input.acceptedRequest.leaseEpoch,
  phase: "starting",
  profileId: input.acceptedRequest.profileId,
  runningAtMs: null,
  runtimeCoordinatorExecutionId:
    input.acceptedRequest.payload.runtimeCoordinatorExecutionId,
  sourceClientMessageId:
    input.acceptedRequest.payload.sourceClientMessageId ?? null,
  sourceSignalId: resolvePendingDispatchSourceSignalId(input.acceptedRequest),
  spaceAccess: buildPendingDispatchSpaceAccess(input.acceptedRequest),
  spaceId: resolvePendingDispatchSpaceId(input.acceptedRequest),
  taskId: input.acceptedRequest.payload.taskId,
  targetProfileName: resolvePendingDispatchTargetProfileName(
    input.acceptedRequest
  ),
  createdAtMs: input.nowMs,
});

const rejectIncompatibleDaemonExecution = (input: {
  compatibility: DaemonExecutionCompatibility;
  request: RuntimeTransportDeliverDispatchRequest;
  source: "lease" | "session";
}): RuntimeTransportDeliverDispatchResponse | null => {
  if (isDaemonExecutionCompatible(input.compatibility)) {
    return null;
  }

  const reasonCode = toExecutionIncompatibleDeliveryReason(
    input.compatibility.reasonCode
  );
  console.warn("[core.runtime_transport.dispatch_execution_incompatible]", {
    attemptId: input.request.attemptId,
    connectionGeneration: input.request.connectionGeneration,
    daemonSessionId: input.request.daemonSessionId,
    dispatchId: input.request.dispatchId,
    expectedEpoch: input.compatibility.expectedEpoch,
    observedEpoch: input.compatibility.observedEpoch,
    profileId: input.request.profileId,
    reasonCode,
    source: input.source,
  });

  return {
    accepted: false,
    reasonCode,
    status: "rejected",
  };
};

const toExecutionIncompatibleDeliveryReason = (
  reasonCode: string
): ExecutionIncompatibleDeliveryReason => {
  if (reasonCode === "daemon.runtime_contract.mismatch") {
    return "daemon.runtime_contract.mismatch";
  }

  return "daemon.runtime_contract.missing";
};

export const handleDispatchLifecycle = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportDispatchLifecycleRequest
): {
  ok: boolean;
  reasonCode?:
    | "daemon.session.connection_replaced"
    | "daemon.session.not_found"
    | "daemon.session.stale_lease";
} => {
  const dispatchAttemptKey = buildDispatchAttemptKey(
    request.dispatchId,
    request.attemptId
  );
  const pending = state.pendingDispatches.get(dispatchAttemptKey);
  if (!pending) {
    return {
      ok: false,
      reasonCode: "daemon.session.not_found",
    };
  }

  const leaseMatched = isLeaseMatch({
    expectedDaemonSessionId: pending.daemonSessionId,
    expectedLeaseEpoch: pending.leaseEpoch,
    actualDaemonSessionId: request.daemonSessionId,
    actualLeaseEpoch: request.leaseEpoch,
  });
  if (!leaseMatched) {
    return {
      ok: false,
      reasonCode: "daemon.session.stale_lease",
    };
  }
  if (
    pending.connectionGeneration !== request.connectionGeneration &&
    !hasPendingLocalRuntimeOwnershipEvidence(pending)
  ) {
    return {
      ok: false,
      reasonCode: "daemon.session.connection_replaced",
    };
  }

  const lifecycleAtMs = resolvePendingLifecycleAtMs({
    pending,
    requestedLifecycleAtMs: request.lifecycleAtMs,
    receivedAtMs: Date.now(),
  });
  pending.lastLifecycleAtMs = lifecycleAtMs;

  const nextPhase = resolveNextPendingPhase({
    currentPhase: pending.phase,
    requestedPhase: request.phase,
  });
  pending.phase = nextPhase;

  if (
    nextPhase === "accepted_local" ||
    nextPhase === "running" ||
    nextPhase === "completed_local"
  ) {
    pending.acceptedLocalAtMs ??= lifecycleAtMs;
  }
  if (nextPhase === "running" || nextPhase === "completed_local") {
    pending.runningAtMs ??= lifecycleAtMs;
  }
  if (nextPhase === "completed_local") {
    pending.completedLocalAtMs ??= lifecycleAtMs;
  }

  return {
    ok: true,
  };
};

export const handleSubmitTaskResult = async (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportSubmitTaskResultRequest,
  deps: SubmitTaskResultDependencies
): Promise<RuntimeTransportSubmitTaskResultResponse> => {
  const requestAttemptId = resolveResultAttemptId(request);
  if (!requestAttemptId) {
    console.warn("[core.runtime_transport.result_identity_mismatch]", {
      dispatchId: request.dispatchId,
      daemonSessionId: request.daemonSessionId,
      connectionGeneration: request.connectionGeneration,
      leaseEpoch: request.leaseEpoch,
      reasonCode: "daemon.result.identity_mismatch",
    });
    return {
      ok: false,
      reasonCode: "daemon.result.identity_mismatch",
      status: "rejected_terminal",
    };
  }
  const dispatchAttemptKey = buildDispatchAttemptKey(
    request.dispatchId,
    requestAttemptId
  );
  const pending = state.pendingDispatches.get(dispatchAttemptKey) ?? null;

  if (!pending) {
    return await resolveSubmitTaskResultWithoutPending({
      deps,
      dispatchAttemptKey,
      request,
      requestAttemptId,
      state,
    });
  }

  const rejection = validatePendingSubmitTaskResult({
    pending,
    request,
    requestAttemptId,
  });
  if (rejection) {
    return rejection;
  }
  const identityEchoMismatch = resolveExecutionIdentityEchoMismatch({
    authoritative: pending.executionIdentity,
    echoed: request.executionIdentityEcho,
  });
  if (identityEchoMismatch) {
    console.warn("[core.runtime_transport.result_identity_echo_mismatch]", {
      dispatchId: request.dispatchId,
      attemptId: requestAttemptId,
      daemonSessionId: request.daemonSessionId,
      reasonCode: "daemon.result.identity_mismatch",
      mismatchField: identityEchoMismatch,
      authoritativeRuntimeId:
        pending.executionIdentity.core.openMeldServiceRuntimeId.value,
      echoedRuntimeId:
        request.executionIdentityEcho.core.openMeldServiceRuntimeId.value,
    });
  }

  const receivedAtMs = Date.now();
  const resultPointer = resolveAcceptedResultRuntimeCoordinatorPointer({
    deps,
    pending,
  });
  const resultAcceptance: DispatchResultAcceptance = {
    acceptedAtMs: receivedAtMs,
    attemptId: pending.attemptId,
    daemonSessionId: request.daemonSessionId,
    dispatchId: pending.dispatchId,
    executionTokenFingerprint: resultPointer.executionTokenFingerprint,
    executionTokenRunId: resultPointer.executionTokenRunId,
    leaseEpoch: request.leaseEpoch,
    runtimeCoordinatorExecutionId: resultPointer.runtimeCoordinatorExecutionId,
    submittedConnectionGeneration: request.connectionGeneration,
    targetProfileId: pending.profileId,
    taskId: pending.taskId,
    taskResult: request.taskResult,
  };
  const durableResultAcceptance: DurableDispatchResultAcceptance = {
    ...resultAcceptance,
    finalizationRequired: true,
    spaceId: pending.spaceId,
  };
  let settledFinalization: SettledDurableDispatchFinalization | null = null;
  if (
    deps.settleDurableDispatchResult &&
    state.sessionsById.get(request.daemonSessionId)?.capabilities
      .agentReplyContextReview === true &&
    shouldSettleAgentReplyBeforeResultAcceptance(request.taskResult)
  ) {
    const settlement = await deps.settleDurableDispatchResult(
      durableResultAcceptance
    );
    if (!settlement.ok) {
      return settlement;
    }
    settledFinalization = settlement.settledFinalization;
  }
  const inboxAcceptance = await deps.acceptDispatchResult(resultAcceptance);
  if (!inboxAcceptance.ok) {
    return toSubmitTaskResultResponse(inboxAcceptance);
  }
  if (deps.finalizeDurableDispatchResult) {
    const finalization = await deps.finalizeDurableDispatchResult({
      ...durableResultAcceptance,
      acceptedResultStatus: inboxAcceptance.status,
      settledFinalization,
    });
    if (!finalization.ok) {
      return finalization;
    }
  }

  const completedDispatchResult: CompletedDispatchResultState = {
    attemptId: pending.attemptId,
    dispatchId: pending.dispatchId,
    daemonSessionId: request.daemonSessionId,
    executionIdentity: pending.executionIdentity,
    executionTokenFingerprint: resultPointer.executionTokenFingerprint,
    executionTokenRunId: resultPointer.executionTokenRunId,
    connectionGeneration: pending.connectionGeneration,
    leaseEpoch: request.leaseEpoch,
    receivedAtMs,
    runtimeCoordinatorExecutionId: resultPointer.runtimeCoordinatorExecutionId,
    sourceClientMessageId: pending.sourceClientMessageId,
    submittedConnectionGeneration: request.connectionGeneration,
    taskResult: request.taskResult,
    taskId: pending.taskId,
    targetProfileId: pending.profileId,
  };
  state.completedDispatchResults.set(
    dispatchAttemptKey,
    completedDispatchResult
  );
  pending.phase = "result_received";
  state.pendingDispatches.delete(dispatchAttemptKey);

  const completedLifecycle = buildCompletedLifecycleSnapshot({
    pending,
    completedLocalAtMs: pending.completedLocalAtMs ?? receivedAtMs,
  });
  deps.resolvePendingResultWaiters(dispatchAttemptKey, {
    lifecycle: completedLifecycle,
    state: "completed",
    taskResult: request.taskResult,
  });
  deps.cleanupCompletedResults(receivedAtMs);

  return {
    ok: true,
    status: "accepted",
  };
};

const resolveSubmitTaskResultWithoutPending = async (input: {
  deps: SubmitTaskResultDependencies;
  dispatchAttemptKey: string;
  request: RuntimeTransportSubmitTaskResultRequest;
  requestAttemptId: string;
  state: RuntimeTransportMutableState;
}): Promise<RuntimeTransportSubmitTaskResultResponse> => {
  const completedResult = input.state.completedDispatchResults.get(
    input.dispatchAttemptKey
  );
  if (completedResult) {
    return resolveCompletedResultReplayResponse(
      completedResult.taskResult,
      input.request.taskResult
    );
  }

  if (input.deps.resolveDurableDispatchResultAcceptance) {
    const durableAcceptance =
      await input.deps.resolveDurableDispatchResultAcceptance({
        attemptId: input.requestAttemptId,
        connectionGeneration: input.request.connectionGeneration,
        daemonSessionId: input.request.daemonSessionId,
        dispatchId: input.request.dispatchId,
        executionTokenFingerprint:
          input.deps.acceptedResultRuntimeCoordinatorPointer
            ?.executionTokenFingerprint ?? null,
        executionTokenRunId:
          input.deps.acceptedResultRuntimeCoordinatorPointer
            ?.executionTokenRunId ?? null,
        leaseEpoch: input.request.leaseEpoch,
        runtimeCoordinatorExecutionId:
          input.deps.acceptedResultRuntimeCoordinatorPointer
            ?.runtimeCoordinatorExecutionId ?? null,
        taskResult: input.request.taskResult,
      });
    if (!durableAcceptance.ok) {
      return durableAcceptance;
    }
    const inboxAcceptance = await input.deps.acceptDispatchResult(
      durableAcceptance.result
    );
    if (!inboxAcceptance.ok) {
      return toSubmitTaskResultResponse(inboxAcceptance);
    }
    if (
      durableAcceptance.result.finalizationRequired &&
      input.deps.finalizeDurableDispatchResult
    ) {
      const finalization = await input.deps.finalizeDurableDispatchResult({
        ...durableAcceptance.result,
        acceptedResultStatus: inboxAcceptance.status,
      });
      if (!finalization.ok) {
        return finalization;
      }
    }
    return toSubmitTaskResultResponse(inboxAcceptance);
  }

  console.warn("[core.runtime_transport.result_without_pending]", {
    dispatchId: input.request.dispatchId,
    attemptId: input.requestAttemptId,
    daemonSessionId: input.request.daemonSessionId,
    connectionGeneration: input.request.connectionGeneration,
    leaseEpoch: input.request.leaseEpoch,
    reasonCode: "daemon.session.not_found",
  });
  return {
    ok: false,
    reasonCode: "daemon.session.not_found",
    status: "retry_later",
  };
};

const validatePendingSubmitTaskResult = (input: {
  pending: PendingDispatchState;
  request: RuntimeTransportSubmitTaskResultRequest;
  requestAttemptId: string;
}): RuntimeTransportSubmitTaskResultResponse | null => {
  if (input.pending.attemptId !== input.requestAttemptId) {
    console.warn("[core.runtime_transport.stale_attempt_result_rejected]", {
      event: CORE_LOG_EVENTS.runtimeTransportStaleLeaseResultRejected,
      dispatchId: input.request.dispatchId,
      expectedAttemptId: input.pending.attemptId,
      actualAttemptId: input.requestAttemptId,
      expectedDaemonSessionId: input.pending.daemonSessionId,
      expectedLeaseEpoch: input.pending.leaseEpoch,
      actualDaemonSessionId: input.request.daemonSessionId,
      actualLeaseEpoch: input.request.leaseEpoch,
    });
    return {
      ok: false,
      reasonCode: "daemon.result.identity_mismatch",
      status: "rejected_terminal",
    };
  }

  if (
    !isTaskResultForPendingDispatch(input.pending, input.request.taskResult)
  ) {
    console.warn("[core.runtime_transport.result_identity_mismatch]", {
      dispatchId: input.request.dispatchId,
      attemptId: input.requestAttemptId,
      expectedTaskId: input.pending.taskId,
      actualTaskId: input.request.taskResult.payload.taskId,
      expectedTargetProfileId: input.pending.profileId,
      actualTargetProfileId: input.request.taskResult.payload.agentId,
      reasonCode: "daemon.result.identity_mismatch",
    });
    return {
      ok: false,
      reasonCode: "daemon.result.identity_mismatch",
      status: "rejected_terminal",
    };
  }

  const leaseMatched = isLeaseMatch({
    expectedDaemonSessionId: input.pending.daemonSessionId,
    expectedLeaseEpoch: input.pending.leaseEpoch,
    actualDaemonSessionId: input.request.daemonSessionId,
    actualLeaseEpoch: input.request.leaseEpoch,
  });
  if (leaseMatched) {
    return null;
  }

  console.warn("[core.runtime_transport.stale_lease_result_rejected]", {
    event: CORE_LOG_EVENTS.runtimeTransportStaleLeaseResultRejected,
    dispatchId: input.request.dispatchId,
    expectedDaemonSessionId: input.pending.daemonSessionId,
    expectedLeaseEpoch: input.pending.leaseEpoch,
    actualDaemonSessionId: input.request.daemonSessionId,
    actualLeaseEpoch: input.request.leaseEpoch,
  });
  return {
    ok: false,
    reasonCode: "daemon.session.stale_lease",
    status: "rejected_terminal",
  };
};

const resolveExecutionIdentityEchoMismatch = (input: {
  authoritative: PendingDispatchState["executionIdentity"];
  echoed: RuntimeTransportSubmitTaskResultRequest["executionIdentityEcho"];
}):
  | "bindingId"
  | "agentControllerRef"
  | "modelVersion"
  | "openMeldServiceRuntimeId"
  | "scope"
  | null => {
  const authoritative = input.authoritative.core;
  const echoed = input.echoed.core;
  if (authoritative.modelVersion !== echoed.modelVersion) {
    return "modelVersion";
  }
  if (
    authoritative.spaceId !== echoed.spaceId ||
    authoritative.dispatchId !== echoed.dispatchId ||
    authoritative.targetProfileId !== echoed.targetProfileId
  ) {
    return "scope";
  }
  if (authoritative.bindingId !== echoed.bindingId) {
    return "bindingId";
  }
  if (
    authoritative.openMeldServiceRuntimeId.value !==
    echoed.openMeldServiceRuntimeId.value
  ) {
    return "openMeldServiceRuntimeId";
  }
  if (authoritative.agentControllerRef !== echoed.agentControllerRef) {
    return "agentControllerRef";
  }
  return null;
};

const resolveAcceptedResultRuntimeCoordinatorPointer = (input: {
  deps: SubmitTaskResultDependencies;
  pending: PendingDispatchState;
}): AcceptedResultRuntimeCoordinatorPointer => {
  const validatedPointer = input.deps.acceptedResultRuntimeCoordinatorPointer;
  if (validatedPointer) {
    return validatedPointer;
  }

  return {
    executionTokenFingerprint: input.pending.executionTokenFingerprint ?? null,
    executionTokenRunId: input.pending.executionTokenRunId ?? null,
    runtimeCoordinatorExecutionId: input.pending.runtimeCoordinatorExecutionId,
  };
};

type AcceptedResultRuntimeCoordinatorPointer = {
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  runtimeCoordinatorExecutionId: string;
};

const resolveNextPendingPhase = (input: {
  currentPhase:
    | "starting"
    | "accepted_local"
    | "completed_local"
    | "result_received"
    | "running";
  requestedPhase: "accepted_local" | "completed_local" | "running";
}):
  | "starting"
  | "accepted_local"
  | "completed_local"
  | "result_received"
  | "running" => {
  const phaseRank = {
    starting: 0,
    accepted_local: 1,
    running: 2,
    completed_local: 3,
    result_received: 4,
  } as const;
  return phaseRank[input.requestedPhase] >= phaseRank[input.currentPhase]
    ? input.requestedPhase
    : input.currentPhase;
};

const resolveCompletedResultReplayResponse = (
  existingTaskResult: OpenMeldDaemonTaskResultEnvelope | null,
  submittedTaskResult: OpenMeldDaemonTaskResultEnvelope
): RuntimeTransportSubmitTaskResultResponse => {
  if (
    existingTaskResult &&
    !areTaskResultEnvelopesEquivalent(existingTaskResult, submittedTaskResult)
  ) {
    return {
      ok: false,
      reasonCode: "daemon.result.conflict",
      status: "rejected_terminal",
    };
  }
  return { ok: true, status: "accepted" };
};

const toSubmitTaskResultResponse = (
  result: Awaited<ReturnType<AcceptDispatchResult>>
): RuntimeTransportSubmitTaskResultResponse => {
  if (result.ok) {
    return {
      ok: true,
      status: "accepted",
    };
  }
  return {
    ok: false,
    reasonCode: result.reasonCode,
    status: result.status,
  };
};

const isTaskResultForPendingDispatch = (
  pending: PendingDispatchState,
  taskResult: OpenMeldDaemonTaskResultEnvelope
): boolean => {
  return (
    taskResult.payload.taskId === pending.taskId &&
    taskResult.payload.agentId === pending.profileId
  );
};

const shouldSettleAgentReplyBeforeResultAcceptance = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): boolean => {
  const payload = taskResult.payload;
  return (
    (payload.status === "success" || payload.status === "partial_success") &&
    "spaceAction" in payload &&
    payload.spaceAction?.type === "post_message"
  );
};

const areTaskResultEnvelopesEquivalent = (
  left: OpenMeldDaemonTaskResultEnvelope,
  right: OpenMeldDaemonTaskResultEnvelope
): boolean => {
  return stableJsonStringify(left) === stableJsonStringify(right);
};

const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(sortJsonValue(value));

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
  );
};

const hasPendingLocalRuntimeOwnershipEvidence = (
  pending: PendingDispatchState
): boolean => {
  return (
    pending.phase !== "starting" ||
    pending.acceptedLocalAtMs !== null ||
    pending.runningAtMs !== null ||
    pending.completedLocalAtMs !== null
  );
};

const resolvePendingLifecycleAtMs = (input: {
  pending: PendingDispatchState;
  requestedLifecycleAtMs: number;
  receivedAtMs: number;
}): number => {
  return Math.max(
    input.pending.lastLifecycleAtMs,
    Math.min(input.requestedLifecycleAtMs, input.receivedAtMs)
  );
};

const buildCompletedLifecycleSnapshot = (input: {
  pending: PendingDispatchState;
  completedLocalAtMs: number;
}) => {
  const completedLocalAtMs = input.completedLocalAtMs;
  return {
    phase: "completed_local" as const,
    createdAtMs: input.pending.createdAtMs,
    acceptedLocalAtMs: input.pending.acceptedLocalAtMs,
    runningAtMs: input.pending.runningAtMs,
    completedLocalAtMs,
    lastLifecycleAtMs: Math.max(
      input.pending.lastLifecycleAtMs,
      completedLocalAtMs
    ),
  };
};

const findPendingDispatchForSameDispatchTask = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportDeliverDispatchRequest
): PendingDispatchState | null => {
  for (const pending of state.pendingDispatches.values()) {
    if (
      pending.dispatchId === request.dispatchId &&
      pending.attemptId !== request.attemptId &&
      pending.taskId === request.payload.taskId &&
      pending.profileId === request.profileId &&
      hasPendingLocalRuntimeOwnershipEvidence(pending)
    ) {
      return pending;
    }
  }
  return null;
};

const findCompletedDispatchResultByDispatchTask = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportDeliverDispatchRequest
): CompletedDispatchResultState | null => {
  for (const [
    dispatchAttemptKey,
    result,
  ] of state.completedDispatchResults.entries()) {
    if (
      dispatchAttemptKey.startsWith(`${request.dispatchId}::`) &&
      result.taskId === request.payload.taskId &&
      result.targetProfileId === request.profileId
    ) {
      return result;
    }
  }
  return null;
};

const resolveResultAttemptId = (
  request: RuntimeTransportSubmitTaskResultRequest
): string | null => {
  const requestAttemptId =
    typeof request.attemptId === "string" ? request.attemptId.trim() : "";
  const payload = request.taskResult.payload as { attemptId?: unknown };
  const payloadAttemptId =
    typeof payload.attemptId === "string" ? payload.attemptId.trim() : "";
  return requestAttemptId || payloadAttemptId || null;
};

const resolvePendingDispatchSpaceId = (
  request: RuntimeTransportDeliverDispatchRequest
): string => {
  const payload = request.payload as { spaceId?: unknown };
  const spaceId =
    typeof payload.spaceId === "string" ? payload.spaceId.trim() : "";
  return spaceId || "unknown-space";
};

const resolvePendingDispatchSpacePassword = (
  request: RuntimeTransportDeliverDispatchRequest
): string | null => {
  const payload = request.payload as { spacePassword?: unknown };
  const spacePassword =
    typeof payload.spacePassword === "string"
      ? normalizeSpacePasswordText(payload.spacePassword)
      : "";
  return spacePassword || null;
};

function buildPendingDispatchSpaceAccess(
  request: RuntimeTransportDeliverDispatchRequest
) {
  return createDispatchContinuationSpaceAccessContext({
    attemptId: request.attemptId,
    dispatchId: request.dispatchId,
    password: resolvePendingDispatchSpacePassword(request),
    requestContext: buildPendingDispatchRequestContext(request),
    sourceSignalId: resolvePendingDispatchSourceSignalId(request),
    spaceId: resolvePendingDispatchSpaceId(request),
    targetProfileId: request.profileId,
  });
}

function buildPendingDispatchRequestContext(
  request: RuntimeTransportDeliverDispatchRequest
): OpenMeldRequestContext {
  const payload = request.payload;
  return {
    actorContext: {
      requestId: `runtime-transport-dispatch-${request.dispatchId}`,
      openMeldProfileId: request.profileId,
      profileKind: "agent",
      ...(typeof payload.targetProfileName === "string" &&
      payload.targetProfileName.trim().length > 0
        ? { profileName: payload.targetProfileName.trim() }
        : {}),
      dispatchChainId: payload.dispatchChainId ?? request.dispatchId,
      autoRelayDepth: payload.autoRelayDepth ?? 0,
      visitedProfileIds: payload.visitedProfileIds ?? [],
      visitedProfileIdsHash:
        payload.visitedProfileIdsHash ?? request.dispatchId,
    },
  };
}

function resolvePendingDispatchSourceSignalId(
  request: RuntimeTransportDeliverDispatchRequest
): string {
  const sourceSignalId =
    typeof request.payload.sourceEventId === "string"
      ? request.payload.sourceEventId.trim()
      : "";
  return sourceSignalId || request.dispatchId;
}

const resolvePendingDispatchTargetProfileName = (
  request: RuntimeTransportDeliverDispatchRequest
): string | null => {
  const payload = request.payload as { targetProfileName?: unknown };
  const targetProfileName =
    typeof payload.targetProfileName === "string"
      ? payload.targetProfileName.trim()
      : "";
  return targetProfileName || null;
};
