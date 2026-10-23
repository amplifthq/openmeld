import { resolveCatalogSyncSkippedProfilesLogState } from "@openmeld/local-service/catalog-sync-skipped-profiles";
import {
  ADAPTIVE_HEARTBEAT_JITTER_RATIO,
  applyAcceptedLeases,
  applyIntervalJitterMs,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  pruneStaleLeases,
  resolveAdaptiveHeartbeatIntervalMs,
  resolveCatalogSyncIntervalMs,
} from "@openmeld/local-service/heartbeat-policy";
import { resolveRouteRegistrationReconcileDecision } from "@openmeld/local-service/service-reconcile-decision";
import {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import type { ServiceExecutionHostOutput } from "@openmeld/schemas";
import {
  computerFileAccessDaemonFrameSchema,
  localFolderPickerDaemonFrameSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportHeartbeatRequestSchema,
  runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema,
  runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema,
  runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema,
  runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema,
  runtimeTransportOpenMeldToolsControlFramePayloadSchema,
  runtimeTransportOpenMeldToolsControlResultFramePayloadSchema,
  runtimeTransportRegisterSessionRequestSchema,
  runtimeTransportRouteCatalogChangedFramePayloadSchema,
} from "@openmeld/schemas";
import type {
  LocalComponentsStatus,
  OpenMeldDaemonSetProfileWorkspacePayload,
  OpenMeldDaemonSyncRouteCatalogPayload,
  RuntimeTransportAdmissionEvidence,
  RuntimeTransportLease,
  RuntimeTransportRegisterSessionResponse,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import {
  ensureOpenMeldManagedProfileWorkspace,
  setCustomProfileWorkspace,
} from "../../profile-workspace/service";
import type { Presenter } from "../../runtime/presenter/types";
import { OPENMELD_VERSION } from "../../runtime/version";
import type { WsClient } from "../../transport/ws";
import { resolveDaemonCapabilitiesFromAdapterIds } from "../adapters/resolve-daemon-capabilities";
import {
  CATALOG_SYNC_RETRY_INTERVAL_MS,
  CATALOG_SYNC_SIGNAL_POLL_INTERVAL_MS,
  CONTROLLED_SHUTDOWN_SOCKET_CLOSE_TIMEOUT_MS,
  DAEMON_RUNTIME_CONTRACT_EPOCH,
  HEARTBEAT_CONSECUTIVE_FAILURES_BEFORE_CLOSE,
  HEARTBEAT_RESPONSE_TIMEOUT_MS,
  PROVIDER_CONVERSATION_PROOF_SYNC_INTERVAL_MS,
  PROVIDER_CONVERSATION_PROOF_SYNC_RETRY_INTERVAL_MS,
  REGISTER_RESPONSE_TIMEOUT_MS,
  RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_INTERVAL_MS,
  RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_RETRY_INTERVAL_MS,
} from "../core/constants";
import {
  emitRunLine,
  normalizeHeartbeatIntervalMs,
  normalizeText,
  nowIsoString,
  toErrorMessage,
  warnDaemonEvent,
} from "../core/logger";
import type {
  MutableRouteCatalogState,
  ParsedDaemonFrame,
  PendingFrameWaiters,
  RouteCatalog,
  RouteCatalogSyncResult,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import { emitReconcileCompletedEvidence } from "../diagnostics/service-evidence-trace";
import { emitDaemonDispatchJournalEvent } from "../dispatch/daemon-dispatch-journal";
import type { ExecutionHostPort } from "../execution-host/port";
import { createExecutionHostSocketLink } from "../execution-host/socket-link";
import { handleComputerFileAccessFrame } from "../file-access/computer-file-access-handler";
import {
  handleLocalFolderPickerFrame,
  type SelectLocalFolders,
} from "../folder-picker/local-folder-picker-handler";
import { resolveNextRuntimeAgentControllerReportSyncAtMs } from "../inventory/agent-controller-interface-keeper";
import { handleOpenMeldToolsControlRequest } from "../maintenance/openmeld-tools-control-handler";
import type { OpenMeldToolsUpdateCoordinator } from "../maintenance/openmeld-tools-update-coordinator";
import { didLocalProjectConnectionsChange } from "../projects/local-project-activity-sync";
import { handleLocalProjectControlFrame } from "../projects/local-project-control-handler";
import {
  createLocalWakeRouteReport,
  hasCompleteProfileConfigurationRevisions,
} from "../reporting/local-wake-route-report";
import { manageLocalProfileFolders } from "./manage-profile-folders";
import { readLocalAgentProfileWorkspace } from "./read-profile-workspace";

type LocalServiceRuntimeAgentControllerReportSyncResult =
  ServiceExecutionHostOutput<"reportControllers">;

import type { RuntimeReportingAuthenticationFailure } from "../reporting/runtime-reporting-auth-recovery";
import {
  createRouteCatalogFromMutableState,
  summarizeSkippedDaemonProfiles,
  syncDaemonRouteCatalogState,
} from "../routing/route-catalog-state";
import {
  type DaemonCatalogSyncSignal,
  readDaemonCatalogSyncSignal,
} from "../state/catalog-sync-signal";
import {
  handleDaemonTransportFrame,
  parseDaemonFrame,
  sendDaemonFrame,
} from "./daemon-frame-transport";
import { createDaemonStreamKeepalive } from "./daemon-stream-keepalive";
import { waitForHeartbeatResponse } from "./heartbeat-loop";
import { waitForRegisterResponse } from "./register-session";
import type { ServiceLocalComponentsObservation } from "./service-local-components-observation";

function buildShutdownHeartbeatFacts(input: {
  acceptingDispatches: boolean;
  stopCause: RuntimeTransportStopCause | null;
}): {
  acceptingDispatches?: false;
  stopCause?: RuntimeTransportStopCause;
} {
  if (input.acceptingDispatches) {
    return {};
  }
  return {
    acceptingDispatches: false,
    ...(input.stopCause ? { stopCause: input.stopCause } : {}),
  };
}

function resolveHeartbeatIdleWaiters(waiters: Array<() => void>): void {
  while (waiters.length > 0) {
    waiters.shift()?.();
  }
}

function resolveCatalogSyncSignalMarker(
  signal: DaemonCatalogSyncSignal | null
): string | null {
  if (!signal) {
    return null;
  }
  return signal.signalId ?? signal.updatedAt;
}

type CatalogSyncForceReason =
  | "local_state_changed"
  | "register_conflict"
  | "stale_leases";

type CatalogSyncInput = {
  forceReason?: CatalogSyncForceReason;
};

type RouteCatalogSyncInvoker = (
  reason: string
) => Promise<RouteCatalogSyncResult>;

type PendingRouteCatalogSyncRequest = {
  reason: string;
  reject: (error: Error) => void;
  resolve: (result: RouteCatalogSyncResult) => void;
};

const HEARTBEAT_RUNTIME_STATE_WRITE_TIMEOUT_MS = HEARTBEAT_RESPONSE_TIMEOUT_MS;
type DaemonSocketDisconnectClass =
  | "abnormal_socket_close"
  | "normal_shutdown"
  | "possible_deploy_or_edge_restart";

// Post-register bootstrap policy for one socket session. With a resolved
// catalog the session persists the accepted catalog to the recovery cache and
// waits a normal sync interval. With an unresolved boot placeholder it must
// never persist (an empty write clears the recovery cache) and resolves the
// real catalog immediately instead of waiting a full interval.
export function resolveBootstrapCatalogSyncPlan(input: {
  isRouteCatalogResolved: boolean;
  syncIntervalMs: number;
}): {
  nextSyncDelayMs: number;
  persistCache: boolean;
} {
  if (input.isRouteCatalogResolved) {
    return {
      nextSyncDelayMs: input.syncIntervalMs,
      persistCache: true,
    };
  }
  return {
    nextSyncDelayMs: 0,
    persistCache: false,
  };
}

function projectRouteCatalogSyncPayload(input: {
  knownProfileIds: readonly string[];
  result: RouteCatalogSyncResult;
}): OpenMeldDaemonSyncRouteCatalogPayload {
  const { result } = input;
  if (result.status === "failed") {
    return {
      accepted: false,
      errorMessage: result.errorMessage,
      profileIds: [...input.knownProfileIds],
      syncStatus: "failed",
    };
  }
  if (result.status === "changed") {
    return {
      accepted: true,
      addedProfileIds: result.diff.addedProfileIds,
      keptProfileIds: result.diff.keptProfileIds,
      profileIds: result.registerResponse.acceptedLeases.map(
        (lease) => lease.profileId
      ),
      removedProfileIds: result.diff.removedProfileIds,
      skippedProfiles: result.skippedProfiles,
      syncStatus: "changed",
    };
  }
  if (result.status === "registered") {
    return {
      accepted: true,
      profileIds: result.registerResponse.acceptedLeases.map(
        (lease) => lease.profileId
      ),
      skippedProfiles: result.skippedProfiles,
      syncStatus: "registered",
    };
  }
  return {
    accepted: true,
    profileIds: [...input.knownProfileIds],
    skippedProfiles: result.skippedProfiles,
    syncStatus: "unchanged",
  };
}

function classifyDaemonSocketDisconnect(input: {
  closeCode: number;
  closeReason: string;
}): DaemonSocketDisconnectClass {
  if (input.closeCode === 1000 || input.closeCode === 1001) {
    return "normal_shutdown";
  }
  if (input.closeCode === 1006) {
    return "possible_deploy_or_edge_restart";
  }
  return "abnormal_socket_close";
}

function handleSessionHistorySocketFrame(input: {
  computerFileAccessStorePath: string;
  ownerUserId: string;
  deviceId: string;
  presenter: Presenter;
  frame: ParsedDaemonFrame;
  socket: WsClient;
}): boolean {
  if (input.frame.code !== "daemon.session_history.request") {
    return false;
  }
  const parsed = sessionHistoryRequestFrameSchema.safeParse(input.frame);
  if (!parsed.success) {
    return true;
  }
  handleSessionHistoryFrame({ ...input, frame: parsed.data })
    .then((frame) => input.socket.send(JSON.stringify(frame)))
    .catch(() => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.session_history_failed",
        text: "Session history request failed. No transcript content was logged.",
      });
    });
  return true;
}

function handleComputerFileAccessSocketFrame(input: {
  computerFileAccessStorePath: string;
  deviceId: string;
  frame: ParsedDaemonFrame;
  presenter: Presenter;
  socket: WsClient;
}): boolean {
  if (!input.frame.code.startsWith("daemon.computer_file_access.")) {
    return false;
  }
  const parsed = computerFileAccessDaemonFrameSchema.safeParse(input.frame);
  if (
    !parsed.success ||
    (parsed.data.code !== "daemon.computer_file_access.read_policy" &&
      parsed.data.code !== "daemon.computer_file_access.update_policy")
  ) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.computer_file_access_failed",
      text: "Computer file access request was invalid.",
    });
    return true;
  }
  handleComputerFileAccessFrame({
    deviceId: input.deviceId,
    frame: parsed.data,
    storePath: input.computerFileAccessStorePath,
  })
    .then((resultFrame) => input.socket.send(JSON.stringify(resultFrame)))
    .catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.computer_file_access_failed",
        text: `Computer file access failed: ${toErrorMessage(error)}`,
      });
    });
  return true;
}

function handleLocalProjectControlSocketFrame(input: {
  deviceId: string;
  frame: ParsedDaemonFrame;
  ownerUserId: string;
  onLocalProjectConnectionsChanged?: () => void;
  presenter: Presenter;
  socket: WsClient;
}): boolean {
  if (!input.frame.code.startsWith("daemon.local_project_control.")) {
    return false;
  }
  handleLocalProjectControlFrame({
    deviceId: input.deviceId,
    frame: input.frame,
    ownerUserId: input.ownerUserId,
  })
    .then((resultFrame) => {
      input.socket.send(JSON.stringify(resultFrame));
      if (!didLocalProjectConnectionsChange(resultFrame)) {
        return;
      }
      try {
        input.onLocalProjectConnectionsChanged?.();
      } catch (error) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_activity_connection_signal_failed",
          text: `Agent Activity connection signal failed: ${toErrorMessage(error)}`,
        });
      }
    })
    .catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_project_control_failed",
        text: `local Project control failed: ${toErrorMessage(error)}`,
      });
    });
  return true;
}

function handleLocalFolderPickerSocketFrame(input: {
  deviceId: string;
  frame: ParsedDaemonFrame;
  presenter: Presenter;
  selectLocalFolders?: SelectLocalFolders;
  socket: WsClient;
}): boolean {
  if (!input.frame.code.startsWith("daemon.local_folder_picker.")) {
    return false;
  }
  const parsed = localFolderPickerDaemonFrameSchema.safeParse(input.frame);
  if (
    !parsed.success ||
    parsed.data.code !== "daemon.local_folder_picker.select_folders"
  ) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.local_folder_picker_failed",
      text: "Local Folder Picker request was invalid.",
    });
    return true;
  }
  const selectLocalFolders: SelectLocalFolders =
    input.selectLocalFolders ??
    (async () => ({
      code: "local.folder_picker.helper_missing",
      message:
        "Update or repair OpenMeld Service to choose folders on this computer.",
      status: "unavailable",
    }));
  handleLocalFolderPickerFrame({
    deviceId: input.deviceId,
    frame: parsed.data,
    selectFolders: selectLocalFolders,
  })
    .then((resultFrame) => input.socket.send(JSON.stringify(resultFrame)))
    .catch(() => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_folder_picker_failed",
        text: "Local Folder Picker failed.",
      });
    });
  return true;
}

export async function runDaemonSocketSession(input: {
  executionHost: ExecutionHostPort;
  drainExecutionHost: () => Promise<void>;
  failHostShutdown: (error: unknown) => never;
  computerFileAccessStorePath: string;
  daemonSessionId: string;
  deviceId: string;
  serviceContractGeneration?: number;
  foregroundActive: boolean;
  heartbeatIntervalMs: number;
  // Boot-time placeholder support: while the route catalog is unresolved the
  // session registers the placeholder (lease-neutral on a fresh session),
  // skips cache persistence, and schedules an immediate catalog sync instead
  // of waiting a full interval.
  isRouteCatalogResolved?: () => boolean;
  loadRouteCatalog: () => Promise<RouteCatalog>;
  localComponentsObservation: ServiceLocalComponentsObservation;
  lane: string;
  ownerUserId: string;
  onRuntimeReportingAuthenticationFailure?: (
    failure: RuntimeReportingAuthenticationFailure
  ) => Promise<void> | void;
  onAgentActivitySessionsChanged?: () => void;
  onLocalProjectConnectionsChanged?: () => void;
  openMeldToolsUpdateCoordinator?: OpenMeldToolsUpdateCoordinator;
  presenter: Presenter;
  persistRouteCatalogCache?: (catalog: RouteCatalog) => Promise<void>;
  reconnectAttempt: number;
  connectionGeneration?: number;
  routeCatalogState: MutableRouteCatalogState;
  selectLocalFolders?: SelectLocalFolders;
  shutdownRequested?: Promise<RuntimeTransportStopCause>;
  socket: WsClient;
  attachRouteCatalogSyncInvoker?: (
    invoker: RouteCatalogSyncInvoker | null
  ) => void;
  touchRuntimeState: (
    state: Partial<{
      heartbeatAt: string | null;
      updatedAt: string;
      stopRequestedAt: string | null;
    }>
  ) => Promise<void>;
}): Promise<void> {
  // OPENMELD_SERVICE_THIN_CORE: socket-session carrier.
  // The session registers this local runtime, sends heartbeat/capability
  // evidence, receives RuntimeCoordinator-backed deliveries, and reports local
  // execution evidence. Readiness and final outcome remain upstream-owned.
  const leasesByProfileId = new Map<string, number>();
  const waiters: PendingFrameWaiters = {
    heartbeatResolver: null,
    heartbeatRejecter: null,
    registerResolver: null,
    registerRejecter: null,
  };

  let closed = false;
  let closeCode = 1000;
  let closeReason = "closed";
  const socketConnectedAtMs = Date.now();
  let heartbeatInFlight = false;
  // Admission may change again before the current heartbeat is acknowledged.
  // Retain only the need to republish; the next send reads the current state.
  let admissionHeartbeatPending = false;
  const heartbeatIdleWaiters: Array<() => void> = [];
  // A replacement session must replay every durable result that survived the
  // previous process before it can accept new work. The existing heartbeat
  // admission bit doubles as that startup fence without adding a second source
  // of session readiness.
  let acceptingDispatches = false;
  let shutdownAdmissionEvidence: RuntimeTransportAdmissionEvidence | null =
    null;
  let shutdownStopCause: RuntimeTransportStopCause | null = null;
  let controlledShutdownCompleted = false;
  let routeCatalogSyncInFlight = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatTimerDueAtMs: number | null = null;
  const transportEnded = Promise.withResolvers<DaemonServiceRunError>();
  const keepalive = createDaemonStreamKeepalive({
    onPongTimeout: () => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.keepalive_pong_timeout",
        text: "daemon stream keepalive PONG missing; terminating half-open socket for reconnect",
        payload: {
          connectionGeneration: activeConnectionGeneration,
          daemonSessionId: input.daemonSessionId,
        },
      });
      terminateForReconnect("keepalive_pong_timeout");
    },
    sendPing: () => {
      if (closed) {
        return false;
      }
      input.socket.send(DAEMON_STREAM_KEEPALIVE_PING);
      return true;
    },
  });
  let lastDispatchActivityAtMs: number | null = null;
  let lastHeartbeatSentAtMs: number | null = null;
  let consecutiveHeartbeatFailures = 0;
  let catalogSyncSignalTimer: NodeJS.Timeout | null = null;
  let runtimeAgentControllerReportSyncTimer: NodeJS.Timeout | null = null;
  let currentHeartbeatIntervalMs = normalizeHeartbeatIntervalMs(
    input.heartbeatIntervalMs
  );
  let activeConnectionGeneration = input.connectionGeneration ?? 1;
  let nextCatalogSyncAtMs = 0;
  let nextProviderConversationProofSyncAtMs = 0;
  let nextRuntimeAgentControllerReportSyncAtMs = 0;
  let forceFreshAgentControllerProbes = false;
  let providerConversationProofSyncInFlight = false;
  let runtimeAgentControllerReportSyncPromise: Promise<LocalServiceRuntimeAgentControllerReportSyncResult> | null =
    null;
  let pendingFreshAgentControllerReportSyncPromise: Promise<LocalServiceRuntimeAgentControllerReportSyncResult> | null =
    null;
  let latestCatalogSyncStatus:
    | RouteCatalogSyncResult["status"]
    | "skipped"
    | null = null;
  let latestSkippedProfilesFingerprint: string | null = null;
  let latestCatalogSyncSignalMarker: string | null = null;
  let forceCatalogSyncReason: CatalogSyncForceReason | null = null;
  let pendingLocalExecutionEvidenceRefreshReason: CatalogSyncForceReason | null =
    null;
  const pendingRouteCatalogSyncRequests: PendingRouteCatalogSyncRequest[] = [];
  const reportHostFailure = (error: unknown) => {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.execution_host_unavailable",
      text: `Execution host unavailable: ${toErrorMessage(error)}`,
    });
  };
  const hostLink = createExecutionHostSocketLink({
    host: input.executionHost,
    socket: input.socket,
    onAdmissionChanged: () => {
      acceptingDispatches = !shutdownStopCause && hostLink.canAccept();
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.admission_changed",
        text: `Local dispatch admission is ${acceptingDispatches ? "open" : "closed"}.`,
        payload: shutdownAdmissionEvidence ?? hostLink.admissionEvidence(),
      });
      if (heartbeatInFlight || lastHeartbeatSentAtMs !== null) {
        scheduleHeartbeat({
          delayMs: 0,
          reason: "execution_host_admission_changed",
        });
      }
    },
    onInvalidation: (scope) => {
      if (scope === "routes") {
        requestLocalExecutionEvidenceRefresh({
          reason: "local_state_changed",
          scheduleReason: "host_routes_changed",
        });
      }
      if (scope === "activity") {
        input.onAgentActivitySessionsChanged?.();
      }
    },
    onAuthenticationFailure: (failure) => {
      Promise.resolve(
        input.onRuntimeReportingAuthenticationFailure?.(failure)
      ).catch(reportHostFailure);
    },
    onError: reportHostFailure,
  });
  const configureHostConnection = async () => {
    if (!executionAdmissionSupported) {
      reportHostFailure(
        new Error(
          "The server does not support execution admission confirmation. New tasks remain unavailable."
        )
      );
      return;
    }
    await hostLink.configure({
      executionAdmissionConfirmation: executionAdmissionSupported,
      connectionGeneration: activeConnectionGeneration,
      catalogRevision:
        input.routeCatalogState.executionHostCatalogRevision ?? 0,
      leases: [...leasesByProfileId].map(([profileId, leaseEpoch]) => ({
        profileId,
        leaseEpoch,
      })),
    });
  };

  function retireTransport(error: DaemonServiceRunError): void {
    if (closed) {
      return;
    }
    closed = true;
    admissionHeartbeatPending = false;
    clearHeartbeatTimer();
    clearRuntimeAgentControllerReportSyncTimer();
    keepalive.stop();
    clearCatalogSyncSignalTimer();
    hostLink.detach().catch(reportHostFailure);
    input.attachRouteCatalogSyncInvoker?.(null);
    waiters.registerRejecter?.(error);
    waiters.heartbeatRejecter?.(error);
    failPendingRouteCatalogSyncRequests(error);
    transportEnded.resolve(error);
  }

  function terminateForReconnect(
    reasonCode: "keepalive_pong_timeout" | "heartbeat_failed" | "socket_error"
  ): void {
    if (closed) {
      return;
    }
    const error = new DaemonServiceRunError({
      code: "daemon.run.socket_closed",
      message: `daemon stream unavailable (${reasonCode})`,
    });
    // The connector owns failure detection. Transport termination must not
    // depend on a later native close callback to release the reconnect loop.
    retireTransport(error);
    warnDaemonEvent("[openmeld.daemon.reconnect_required]", {
      event: "cli.daemon.reconnect_required",
      reasonCode,
      connectionGeneration: activeConnectionGeneration,
      daemonSessionId: input.daemonSessionId,
    });
    input.socket.terminate();
  }

  const waitForClose = new Promise<void>((resolve) => {
    input.socket.onClose((code, reason) => {
      closeCode = code;
      closeReason = normalizeText(reason) || "closed";
      retireTransport(
        new DaemonServiceRunError({
          code: "daemon.run.socket_closed",
          message: `daemon stream closed (code=${String(closeCode)}, reason=${closeReason})`,
        })
      );
      const closedAtMs = Date.now();
      const durationMs = Math.max(0, closedAtMs - socketConnectedAtMs);
      const disconnectClass = classifyDaemonSocketDisconnect({
        closeCode,
        closeReason,
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.socket_closed",
        text: `daemon stream socket closed (code=${String(closeCode)}, reason=${closeReason})`,
        payload: {
          abnormalClosure: closeCode !== 1000 && closeCode !== 1001,
          closeCode,
          closeReason,
          connectionGeneration: activeConnectionGeneration,
          daemonSessionId: input.daemonSessionId,
          deployAdjacentReason:
            disconnectClass === "possible_deploy_or_edge_restart"
              ? "websocket_1006_abnormal_close"
              : null,
          disconnectClass,
          durationMs,
          inflightDispatchCount:
            input.executionHost.snapshot()?.activeCount ?? 0,
          socketConnectedAtMs,
          socketDisconnectedAtMs: closedAtMs,
        },
      });
      resolve();
    });
  });

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.socket_connected",
    text: `daemon stream connected (reconnectAttempt=${String(input.reconnectAttempt)})`,
    payload: {
      connectedAtMs: socketConnectedAtMs,
      daemonSessionId: input.daemonSessionId,
      reconnectAttempt: input.reconnectAttempt,
    },
  });

  const clearRuntimeAgentControllerReportSyncTimer = (): void => {
    if (!runtimeAgentControllerReportSyncTimer) {
      return;
    }
    clearTimeout(runtimeAgentControllerReportSyncTimer);
    runtimeAgentControllerReportSyncTimer = null;
  };

  const clearHeartbeatTimer = (): void => {
    if (!heartbeatTimer) {
      return;
    }
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatTimerDueAtMs = null;
  };

  const resolvePendingRouteCatalogSyncRequests = (
    result: RouteCatalogSyncResult
  ): void => {
    const pending = pendingRouteCatalogSyncRequests.splice(
      0,
      pendingRouteCatalogSyncRequests.length
    );
    for (const request of pending) {
      request.resolve(result);
    }
  };

  const failPendingRouteCatalogSyncRequests = (error: Error): void => {
    const pending = pendingRouteCatalogSyncRequests.splice(
      0,
      pendingRouteCatalogSyncRequests.length
    );
    for (const request of pending) {
      request.reject(error);
    }
  };

  const requestLocalExecutionEvidenceRefresh = (inputRequest: {
    reason: CatalogSyncForceReason;
    scheduleReason: string;
  }): void => {
    forceCatalogSyncReason = inputRequest.reason;
    nextCatalogSyncAtMs = 0;
    nextProviderConversationProofSyncAtMs = 0;
    nextRuntimeAgentControllerReportSyncAtMs = 0;
    // Local state changed or the user asked for a check: the next controller
    // report sync must probe for real instead of reusing background snapshots.
    forceFreshAgentControllerProbes = true;
    if (routeCatalogSyncInFlight) {
      pendingLocalExecutionEvidenceRefreshReason = inputRequest.reason;
    }
    // A catalog change is independent of renewing the old leases. Waiting for
    // a heartbeat (including its local maintenance checks) strands new routes
    // while Core is already waiting to admit their first Wake.
    startRouteCatalogSyncIfDue();
    scheduleHeartbeat({
      delayMs: 0,
      reason: inputRequest.scheduleReason,
    });
  };

  const requestRouteCatalogSync: RouteCatalogSyncInvoker = async (reason) => {
    if (closed) {
      throw new DaemonServiceRunError({
        code: "daemon.run.socket_closed",
        message: "daemon stream is not connected",
      });
    }
    return await new Promise<RouteCatalogSyncResult>((resolve, reject) => {
      pendingRouteCatalogSyncRequests.push({
        reason: normalizeText(reason) || "local_state_changed",
        reject,
        resolve,
      });
      requestLocalExecutionEvidenceRefresh({
        reason: "local_state_changed",
        scheduleReason: "catalog_sync_signal",
      });
    });
  };
  input.attachRouteCatalogSyncInvoker?.(requestRouteCatalogSync);

  function schedulePendingLocalExecutionEvidenceRefreshIfNeeded(): void {
    const pendingRefreshReason = pendingLocalExecutionEvidenceRefreshReason;
    if (closed || routeCatalogSyncInFlight || !pendingRefreshReason) {
      return;
    }

    pendingLocalExecutionEvidenceRefreshReason = null;
    forceCatalogSyncReason = pendingRefreshReason;
    nextCatalogSyncAtMs = 0;
    nextProviderConversationProofSyncAtMs = 0;
    nextRuntimeAgentControllerReportSyncAtMs = 0;
    forceFreshAgentControllerProbes = true;
    startRouteCatalogSyncIfDue();
    scheduleHeartbeat({
      delayMs: 0,
      reason: "pending_local_execution_evidence_refresh",
    });
  }

  function recordHeartbeatFailure(error: unknown): boolean {
    consecutiveHeartbeatFailures += 1;
    const shouldCloseSocket =
      consecutiveHeartbeatFailures >=
      HEARTBEAT_CONSECUTIVE_FAILURES_BEFORE_CLOSE;
    const errorMessage = toErrorMessage(error);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.heartbeat_failed",
      text: `heartbeat failed (${String(consecutiveHeartbeatFailures)}/${String(HEARTBEAT_CONSECUTIVE_FAILURES_BEFORE_CLOSE)}): ${errorMessage}`,
      payload: {
        closeSocket: shouldCloseSocket,
        connectionGeneration: activeConnectionGeneration,
        daemonSessionId: input.daemonSessionId,
        error: errorMessage,
        errorCode: error instanceof DaemonServiceRunError ? error.code : null,
        failureCount: consecutiveHeartbeatFailures,
        failureLimit: HEARTBEAT_CONSECUTIVE_FAILURES_BEFORE_CLOSE,
      },
    });
    return shouldCloseSocket;
  }

  function resolveSuccessfulHeartbeatSchedule(): {
    hasDispatchActivity: boolean;
    reason: "controlled_shutdown" | "dispatch_active" | "idle_growth";
  } {
    if (!acceptingDispatches) {
      return {
        hasDispatchActivity: true,
        reason: "controlled_shutdown",
      };
    }
    const hadDispatchActivity =
      lastDispatchActivityAtMs !== null &&
      (lastHeartbeatSentAtMs === null ||
        lastDispatchActivityAtMs > lastHeartbeatSentAtMs);
    if (
      hadDispatchActivity ||
      (input.executionHost.snapshot()?.activeCount ?? 0) > 0
    ) {
      return {
        hasDispatchActivity: true,
        reason: "dispatch_active",
      };
    }
    return {
      hasDispatchActivity: false,
      reason: "idle_growth",
    };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One ordered transaction owns heartbeat response, cadence, retry, and pending admission publication.
  async function sendHeartbeat(
    options: {
      advanceIdleCadence?: boolean;
      publishAdmissionAfterInFlight?: boolean;
      requireAcknowledgement?: boolean;
    } = {}
  ): Promise<void> {
    if (closed) {
      if (options.requireAcknowledgement) {
        throw new DaemonServiceRunError({
          code: "daemon.run.socket_closed",
          message: "Transport closed before the final heartbeat.",
        });
      }
      return;
    }
    if (heartbeatInFlight) {
      if (options.publishAdmissionAfterInFlight) {
        admissionHeartbeatPending = true;
      }
      return;
    }
    heartbeatInFlight = true;
    try {
      const leases: RuntimeTransportLease[] = Array.from(
        leasesByProfileId.entries()
      )
        .map(([profileId, leaseEpoch]) => ({
          profileId,
          leaseEpoch,
        }))
        .sort((left, right) => left.profileId.localeCompare(right.profileId));
      const localComponentsStatus = readSessionLocalComponentsStatus();
      const heartbeatRequest = runtimeTransportHeartbeatRequestSchema.safeParse(
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: input.ownerUserId,
          deviceId: input.deviceId,
          lane: input.lane,
          daemonSessionId: input.daemonSessionId,
          ...buildShutdownHeartbeatFacts({
            acceptingDispatches,
            stopCause: shutdownStopCause,
          }),
          ...(admissionEvidenceSupported &&
          (shutdownAdmissionEvidence ?? hostLink.admissionEvidence())
            ? {
                admissionEvidence:
                  shutdownAdmissionEvidence ?? hostLink.admissionEvidence(),
              }
            : {}),
          serviceVersion,
          leases,
          runtimeContract: {
            epoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
          },
          capabilities: {
            ...resolveDaemonCapabilitiesFromAdapterIds({
              adapterIds: input.executionHost.snapshot()?.adapterIds ?? [],
              localComponentsStatus,
              profileConfigurationRevision:
                hasCompleteProfileConfigurationRevisions(
                  input.routeCatalogState
                ),
            }),
            ...(computerCareSupported && input.executionHost.observation
              ? { executionHost: input.executionHost.observation() }
              : {}),
          },
          sentAtMs: Date.now(),
        }
      );
      if (!heartbeatRequest.success) {
        throw new DaemonServiceRunError({
          code: "daemon.run.heartbeat_payload_invalid",
          message: "invalid heartbeat payload",
        });
      }

      sendDaemonFrame(input.socket, {
        code: "daemon.session.heartbeat",
        payload: heartbeatRequest.data,
      });

      const heartbeatResponse = await waitForHeartbeatResponse({
        timeoutMs: HEARTBEAT_RESPONSE_TIMEOUT_MS,
        waiters,
      });
      if (!heartbeatResponse.ok) {
        throw new DaemonServiceRunError({
          code: "daemon.run.heartbeat_rejected",
          message: "Core rejected the service heartbeat.",
        });
      }
      pruneStaleLeases({
        leasesByProfileId,
        staleLeases: heartbeatResponse.staleLeases,
      });
      if (heartbeatResponse.staleLeases.length > 0) {
        forceCatalogSyncReason = "stale_leases";
        nextCatalogSyncAtMs = 0;
      }
      const heartbeatAt = nowIsoString();
      await withDaemonRunTimeout({
        code: "daemon.run.heartbeat_runtime_state_timeout",
        message: `heartbeat runtime state write timed out after ${String(
          HEARTBEAT_RUNTIME_STATE_WRITE_TIMEOUT_MS
        )}ms`,
        operation: input.touchRuntimeState({
          heartbeatAt,
          updatedAt: heartbeatAt,
        }),
        timeoutMs: HEARTBEAT_RUNTIME_STATE_WRITE_TIMEOUT_MS,
      });
      hostLink.heartbeat(
        heartbeatResponse.staleLeases.map((lease) => lease.profileId)
      );
      consecutiveHeartbeatFailures = 0;

      const heartbeatSchedule = resolveSuccessfulHeartbeatSchedule();
      // Host admission changes require immediate publication, but are not an
      // elapsed idle interval. Otherwise one extra readiness ACK can double
      // the cadence and starve a scheduled controller-report retry.
      const nextIntervalWithoutJitter =
        options.advanceIdleCadence === false &&
        !heartbeatSchedule.hasDispatchActivity
          ? currentHeartbeatIntervalMs
          : resolveAdaptiveHeartbeatIntervalMs({
              currentIntervalMs: currentHeartbeatIntervalMs,
              hasDispatchActivity: heartbeatSchedule.hasDispatchActivity,
            });
      updateHeartbeatInterval({
        nextIntervalMs: nextIntervalWithoutJitter,
        reason: heartbeatSchedule.reason,
      });
      const nextIntervalWithJitter = applyIntervalJitterMs({
        baseIntervalMs: currentHeartbeatIntervalMs,
        jitterRatio: ADAPTIVE_HEARTBEAT_JITTER_RATIO,
        maxIntervalMs: MAX_HEARTBEAT_INTERVAL_MS,
        minIntervalMs: MIN_HEARTBEAT_INTERVAL_MS,
      });
      scheduleHeartbeat({
        delayMs: nextIntervalWithJitter,
        reason: heartbeatSchedule.reason,
      });
      lastHeartbeatSentAtMs = Date.now();
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.heartbeat",
        text: `heartbeat ok; active leases=${leasesByProfileId.size}, stale leases=${heartbeatResponse.staleLeases.length}, next=${String(currentHeartbeatIntervalMs)}ms`,
      });
      startRouteCatalogSyncIfDue();
      startSupplementalEvidenceSyncs();
    } catch (error) {
      if (recordHeartbeatFailure(error) && !options.requireAcknowledgement) {
        admissionHeartbeatPending = false;
        terminateForReconnect("heartbeat_failed");
        return;
      }
      updateHeartbeatInterval({
        nextIntervalMs: MIN_HEARTBEAT_INTERVAL_MS,
        reason: "dispatch_activity",
      });
      scheduleHeartbeat({
        delayMs: MIN_HEARTBEAT_INTERVAL_MS,
        reason: "heartbeat_retry",
      });
      if (options.requireAcknowledgement) {
        throw error;
      }
    } finally {
      heartbeatInFlight = false;
      const publishPendingAdmission = admissionHeartbeatPending;
      admissionHeartbeatPending = false;
      if (!closed && publishPendingAdmission) {
        scheduleHeartbeat({
          delayMs: 0,
          reason: "execution_host_admission_changed",
        });
      }
      resolveHeartbeatIdleWaiters(heartbeatIdleWaiters);
      schedulePendingLocalExecutionEvidenceRefreshIfNeeded();
    }
  }

  function waitForHeartbeatIdle(): Promise<void> {
    if (!heartbeatInFlight) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      heartbeatIdleWaiters.push(resolve);
    });
  }

  function scheduleHeartbeat(inputSchedule: {
    delayMs: number;
    reason: string;
  }): void {
    if (closed) {
      return;
    }
    const normalizedDelayMs = Math.max(0, Math.trunc(inputSchedule.delayMs));
    if (
      heartbeatInFlight &&
      inputSchedule.reason === "execution_host_admission_changed"
    ) {
      admissionHeartbeatPending = true;
      return;
    }
    const dueAtMs = Date.now() + normalizedDelayMs;
    if (
      heartbeatTimer &&
      heartbeatTimerDueAtMs !== null &&
      heartbeatTimerDueAtMs <= dueAtMs
    ) {
      return;
    }
    clearHeartbeatTimer();
    heartbeatTimerDueAtMs = dueAtMs;
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      heartbeatTimerDueAtMs = null;
      sendHeartbeat({
        advanceIdleCadence:
          inputSchedule.reason !== "execution_host_admission_changed",
        publishAdmissionAfterInFlight:
          inputSchedule.reason === "execution_host_admission_changed",
      }).catch((error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.heartbeat_failed",
          text: `heartbeat failed: ${toErrorMessage(error)}`,
        });
      });
    }, normalizedDelayMs);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.heartbeat_scheduled",
      text: `heartbeat scheduled in ${String(normalizedDelayMs)}ms (${inputSchedule.reason})`,
    });
  }

  const updateHeartbeatInterval = (inputUpdate: {
    nextIntervalMs: number;
    reason:
      | "controlled_shutdown"
      | "dispatch_activity"
      | "dispatch_active"
      | "idle_growth";
  }): void => {
    const normalizedNextIntervalMs = normalizeHeartbeatIntervalMs(
      inputUpdate.nextIntervalMs
    );
    if (normalizedNextIntervalMs === currentHeartbeatIntervalMs) {
      return;
    }
    const previousIntervalMs = currentHeartbeatIntervalMs;
    currentHeartbeatIntervalMs = normalizedNextIntervalMs;
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.heartbeat_interval_changed",
      text: `heartbeat interval changed: ${String(previousIntervalMs)}ms -> ${String(normalizedNextIntervalMs)}ms (${inputUpdate.reason})`,
      payload: {
        fromMs: previousIntervalMs,
        reason: inputUpdate.reason,
        toMs: normalizedNextIntervalMs,
      },
    });
  };

  const scheduleCatalogSyncNext = (delayMs: number): void => {
    nextCatalogSyncAtMs = Date.now() + Math.max(0, Math.trunc(delayMs));
  };

  const clearCatalogSyncSignalTimer = (): void => {
    if (!catalogSyncSignalTimer) {
      return;
    }
    clearTimeout(catalogSyncSignalTimer);
    catalogSyncSignalTimer = null;
  };

  const scheduleCatalogSyncSignalPoll = (): void => {
    if (closed || catalogSyncSignalTimer) {
      return;
    }
    catalogSyncSignalTimer = setTimeout(() => {
      catalogSyncSignalTimer = null;
      pollCatalogSyncSignal()
        .catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.catalog_sync_signal_read_failed",
            text: `catalog sync signal read failed: ${toErrorMessage(error)}`,
          });
        })
        .finally(() => {
          scheduleCatalogSyncSignalPoll();
        });
    }, CATALOG_SYNC_SIGNAL_POLL_INTERVAL_MS);
  };

  const pollCatalogSyncSignal = async (): Promise<void> => {
    const signal = await readDaemonCatalogSyncSignal();
    if (!signal) {
      return;
    }
    const signalMarker = resolveCatalogSyncSignalMarker(signal);
    if (signalMarker === latestCatalogSyncSignalMarker) {
      return;
    }
    latestCatalogSyncSignalMarker = signalMarker;
    requestLocalExecutionEvidenceRefresh({
      reason: "local_state_changed",
      scheduleReason: "catalog_sync_signal",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.catalog_sync_signal_detected",
      text: `catalog sync signal detected (${signal.reason}); scheduling immediate heartbeat`,
      payload: {
        reason: signal.reason,
        updatedAt: signal.updatedAt,
      },
    });
  };

  let hasLoggedWaitingForProfiles =
    (input.isRouteCatalogResolved?.() ?? true) &&
    input.routeCatalogState.profileIds.length === 0;
  const serviceVersion = OPENMELD_VERSION;
  let computerCareSupported = false;
  let executionAdmissionSupported = false;
  let admissionEvidenceSupported = false;

  const readSessionLocalComponentsStatus = (): LocalComponentsStatus | null =>
    input.localComponentsObservation.read(() => {
      if (lastHeartbeatSentAtMs !== null) {
        scheduleHeartbeat({ delayMs: 0, reason: "local_components_refreshed" });
      }
    });

  const registerDaemonSession = async (
    routeCatalog: RouteCatalog
  ): Promise<RuntimeTransportRegisterSessionResponse> => {
    const connectionGeneration = activeConnectionGeneration;
    const localComponentsStatus = readSessionLocalComponentsStatus();
    const registerPayload =
      runtimeTransportRegisterSessionRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        deviceId: input.deviceId,
        lane: input.lane,
        daemonSessionId: input.daemonSessionId,
        serviceVersion,
        connectionGeneration,
        profileIds: routeCatalog.profileIds,
        localWakeRouteReport: createLocalWakeRouteReport({
          daemonSessionId: input.daemonSessionId,
          deviceId: input.deviceId,
          lane: input.lane,
          reportedAtMs: Date.now(),
          routeCatalog,
          serviceVersion,
        }),
        capabilities: resolveDaemonCapabilitiesFromAdapterIds({
          adapterIds: input.executionHost.snapshot()?.adapterIds ?? [],
          localComponentsStatus,
          profileConfigurationRevision:
            hasCompleteProfileConfigurationRevisions(routeCatalog),
        }),
        runtimeContract: {
          epoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        },
        connectedAtMs: socketConnectedAtMs,
      });
    if (!registerPayload.success) {
      throw new DaemonServiceRunError({
        code: "daemon.run.register_payload_invalid",
        message: "invalid register payload",
      });
    }

    sendDaemonFrame(input.socket, {
      code: "daemon.session.register",
      payload: registerPayload.data,
    });

    const response = await waitForRegisterResponse({
      timeoutMs: REGISTER_RESPONSE_TIMEOUT_MS,
      waiters,
    });
    computerCareSupported = response.computerCare === true;
    executionAdmissionSupported =
      response.executionAdmissionConfirmation === true;
    admissionEvidenceSupported = response.admissionEvidence === true;
    return response;
  };

  const resolveCatalogSyncForcePayload = (
    inputSync?: CatalogSyncInput
  ): { forceReason: CatalogSyncForceReason } | undefined =>
    inputSync?.forceReason ? { forceReason: inputSync.forceReason } : undefined;

  const scheduleNextCatalogSync = (): void => {
    scheduleCatalogSyncNext(
      resolveCatalogSyncIntervalMs({
        heartbeatIntervalMs: currentHeartbeatIntervalMs,
      })
    );
  };

  const resetWaitingForProfilesTracking = (): void => {
    hasLoggedWaitingForProfiles = false;
    latestSkippedProfilesFingerprint = null;
  };

  const emitSkippedProfilesIfNeeded = (
    syncResult: Extract<
      RouteCatalogSyncResult,
      { status: "changed" | "unchanged" }
    >,
    inputSync?: CatalogSyncInput
  ): void => {
    const skippedProfilesLogState = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: input.routeCatalogState.profileIds.length > 0,
      latestFingerprint: latestSkippedProfilesFingerprint,
      skippedProfiles: syncResult.skippedProfiles,
    });
    latestSkippedProfilesFingerprint = skippedProfilesLogState.fingerprint;
    if (!skippedProfilesLogState.shouldEmit) {
      return;
    }
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.waiting_for_profiles_reasons",
      text: `eligible local profiles are still empty; skipped=${syncResult.skippedProfiles.length} (${summarizeSkippedDaemonProfiles(syncResult.skippedProfiles)})`,
      payload: {
        ...resolveCatalogSyncForcePayload(inputSync),
        skippedProfiles: syncResult.skippedProfiles,
      },
    });
  };

  const persistAcceptedRouteCatalogCache = async (): Promise<void> => {
    if (!input.persistRouteCatalogCache) {
      return;
    }
    await input.persistRouteCatalogCache(
      createRouteCatalogFromMutableState(input.routeCatalogState)
    );
  };

  const handleChangedCatalogSync = async (
    syncResult: Extract<RouteCatalogSyncResult, { status: "changed" }>,
    inputSync?: CatalogSyncInput
  ): Promise<void> => {
    latestCatalogSyncStatus = "changed";
    const rejectedProfileIds = syncResult.registerResponse.rejectedProfiles.map(
      (item) => item.profileId
    );
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.catalog_sync_changed",
      text: `catalog sync changed: +${syncResult.diff.addedProfileIds.length} / -${syncResult.diff.removedProfileIds.length} / =${syncResult.diff.keptProfileIds.length}, accepted=${syncResult.registerResponse.acceptedLeases.length}, rejected=${syncResult.registerResponse.rejectedProfiles.length}`,
      payload: {
        ...syncResult.diff,
        acceptedProfileIds: syncResult.registerResponse.acceptedLeases.map(
          (lease) => lease.profileId
        ),
        ...resolveCatalogSyncForcePayload(inputSync),
        rejectedProfileIds,
      },
    });

    if (rejectedProfileIds.length > 0) {
      requestLocalExecutionEvidenceRefresh({
        reason: "register_conflict",
        scheduleReason: "register_conflict",
      });
    } else {
      await persistAcceptedRouteCatalogCache();
      scheduleNextCatalogSync();
    }

    if (input.routeCatalogState.profileIds.length > 0) {
      resetWaitingForProfilesTracking();
      return;
    }

    emitSkippedProfilesIfNeeded(syncResult, inputSync);
    if (hasLoggedWaitingForProfiles) {
      return;
    }

    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.waiting_for_profiles",
      text: "no eligible local profiles yet; daemon will keep running and auto-register when profiles become available",
    });
    hasLoggedWaitingForProfiles = true;
  };

  const handleRegisteredCatalogSync = async (
    syncResult: Extract<RouteCatalogSyncResult, { status: "registered" }>,
    inputSync?: CatalogSyncInput
  ): Promise<void> => {
    latestCatalogSyncStatus = "registered";
    const rejectedProfileIds = syncResult.registerResponse.rejectedProfiles.map(
      (item) => item.profileId
    );
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.catalog_sync_registered",
      text: `catalog sync re-registered; accepted=${syncResult.registerResponse.acceptedLeases.length}, rejected=${syncResult.registerResponse.rejectedProfiles.length}`,
      payload: {
        acceptedProfileIds: syncResult.registerResponse.acceptedLeases.map(
          (lease) => lease.profileId
        ),
        ...resolveCatalogSyncForcePayload(inputSync),
        rejectedProfileIds,
      },
    });

    if (rejectedProfileIds.length > 0) {
      requestLocalExecutionEvidenceRefresh({
        reason: "register_conflict",
        scheduleReason: "register_conflict",
      });
      return;
    }

    if (input.routeCatalogState.profileIds.length > 0) {
      resetWaitingForProfilesTracking();
    }
    await persistAcceptedRouteCatalogCache();
    scheduleNextCatalogSync();
  };

  const handleUnchangedCatalogSync = (
    syncResult: Extract<RouteCatalogSyncResult, { status: "unchanged" }>,
    inputSync?: CatalogSyncInput
  ): void => {
    if (latestCatalogSyncStatus !== "unchanged") {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.catalog_sync_unchanged",
        text: `catalog sync unchanged; profiles=${input.routeCatalogState.profileIds.length}`,
        payload: resolveCatalogSyncForcePayload(inputSync),
      });
    }

    emitSkippedProfilesIfNeeded(syncResult, inputSync);
    latestCatalogSyncStatus = "unchanged";
    scheduleNextCatalogSync();
  };

  const handleFailedCatalogSync = (
    syncResult: Extract<RouteCatalogSyncResult, { status: "failed" }>
  ): void => {
    latestCatalogSyncStatus = "failed";
    latestSkippedProfilesFingerprint = null;
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.catalog_sync_failed",
      text: `catalog sync failed (${syncResult.reason}): ${syncResult.errorMessage}`,
    });
    scheduleCatalogSyncNext(CATALOG_SYNC_RETRY_INTERVAL_MS);
  };

  const runCatalogSync = async (
    inputSync?: CatalogSyncInput
  ): Promise<void> => {
    const syncResult = await syncDaemonRouteCatalogState({
      catalogState: input.routeCatalogState,
      forceRegister: Boolean(inputSync?.forceReason),
      leasesByProfileId,
      loadCatalog: input.loadRouteCatalog,
      registerCatalog: registerDaemonSession,
    });

    if (syncResult.status !== "failed") {
      await configureHostConnection();
    }

    if (syncResult.status === "changed") {
      await handleChangedCatalogSync(syncResult, inputSync);
      resolvePendingRouteCatalogSyncRequests(syncResult);
      return;
    }

    if (syncResult.status === "registered") {
      await handleRegisteredCatalogSync(syncResult, inputSync);
      resolvePendingRouteCatalogSyncRequests(syncResult);
      return;
    }

    if (syncResult.status === "unchanged") {
      handleUnchangedCatalogSync(syncResult, inputSync);
      resolvePendingRouteCatalogSyncRequests(syncResult);
      return;
    }

    handleFailedCatalogSync(syncResult);
    resolvePendingRouteCatalogSyncRequests(syncResult);
  };

  const shouldStartRouteCatalogSync = (): boolean =>
    Boolean(forceCatalogSyncReason) || Date.now() >= nextCatalogSyncAtMs;

  function startRouteCatalogSyncIfDue(): void {
    if (closed || routeCatalogSyncInFlight || !shouldStartRouteCatalogSync()) {
      return;
    }

    routeCatalogSyncInFlight = true;
    syncRouteCatalogIfDue()
      .catch((error) => {
        const syncError =
          error instanceof Error ? error : new Error(toErrorMessage(error));
        failPendingRouteCatalogSyncRequests(syncError);
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.catalog_sync_failed",
          text: `catalog sync failed: ${toErrorMessage(error)}`,
        });
      })
      .finally(() => {
        routeCatalogSyncInFlight = false;
        schedulePendingLocalExecutionEvidenceRefreshIfNeeded();
      });
  }

  async function syncRouteCatalogIfDue(): Promise<void> {
    const forceReason = forceCatalogSyncReason;
    const nowMs = Date.now();
    if (!forceReason && nowMs < nextCatalogSyncAtMs) {
      if (latestCatalogSyncStatus !== "skipped") {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.catalog_sync_skipped",
          text: `catalog sync skipped; next sync in ${String(
            Math.max(0, nextCatalogSyncAtMs - nowMs)
          )}ms`,
        });
      }
      latestCatalogSyncStatus = "skipped";
      return;
    }

    forceCatalogSyncReason = null;
    await runCatalogSync(forceReason ? { forceReason } : undefined);
  }

  const runRuntimeAgentControllerReportSync = async (
    probePolicy: "background" | "fresh"
  ): Promise<LocalServiceRuntimeAgentControllerReportSyncResult> => {
    // Core accepts a native check for a fixed window after its check time, so
    // the cadence is measured from when this pass starts checking. Measuring
    // from its end would let a slow pass push every controller's renewal past
    // that window and briefly turn a healthy controller stale.
    const passStartedAtMs = Date.now();
    try {
      const result = await input.executionHost.call("reportControllers", {
        probePolicy,
      });
      const retryInMs =
        result.failedCount > 0
          ? RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_RETRY_INTERVAL_MS
          : RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_INTERVAL_MS;
      // A controller check that just failed must not wait for the normal report
      // cadence before trying again. Bring the next pass forward once to
      // re-probe it for real (serially, so simultaneous failures stagger their
      // cold starts) while healthy controllers reuse held snapshots. The arm is
      // consumed here so it fires at most once even if the controller later
      // leaves the ready state and is never re-probed. This only reschedules;
      // current Wake eligibility stays fail-closed until a check completes.
      nextRuntimeAgentControllerReportSyncAtMs =
        resolveNextRuntimeAgentControllerReportSyncAtMs({
          nowMs: Date.now(),
          passStartedAtMs,
          baseRetryMs: retryInMs,
          hasArmedReprobe: result.hasArmedReprobe,
        });
      scheduleRuntimeAgentControllerReportSyncTimer();
      let reportSyncLineText: string;
      if (result.status === "skipped") {
        reportSyncLineText = `runtime agent controller report sync skipped; ${result.reasonCodes[0] ?? "no reports"}`;
      } else if (result.failedCount > 0) {
        reportSyncLineText = `runtime agent controller report sync incomplete; accepted=${result.submittedCount}, failed=${result.failedCount}, total=${result.reportCount}; retrying in ${String(retryInMs)}ms`;
      } else {
        reportSyncLineText = `runtime agent controller report sync submitted; accepted=${result.submittedCount}, failed=${result.failedCount}, total=${result.reportCount}`;
      }
      emitRunLine({
        presenter: input.presenter,
        code:
          result.failedCount > 0
            ? "daemon.run.runtime_agent_controller_report_sync_failed"
            : "daemon.run.runtime_agent_controller_report_sync",
        text: reportSyncLineText,
        payload: {
          failedCount: result.failedCount,
          reasonCodes: result.reasonCodes,
          reportCount: result.reportCount,
          retryInMs,
          status: result.status,
          submittedCount: result.submittedCount,
        },
      });
      return result;
    } catch (error) {
      nextRuntimeAgentControllerReportSyncAtMs =
        Date.now() + RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_RETRY_INTERVAL_MS;
      scheduleRuntimeAgentControllerReportSyncTimer();
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.runtime_agent_controller_report_sync_failed",
        text: `runtime agent controller report sync failed: ${toErrorMessage(error)}`,
      });
      throw error;
    }
  };

  const startRuntimeAgentControllerReportSync = (
    probePolicy: "background" | "fresh"
  ): Promise<LocalServiceRuntimeAgentControllerReportSyncResult> => {
    const syncPromise = runRuntimeAgentControllerReportSync(probePolicy);
    runtimeAgentControllerReportSyncPromise = syncPromise;
    syncPromise
      .finally(() => {
        if (runtimeAgentControllerReportSyncPromise === syncPromise) {
          runtimeAgentControllerReportSyncPromise = null;
        }
      })
      .catch(() => undefined);
    return syncPromise;
  };

  const syncRuntimeAgentControllerReportsIfDue = async (): Promise<void> => {
    const nowMs = Date.now();
    if (
      runtimeAgentControllerReportSyncPromise ||
      nowMs < nextRuntimeAgentControllerReportSyncAtMs
    ) {
      return;
    }

    const probeFresh = forceFreshAgentControllerProbes;
    forceFreshAgentControllerProbes = false;
    try {
      await startRuntimeAgentControllerReportSync(
        probeFresh ? "fresh" : "background"
      );
    } catch {
      // The shared runner already emitted the failure with full context and
      // scheduled the bounded retry. Background heartbeats stay independent.
    }
  };

  // The report cadence must not depend on the heartbeat. An idle heartbeat
  // stretches to a minute, so a pass that comes due just after one would wait
  // for the next and land on Core's two-minute check window, briefly turning
  // every healthy controller stale. Heartbeats still trigger a due pass; this
  // timer only guarantees one runs on time.
  function scheduleRuntimeAgentControllerReportSyncTimer(): void {
    clearRuntimeAgentControllerReportSyncTimer();
    // A controlled shutdown drains accepted work; it must not start new
    // controller probes even when a pass that began earlier finishes now.
    if (closed || shutdownStopCause) {
      return;
    }
    runtimeAgentControllerReportSyncTimer = setTimeout(
      () => {
        runtimeAgentControllerReportSyncTimer = null;
        if (closed || shutdownStopCause) {
          return;
        }
        syncRuntimeAgentControllerReportsIfDue().catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.runtime_agent_controller_report_sync_failed",
            text: `runtime agent controller report sync failed: ${toErrorMessage(error)}`,
          });
        });
      },
      Math.max(0, nextRuntimeAgentControllerReportSyncAtMs - Date.now())
    );
  }

  const requestFreshRuntimeAgentControllerReportSync =
    async (): Promise<LocalServiceRuntimeAgentControllerReportSyncResult> => {
      if (pendingFreshAgentControllerReportSyncPromise) {
        return await pendingFreshAgentControllerReportSyncPromise;
      }

      const freshSyncPromise = (async () => {
        while (runtimeAgentControllerReportSyncPromise) {
          const activeSync = runtimeAgentControllerReportSyncPromise;
          try {
            await activeSync;
          } catch {
            // A manual check still gets its own fresh attempt after an earlier
            // background failure.
          }
        }
        forceFreshAgentControllerProbes = false;
        nextRuntimeAgentControllerReportSyncAtMs = 0;
        const result = await startRuntimeAgentControllerReportSync("fresh");
        if (result.failedCount > 0) {
          throw new Error(
            `OpenMeld could not submit ${String(result.failedCount)} of ${String(result.reportCount)} local agent reports.`
          );
        }
        return result;
      })();
      pendingFreshAgentControllerReportSyncPromise = freshSyncPromise;
      try {
        return await freshSyncPromise;
      } finally {
        if (pendingFreshAgentControllerReportSyncPromise === freshSyncPromise) {
          pendingFreshAgentControllerReportSyncPromise = null;
        }
      }
    };

  const syncProviderConversationProofsIfDue = async (): Promise<void> => {
    const nowMs = Date.now();
    if (
      providerConversationProofSyncInFlight ||
      nowMs < nextProviderConversationProofSyncAtMs
    ) {
      return;
    }

    providerConversationProofSyncInFlight = true;
    try {
      const result = await input.executionHost.call("reportConversations", {});
      const retryInMs =
        result.failedCount > 0
          ? PROVIDER_CONVERSATION_PROOF_SYNC_RETRY_INTERVAL_MS
          : PROVIDER_CONVERSATION_PROOF_SYNC_INTERVAL_MS;
      nextProviderConversationProofSyncAtMs = Date.now() + retryInMs;
      let proofSyncLineText: string;
      if (result.status === "skipped") {
        proofSyncLineText = `provider conversation proof sync skipped; ${result.reasonCodes[0] ?? "no applicable routes"}`;
      } else if (result.failedCount > 0) {
        proofSyncLineText = `provider conversation proof sync incomplete; accepted=${result.submittedCount}, failed=${result.failedCount}, total=${result.proofCount}; retrying in ${String(retryInMs)}ms`;
      } else {
        proofSyncLineText = `provider conversation proof sync submitted; accepted=${result.submittedCount}, failed=${result.failedCount}, total=${result.proofCount}`;
      }
      emitRunLine({
        presenter: input.presenter,
        code:
          result.failedCount > 0
            ? "daemon.run.provider_conversation_proof_sync_failed"
            : "daemon.run.provider_conversation_proof_sync",
        text: proofSyncLineText,
        payload: {
          failedCount: result.failedCount,
          proofCount: result.proofCount,
          reasonCodes: result.reasonCodes,
          retryInMs,
          status: result.status,
          submittedCount: result.submittedCount,
        },
      });
    } catch (error) {
      nextProviderConversationProofSyncAtMs =
        Date.now() + PROVIDER_CONVERSATION_PROOF_SYNC_RETRY_INTERVAL_MS;
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_conversation_proof_sync_failed",
        text: `provider conversation proof sync failed: ${toErrorMessage(error)}`,
      });
    } finally {
      providerConversationProofSyncInFlight = false;
    }
  };

  const startSupplementalEvidenceSyncs = (): void => {
    syncRuntimeAgentControllerReportsIfDue().catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.runtime_agent_controller_report_sync_failed",
        text: `runtime agent controller report sync failed: ${toErrorMessage(error)}`,
      });
    });
    syncProviderConversationProofsIfDue().catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.provider_conversation_proof_sync_failed",
        text: `provider conversation proof sync failed: ${toErrorMessage(error)}`,
      });
    });
  };

  const handleLocalAgentControlRefreshCatalogFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_frame_invalid",
        text: "ignored invalid local agent catalog refresh frame",
      });
      return;
    }

    const responsePayload = await applyLocalAgentControlRefreshCatalog(
      parsed.data.payload.reason
    );
    sendDaemonFrame(input.socket, {
      code: "daemon.local_agent_control.result",
      payload: {
        requestId: parsed.data.requestId,
        payload: responsePayload,
      },
    });
  };

  const handleLocalAgentControlReadProfileWorkspaceFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_frame_invalid",
        text: "ignored invalid profile workspace read frame",
      });
      return;
    }
    const responsePayload = await readLocalAgentProfileWorkspace({
      ownerUserId: input.ownerUserId,
      ...parsed.data.payload,
    });
    sendDaemonFrame(input.socket, {
      code: "daemon.local_agent_control.result",
      payload: { requestId: parsed.data.requestId, payload: responsePayload },
    });
  };

  const handleLocalAgentControlManageProfileFoldersFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_frame_invalid",
        text: "ignored invalid profile folder control frame",
      });
      return;
    }
    const responsePayload = await manageLocalProfileFolders({
      ownerUserId: input.ownerUserId,
      ...parsed.data.payload,
    });
    if (
      responsePayload.accepted &&
      parsed.data.payload.operation.operation !== "list"
    ) {
      // A new default changes the effective working folder that routes report.
      requestLocalExecutionEvidenceRefresh({
        reason: "local_state_changed",
        scheduleReason: "local_agent_control_manage_profile_folders",
      });
    }
    sendDaemonFrame(input.socket, {
      code: "daemon.local_agent_control.result",
      payload: { requestId: parsed.data.requestId, payload: responsePayload },
    });
  };

  const handleLocalAgentControlSetProfileWorkspaceFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_frame_invalid",
        text: "ignored invalid profile workspace control frame",
      });
      return;
    }

    const responsePayload = await applyLocalAgentControlSetProfileWorkspace(
      parsed.data.payload
    );
    sendDaemonFrame(input.socket, {
      code: "daemon.local_agent_control.result",
      payload: {
        requestId: parsed.data.requestId,
        payload: responsePayload,
      },
    });
  };

  const applyLocalAgentControlSetProfileWorkspace = async (controlInput: {
    targetProfileId: string;
    workspaceMode: "custom" | "openmeld_managed";
    workspacePath?: string;
    onlyIfUnconfigured?: boolean;
  }): Promise<OpenMeldDaemonSetProfileWorkspacePayload> => {
    try {
      const result =
        controlInput.workspaceMode === "custom"
          ? await setCustomProfileWorkspace({
              customWorkspacePath: controlInput.workspacePath ?? "",
              openMeldProfileId: controlInput.targetProfileId,
            })
          : await ensureOpenMeldManagedProfileWorkspace({
              openMeldProfileId: controlInput.targetProfileId,
              onlyIfUnconfigured: controlInput.onlyIfUnconfigured,
            });
      requestLocalExecutionEvidenceRefresh({
        reason: "local_state_changed",
        scheduleReason: "local_agent_control_set_profile_workspace",
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_set_profile_workspace",
        text: `profile workspace updated for ${controlInput.targetProfileId}.`,
        payload: {
          targetProfileId: controlInput.targetProfileId,
          workspaceMode: result.value.mode,
          workspacePath: result.workspacePath,
        },
      });
      return {
        accepted: true,
        targetProfileId: controlInput.targetProfileId,
        status: "updated",
        workspaceMode: result.value.mode,
        workspacePath: result.workspacePath,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      const reasonCode = resolveProfileWorkspaceControlErrorCode(error);
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_set_profile_workspace_rejected",
        text: `profile workspace control rejected: ${message}`,
        payload: {
          reasonCode,
          targetProfileId: controlInput.targetProfileId,
          workspaceMode: controlInput.workspaceMode,
        },
      });
      return {
        accepted: false,
        message,
        reasonCode,
        targetProfileId: controlInput.targetProfileId,
        status: "rejected",
      };
    }
  };

  const applyLocalAgentControlRefreshCatalog = async (
    reason: string
  ): Promise<OpenMeldDaemonSyncRouteCatalogPayload> => {
    try {
      const [result] = await Promise.all([
        requestRouteCatalogSync(reason),
        requestFreshRuntimeAgentControllerReportSync(),
      ]);
      const payload = projectRouteCatalogSyncPayload({
        knownProfileIds: input.routeCatalogState.profileIds,
        result,
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_refresh_catalog",
        text: `local agent catalog check completed (${payload.syncStatus}).`,
        payload: {
          profileCount: payload.profileIds.length,
          syncStatus: payload.syncStatus,
        },
      });
      return payload;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_refresh_catalog_failed",
        text: `local agent catalog check failed: ${errorMessage}`,
      });
      return {
        accepted: false,
        errorMessage,
        profileIds: [...input.routeCatalogState.profileIds],
        syncStatus: "failed",
      };
    }
  };

  input.socket.onError((error) => {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.socket_error",
      text: `daemon stream socket error: ${toErrorMessage(error)}`,
    });
    terminateForReconnect("socket_error");
  });

  const handleOpenMeldToolsControlFrame = (frame: {
    code: string;
    payload: Record<string, unknown>;
  }): boolean => {
    if (frame.code !== "daemon.openmeld_tools_control.request") {
      return false;
    }
    const parsed =
      runtimeTransportOpenMeldToolsControlFramePayloadSchema.safeParse(
        frame.payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.openmeld_tools_control_invalid",
        text: "OpenMeld Tools control request was invalid.",
      });
      return true;
    }
    handleOpenMeldToolsControlRequest({
      coordinator: input.openMeldToolsUpdateCoordinator,
      request: parsed.data.request,
    })
      .then((result) => {
        const payload =
          runtimeTransportOpenMeldToolsControlResultFramePayloadSchema.parse({
            requestId: parsed.data.requestId,
            result,
          });
        sendDaemonFrame(input.socket, {
          code: "daemon.openmeld_tools_control.result",
          payload,
        });
        scheduleHeartbeat({
          delayMs: 0,
          reason: "openmeld_tools_control_changed",
        });
      })
      .catch((error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.openmeld_tools_control_failed",
          text: `OpenMeld Tools control failed: ${toErrorMessage(error)}`,
        });
      });
    return true;
  };

  const handleServiceControlFrame = (frame: {
    code: string;
    payload: Record<string, unknown>;
  }): boolean => handleOpenMeldToolsControlFrame(frame);

  const handleProfileWorkspaceControlFrame = (
    frame: ParsedDaemonFrame
  ): boolean => {
    const handlers: Partial<
      Record<
        ParsedDaemonFrame["code"],
        (payload: Record<string, unknown>) => Promise<void>
      >
    > = {
      "daemon.local_agent_control.read_profile_workspace":
        handleLocalAgentControlReadProfileWorkspaceFrame,
      "daemon.local_agent_control.set_profile_workspace":
        handleLocalAgentControlSetProfileWorkspaceFrame,
      "daemon.local_agent_control.manage_profile_folders":
        handleLocalAgentControlManageProfileFoldersFrame,
    };
    const handler = handlers[frame.code];
    if (!handler) {
      return false;
    }
    handler(frame.payload).catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_failed",
        text: `local agent control failed: ${toErrorMessage(error)}`,
      });
    });
    return true;
  };

  const handleMessage = (raw: string): void => {
    // Keepalive PONG (bare "pong", auto-answered by the RuntimeTransportHub DO)
    // is not a daemon frame; feed the keepalive watchdog and swallow it before
    // frame parsing so it never logs as an invalid frame and never touches
    // lease / readiness.
    if (raw === DAEMON_STREAM_KEEPALIVE_PONG) {
      keepalive.observePong();
      return;
    }
    const parsedFrame = parseDaemonFrame(raw);
    if (!parsedFrame) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.frame_invalid",
        text: "ignored invalid daemon frame",
      });
      return;
    }
    if (parsedFrame.code === "daemon.route_catalog.changed") {
      const payload =
        runtimeTransportRouteCatalogChangedFramePayloadSchema.safeParse(
          parsedFrame.payload
        );
      requestLocalExecutionEvidenceRefresh({
        reason: "local_state_changed",
        scheduleReason: "daemon_route_catalog_changed",
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.route_catalog_changed",
        text: `route catalog changed; sync scheduled (${payload.success ? payload.data.reason : "unknown"})`,
      });
      return;
    }
    if (handleServiceControlFrame(parsedFrame)) {
      return;
    }
    if (parsedFrame.code === "daemon.local_agent_control.refresh_catalog") {
      handleLocalAgentControlRefreshCatalogFrame(parsedFrame.payload).catch(
        (error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.local_agent_control_failed",
            text: `local agent control failed: ${toErrorMessage(error)}`,
          });
        }
      );
      return;
    }
    if (handleProfileWorkspaceControlFrame(parsedFrame)) {
      return;
    }
    const handledCurrentComputerControl =
      handleSessionHistorySocketFrame({ ...input, frame: parsedFrame }) ||
      handleLocalFolderPickerSocketFrame({
        deviceId: input.deviceId,
        frame: parsedFrame,
        presenter: input.presenter,
        selectLocalFolders: input.selectLocalFolders,
        socket: input.socket,
      }) ||
      handleLocalProjectControlSocketFrame({
        deviceId: input.deviceId,
        frame: parsedFrame,
        ownerUserId: input.ownerUserId,
        onLocalProjectConnectionsChanged: () => {
          requestLocalExecutionEvidenceRefresh({
            reason: "local_state_changed",
            scheduleReason: "local_project_connection_changed",
          });
          input.onLocalProjectConnectionsChanged?.();
        },
        presenter: input.presenter,
        socket: input.socket,
      }) ||
      handleComputerFileAccessSocketFrame({
        computerFileAccessStorePath: input.computerFileAccessStorePath,
        deviceId: input.deviceId,
        frame: parsedFrame,
        presenter: input.presenter,
        socket: input.socket,
      });
    if (handledCurrentComputerControl) {
      return;
    }
    observeDispatchFrame({
      onDispatchActivity: () => {
        lastDispatchActivityAtMs = Date.now();
        updateHeartbeatInterval({
          nextIntervalMs: MIN_HEARTBEAT_INTERVAL_MS,
          reason: "dispatch_activity",
        });
        scheduleHeartbeat({
          delayMs: MIN_HEARTBEAT_INTERVAL_MS,
          reason: "dispatch_activity",
        });
      },
      parsedFrame,
      presenter: input.presenter,
    });
    if (
      !handleDaemonTransportFrame({
        frame: parsedFrame,
        presenter: input.presenter,
        waiters,
      })
    ) {
      hostLink.forward(parsedFrame);
    }
  };
  input.socket.onMessage((raw) => {
    if (!closed) {
      handleMessage(raw);
    }
  });

  const registerResponse = await registerDaemonSession(
    createRouteCatalogFromMutableState(input.routeCatalogState)
  );
  applyAcceptedLeases({
    acceptedLeases: registerResponse.acceptedLeases,
    leasesByProfileId,
  });
  activeConnectionGeneration = registerResponse.connectionGeneration;
  configureHostConnection().catch(reportHostFailure);
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.registered",
    text: `registered daemon session; accepted leases=${registerResponse.acceptedLeases.length}, rejected=${registerResponse.rejectedProfiles.length}`,
    payload: {
      ...registerResponse,
      daemonSessionId: input.daemonSessionId,
      reconnectAttempt: input.reconnectAttempt,
    },
  });
  if (input.reconnectAttempt > 0) {
    const reconcileDecision = resolveRouteRegistrationReconcileDecision({
      driftDetected: true,
      foregroundActive: input.foregroundActive,
    });
    emitReconcileCompletedEvidence({
      action: reconcileDecision.action,
      acceptedLeaseCount: registerResponse.acceptedLeases.length,
      daemonSessionId: input.daemonSessionId,
      driftClass: reconcileDecision.driftClass,
      foregroundActive: reconcileDecision.foregroundActive,
      lifecycleLocked: reconcileDecision.lifecycleLocked,
      owner: reconcileDecision.owner,
      reconnectAttempt: input.reconnectAttempt,
      rejectedProfileCount: registerResponse.rejectedProfiles.length,
      skipReason: reconcileDecision.skipReason,
    });
  }
  if (registerResponse.rejectedProfiles.length > 0) {
    requestLocalExecutionEvidenceRefresh({
      reason: "register_conflict",
      scheduleReason: "register_conflict",
    });
  }
  const bootstrap = await completeRegisteredSessionBootstrap({
    heartbeatIntervalMs: currentHeartbeatIntervalMs,
    isRouteCatalogResolved: input.isRouteCatalogResolved?.() ?? true,
    persistAcceptedRouteCatalogCache,
    registerRejected: registerResponse.rejectedProfiles.length > 0,
    scheduleCatalogSyncNext,
    shutdownRequested: input.shutdownRequested,
    transportEnded: transportEnded.promise,
  });
  const bootstrapShutdownStopCause = bootstrap.shutdownStopCause;
  if (!bootstrapShutdownStopCause) {
    latestCatalogSyncSignalMarker = resolveCatalogSyncSignalMarker(
      bootstrap.initialCatalogSyncSignal
    );
    scheduleCatalogSyncSignalPoll();
    await sendHeartbeat();
  }
  // A resumed stop still needs transport failure detection while work drains.
  keepalive.start();

  async function finishControlledShutdown(
    stopCause: RuntimeTransportStopCause
  ): Promise<boolean> {
    acceptingDispatches = false;
    shutdownStopCause = stopCause;
    const priorAdmissionEvidence = hostLink.admissionEvidence();
    shutdownAdmissionEvidence = {
      acceptingDispatches: false,
      connectionGeneration: activeConnectionGeneration,
      revision: (priorAdmissionEvidence?.revision ?? 0) + 1,
      changedAtMs: Date.now(),
      reasonCode: "controlled_stop",
      detailCode: stopCause,
    };
    await input.executionHost
      .call("beginDrain", {})
      .catch(input.failHostShutdown);
    clearHeartbeatTimer();
    clearRuntimeAgentControllerReportSyncTimer();
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.controlled_shutdown_started",
      text: "Controlled shutdown was admitted; waiting for the active heartbeat to settle.",
    });
    await waitForHeartbeatIdle();
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.controlled_shutdown_inflight_heartbeat_completed",
      text: "Controlled shutdown finished waiting for the active heartbeat.",
    });
    let finalHeartbeatError: unknown;
    try {
      await sendHeartbeat({ requireAcknowledgement: true });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.controlled_shutdown_final_heartbeat_completed",
        text: "Controlled shutdown completed its final heartbeat.",
      });
    } catch (error) {
      // Failure to publish a stop must not interrupt already accepted work.
      // Preserve the failed acknowledgement until the existing drain finishes.
      finalHeartbeatError = error;
    }
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.controlled_shutdown_draining",
      text: "Waiting for accepted local work to finish in the execution host.",
    });
    // The Host owns accepted work across connections. Do not let its wait for
    // a cloud reply decision prevent this connector from reconnecting. Racing
    // here also prevents an abandoned session from later settling/closing a
    // replacement connection when that same Host finishes its work.
    await Promise.race([
      input.drainExecutionHost(),
      transportEnded.promise.then((error) => {
        throw error;
      }),
    ]);
    const result = await input.executionHost
      .call("settleResults", {})
      .catch(input.failHostShutdown);
    if (finalHeartbeatError) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.controlled_shutdown_offline_unconfirmed",
        text: "Local work drained. The cloud did not confirm the final offline update.",
        payload: { errorMessage: toErrorMessage(finalHeartbeatError) },
      });
    }
    if (result.status === "connection_closed") {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.controlled_shutdown_results_preserved",
        text: "Local work drained. Pending results remain on disk for the next Service start.",
      });
    }
    if (result.status === "timeout") {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.controlled_shutdown_result_ack_timeout",
        text: "Controlled shutdown preserved unacknowledged durable results for replay after the receipt deadline.",
      });
    }
    if (!closed) {
      input.socket.close(1000, "shutdown");
      if (
        !(await waitForPromiseDeadline({
          operation: waitForClose,
          timeoutMs: CONTROLLED_SHUTDOWN_SOCKET_CLOSE_TIMEOUT_MS,
        }))
      ) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.controlled_shutdown_socket_close_timeout",
          text: "Controlled shutdown terminated a half-open transport after the close deadline.",
          payload: {
            reasonCode: "socket_close_timeout",
            timeoutMs: CONTROLLED_SHUTDOWN_SOCKET_CLOSE_TIMEOUT_MS,
          },
        });
        input.socket.terminate();
      }
    }
    return true;
  }

  const sessionExit = bootstrapShutdownStopCause
    ? ({
        kind: "shutdown_requested" as const,
        stopCause: bootstrapShutdownStopCause,
      } as const)
    : await Promise.race([
        transportEnded.promise.then((error) => ({
          kind: "transport_ended" as const,
          error,
        })),
        input.shutdownRequested?.then((stopCause) => ({
          kind: "shutdown_requested" as const,
          stopCause,
        })) ?? new Promise<never>(() => undefined),
      ]);
  try {
    if (sessionExit.kind === "shutdown_requested" && !closed) {
      controlledShutdownCompleted = await finishControlledShutdown(
        sessionExit.stopCause
      );
    }
  } catch (error) {
    if (!closed) {
      input.socket.terminate();
    }
    throw error;
  } finally {
    hostLink.detach().catch(reportHostFailure);
    input.attachRouteCatalogSyncInvoker?.(null);
    clearHeartbeatTimer();
    clearRuntimeAgentControllerReportSyncTimer();
    keepalive.stop();
    clearCatalogSyncSignalTimer();
  }
  const shouldDrainBeforeExit =
    controlledShutdownCompleted ||
    (closeCode === 1000 && closeReason === "shutdown");
  if (shouldDrainBeforeExit) {
    return;
  }
  if (sessionExit.kind === "transport_ended") {
    throw sessionExit.error;
  }
  throw new DaemonServiceRunError({
    code: "daemon.run.socket_closed",
    message: `daemon stream closed (code=${String(closeCode)}, reason=${closeReason})`,
  });
}

async function withDaemonRunTimeout<T>(input: {
  code: string;
  message: string;
  operation: Promise<T>;
  timeoutMs: number;
}): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      input.operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new DaemonServiceRunError({
              code: input.code,
              message: input.message,
            })
          );
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function completeRegisteredSessionBootstrap(input: {
  heartbeatIntervalMs: number;
  isRouteCatalogResolved: boolean;
  persistAcceptedRouteCatalogCache: () => Promise<void>;
  registerRejected: boolean;
  scheduleCatalogSyncNext: (delayMs: number) => void;
  shutdownRequested?: Promise<RuntimeTransportStopCause>;
  transportEnded: Promise<DaemonServiceRunError>;
}): Promise<{
  initialCatalogSyncSignal: DaemonCatalogSyncSignal | null;
  shutdownStopCause: RuntimeTransportStopCause | null;
}> {
  if (!input.registerRejected) {
    const bootstrapPlan = resolveBootstrapCatalogSyncPlan({
      isRouteCatalogResolved: input.isRouteCatalogResolved,
      syncIntervalMs: resolveCatalogSyncIntervalMs({
        heartbeatIntervalMs: input.heartbeatIntervalMs,
      }),
    });
    if (bootstrapPlan.persistCache) {
      const persistence = await awaitOperationOrSessionExit({
        operation: input.persistAcceptedRouteCatalogCache(),
        shutdownRequested: input.shutdownRequested,
        transportEnded: input.transportEnded,
      });
      if (persistence.kind === "shutdown_requested") {
        return {
          initialCatalogSyncSignal: null,
          shutdownStopCause: persistence.stopCause,
        };
      }
    }
    input.scheduleCatalogSyncNext(bootstrapPlan.nextSyncDelayMs);
  }

  const catalogSignal = await awaitOperationOrSessionExit({
    operation: readDaemonCatalogSyncSignal().catch(() => null),
    shutdownRequested: input.shutdownRequested,
    transportEnded: input.transportEnded,
  });
  if (catalogSignal.kind === "shutdown_requested") {
    return {
      initialCatalogSyncSignal: null,
      shutdownStopCause: catalogSignal.stopCause,
    };
  }
  return {
    initialCatalogSyncSignal: catalogSignal.value,
    shutdownStopCause: null,
  };
}

async function awaitOperationOrSessionExit<T>(input: {
  operation: Promise<T>;
  shutdownRequested?: Promise<RuntimeTransportStopCause>;
  transportEnded: Promise<DaemonServiceRunError>;
}): Promise<
  | { kind: "completed"; value: T }
  | { kind: "shutdown_requested"; stopCause: RuntimeTransportStopCause }
> {
  return await Promise.race([
    input.operation.then((value) => ({ kind: "completed" as const, value })),
    input.transportEnded.then((error) => {
      throw error;
    }),
    input.shutdownRequested?.then((stopCause) => ({
      kind: "shutdown_requested" as const,
      stopCause,
    })) ?? new Promise<never>(() => undefined),
  ]);
}

async function waitForPromiseDeadline(input: {
  operation: Promise<unknown>;
  timeoutMs: number;
}): Promise<boolean> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      input.operation.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), input.timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function observeDispatchFrame(input: {
  onDispatchActivity: () => void;
  parsedFrame: ParsedDaemonFrame;
  presenter: Presenter;
}): void {
  switch (input.parsedFrame.code) {
    case "daemon.dispatch.deliver":
      observeDispatchDeliverFrame({
        onDispatchActivity: input.onDispatchActivity,
        parsedFrame: input.parsedFrame,
        presenter: input.presenter,
      });
      return;
    case "daemon.dispatch.accepted":
      observeDispatchAcceptedFrame(input.parsedFrame, input.presenter);
      return;
    default:
      return;
  }
}

function observeDispatchDeliverFrame(input: {
  onDispatchActivity: () => void;
  parsedFrame: ParsedDaemonFrame;
  presenter: Presenter;
}): void {
  input.onDispatchActivity();
  const payload = input.parsedFrame.payload;
  const dispatchId = normalizeFrameString(payload.dispatchId) ?? "unknown";
  emitDaemonDispatchJournalEvent({
    attemptId: normalizeFrameString(payload.attemptId),
    connectionGeneration: normalizeFrameInteger(payload.connectionGeneration),
    daemonSessionId: normalizeFrameString(payload.daemonSessionId),
    dispatchId,
    leaseEpoch: normalizeFrameInteger(payload.leaseEpoch),
    metadata: {
      deliveryRecoveryReason: payload.deliveryRecoveryReason ?? null,
    },
    profileId: normalizeFrameString(payload.profileId),
    result: "received",
    taskId: resolveDeliveredTaskId(payload.payload),
    type: "dispatch.deliver.received",
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.deliver_frame_received",
    text: `daemon deliver frame received for dispatch ${dispatchId}`,
    payload: {
      attemptId: payload.attemptId ?? null,
      connectionGeneration: payload.connectionGeneration ?? null,
      dispatchId: payload.dispatchId ?? null,
      leaseEpoch: payload.leaseEpoch ?? null,
      profileId: payload.profileId ?? null,
    },
  });
}

function observeDispatchAcceptedFrame(
  parsedFrame: ParsedDaemonFrame,
  presenter: Presenter
): void {
  const dispatchId =
    normalizeFrameString(parsedFrame.payload.dispatchId) ?? "unknown";
  const accepted = parsedFrame.payload.ok === true;
  emitDaemonDispatchJournalEvent({
    attemptId: normalizeFrameString(parsedFrame.payload.attemptId),
    dispatchId,
    metadata: {
      ok: parsedFrame.payload.ok ?? null,
      reasonCode: parsedFrame.payload.reasonCode ?? null,
      status: parsedFrame.payload.status ?? null,
    },
    result: accepted ? "accepted" : "rejected",
    type: "dispatch.result.accepted",
  });
  emitRunLine({
    presenter,
    code: "daemon.run.result_accepted",
    text: `daemon result frame accepted for dispatch ${dispatchId}`,
    payload: {
      attemptId: parsedFrame.payload.attemptId ?? null,
      dispatchId: parsedFrame.payload.dispatchId ?? null,
      ok: parsedFrame.payload.ok ?? null,
      reasonCode: parsedFrame.payload.reasonCode ?? null,
      status: parsedFrame.payload.status ?? null,
    },
  });
}

function resolveDeliveredTaskId(payload: unknown): string | null {
  if (!(payload && typeof payload === "object" && "taskId" in payload)) {
    return null;
  }
  const taskId = payload.taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : null;
}

function normalizeFrameString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeFrameInteger(value: unknown): number | null {
  if (!(typeof value === "number" && Number.isInteger(value))) {
    return null;
  }
  return value;
}

function resolveProfileWorkspaceControlErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const codedError = error as Error & { code?: unknown };
    if (typeof codedError.code === "string") {
      return codedError.code;
    }
  }
  return "profile.workspace.update_failed";
}

import { sessionHistoryRequestFrameSchema } from "@openmeld/schemas";
import { handleSessionHistoryFrame } from "../session-history/session-history-handler";
