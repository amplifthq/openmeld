import type {
  DaemonExecutionCompatibility,
  DaemonServiceLane,
  LocalWakeRouteReport,
  OpenMeldDaemonTaskResultEnvelope,
  RuntimeTransportCapabilities,
  RuntimeTransportDeliveryExecutionIdentity,
  RuntimeTransportDispatchLifecyclePhase,
  RuntimeTransportDispatchLifecycleSnapshot,
  RuntimeTransportErrorCode,
  RuntimeTransportRejectedProfileRegistration,
  RuntimeTransportSocketDisconnectRateBucket,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import type { SpaceAccessContext } from "@openmeld/space";

export type RuntimeTransportSessionState = {
  ownerUserId: string;
  daemonSessionId: string;
  deviceId: string;
  lane: DaemonServiceLane;
  serviceVersion?: string | null;
  connectionGeneration: number;
  connectedAtMs: number;
  lastHeartbeatMs: number;
  deliveryDisconnectedAtMs: number | null;
  acceptingDispatches?: boolean;
  stopCause?: RuntimeTransportStopCause;
  capabilities: RuntimeTransportCapabilities;
  executionCompatibility: DaemonExecutionCompatibility;
  profileIds: Set<string>;
  localWakeRouteReport: LocalWakeRouteReport | null;
  rejectedProfileRegistrationsByProfileId: Map<
    string,
    RuntimeTransportRejectedProfileRegistration
  >;
  socket: WebSocket | null;
};

export type RuntimeTransportProfileLeaseState = {
  profileId: string;
  daemonSessionId: string;
  deviceId: string;
  lane: DaemonServiceLane;
  serviceVersion?: string | null;
  leaseEpoch: number;
  lastHeartbeatMs: number;
  capabilities: RuntimeTransportCapabilities;
  executionCompatibility: DaemonExecutionCompatibility;
};

export type PendingDispatchState = {
  attemptId: string;
  acceptedLocalAtMs: number | null;
  completedLocalAtMs: number | null;
  dispatchId: string;
  daemonSessionId: string;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  executionTokenFingerprint?: string | null;
  executionTokenRunId?: string | null;
  connectionGeneration: number;
  lastLifecycleAtMs: number;
  leaseEpoch: number;
  phase:
    | "starting"
    | RuntimeTransportDispatchLifecyclePhase
    | "result_received";
  profileId: string;
  runningAtMs: number | null;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string | null;
  sourceSignalId: string;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
  taskId: string;
  targetProfileName: string | null;
  createdAtMs: number;
};

export type CompletedDispatchResultState = {
  attemptId: string;
  dispatchId: string;
  daemonSessionId: string;
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity;
  executionTokenFingerprint?: string | null;
  executionTokenRunId?: string | null;
  connectionGeneration: number;
  leaseEpoch: number;
  receivedAtMs: number;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string | null;
  submittedConnectionGeneration: number;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
  taskId: string;
  targetProfileId: string;
};

export type WaitDispatchResultRequest = {
  attemptId: string;
  dispatchId: string;
  daemonSessionId: string;
  connectionGeneration: number;
  leaseEpoch: number;
  timeoutMs?: number;
};

export type WaitDispatchResultResponse =
  | {
      state: "completed";
      lifecycle?: RuntimeTransportDispatchLifecycleSnapshot;
      taskResult: OpenMeldDaemonTaskResultEnvelope;
    }
  | {
      state: "pending";
      lifecycle: RuntimeTransportDispatchLifecycleSnapshot;
    }
  | {
      state: "failed";
      lifecycle?: RuntimeTransportDispatchLifecycleSnapshot;
      reasonCode: RuntimeTransportErrorCode;
    };

export type Waiter = {
  resolve: (value: WaitDispatchResultResponse) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

export type RuntimeTransportMutableState = {
  ownerUserId: string | null;
  sessionsById: Map<string, RuntimeTransportSessionState>;
  profileLeasesByProfileId: Map<string, RuntimeTransportProfileLeaseState>;
  pendingFirstReportStartedAtByProfileId: Map<string, number>;
  socketDisconnectRateBucketsByKey: Map<
    string,
    RuntimeTransportSocketDisconnectRateBucket
  >;
  sessionIdBySocket: Map<WebSocket, string | null>;
  pendingDispatches: Map<string, PendingDispatchState>;
  completedDispatchResults: Map<string, CompletedDispatchResultState>;
  pendingResultWaiters: Map<string, Set<Waiter>>;
};

export const buildDispatchAttemptKey = (
  dispatchId: string,
  attemptId: string
): string => {
  return `${dispatchId}::${attemptId}`;
};

export const createRuntimeTransportMutableState =
  (): RuntimeTransportMutableState => {
    return {
      ownerUserId: null,
      sessionsById: new Map<string, RuntimeTransportSessionState>(),
      profileLeasesByProfileId: new Map<
        string,
        RuntimeTransportProfileLeaseState
      >(),
      pendingFirstReportStartedAtByProfileId: new Map<string, number>(),
      socketDisconnectRateBucketsByKey: new Map<
        string,
        RuntimeTransportSocketDisconnectRateBucket
      >(),
      sessionIdBySocket: new Map<WebSocket, string | null>(),
      pendingDispatches: new Map<string, PendingDispatchState>(),
      completedDispatchResults: new Map<string, CompletedDispatchResultState>(),
      pendingResultWaiters: new Map<string, Set<Waiter>>(),
    };
  };
