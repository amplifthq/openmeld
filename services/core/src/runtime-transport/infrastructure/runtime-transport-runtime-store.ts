import type {
  DaemonExecutionCompatibility,
  DaemonServiceLane,
  LocalWakeRouteReport,
  RuntimeTransportCapabilities,
  RuntimeTransportRejectedProfileRegistration,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import type {
  RuntimeTransportMutableState,
  RuntimeTransportProfileLeaseState,
  RuntimeTransportSessionState,
} from "../application/runtime-transport-state";
import { readRuntimeTransportSocketAttachment } from "./runtime-transport-socket-attachment";

// ServiceRuntime records are the durable self-attestation facts for this
// account's devices (see docs/architecture/facts.md). One record per device,
// written on every register/heartbeat, restored on every cold start. They are
// what keeps Wake routes alive across Durable Object hibernation, restarts,
// and deploys — the in-memory session map is just a projection of them plus
// live sockets.
const SERVICE_RUNTIME_RECORD_PREFIX = "serviceruntime.v1.";
const LEGACY_SNAPSHOT_STORAGE_KEY = "daemonhub.snapshot.v1";

// Records older than this are dead devices; prune lazily on restore so the
// per-account record set stays bounded without a dedicated sweeper.
const SERVICE_RUNTIME_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;
const PLATFORM_REFERENCE_PATTERN = /reference\s*[:=]\s*([a-z0-9_-]{8,80})/iu;

function describeRuntimeStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const flags = typeof error === "object" && error !== null ? error : {};
  return {
    error: message.slice(0, 1024),
    platformReference: PLATFORM_REFERENCE_PATTERN.exec(message)?.[1] ?? null,
    retryable:
      "retryable" in flags && typeof flags.retryable === "boolean"
        ? flags.retryable
        : null,
    overloaded:
      "overloaded" in flags && typeof flags.overloaded === "boolean"
        ? flags.overloaded
        : null,
  };
}

type ServiceRuntimeLeaseEntryV1 = {
  profileId: string;
  leaseEpoch: number;
  lastHeartbeatMs: number;
};

type ServiceRuntimeRecordV1 = {
  v: 1;
  ownerUserId: string;
  daemonSessionId: string;
  deviceId: string;
  lane: DaemonServiceLane;
  serviceVersion: string | null;
  connectionGeneration: number;
  connectedAtMs: number;
  lastHeartbeatMs: number;
  deliveryDisconnectedAtMs: number | null;
  acceptingDispatches?: boolean;
  stopCause?: RuntimeTransportStopCause;
  capabilities: RuntimeTransportCapabilities;
  executionCompatibility: DaemonExecutionCompatibility;
  localWakeRouteReport: LocalWakeRouteReport | null;
  rejectedProfileRegistrations: RuntimeTransportRejectedProfileRegistration[];
  profileLeases: ServiceRuntimeLeaseEntryV1[];
};

const toServiceRuntimeRecordKey = (deviceId: string): string =>
  `${SERVICE_RUNTIME_RECORD_PREFIX}${deviceId}`;

const buildServiceRuntimeRecord = (
  state: RuntimeTransportMutableState,
  session: RuntimeTransportSessionState
): ServiceRuntimeRecordV1 => ({
  v: 1,
  ownerUserId: session.ownerUserId,
  daemonSessionId: session.daemonSessionId,
  deviceId: session.deviceId,
  lane: session.lane,
  serviceVersion: session.serviceVersion ?? null,
  connectionGeneration: session.connectionGeneration,
  connectedAtMs: session.connectedAtMs,
  lastHeartbeatMs: session.lastHeartbeatMs,
  deliveryDisconnectedAtMs: session.deliveryDisconnectedAtMs,
  ...(session.acceptingDispatches === false
    ? {
        acceptingDispatches: false,
        stopCause: session.stopCause ?? "unknown",
      }
    : {}),
  capabilities: session.capabilities,
  executionCompatibility: session.executionCompatibility,
  localWakeRouteReport: session.localWakeRouteReport,
  rejectedProfileRegistrations: Array.from(
    session.rejectedProfileRegistrationsByProfileId.values()
  ),
  // Leases stay slim on purpose: capabilities/compatibility are session-level
  // facts and are re-pointed at restore. Duplicating them per lease is what
  // made the retired socket-attachment snapshot blow past platform limits.
  profileLeases: Array.from(state.profileLeasesByProfileId.values())
    .filter((lease) => lease.daemonSessionId === session.daemonSessionId)
    .map((lease) => ({
      profileId: lease.profileId,
      leaseEpoch: lease.leaseEpoch,
      lastHeartbeatMs: lease.lastHeartbeatMs,
    })),
});

const persistServiceRuntimeRecord = async (
  ctx: DurableObjectState,
  state: RuntimeTransportMutableState,
  session: RuntimeTransportSessionState
): Promise<void> => {
  const record = buildServiceRuntimeRecord(state, session);
  await ctx.storage
    .put(toServiceRuntimeRecordKey(session.deviceId), record)
    .catch((error: unknown) => {
      console.error("[core.runtime_transport.runtime_record.persist_failed]", {
        deviceId: session.deviceId,
        daemonSessionId: session.daemonSessionId,
        ...describeRuntimeStorageError(error),
      });
      throw error;
    });
};

export const persistServiceRuntimeRecordsNow = async (
  ctx: DurableObjectState,
  state: RuntimeTransportMutableState
): Promise<void> => {
  await Promise.all(
    [...state.sessionsById.values()].map((session) =>
      persistServiceRuntimeRecord(ctx, state, session)
    )
  );
};

export const persistServiceRuntimeRecords = (
  ctx: DurableObjectState,
  state: RuntimeTransportMutableState
): void => {
  persistServiceRuntimeRecordsNow(ctx, state).catch((error: unknown) => {
    console.error(
      "[core.runtime_transport.runtime_record.persist_batch_failed]",
      {
        ...describeRuntimeStorageError(error),
      }
    );
  });
};

export const restoreServiceRuntimeRecords = async (
  ctx: DurableObjectState,
  state: RuntimeTransportMutableState
): Promise<{ needsPersist: boolean }> => {
  ctx.storage.delete(LEGACY_SNAPSHOT_STORAGE_KEY).catch(() => undefined);

  const entries = await ctx.storage
    .list<unknown>({ prefix: SERVICE_RUNTIME_RECORD_PREFIX })
    .catch((error: unknown) => {
      console.error("[core.runtime_transport.runtime_record.restore_failed]", {
        ...describeRuntimeStorageError(error),
      });
      throw error;
    });

  const nowMs = Date.now();
  let needsPersist = false;
  for (const [key, raw] of entries) {
    const record = parseServiceRuntimeRecord(raw);
    if (
      !record ||
      nowMs - record.lastHeartbeatMs > SERVICE_RUNTIME_RECORD_RETENTION_MS
    ) {
      ctx.storage.delete(key).catch(() => undefined);
      continue;
    }
    const restoredSession = restoreSessionFromRecord(state, record, nowMs);
    needsPersist =
      needsPersist || restoredSession.synthesizedDeliveryDisconnectedAtMs;
  }
  return { needsPersist };
};

// Re-attach hibernated sockets to restored sessions. Never close a socket
// just because state is missing: an unknown session self-heals through the
// client's next heartbeat/register over the same socket (facts.md: unknown
// declarations are reconciled, not rejected).
export const adoptHibernatedSockets = (
  ctx: DurableObjectState,
  state: RuntimeTransportMutableState,
  input: {
    closeSocket: (socket: WebSocket, code: number, reason: string) => void;
  }
): { needsPersist: boolean } => {
  let needsPersist = false;
  for (const webSocket of ctx.getWebSockets()) {
    const result = adoptHibernatedSocket(state, webSocket, input);
    needsPersist = needsPersist || result.needsPersist;
  }
  return { needsPersist };
};

const adoptHibernatedSocket = (
  state: RuntimeTransportMutableState,
  webSocket: WebSocket,
  input: {
    closeSocket: (socket: WebSocket, code: number, reason: string) => void;
  }
): { needsPersist: boolean } => {
  const attachment = readRuntimeTransportSocketAttachment(webSocket);
  const { daemonSessionId, connectionGeneration, verifiedOwnerUserId } =
    attachment;

  if (!verifiedOwnerUserId) {
    input.closeSocket(webSocket, 1008, "session_owner_unverified");
    return { needsPersist: false };
  }

  state.sessionIdBySocket.set(webSocket, daemonSessionId ?? null);
  if (state.ownerUserId !== verifiedOwnerUserId) {
    state.ownerUserId = verifiedOwnerUserId;
  }
  if (!daemonSessionId) {
    return { needsPersist: false };
  }

  const session = state.sessionsById.get(daemonSessionId);
  if (!session) {
    return { needsPersist: false };
  }

  if (
    connectionGeneration !== null &&
    connectionGeneration < session.connectionGeneration
  ) {
    input.closeSocket(webSocket, 1012, "session_replaced");
    state.sessionIdBySocket.delete(webSocket);
    return { needsPersist: false };
  }
  if (
    connectionGeneration !== null &&
    connectionGeneration > session.connectionGeneration
  ) {
    // The socket outlived the last persisted record; trust the socket.
    session.connectionGeneration = connectionGeneration;
  }

  if (session.socket && session.socket !== webSocket) {
    input.closeSocket(session.socket, 1012, "session_replaced");
    state.sessionIdBySocket.delete(session.socket);
  }
  session.socket = webSocket;
  const needsPersist = session.deliveryDisconnectedAtMs !== null;
  session.deliveryDisconnectedAtMs = null;
  session.ownerUserId = verifiedOwnerUserId;
  return { needsPersist };
};

const restoreSessionFromRecord = (
  state: RuntimeTransportMutableState,
  record: ServiceRuntimeRecordV1,
  restoredAtMs: number
): { synthesizedDeliveryDisconnectedAtMs: boolean } => {
  const synthesizedDeliveryDisconnectedAtMs =
    record.deliveryDisconnectedAtMs === null;
  const session: RuntimeTransportSessionState = {
    ownerUserId: record.ownerUserId,
    daemonSessionId: record.daemonSessionId,
    deviceId: record.deviceId,
    lane: record.lane,
    serviceVersion: record.serviceVersion,
    connectionGeneration: record.connectionGeneration,
    connectedAtMs: record.connectedAtMs,
    lastHeartbeatMs: record.lastHeartbeatMs,
    deliveryDisconnectedAtMs: record.deliveryDisconnectedAtMs ?? restoredAtMs,
    acceptingDispatches: record.acceptingDispatches !== false,
    stopCause:
      record.acceptingDispatches === false
        ? (record.stopCause ?? "unknown")
        : undefined,
    capabilities: record.capabilities,
    executionCompatibility: record.executionCompatibility,
    profileIds: new Set(record.profileLeases.map((lease) => lease.profileId)),
    localWakeRouteReport: record.localWakeRouteReport,
    rejectedProfileRegistrationsByProfileId: new Map(
      record.rejectedProfileRegistrations.map((registration) => [
        registration.profileId,
        registration,
      ])
    ),
    socket: null,
  };
  state.sessionsById.set(record.daemonSessionId, session);
  if (state.ownerUserId === null) {
    state.ownerUserId = record.ownerUserId;
  }

  for (const lease of record.profileLeases) {
    const existing = state.profileLeasesByProfileId.get(lease.profileId);
    if (existing && existing.lastHeartbeatMs >= lease.lastHeartbeatMs) {
      continue;
    }
    const leaseState: RuntimeTransportProfileLeaseState = {
      profileId: lease.profileId,
      daemonSessionId: record.daemonSessionId,
      deviceId: record.deviceId,
      lane: record.lane,
      serviceVersion: record.serviceVersion,
      leaseEpoch: lease.leaseEpoch,
      lastHeartbeatMs: lease.lastHeartbeatMs,
      capabilities: record.capabilities,
      executionCompatibility: record.executionCompatibility,
    };
    state.profileLeasesByProfileId.set(lease.profileId, leaseState);
  }
  return { synthesizedDeliveryDisconnectedAtMs };
};

// Records are produced solely by buildServiceRuntimeRecord, so validation is
// structural, not schema-strict: a record that fails these basics is treated
// as dead and pruned rather than allowed to wedge restore.
const parseServiceRuntimeRecord = (
  raw: unknown
): ServiceRuntimeRecordV1 | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const data = raw as Record<string, unknown>;
  if (data.v !== 1) {
    return null;
  }
  if (
    !(
      isNonEmptyString(data.ownerUserId) &&
      isNonEmptyString(data.daemonSessionId) &&
      isNonEmptyString(data.deviceId) &&
      isNonEmptyString(data.lane)
    )
  ) {
    return null;
  }
  if (
    !(
      isFiniteNumber(data.connectionGeneration) &&
      isFiniteNumber(data.connectedAtMs) &&
      isFiniteNumber(data.lastHeartbeatMs)
    )
  ) {
    return null;
  }
  if (!(data.capabilities && typeof data.capabilities === "object")) {
    return null;
  }
  if (
    !(
      data.executionCompatibility &&
      typeof data.executionCompatibility === "object"
    )
  ) {
    return null;
  }
  const profileLeases = Array.isArray(data.profileLeases)
    ? data.profileLeases.filter(isServiceRuntimeLeaseEntry)
    : [];
  const rejectedProfileRegistrations = Array.isArray(
    data.rejectedProfileRegistrations
  )
    ? (data.rejectedProfileRegistrations.filter(
        (entry) =>
          !!entry &&
          typeof entry === "object" &&
          isNonEmptyString((entry as { profileId?: unknown }).profileId)
      ) as RuntimeTransportRejectedProfileRegistration[])
    : [];

  return {
    v: 1,
    ownerUserId: data.ownerUserId,
    daemonSessionId: data.daemonSessionId,
    deviceId: data.deviceId,
    lane: data.lane as DaemonServiceLane,
    serviceVersion: isNonEmptyString(data.serviceVersion)
      ? data.serviceVersion
      : null,
    connectionGeneration: data.connectionGeneration,
    connectedAtMs: data.connectedAtMs,
    lastHeartbeatMs: data.lastHeartbeatMs,
    deliveryDisconnectedAtMs: isFiniteNumber(data.deliveryDisconnectedAtMs)
      ? data.deliveryDisconnectedAtMs
      : null,
    capabilities: data.capabilities as RuntimeTransportCapabilities,
    executionCompatibility:
      data.executionCompatibility as DaemonExecutionCompatibility,
    localWakeRouteReport:
      data.localWakeRouteReport && typeof data.localWakeRouteReport === "object"
        ? (data.localWakeRouteReport as LocalWakeRouteReport)
        : null,
    rejectedProfileRegistrations,
    profileLeases,
  };
};

const isServiceRuntimeLeaseEntry = (
  entry: unknown
): entry is ServiceRuntimeLeaseEntryV1 => {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const data = entry as Record<string, unknown>;
  return (
    isNonEmptyString(data.profileId) &&
    isFiniteNumber(data.leaseEpoch) &&
    isFiniteNumber(data.lastHeartbeatMs)
  );
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
