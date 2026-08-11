import { isLeaseMatch, resolveLeaseArbitration } from "@openmeld/agent-runtime";
import type {
  DaemonExecutionCompatibility,
  LocalWakeRouteReport,
  RuntimeTransportHeartbeatRequest,
  RuntimeTransportHeartbeatResponse,
  RuntimeTransportLease,
  RuntimeTransportLookupOwnerServiceRequest,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportLookupRouteRequest,
  RuntimeTransportLookupRouteResponse,
  RuntimeTransportLookupRoutesBatchRequest,
  RuntimeTransportLookupRoutesBatchResponse,
  RuntimeTransportRegisterSessionRequest,
  RuntimeTransportRegisterSessionResponse,
  RuntimeTransportRejectedProfileRegistration,
} from "@openmeld/schemas/types";
import { RUNTIME_TRANSPORT_LEASE_TTL_MS } from "../../strategy-constants";
import { writeRuntimeTransportSocketAttachment } from "../infrastructure/runtime-transport-socket-attachment";
import {
  createMissingDaemonExecutionCompatibility,
  isDaemonExecutionCompatible,
  resolveDaemonExecutionCompatibility,
} from "./daemon-execution-compatibility";
import type {
  RuntimeTransportMutableState,
  RuntimeTransportSessionState,
  WaitDispatchResultResponse,
} from "./runtime-transport-state";

// Must comfortably exceed the client's adaptive heartbeat ceiling
// (60s + 10% jitter) plus one slow round trip through a flaky proxy and a
// cold DO start. 90s left a 24s margin that ordinary latency breached,
// reaping live leases and driving the web card's blocked/ready flapping.
export const LEASE_TTL_MS = RUNTIME_TRANSPORT_LEASE_TTL_MS;
const PENDING_FIRST_REPORT_MAX_AGE_MS = LEASE_TTL_MS;

const isRuntimeTransportSessionFresh = (
  session: Pick<RuntimeTransportSessionState, "lastHeartbeatMs">,
  nowMs: number
): boolean => nowMs - session.lastHeartbeatMs <= LEASE_TTL_MS;

const isRuntimeTransportSessionExplicitlyStopped = (
  session: Pick<
    RuntimeTransportSessionState,
    "acceptingDispatches" | "stopCause"
  >
): boolean =>
  session.acceptingDispatches === false && session.stopCause === "user_stop";

const compareOwnerServiceSessionsByFreshness = (
  left: RuntimeTransportSessionState,
  right: RuntimeTransportSessionState
): number => {
  return (
    right.lastHeartbeatMs - left.lastHeartbeatMs ||
    right.connectionGeneration - left.connectionGeneration ||
    right.connectedAtMs - left.connectedAtMs ||
    right.daemonSessionId.localeCompare(left.daemonSessionId)
  );
};

type SessionLifecycleDependencies = {
  persistRuntimeRecords: () => void;
  cleanupExpiredPendingDispatches: (nowMs: number) => void;
  recordReapedReadinessProfiles?: (result: ReapExpiredLeasesResult) => void;
  failPendingDispatchResultWaitersForConnectionGeneration: (
    daemonSessionId: string,
    connectionGeneration: number,
    response: WaitDispatchResultResponse
  ) => void;
  closeSocket: (socket: WebSocket, code: number, reason: string) => void;
};

type ReapExpiredLeasesResult = {
  expiredProfileIds: string[];
  removedSessionProfileIds: string[];
};

export const handleRegisterSession = (
  state: RuntimeTransportMutableState,
  input: {
    request: RuntimeTransportRegisterSessionRequest;
    verifiedOwnerUserId: string;
    webSocket: WebSocket;
  },
  deps: SessionLifecycleDependencies
): RuntimeTransportRegisterSessionResponse => {
  const nowMs = Date.now();
  reapExpiredLeases(state, nowMs, deps);

  const request = input.request;
  const existingSession = state.sessionsById.get(request.daemonSessionId);
  const isSameSocketReRegister = existingSession?.socket === input.webSocket;
  const previousAcceptingDispatches =
    existingSession?.acceptingDispatches !== false;
  const previousStopCause = existingSession?.stopCause;
  if (request.ownerUserId !== input.verifiedOwnerUserId) {
    return {
      ok: false,
      connectionGeneration:
        existingSession?.connectionGeneration ?? request.connectionGeneration,
      acceptedLeases: [],
      rejectedProfiles: request.profileIds.map((profileId) => ({
        profileId,
        reasonCode: "daemon.session.reject_conflict",
      })),
    };
  }

  if (state.ownerUserId !== input.verifiedOwnerUserId) {
    state.ownerUserId = input.verifiedOwnerUserId;
  }
  const session = resolveRuntimeTransportSession({
    existingSession,
    nowMs,
    verifiedOwnerUserId: input.verifiedOwnerUserId,
    request,
  });
  const previousConnectionGeneration =
    existingSession?.connectionGeneration ?? null;
  const nextConnectionGeneration = resolveAcceptedConnectionGeneration({
    existingSession,
    requestedConnectionGeneration: request.connectionGeneration,
    webSocket: input.webSocket,
  });

  session.ownerUserId = input.verifiedOwnerUserId;
  session.deviceId = request.deviceId;
  session.lane = request.lane;
  session.serviceVersion = normalizeServiceVersion(request.serviceVersion);
  session.connectionGeneration = nextConnectionGeneration;
  session.connectedAtMs = request.connectedAtMs;
  session.lastHeartbeatMs = nowMs;
  session.acceptingDispatches = isSameSocketReRegister
    ? previousAcceptingDispatches
    : false;
  session.stopCause = isSameSocketReRegister ? previousStopCause : undefined;
  session.capabilities = request.capabilities;
  session.executionCompatibility = resolveDaemonExecutionCompatibility(
    request.runtimeContract
  );
  session.localWakeRouteReport = request.localWakeRouteReport
    ? {
        ...request.localWakeRouteReport,
        daemonSessionId: request.daemonSessionId,
        deviceId: request.deviceId,
        lane: request.lane,
        serviceVersion: session.serviceVersion,
      }
    : null;

  if (
    previousConnectionGeneration !== null &&
    previousConnectionGeneration !== nextConnectionGeneration
  ) {
    handleConnectionGenerationReplacement({
      daemonSessionId: request.daemonSessionId,
      deps,
      nextConnectionGeneration,
      previousConnectionGeneration,
    });
  }

  replaceDaemonSessionSocket({
    closeSocket: deps.closeSocket,
    daemonSessionId: request.daemonSessionId,
    session,
    socket: input.webSocket,
    state,
    verifiedOwnerUserId: input.verifiedOwnerUserId,
  });

  const { acceptedLeases, rejectedProfiles } = isDaemonExecutionCompatible(
    session.executionCompatibility
  )
    ? reconcileRequestedProfileLeases({
        nowMs,
        profileIds: request.profileIds,
        request,
        session,
        state,
      })
    : rejectRequestedProfileLeasesForIncompatibleSession({
        profileIds: request.profileIds,
        request,
        session,
        state,
      });
  syncRejectedProfileRegistrations({
    nowMs,
    rejectedProfiles,
    request,
    session,
  });

  state.sessionsById.set(request.daemonSessionId, session);
  refreshDaemonSessionSocketAttachment(session);
  deps.persistRuntimeRecords();

  return {
    ok: rejectedProfiles.length === 0,
    connectionGeneration: session.connectionGeneration,
    acceptedLeases,
    rejectedProfiles,
  };
};

const syncRejectedProfileRegistrations = (input: {
  nowMs: number;
  rejectedProfiles: RuntimeTransportRegisterSessionResponse["rejectedProfiles"];
  request: RuntimeTransportRegisterSessionRequest;
  session: RuntimeTransportSessionState;
}): void => {
  const mentionedProfileIds = new Set<string>([
    ...input.request.profileIds,
    ...(input.session.localWakeRouteReport?.includedProfileIds ?? []),
    ...(input.session.localWakeRouteReport?.skippedProfiles.map(
      (profile) => profile.profileId
    ) ?? []),
  ]);
  for (const profileId of mentionedProfileIds) {
    input.session.rejectedProfileRegistrationsByProfileId.delete(profileId);
  }

  for (const rejectedProfile of input.rejectedProfiles) {
    input.session.rejectedProfileRegistrationsByProfileId.set(
      rejectedProfile.profileId,
      {
        profileId: rejectedProfile.profileId,
        reasonCode: rejectedProfile.reasonCode,
        rejectedAtMs: input.nowMs,
        daemonSessionId: input.request.daemonSessionId,
        deviceId: input.request.deviceId,
        lane: input.request.lane,
        serviceVersion: input.session.serviceVersion,
      }
    );
  }
};

const resolveRuntimeTransportSession = (input: {
  existingSession: RuntimeTransportSessionState | undefined;
  nowMs: number;
  verifiedOwnerUserId: string;
  request: RuntimeTransportRegisterSessionRequest;
}): RuntimeTransportSessionState => {
  return (
    input.existingSession ?? {
      ownerUserId: input.verifiedOwnerUserId,
      daemonSessionId: input.request.daemonSessionId,
      deviceId: input.request.deviceId,
      lane: input.request.lane,
      serviceVersion: normalizeServiceVersion(input.request.serviceVersion),
      connectionGeneration: 1,
      connectedAtMs: input.request.connectedAtMs,
      lastHeartbeatMs: input.nowMs,
      deliveryDisconnectedAtMs: null,
      capabilities: input.request.capabilities,
      executionCompatibility: resolveDaemonExecutionCompatibility(
        input.request.runtimeContract
      ),
      profileIds: new Set<string>(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    }
  );
};

const resolveAcceptedConnectionGeneration = (input: {
  existingSession: RuntimeTransportSessionState | undefined;
  requestedConnectionGeneration: number;
  webSocket: WebSocket;
}): number => {
  if (
    input.existingSession &&
    input.existingSession.socket === input.webSocket
  ) {
    return input.existingSession.connectionGeneration;
  }
  return Math.max(
    1,
    input.requestedConnectionGeneration,
    input.existingSession?.connectionGeneration ?? 0
  );
};

const handleConnectionGenerationReplacement = (input: {
  daemonSessionId: string;
  deps: Pick<
    SessionLifecycleDependencies,
    "failPendingDispatchResultWaitersForConnectionGeneration"
  >;
  nextConnectionGeneration: number;
  previousConnectionGeneration: number;
}): void => {
  input.deps.failPendingDispatchResultWaitersForConnectionGeneration(
    input.daemonSessionId,
    input.previousConnectionGeneration,
    {
      state: "failed",
      reasonCode: "daemon.session.connection_replaced",
    }
  );
  console.info("[core.runtime_transport.connection_generation_replaced]", {
    daemonSessionId: input.daemonSessionId,
    previousConnectionGeneration: input.previousConnectionGeneration,
    nextConnectionGeneration: input.nextConnectionGeneration,
  });
};

const replaceDaemonSessionSocket = (input: {
  closeSocket: SessionLifecycleDependencies["closeSocket"];
  daemonSessionId: string;
  session: RuntimeTransportSessionState;
  socket: WebSocket;
  state: RuntimeTransportMutableState;
  verifiedOwnerUserId: string;
}): void => {
  if (input.session.socket && input.session.socket !== input.socket) {
    input.closeSocket(input.session.socket, 1012, "session_replaced");
    input.state.sessionIdBySocket.delete(input.session.socket);
  }

  input.session.socket = input.socket;
  input.session.deliveryDisconnectedAtMs = null;
  input.state.sessionIdBySocket.set(input.socket, input.daemonSessionId);
  writeRuntimeTransportSocketAttachment(input.socket, {
    verifiedOwnerUserId: input.verifiedOwnerUserId,
    daemonSessionId: input.daemonSessionId,
    connectionGeneration: input.session.connectionGeneration,
  });
};

const refreshDaemonSessionSocketAttachment = (
  session: RuntimeTransportSessionState
): void => {
  if (!session.socket) {
    return;
  }
  writeRuntimeTransportSocketAttachment(session.socket, {
    verifiedOwnerUserId: session.ownerUserId,
    daemonSessionId: session.daemonSessionId,
    connectionGeneration: session.connectionGeneration,
  });
};

const reconcileRequestedProfileLeases = (input: {
  nowMs: number;
  profileIds: string[];
  request: RuntimeTransportRegisterSessionRequest;
  session: RuntimeTransportSessionState;
  state: RuntimeTransportMutableState;
}): {
  acceptedLeases: RuntimeTransportLease[];
  rejectedProfiles: Array<{
    profileId: string;
    reasonCode: "daemon.session.reject_conflict";
  }>;
} => {
  const requestedProfileIds = new Set(input.profileIds);
  for (const existingProfileId of [...input.session.profileIds]) {
    if (requestedProfileIds.has(existingProfileId)) {
      continue;
    }
    const activeLease =
      input.state.profileLeasesByProfileId.get(existingProfileId);
    if (activeLease?.daemonSessionId === input.request.daemonSessionId) {
      input.state.profileLeasesByProfileId.delete(existingProfileId);
    }
    input.session.profileIds.delete(existingProfileId);
  }

  const acceptedLeases: RuntimeTransportLease[] = [];
  const rejectedProfiles: Array<{
    profileId: string;
    reasonCode: "daemon.session.reject_conflict";
  }> = [];

  const profileIdsToClear = new Set([
    ...input.session.profileIds,
    ...input.profileIds,
  ]);
  for (const profileId of profileIdsToClear) {
    const current = input.state.profileLeasesByProfileId.get(profileId);
    const decision = resolveLeaseArbitration({
      current: current
        ? {
            daemonSessionId: current.daemonSessionId,
            deviceId: current.deviceId,
            lane: current.lane,
            leaseEpoch: current.leaseEpoch,
          }
        : null,
      candidate: {
        daemonSessionId: input.request.daemonSessionId,
        deviceId: input.request.deviceId,
        lane: input.request.lane,
        takeover: false,
      },
    });

    if (!decision.accepted) {
      rejectedProfiles.push({
        profileId,
        reasonCode: "daemon.session.reject_conflict",
      });
      continue;
    }

    if (current && current.daemonSessionId !== input.request.daemonSessionId) {
      const previousSession = input.state.sessionsById.get(
        current.daemonSessionId
      );
      previousSession?.profileIds.delete(profileId);
    }

    const nextLease = {
      profileId,
      daemonSessionId: input.request.daemonSessionId,
      deviceId: input.request.deviceId,
      lane: input.request.lane,
      serviceVersion: input.session.serviceVersion,
      leaseEpoch: decision.nextLeaseEpoch,
      lastHeartbeatMs: input.nowMs,
      capabilities: input.request.capabilities,
      executionCompatibility: input.session.executionCompatibility,
    };
    input.state.profileLeasesByProfileId.set(profileId, nextLease);
    input.session.profileIds.add(profileId);
    acceptedLeases.push({
      profileId,
      leaseEpoch: nextLease.leaseEpoch,
    });
  }

  return {
    acceptedLeases,
    rejectedProfiles,
  };
};

const rejectRequestedProfileLeasesForIncompatibleSession = (input: {
  profileIds: string[];
  request: RuntimeTransportRegisterSessionRequest;
  session: RuntimeTransportSessionState;
  state: RuntimeTransportMutableState;
}): {
  acceptedLeases: RuntimeTransportLease[];
  rejectedProfiles: Array<{
    profileId: string;
    reasonCode: "daemon.session.reject_conflict";
  }>;
} => {
  const profileIdsToClear = new Set([
    ...input.session.profileIds,
    ...input.profileIds,
  ]);
  for (const profileId of profileIdsToClear) {
    const activeLease = input.state.profileLeasesByProfileId.get(profileId);
    if (activeLease?.daemonSessionId === input.request.daemonSessionId) {
      input.state.profileLeasesByProfileId.delete(profileId);
    }
    input.session.profileIds.delete(profileId);
  }

  return {
    acceptedLeases: [],
    rejectedProfiles: input.profileIds.map((profileId) => ({
      profileId,
      reasonCode: "daemon.session.reject_conflict",
    })),
  };
};

export const handleHeartbeat = (
  state: RuntimeTransportMutableState,
  input: {
    request: RuntimeTransportHeartbeatRequest;
    verifiedOwnerUserId: string;
  },
  deps: SessionLifecycleDependencies
): RuntimeTransportHeartbeatResponse => {
  const nowMs = Date.now();
  reapExpiredLeases(state, nowMs, deps);
  const request = input.request;

  if (request.ownerUserId !== input.verifiedOwnerUserId) {
    return {
      ok: false,
      serverNowMs: nowMs,
      staleLeases: request.leases,
      reasonCode: "daemon.session.reject_conflict",
    };
  }

  const session = state.sessionsById.get(request.daemonSessionId);
  if (
    !session ||
    session.deviceId !== request.deviceId ||
    session.lane !== request.lane
  ) {
    return {
      ok: false,
      serverNowMs: nowMs,
      staleLeases: request.leases,
    };
  }

  if (state.ownerUserId !== input.verifiedOwnerUserId) {
    state.ownerUserId = input.verifiedOwnerUserId;
  }
  session.ownerUserId = input.verifiedOwnerUserId;
  session.lane = request.lane;
  session.serviceVersion = normalizeServiceVersion(request.serviceVersion);
  session.lastHeartbeatMs = nowMs;
  session.acceptingDispatches = request.acceptingDispatches !== false;
  session.stopCause =
    request.acceptingDispatches === false ? request.stopCause : undefined;
  session.capabilities = request.capabilities ?? session.capabilities;
  session.executionCompatibility = resolveDaemonExecutionCompatibility(
    request.runtimeContract
  );

  if (!isDaemonExecutionCompatible(session.executionCompatibility)) {
    const staleLeases = staleSessionLeases({
      leases: request.leases,
      session,
      state,
    });
    refreshDaemonSessionSocketAttachment(session);
    deps.persistRuntimeRecords();
    return {
      ok: true,
      serverNowMs: nowMs,
      staleLeases,
    };
  }

  const staleLeases: RuntimeTransportLease[] = [];
  for (const lease of request.leases) {
    const activeLease = state.profileLeasesByProfileId.get(lease.profileId);
    if (!activeLease) {
      staleLeases.push(lease);
      continue;
    }

    const matched = isLeaseMatch({
      expectedDaemonSessionId: activeLease.daemonSessionId,
      expectedLeaseEpoch: activeLease.leaseEpoch,
      actualDaemonSessionId: request.daemonSessionId,
      actualLeaseEpoch: lease.leaseEpoch,
    });

    if (!matched) {
      staleLeases.push(lease);
      continue;
    }

    activeLease.lastHeartbeatMs = nowMs;
    activeLease.capabilities = session.capabilities;
    activeLease.executionCompatibility = session.executionCompatibility;
    activeLease.serviceVersion = session.serviceVersion;
    session.profileIds.add(lease.profileId);
  }

  refreshDaemonSessionSocketAttachment(session);
  deps.persistRuntimeRecords();

  return {
    ok: true,
    serverNowMs: nowMs,
    staleLeases,
  };
};

const staleSessionLeases = (input: {
  leases: readonly RuntimeTransportLease[];
  session: RuntimeTransportSessionState;
  state: RuntimeTransportMutableState;
}): RuntimeTransportLease[] => {
  const staleLeases: RuntimeTransportLease[] = [];
  const requestedLeaseByProfileId = new Map(
    input.leases.map((lease) => [lease.profileId, lease])
  );
  const profileIdsToClear = new Set([
    ...input.session.profileIds,
    ...requestedLeaseByProfileId.keys(),
  ]);
  for (const profileId of profileIdsToClear) {
    const activeLease = input.state.profileLeasesByProfileId.get(profileId);
    if (activeLease?.daemonSessionId === input.session.daemonSessionId) {
      staleLeases.push(
        requestedLeaseByProfileId.get(profileId) ?? {
          profileId,
          leaseEpoch: activeLease.leaseEpoch,
        }
      );
      input.state.profileLeasesByProfileId.delete(profileId);
    } else {
      const requestedLease = requestedLeaseByProfileId.get(profileId);
      if (requestedLease) {
        staleLeases.push(requestedLease);
      }
    }
    input.session.profileIds.delete(profileId);
  }
  return staleLeases;
};

export const lookupRoute = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportLookupRouteRequest,
  deps: Pick<
    SessionLifecycleDependencies,
    | "persistRuntimeRecords"
    | "cleanupExpiredPendingDispatches"
    | "recordReapedReadinessProfiles"
  >
): RuntimeTransportLookupRouteResponse => {
  const nowMs = Date.now();
  reapExpiredLeases(state, nowMs, deps);

  if (state.ownerUserId && state.ownerUserId !== request.ownerUserId) {
    return {
      online: false,
      reasonCode: "daemon.session.reject_conflict",
    };
  }

  const lease = state.profileLeasesByProfileId.get(request.profileId);
  if (!lease) {
    return resolveMissingLeaseRoute({
      nowMs,
      request,
      state,
    });
  }
  state.pendingFirstReportStartedAtByProfileId.delete(request.profileId);

  const session = state.sessionsById.get(lease.daemonSessionId);
  if (!session?.socket) {
    return {
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: lease.lastHeartbeatMs,
      executionCompatibility:
        lease.executionCompatibility ??
        session?.executionCompatibility ??
        createMissingDaemonExecutionCompatibility(),
      localWakeRouteReport: session?.localWakeRouteReport ?? undefined,
      rejectedProfileRegistration:
        session?.rejectedProfileRegistrationsByProfileId.get(
          request.profileId
        ) ?? undefined,
    };
  }

  const executionCompatibility =
    lease.executionCompatibility ??
    session.executionCompatibility ??
    createMissingDaemonExecutionCompatibility();
  if (!isDaemonExecutionCompatible(executionCompatibility)) {
    return {
      online: false,
      reasonCode: "daemon.profile.offline",
      executionCompatibility,
      localWakeRouteReport: session.localWakeRouteReport ?? undefined,
      rejectedProfileRegistration:
        session.rejectedProfileRegistrationsByProfileId.get(
          request.profileId
        ) ?? undefined,
    };
  }

  return {
    online: true,
    ...(session.acceptingDispatches === false
      ? {
          acceptingDispatches: false,
          stopCause: session.stopCause ?? "unknown",
        }
      : {}),
    daemonSessionId: lease.daemonSessionId,
    deviceId: lease.deviceId,
    lane: lease.lane,
    serviceVersion: lease.serviceVersion,
    connectionGeneration: session.connectionGeneration,
    leaseEpoch: lease.leaseEpoch,
    lastHeartbeatMs: lease.lastHeartbeatMs,
    capabilities: lease.capabilities,
    executionCompatibility,
    localWakeRouteReport: session.localWakeRouteReport ?? undefined,
  };
};

function resolveMissingLeaseRoute(input: {
  nowMs: number;
  request: RuntimeTransportLookupRouteRequest;
  state: RuntimeTransportMutableState;
}): RuntimeTransportLookupRouteResponse {
  const registrationFacts = findProfileRouteRegistrationFacts({
    profileId: input.request.profileId,
    ownerUserId: input.request.ownerUserId,
    state: input.state,
  });
  if (registrationFacts) {
    input.state.pendingFirstReportStartedAtByProfileId.delete(
      input.request.profileId
    );
  }
  const ownerService = registrationFacts
    ? null
    : resolveFreshOwnerServiceForPendingFirstReport({
        nowMs: input.nowMs,
        ownerUserId: input.request.ownerUserId,
        profileId: input.request.profileId,
        state: input.state,
      });
  return {
    online: false,
    reasonCode: ownerService
      ? "daemon.profile.pending_first_report"
      : "daemon.profile.offline",
    ...(registrationFacts ?? {}),
    ...(ownerService ? { ownerService } : {}),
    ...(findProfileSessionExecutionCompatibility({
      profileId: input.request.profileId,
      state: input.state,
    }) ?? {}),
  };
}

export const lookupRoutesBatch = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportLookupRoutesBatchRequest,
  deps: Pick<
    SessionLifecycleDependencies,
    | "persistRuntimeRecords"
    | "cleanupExpiredPendingDispatches"
    | "recordReapedReadinessProfiles"
  >
): RuntimeTransportLookupRoutesBatchResponse => {
  // One DO round trip for a whole readiness batch. The per-profile lookup
  // loop stays on the existing lookupRoute logic so batch and single-profile
  // answers can never drift apart.
  const routes: RuntimeTransportLookupRoutesBatchResponse["routes"] = {};
  for (const profileId of request.profileIds) {
    routes[profileId] = lookupRoute(
      state,
      {
        v: request.v,
        ownerUserId: request.ownerUserId,
        profileId,
      },
      deps
    );
  }
  return { routes };
};

const resolveFreshOwnerServiceForPendingFirstReport = (input: {
  nowMs: number;
  ownerUserId: string;
  profileId: string;
  state: RuntimeTransportMutableState;
}): NonNullable<
  Extract<
    RuntimeTransportLookupRouteResponse,
    { online: false }
  >["ownerService"]
> | null => {
  const session = [...input.state.sessionsById.values()]
    .filter(
      (candidate) =>
        candidate.ownerUserId === input.ownerUserId &&
        isRuntimeTransportSessionFresh(candidate, input.nowMs) &&
        isDaemonExecutionCompatible(
          candidate.executionCompatibility ??
            createMissingDaemonExecutionCompatibility()
        )
    )
    .sort(compareOwnerServiceSessionsByFreshness)[0];
  if (!session) {
    return null;
  }
  const startedAt =
    input.state.pendingFirstReportStartedAtByProfileId.get(input.profileId) ??
    input.nowMs;
  input.state.pendingFirstReportStartedAtByProfileId.set(
    input.profileId,
    startedAt
  );
  if (input.nowMs - startedAt > PENDING_FIRST_REPORT_MAX_AGE_MS) {
    return null;
  }
  return {
    daemonSessionId: session.daemonSessionId,
    deviceId: session.deviceId,
    lane: session.lane,
    serviceVersion: session.serviceVersion ?? null,
    connectionGeneration: session.connectionGeneration,
    lastHeartbeatMs: session.lastHeartbeatMs,
    capabilities: session.capabilities,
    executionCompatibility:
      session.executionCompatibility ??
      createMissingDaemonExecutionCompatibility(),
  };
};

export const lookupOwnerService = (
  state: RuntimeTransportMutableState,
  request: RuntimeTransportLookupOwnerServiceRequest,
  deps: Pick<
    SessionLifecycleDependencies,
    | "persistRuntimeRecords"
    | "cleanupExpiredPendingDispatches"
    | "recordReapedReadinessProfiles"
  >
): RuntimeTransportLookupOwnerServiceResponse => {
  const nowMs = Date.now();
  reapExpiredLeases(state, nowMs, deps);

  if (state.ownerUserId && state.ownerUserId !== request.ownerUserId) {
    return {
      online: false,
      reasonCode: "daemon.session.reject_conflict",
    };
  }

  // facts.md read rule: "is this owner's service online" is a TTL question,
  // not a socket-reference question. The socket only matters for delivery
  // (lookupRoute); requiring it here made hibernation timing flap the
  // user-facing connected/not-connected verdict.
  const sessions = [...state.sessionsById.values()]
    .filter(
      (session) =>
        session.ownerUserId === request.ownerUserId &&
        isRuntimeTransportSessionFresh(session, nowMs) &&
        !isRuntimeTransportSessionExplicitlyStopped(session)
    )
    .sort(compareOwnerServiceSessionsByFreshness)
    .map((session) => ({
      daemonSessionId: session.daemonSessionId,
      deviceId: session.deviceId,
      lane: session.lane,
      serviceVersion: session.serviceVersion,
      connectionGeneration: session.connectionGeneration,
      lastHeartbeatMs: session.lastHeartbeatMs,
      capabilities: session.capabilities,
      executionCompatibility:
        session.executionCompatibility ??
        createMissingDaemonExecutionCompatibility(),
    }));

  if (sessions.length === 0) {
    return {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
  }

  return {
    online: true,
    sessions,
  };
};

const findProfileSessionExecutionCompatibility = (input: {
  profileId: string;
  state: RuntimeTransportMutableState;
}): { executionCompatibility: DaemonExecutionCompatibility } | null => {
  for (const session of input.state.sessionsById.values()) {
    if (!session.profileIds.has(input.profileId)) {
      continue;
    }
    return {
      executionCompatibility:
        session.executionCompatibility ??
        createMissingDaemonExecutionCompatibility(),
    };
  }
  return null;
};

const findProfileRouteRegistrationFacts = (input: {
  profileId: string;
  ownerUserId: string;
  state: RuntimeTransportMutableState;
}): {
  executionCompatibility: DaemonExecutionCompatibility;
  localWakeRouteReport?: LocalWakeRouteReport;
  rejectedProfileRegistration?: RuntimeTransportRejectedProfileRegistration;
} | null => {
  const sessions = [...input.state.sessionsById.values()]
    .filter((session) => session.ownerUserId === input.ownerUserId)
    .sort((left, right) => right.lastHeartbeatMs - left.lastHeartbeatMs);

  for (const session of sessions) {
    const rejectedProfileRegistration =
      session.rejectedProfileRegistrationsByProfileId.get(input.profileId);
    const localWakeRouteReport = session.localWakeRouteReport;
    const reportMentionsProfile =
      Boolean(
        localWakeRouteReport?.includedProfileIds.includes(input.profileId)
      ) ||
      Boolean(
        localWakeRouteReport?.skippedProfiles.some(
          (profile) => profile.profileId === input.profileId
        )
      );

    if (!(rejectedProfileRegistration || reportMentionsProfile)) {
      continue;
    }

    return {
      executionCompatibility:
        session.executionCompatibility ??
        createMissingDaemonExecutionCompatibility(),
      ...(localWakeRouteReport ? { localWakeRouteReport } : {}),
      ...(rejectedProfileRegistration ? { rejectedProfileRegistration } : {}),
    };
  }

  return null;
};

const normalizeServiceVersion = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

export const detachSocket = (
  state: RuntimeTransportMutableState,
  webSocket: WebSocket,
  deps: Pick<
    SessionLifecycleDependencies,
    | "persistRuntimeRecords"
    | "failPendingDispatchResultWaitersForConnectionGeneration"
  >
): void => {
  const daemonSessionId = state.sessionIdBySocket.get(webSocket);
  state.sessionIdBySocket.delete(webSocket);
  if (!daemonSessionId) {
    return;
  }

  const session = state.sessionsById.get(daemonSessionId);
  if (!session || session.socket !== webSocket) {
    return;
  }

  session.socket = null;
  session.deliveryDisconnectedAtMs = Date.now();
  deps.failPendingDispatchResultWaitersForConnectionGeneration(
    daemonSessionId,
    session.connectionGeneration,
    {
      state: "failed",
      reasonCode: "daemon.profile.offline",
    }
  );
  deps.persistRuntimeRecords();
};

export const reapExpiredLeases = (
  state: RuntimeTransportMutableState,
  nowMs: number,
  deps: Pick<
    SessionLifecycleDependencies,
    | "persistRuntimeRecords"
    | "cleanupExpiredPendingDispatches"
    | "recordReapedReadinessProfiles"
  >
): ReapExpiredLeasesResult => {
  const expiredProfileIds: string[] = [];
  for (const [profileId, lease] of state.profileLeasesByProfileId.entries()) {
    if (nowMs - lease.lastHeartbeatMs > LEASE_TTL_MS) {
      expiredProfileIds.push(profileId);
    }
  }

  for (const profileId of expiredProfileIds) {
    const lease = state.profileLeasesByProfileId.get(profileId);
    if (!lease) {
      continue;
    }
    state.profileLeasesByProfileId.delete(profileId);
    const session = state.sessionsById.get(lease.daemonSessionId);
    session?.profileIds.delete(profileId);
  }

  const staleSessions: string[] = [];
  const removedSessionProfileIds: string[] = [];
  for (const [daemonSessionId, session] of state.sessionsById.entries()) {
    if (session.profileIds.size > 0) {
      continue;
    }
    if (session.socket) {
      continue;
    }
    if (nowMs - session.lastHeartbeatMs <= LEASE_TTL_MS) {
      continue;
    }
    staleSessions.push(daemonSessionId);
    removedSessionProfileIds.push(
      ...collectSessionReadinessProfileIds(session)
    );
  }

  for (const daemonSessionId of staleSessions) {
    state.sessionsById.delete(daemonSessionId);
  }

  deps.cleanupExpiredPendingDispatches(nowMs);

  if (expiredProfileIds.length > 0 || staleSessions.length > 0) {
    deps.persistRuntimeRecords();
  }

  const result = { expiredProfileIds, removedSessionProfileIds };
  if (
    result.expiredProfileIds.length > 0 ||
    result.removedSessionProfileIds.length > 0
  ) {
    deps.recordReapedReadinessProfiles?.(result);
  }
  return result;
};

const collectSessionReadinessProfileIds = (
  session: RuntimeTransportSessionState
): string[] => {
  const profileIds = new Set<string>(session.profileIds);
  for (const profileId of session.localWakeRouteReport?.includedProfileIds ??
    []) {
    profileIds.add(profileId);
  }
  for (const skippedProfile of session.localWakeRouteReport?.skippedProfiles ??
    []) {
    profileIds.add(skippedProfile.profileId);
  }
  for (const profileId of session.rejectedProfileRegistrationsByProfileId.keys()) {
    profileIds.add(profileId);
  }
  return [...profileIds];
};

export const resolveNextLeaseCleanupAtMs = (
  state: Pick<
    RuntimeTransportMutableState,
    "profileLeasesByProfileId" | "sessionsById"
  >
): number | null => {
  let nextCleanupAtMs: number | null = null;

  for (const lease of state.profileLeasesByProfileId.values()) {
    const expiresAtMs = lease.lastHeartbeatMs + LEASE_TTL_MS;
    nextCleanupAtMs =
      nextCleanupAtMs === null
        ? expiresAtMs
        : Math.min(nextCleanupAtMs, expiresAtMs);
  }

  for (const session of state.sessionsById.values()) {
    if (session.profileIds.size > 0 || session.socket) {
      continue;
    }

    const expiresAtMs = session.lastHeartbeatMs + LEASE_TTL_MS;
    nextCleanupAtMs =
      nextCleanupAtMs === null
        ? expiresAtMs
        : Math.min(nextCleanupAtMs, expiresAtMs);
  }

  return nextCleanupAtMs;
};
