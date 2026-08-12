import {
  ADAPTIVE_HEARTBEAT_JITTER_RATIO,
  applyAcceptedLeases,
  applyIntervalJitterMs,
  createLocalExecutionSlots,
  type InflightTaskControlRegistry,
  type LocalDaemonAdapterContainer,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  type PendingAgentInteractionRegistry,
  pruneStaleLeases,
  resolveAdaptiveHeartbeatIntervalMs,
  resolveCatalogSyncIntervalMs,
  resolveCatalogSyncSkippedProfilesLogState,
  resolveRouteRegistrationReconcileDecision,
} from "@openmeld/local-service";
import {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
  computerFileAccessDaemonFrameSchema,
  localFolderPickerDaemonFrameSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportHeartbeatRequestSchema,
  runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema,
  runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema,
  runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema,
  runtimeTransportRegisterSessionRequestSchema,
  runtimeTransportResumeControllerConversationFramePayloadSchema,
  runtimeTransportResumeControllerConversationResultFramePayloadSchema,
  runtimeTransportRouteCatalogChangedFramePayloadSchema,
} from "@openmeld/schemas";
import type {
  LocalComponentsStatus,
  OpenMeldDaemonSetLocalAgentEnabledPayload,
  OpenMeldDaemonSetProfileWorkspacePayload,
  OpenMeldDaemonSyncRouteCatalogPayload,
  RuntimeTransportLease,
  RuntimeTransportRegisterSessionResponse,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import { setAgentRegistrationEnabled } from "../../agents/registry";
import { resolveLocalComponentsStatus } from "../../local-components/manifest";
import {
  ensureOpenMeldManagedProfileWorkspace,
  setCustomProfileWorkspace,
} from "../../profile-workspace/service";
import type { Presenter } from "../../runtime/presenter/types";
import type { WsClient } from "../../transport/ws";
import { resolveDaemonCapabilities } from "../adapters/resolve-daemon-capabilities";
import {
  CATALOG_SYNC_RETRY_INTERVAL_MS,
  CATALOG_SYNC_SIGNAL_POLL_INTERVAL_MS,
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
} from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonDispatchLimits,
  InflightDispatchMeta,
  LedgerPaths,
  MutableRouteCatalogState,
  ParsedDaemonFrame,
  PendingFrameWaiters,
  RouteCatalog,
  RouteCatalogSyncResult,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import { emitReconcileCompletedEvidence } from "../diagnostics/service-evidence-trace";
import { emitDaemonDispatchJournalEvent } from "../dispatch/daemon-dispatch-journal";
import {
  flushDispatchResultOutbox,
  listDispatchResultOutboxPendingAcknowledgementKeys,
  waitForDispatchResultOutboxAcknowledgement,
} from "../dispatch/dispatch-result-outbox";
import { sendDispatchInteractionRequestFrame } from "../dispatch/send-dispatch-result";
import { resumeExactControllerConversation } from "../execution-recovery/resume-controller-conversation";
import { runResumeControllerConversationOperation } from "../execution-recovery/resume-controller-conversation-operation-store";
import { handleComputerFileAccessFrame } from "../file-access/computer-file-access-handler";
import {
  handleLocalFolderPickerFrame,
  type SelectLocalFolders,
} from "../folder-picker/local-folder-picker-handler";
import {
  consumeArmedAgentControllerInterfaceReprobe,
  resolveNextRuntimeAgentControllerReportSyncAtMs,
} from "../inventory/agent-controller-interface-keeper";
import { resolveCurrentDaemonExpectedVersion } from "../lifecycle/current-daemon-version";
import { handleLocalProjectControlFrame } from "../projects/local-project-control-handler";
import { syncLocalServiceProviderConversationProofs } from "../reporting/provider-conversation-proof-sync";
import {
  type LocalServiceRuntimeAgentControllerReportSyncResult,
  syncLocalServiceRuntimeAgentControllerReports,
} from "../reporting/runtime-agent-controller-report-sync";
import { createRuntimeReportingAttemptObserver } from "../reporting/runtime-reporting-attempt-observer";
import type { RuntimeReportingAuthenticationFailure } from "../reporting/runtime-reporting-auth-recovery";
import {
  createRouteCatalogFromMutableState,
  loadDaemonRouteCatalog,
  summarizeSkippedDaemonProfiles,
  syncDaemonRouteCatalogState,
} from "../routing/route-catalog";
import { readDaemonCatalogSyncSignal } from "../state/catalog-sync-signal";
import { createDaemonStreamKeepalive } from "./daemon-stream-keepalive";
import {
  handleDaemonSocketFrame,
  parseDaemonFrame,
  sendDaemonFrame,
} from "./frame-router";
import { waitForHeartbeatResponse } from "./heartbeat-loop";
import { waitForRegisterResponse } from "./register-session";

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

function replayStartupResultsBeforeDispatchAdmission(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  ledgerPaths: LedgerPaths;
  onAdmissionOpen: (replayedResultCount: number) => void;
  presenter: Presenter;
  shouldOpenAdmission: () => boolean;
  waitForClose: Promise<void>;
}): boolean {
  const recordKeys = listDispatchResultOutboxPendingAcknowledgementKeys({
    ledgerPaths: input.ledgerPaths,
  });
  const abortController = new AbortController();
  input.waitForClose.then(() => {
    abortController.abort();
  });
  const replayCompleted = waitForDispatchResultOutboxAcknowledgement({
    abortSignal: abortController.signal,
    ledgerPaths: input.ledgerPaths,
    recordKeys,
  });
  flushDispatchResultOutbox({
    currentSocketRef: input.currentSocketRef,
    ledgerPaths: input.ledgerPaths,
    presenter: input.presenter,
  });
  if (recordKeys.length === 0) {
    return true;
  }
  replayCompleted.then(() => {
    if (input.shouldOpenAdmission()) {
      input.onAdmissionOpen(recordKeys.length);
    }
  });
  return false;
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
  presenter: Presenter;
  socket: WsClient;
}): boolean {
  if (!input.frame.code.startsWith("daemon.local_project_control.")) {
    return false;
  }
  handleLocalProjectControlFrame({
    deviceId: input.deviceId,
    frame: input.frame,
  })
    .then((resultFrame) => input.socket.send(JSON.stringify(resultFrame)))
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
  computerFileAccessStorePath: string;
  contextStore: Map<string, string>;
  currentSocketRef?: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchLimits: DaemonDispatchLimits;
  deviceId: string;
  serviceContractGeneration?: number;
  foregroundActive: boolean;
  heartbeatIntervalMs: number;
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  // Boot-time placeholder support: while the route catalog is unresolved the
  // session registers the placeholder (lease-neutral on a fresh session),
  // skips cache persistence, and schedules an immediate catalog sync instead
  // of waiting a full interval.
  isRouteCatalogResolved?: () => boolean;
  ledgerPaths: LedgerPaths;
  loadRouteCatalog?: () => Promise<RouteCatalog>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  lane: string;
  ownerUserId: string;
  onRuntimeReportingAuthenticationFailure?: (
    failure: RuntimeReportingAuthenticationFailure
  ) => Promise<void> | void;
  profileOwnerName: string | null;
  presenter: Presenter;
  persistRouteCatalogCache?: (catalog: RouteCatalog) => Promise<void>;
  reconnectAttempt: number;
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
  const currentSocketRef = input.currentSocketRef ?? {
    connectionGeneration: null,
    socket: input.socket,
  };
  const { pendingAgentInteractionRegistry } = input;
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
  const heartbeatIdleWaiters: Array<() => void> = [];
  // A replacement session must replay every durable result that survived the
  // previous process before it can accept new work. The existing heartbeat
  // admission bit doubles as that startup fence without adding a second source
  // of session readiness.
  let acceptingDispatches = false;
  let shutdownStopCause: RuntimeTransportStopCause | null = null;
  let controlledShutdownCompleted = false;
  let routeCatalogSyncInFlight = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatTimerDueAtMs: number | null = null;
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
      input.socket.terminate();
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
  let currentHeartbeatIntervalMs = normalizeHeartbeatIntervalMs(
    input.heartbeatIntervalMs
  );
  let activeConnectionGeneration = Math.max(1, input.reconnectAttempt + 1);
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
  let latestCatalogSyncSignalUpdatedAtMs = 0;
  let forceCatalogSyncReason: CatalogSyncForceReason | null = null;
  let pendingLocalExecutionEvidenceRefreshReason: CatalogSyncForceReason | null =
    null;
  const pendingRouteCatalogSyncRequests: PendingRouteCatalogSyncRequest[] = [];
  const observeRuntimeReportingAttempt = createRuntimeReportingAttemptObserver({
    onAuthenticationFailure: input.onRuntimeReportingAuthenticationFailure,
    serviceIdentity: {
      contractGeneration: input.serviceContractGeneration ?? 0,
      deviceId: input.deviceId,
    },
  });
  const localExecutionSlots = createLocalExecutionSlots({
    limits: input.dispatchLimits,
    onTaskDropped: (event) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_dropped",
        text: `local execution slot dropped pending task ${event.taskId} for ${event.targetLabel}: ${event.reason}`,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          reason: event.reason,
          spaceId: event.spaceId,
          step: "dropped",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
    onTaskStarted: (event) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_reserved",
        text: `local execution slot reserved task ${event.taskId} for ${event.targetLabel}`,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          durationMs: null,
          errorCode: null,
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          result: null,
          spaceId: event.spaceId,
          step: "started",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
    onTaskCompleted: (event) => {
      let completionText = `local execution slot failed task ${event.taskId} for ${event.targetLabel}`;
      if (event.result === "success") {
        completionText = `local execution slot completed task ${event.taskId} for ${event.targetLabel}`;
      } else if (event.result === "partial_success") {
        completionText = `local execution slot partially completed task ${event.taskId} for ${event.targetLabel}`;
      }
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_completed",
        text: completionText,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          result: event.result,
          spaceId: event.spaceId,
          step: "completed",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
  });

  const waitForClose = new Promise<void>((resolve) => {
    input.socket.onClose((code, reason) => {
      closed = true;
      closeCode = code;
      closeReason = normalizeText(reason) || "closed";
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
          inflightDispatchCount: input.inflightDispatchMetaByTaskId.size,
          socketConnectedAtMs,
          socketDisconnectedAtMs: closedAtMs,
        },
      });
      const closeError = new DaemonServiceRunError({
        code: "daemon.run.socket_closed",
        message: `daemon stream closed (code=${String(closeCode)}, reason=${closeReason})`,
      });
      waiters.registerRejecter?.(closeError);
      waiters.heartbeatRejecter?.(closeError);
      failPendingRouteCatalogSyncRequests(closeError);
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
    if (heartbeatInFlight || routeCatalogSyncInFlight) {
      pendingLocalExecutionEvidenceRefreshReason = inputRequest.reason;
    }
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
    if (closed || !pendingRefreshReason) {
      return;
    }

    pendingLocalExecutionEvidenceRefreshReason = null;
    forceCatalogSyncReason = pendingRefreshReason;
    nextCatalogSyncAtMs = 0;
    nextProviderConversationProofSyncAtMs = 0;
    nextRuntimeAgentControllerReportSyncAtMs = 0;
    forceFreshAgentControllerProbes = true;
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

  function replayPendingAgentInteractions(
    reason: "heartbeat" | "reconnect"
  ): void {
    for (const pendingInteraction of pendingAgentInteractionRegistry.list()) {
      if (pendingInteraction.response) {
        continue;
      }
      const leaseEpoch = leasesByProfileId.get(
        pendingInteraction.authority.targetProfileId
      );
      if (!leaseEpoch) {
        continue;
      }
      sendDispatchInteractionRequestFrame({
        attemptId: pendingInteraction.authority.attemptId,
        connectionGeneration: activeConnectionGeneration,
        daemonSessionId: input.daemonSessionId,
        dispatchId: pendingInteraction.authority.dispatchId,
        executionIdentityEcho:
          pendingInteraction.authority.executionIdentityEcho,
        executionTokenEcho: pendingInteraction.authority.executionTokenEcho,
        interaction: pendingInteraction.request,
        leaseEpoch,
        runtimeCoordinatorExecutionId:
          pendingInteraction.authority.runtimeCoordinatorExecutionId,
        socket: input.socket,
        taskId: pendingInteraction.taskId,
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.interaction_replayed",
        text:
          reason === "reconnect"
            ? "replayed a pending local agent interaction after reconnect"
            : "replayed a pending local agent interaction after heartbeat",
        payload: {
          interactionId: pendingInteraction.request.interactionId,
          interactionKind: pendingInteraction.request.kind,
          reason,
          taskId: pendingInteraction.taskId,
        },
      });
    }
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
    if (hadDispatchActivity || input.inflightDispatchMetaByTaskId.size > 0) {
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

  async function sendHeartbeat(): Promise<void> {
    if (closed || heartbeatInFlight) {
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
      const localComponentsStatus = await resolveSessionLocalComponentsStatus();
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
          serviceVersion,
          leases,
          runtimeContract: {
            epoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
          },
          capabilities: resolveDaemonCapabilities({
            localAdapterContainer: input.localAdapterContainer,
            localComponentsStatus,
            profileConfigurationRevision:
              resolveProfileConfigurationRevisions(input.routeCatalogState) !==
              null,
          }),
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
      replayPendingAgentInteractions("heartbeat");
      consecutiveHeartbeatFailures = 0;
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths: input.ledgerPaths,
        presenter: input.presenter,
      });
      const heartbeatSchedule = resolveSuccessfulHeartbeatSchedule();
      const nextIntervalWithoutJitter = resolveAdaptiveHeartbeatIntervalMs({
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
      if (recordHeartbeatFailure(error)) {
        input.socket.terminate();
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
    } finally {
      heartbeatInFlight = false;
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
      sendHeartbeat().catch((error) => {
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
    if (signal.updatedAtMs <= latestCatalogSyncSignalUpdatedAtMs) {
      return;
    }
    latestCatalogSyncSignalUpdatedAtMs = signal.updatedAtMs;
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
  const serviceVersion = resolveCurrentDaemonExpectedVersion();

  const resolveProfileConfigurationRevisions = (routeCatalog: RouteCatalog) => {
    if (routeCatalog.profileIds.length === 0) {
      return null;
    }
    const revisions = routeCatalog.profileIds.map((profileId) => {
      const configurationRevision =
        routeCatalog.routeByProfileId.get(profileId)?.configurationRevision ??
        null;
      const bindingId =
        routeCatalog.routeByProfileId.get(profileId)?.bindingId ?? null;
      return configurationRevision === null || bindingId === null
        ? null
        : { bindingId, configurationRevision, profileId };
    });
    return revisions.every(
      (
        revision
      ): revision is {
        bindingId: string;
        configurationRevision: number;
        profileId: string;
      } => revision !== null
    )
      ? revisions
      : null;
  };

  const createLocalWakeRouteReport = (routeCatalog: RouteCatalog) => {
    const profileConfigurationRevisions =
      resolveProfileConfigurationRevisions(routeCatalog);
    return {
      reportedAtMs: Date.now(),
      daemonSessionId: input.daemonSessionId,
      deviceId: input.deviceId,
      lane: input.lane,
      serviceVersion,
      includedProfileIds: [...routeCatalog.profileIds],
      ...(profileConfigurationRevisions
        ? { profileConfigurationRevisions }
        : {}),
      skippedProfiles: [...routeCatalog.skippedProfiles],
    };
  };

  const resolveSessionLocalComponentsStatus =
    async (): Promise<LocalComponentsStatus | null> => {
      try {
        return await resolveLocalComponentsStatus();
      } catch (error) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.local_components_status_failed",
          text: `local components status unavailable: ${toErrorMessage(error)}`,
        });
        return null;
      }
    };

  const registerDaemonSession = async (
    routeCatalog: RouteCatalog
  ): Promise<RuntimeTransportRegisterSessionResponse> => {
    const connectionGeneration = Math.max(1, input.reconnectAttempt + 1);
    const localComponentsStatus = await resolveSessionLocalComponentsStatus();
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
        localWakeRouteReport: createLocalWakeRouteReport(routeCatalog),
        capabilities: resolveDaemonCapabilities({
          localAdapterContainer: input.localAdapterContainer,
          localComponentsStatus,
          profileConfigurationRevision:
            resolveProfileConfigurationRevisions(routeCatalog) !== null,
        }),
        runtimeContract: {
          epoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        },
        connectedAtMs: Date.now(),
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

    return await waitForRegisterResponse({
      timeoutMs: REGISTER_RESPONSE_TIMEOUT_MS,
      waiters,
    });
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
      loadCatalog: async () =>
        input.loadRouteCatalog
          ? await input.loadRouteCatalog()
          : await loadDaemonRouteCatalog({
              localAdapterContainer: input.localAdapterContainer,
              localReplyStateMode: "check",
              ownerUserId: input.ownerUserId,
              presenter: input.presenter,
              allowEmpty: true,
              quiet: true,
            }),
      registerCatalog: registerDaemonSession,
    });

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
    try {
      const result = await syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: input.localAdapterContainer,
        onAttempt: observeRuntimeReportingAttempt,
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
          baseRetryMs: retryInMs,
          hasArmedReprobe: consumeArmedAgentControllerInterfaceReprobe(),
        });
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
      const result = await syncLocalServiceProviderConversationProofs({
        onAttempt: observeRuntimeReportingAttempt,
        routeCatalog: createRouteCatalogFromMutableState(
          input.routeCatalogState
        ),
      });
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

  const handleLocalAgentControlSetEnabledFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_frame_invalid",
        text: "ignored invalid local agent control frame",
      });
      return;
    }

    const responsePayload = await applyLocalAgentControlSetEnabled({
      enabled: parsed.data.payload.enabled,
      agentId: parsed.data.payload.agentId,
    });
    sendDaemonFrame(input.socket, {
      code: "daemon.local_agent_control.result",
      payload: {
        requestId: parsed.data.requestId,
        payload: responsePayload,
      },
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

  const handleResumeControllerConversationFrame = async (
    payload: Record<string, unknown>
  ): Promise<void> => {
    const parsed =
      runtimeTransportResumeControllerConversationFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.execution_recovery_frame_invalid",
        text: "ignored invalid execution recovery frame",
      });
      return;
    }
    const result = await runResumeControllerConversationOperation({
      execute: () =>
        resumeExactControllerConversation({
          computerFileAccessStorePath: input.computerFileAccessStorePath,
          localAdapterContainer: input.localAdapterContainer,
          request: parsed.data,
          routeConfig:
            input.routeCatalogState.routeByProfileId.get(
              parsed.data.identity.targetProfileId
            ) ?? null,
        }),
      ledgerRootPath: input.ledgerPaths.rootDirPath,
      request: parsed.data,
    });
    const resultFrame =
      runtimeTransportResumeControllerConversationResultFramePayloadSchema.parse(
        {
          requestId: parsed.data.requestId,
          result,
        }
      );
    sendDaemonFrame(input.socket, {
      code: "daemon.execution_recovery.resume_controller_conversation_result",
      payload: resultFrame,
    });
  };

  const applyLocalAgentControlSetEnabled = async (controlInput: {
    agentId: string;
    enabled: boolean;
  }): Promise<OpenMeldDaemonSetLocalAgentEnabledPayload> => {
    try {
      const result = await setAgentRegistrationEnabled(controlInput);
      let reportSyncStatus: OpenMeldDaemonSetLocalAgentEnabledPayload["reportSyncStatus"] =
        "failed";
      try {
        const reportSync = await requestFreshRuntimeAgentControllerReportSync();
        reportSyncStatus = reportSync.status;
      } catch (error) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.local_agent_control_report_sync_failed",
          text: `runtime agent controller report sync failed after local agent control: ${toErrorMessage(error)}`,
        });
      }
      if (result.changed) {
        requestLocalExecutionEvidenceRefresh({
          reason: "local_state_changed",
          scheduleReason: "local_agent_control_set_enabled",
        });
      }
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_set_enabled",
        text: `${result.displayName} is ${result.enabled ? "enabled" : "disabled"}.`,
        payload: {
          agentControllerRef: result.agentControllerRef,
          agentId: result.agentId,
          changed: result.changed,
          enabled: result.enabled,
          reportSyncStatus,
        },
      });
      return {
        accepted: true,
        agentControllerRef: result.agentControllerRef,
        agentId: result.agentId,
        changed: result.changed,
        enabled: result.enabled,
        reportSyncStatus,
        status: result.status,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      const reasonCode = resolveLocalAgentEnabledErrorCode(error);
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_control_set_enabled_rejected",
        text: `local agent control rejected: ${message}`,
        payload: {
          agentId: controlInput.agentId,
          enabled: controlInput.enabled,
          reasonCode,
        },
      });
      return {
        accepted: false,
        agentId: controlInput.agentId,
        changed: false,
        enabled: controlInput.enabled,
        message,
        reasonCode,
        reportSyncStatus: "failed",
        status: "rejected",
      };
    }
  };

  const applyLocalAgentControlSetProfileWorkspace = async (controlInput: {
    targetProfileId: string;
    workspaceMode: "custom" | "openmeld_managed";
    workspacePath?: string;
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
  });

  input.socket.onMessage((raw) => {
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
    if (parsedFrame.code === "daemon.local_agent_control.set_enabled") {
      handleLocalAgentControlSetEnabledFrame(parsedFrame.payload).catch(
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
    if (
      parsedFrame.code === "daemon.local_agent_control.set_profile_workspace"
    ) {
      handleLocalAgentControlSetProfileWorkspaceFrame(
        parsedFrame.payload
      ).catch((error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.local_agent_control_failed",
          text: `local agent control failed: ${toErrorMessage(error)}`,
        });
      });
      return;
    }
    if (
      parsedFrame.code ===
      "daemon.execution_recovery.resume_controller_conversation"
    ) {
      handleResumeControllerConversationFrame(parsedFrame.payload).catch(
        (error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.execution_recovery_failed",
            text: `execution recovery failed: ${toErrorMessage(error)}`,
          });
        }
      );
      return;
    }
    const handledCurrentComputerControl =
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
    handleDaemonSocketFrame({
      computerFileAccessStorePath: input.computerFileAccessStorePath,
      contextStore: input.contextStore,
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      localExecutionSlots,
      inflightDispatchMetaByTaskId: input.inflightDispatchMetaByTaskId,
      inflightTaskControlRegistry: input.inflightTaskControlRegistry,
      pendingAgentInteractionRegistry,
      ledgerPaths: input.ledgerPaths,
      leasesByProfileId,
      localAdapterContainer: input.localAdapterContainer,
      parsedFrame,
      profileOwnerName: input.profileOwnerName,
      profileOwnerUserId: input.ownerUserId,
      presenter: input.presenter,
      routeByProfileId: input.routeCatalogState.routeByProfileId,
      socket: input.socket,
      waiters,
    });
  });

  const registerResponse = await registerDaemonSession(
    createRouteCatalogFromMutableState(input.routeCatalogState)
  );
  applyAcceptedLeases({
    acceptedLeases: registerResponse.acceptedLeases,
    leasesByProfileId,
  });
  activeConnectionGeneration = registerResponse.connectionGeneration;
  currentSocketRef.socket = input.socket;
  currentSocketRef.connectionGeneration = activeConnectionGeneration;
  replayPendingAgentInteractions("reconnect");
  acceptingDispatches = replayStartupResultsBeforeDispatchAdmission({
    currentSocketRef,
    ledgerPaths: input.ledgerPaths,
    onAdmissionOpen: (replayedResultCount) => {
      acceptingDispatches = true;
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.startup_result_replay_completed",
        text: "durable local results were replayed before dispatch admission opened",
        payload: {
          daemonSessionId: input.daemonSessionId,
          replayedResultCount,
        },
      });
      scheduleHeartbeat({
        delayMs: 0,
        reason: "startup_result_replay_completed",
      });
    },
    presenter: input.presenter,
    shouldOpenAdmission: () => !(closed || shutdownStopCause),
    waitForClose,
  });
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
  } else {
    const bootstrapPlan = resolveBootstrapCatalogSyncPlan({
      isRouteCatalogResolved: input.isRouteCatalogResolved?.() ?? true,
      syncIntervalMs: resolveCatalogSyncIntervalMs({
        heartbeatIntervalMs: currentHeartbeatIntervalMs,
      }),
    });
    if (bootstrapPlan.persistCache) {
      await persistAcceptedRouteCatalogCache();
    }
    scheduleCatalogSyncNext(bootstrapPlan.nextSyncDelayMs);
  }
  latestCatalogSyncSignalUpdatedAtMs =
    (await readDaemonCatalogSyncSignal().catch(() => null))?.updatedAtMs ?? 0;
  scheduleCatalogSyncSignalPoll();

  await sendHeartbeat();
  keepalive.start();

  async function finishControlledShutdown(
    stopCause: RuntimeTransportStopCause
  ): Promise<boolean> {
    localExecutionSlots.beginDrain();
    acceptingDispatches = false;
    shutdownStopCause = stopCause;
    clearHeartbeatTimer();
    await waitForHeartbeatIdle();
    await sendHeartbeat();
    const drainState = localExecutionSlots.getDrainState();
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.controlled_shutdown_draining",
      text: "controlled shutdown is waiting for accepted local agent work to finish",
      payload: {
        activeDispatches: drainState.activeGlobal,
        daemonSessionId: input.daemonSessionId,
        pendingDispatches: drainState.pendingCount,
        stopCause: shutdownStopCause,
      },
    });
    await localExecutionSlots.drain();
    flushDispatchResultOutbox({
      currentSocketRef,
      ledgerPaths: input.ledgerPaths,
      presenter: input.presenter,
    });
    if (!closed) {
      const acknowledgementAbortController = new AbortController();
      waitForClose.then(() => acknowledgementAbortController.abort());
      const acknowledgement = await waitForDispatchResultOutboxAcknowledgement({
        abortSignal: acknowledgementAbortController.signal,
        ledgerPaths: input.ledgerPaths,
        recordKeys: listDispatchResultOutboxPendingAcknowledgementKeys({
          ledgerPaths: input.ledgerPaths,
        }),
      });
      if (acknowledgement === "aborted") {
        return false;
      }
    }
    if (!closed) {
      input.socket.close(1000, "shutdown");
      await waitForClose;
    }
    return true;
  }

  const sessionExit = await Promise.race([
    waitForClose.then(() => ({ kind: "socket_closed" as const })),
    input.shutdownRequested?.then((stopCause) => ({
      kind: "shutdown_requested" as const,
      stopCause,
    })) ?? new Promise<never>(() => undefined),
  ]);
  if (sessionExit.kind === "shutdown_requested" && !closed) {
    controlledShutdownCompleted = await finishControlledShutdown(
      sessionExit.stopCause
    );
  }
  if (currentSocketRef.socket === input.socket) {
    currentSocketRef.socket = null;
    currentSocketRef.connectionGeneration = null;
  }
  input.attachRouteCatalogSyncInvoker?.(null);
  clearHeartbeatTimer();
  keepalive.stop();
  clearCatalogSyncSignalTimer();
  const shouldDrainBeforeExit =
    controlledShutdownCompleted ||
    (closeCode === 1000 && closeReason === "shutdown");
  if (shouldDrainBeforeExit) {
    localExecutionSlots.beginDrain();
    await localExecutionSlots.drain();
  } else {
    const droppedPending = localExecutionSlots.dropPendingTasks({
      reason: "daemon.session.unexpected_close",
    });
    const drainState = localExecutionSlots.getDrainState();
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.socket_drain_skipped",
      text: "skipping dispatch drain after unexpected socket close; reconnect may continue while old tasks settle",
      payload: {
        activeDispatches: drainState.activeGlobal,
        closeCode,
        closeReason,
        daemonSessionId: input.daemonSessionId,
        inflightDispatchCount: input.inflightDispatchMetaByTaskId.size,
        pendingDispatchesDropped: droppedPending.droppedCount,
        pendingDispatches: drainState.pendingCount,
      },
    });
  }

  if (shouldDrainBeforeExit) {
    return;
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

function resolveLocalAgentEnabledErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "agents.unexpected_error";
  }
  const [code] = error.message.split(":", 1);
  const normalized = code?.trim();
  return normalized?.includes(".") ? normalized : "agents.unexpected_error";
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
