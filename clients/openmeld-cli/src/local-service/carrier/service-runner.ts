import { randomUUID } from "node:crypto";
import {
  applyIntervalJitterMs as applyIntervalJitterMsInternal,
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createLocalAdapterEntries,
  createLocalTaskInterruptSender,
  createPendingAgentInteractionRegistry,
  type LocalDaemonAdapterContainer,
  resolveAdaptiveHeartbeatIntervalMs as resolveAdaptiveHeartbeatIntervalMsInternal,
  resolveCatalogSyncIntervalMs as resolveCatalogSyncIntervalMsInternal,
  resolveRouteRegistrationReconcileDecision,
} from "@openmeld/local-service";
import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonControlPlaneResponse,
  OpenMeldDaemonSetLocalAgentEnabledRequestPayload,
  OpenMeldDaemonSyncRouteCatalogRequestPayload,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import {
  createManagedAgentActivityIntegrationRefreshScheduler,
  refreshManagedAgentActivityIntegrations,
} from "../../agent-activity/integration-refresh";
import { startLocalAgentActivitySyncLoop } from "../../agent-activity/local-sync";
import { setAgentRegistrationEnabled } from "../../agents/registry";
import {
  type AuthSessionState,
  getAuthSessionState,
  type StoredAuthSession,
  withAdmittedServiceSession,
} from "../../config/auth-session";
import { resolveBaseUrl } from "../../config/base-url";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import {
  clearDaemonServiceRuntimeState,
  daemonRuntimeRootPath,
  ensureDaemonControlPlaneToken,
  resolveDaemonServiceRuntimeMetadata,
} from "../../config/daemon-state";
import {
  AuthRequestCredentialError,
  type AuthRequestCredentialFailureReason,
  buildOpenMeldProfileRequestHeadersWithAuth,
  buildRequestAuthHeaders,
} from "../../config/request-headers";
import {
  requireOpenMeldProfile,
  resolveOpenMeldProfileOrNull,
} from "../../config/resolve-openmeld-profile";
import { getConfiguredDaemonDispatchLimits } from "../../config/runtime-config";
import type { Presenter } from "../../runtime/presenter";
import type { WsClient } from "../../transport/ws";
import { connectWebSocket } from "../../transport/ws";
import { resolveLocalConversationExecutionStatus } from "../control-plane/conversation-execution-status";
import { startLocalDaemonControlPlaneServer } from "../control-plane/server";
import { DAEMON_STREAM_CONNECT_TIMEOUT_MS } from "../core/constants";
import {
  emitRunLine,
  normalizeHeartbeatIntervalMs,
  normalizeOptionalText,
  normalizeText,
  nowIsoString,
  toErrorMessage,
  warnDaemonEvent,
} from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonServiceRunInput,
  InflightDispatchMeta,
  MutableRouteCatalogState,
  RouteCatalog,
  RouteCatalogSyncResult,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import {
  emitDriftDetectedEvidence,
  emitReconcileStartedEvidence,
} from "../diagnostics/service-evidence-trace";
import { listDispatchResultOutboxPendingAcknowledgementKeys } from "../dispatch/dispatch-result-outbox";
import {
  buildDispatchBootstrapTemplateFacts as buildDispatchBootstrapTemplateFactsInternal,
  buildDispatchPromptPlan as buildDispatchPromptPlanInternal,
  buildDispatchPromptWithBootstrap as buildDispatchPromptWithBootstrapInternal,
} from "../dispatch/parse-dispatch-task";
import { resolveComputerFileAccessStorePath } from "../file-access/computer-file-access-store";
import { resolveSystemLocalFolderPickerHelper } from "../folder-picker/local-folder-picker-helper-process";
import { createLocalFolderPickerService } from "../folder-picker/local-folder-picker-service";
import {
  emitDaemonLifecycleEvent,
  resolveRecentDaemonSignalStopCause,
} from "../lifecycle/daemon-lifecycle-journal";
import { assertDaemonServiceLaunchScope } from "../lifecycle/daemon-service-launch-scope";
import {
  journalDaemonStopSignalEvidence,
  startDaemonServiceRegistrationReconcileLoop,
} from "../lifecycle/daemon-service-registration-reconcile";
import { admitServiceAccountStop } from "../lifecycle/service-account-authorization";
import { createOpenMeldToolsUpdateCoordinator } from "../maintenance/openmeld-tools-update-coordinator";
import { syncLocalServiceRuntimeAgentControllerReports } from "../reporting/runtime-agent-controller-report-sync";
import type { RuntimeReportingAttemptObserver } from "../reporting/runtime-agent-controller-reporting-submission";
import { createRuntimeReportingAttemptObserver } from "../reporting/runtime-reporting-attempt-observer";
import type { RuntimeReportingAuthenticationFailure } from "../reporting/runtime-reporting-auth-recovery";
import { createRuntimeReportingAuthenticationRecovery } from "../reporting/runtime-reporting-auth-recovery";
import {
  createMutableRouteCatalogState as createMutableRouteCatalogStateInternal,
  loadDaemonRouteCatalog,
  type RouteCatalogLoadPhaseTimings,
  summarizeSkippedDaemonProfiles,
  syncDaemonRouteCatalogState as syncDaemonRouteCatalogStateInternal,
} from "../routing/route-catalog";
import { loadContextStore } from "../state/context-store";
import {
  buildLedgerPaths,
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
} from "../state/daemon-device-id";
import {
  buildDaemonProcessCommand,
  createDaemonRuntimeState,
  resolveDaemonRunMode,
  resolveServiceConnectionReconnectBackoffMs,
  toDaemonStreamUrl,
} from "../state/daemon-runtime-state";
import {
  readDaemonRouteCatalogCache,
  writeDaemonRouteCatalogCache,
} from "../state/route-catalog-cache";
import { ensureDaemonRuntimeContractState } from "../state/runtime-contract-guard";
import {
  createDaemonRuntimeStateTracker,
  resolveDaemonRuntimeLeaseDescriptor,
} from "../state/runtime-state-tracker";
import {
  classifyConnectionFailureReason,
  createServiceConnectionStateTracker,
  type ServiceConnectionAuthState,
  type ServiceConnectionDegradedReason,
  toHealthProjection,
} from "../state/service-connection-state";
import {
  handleLocalControlPlaneCancel,
  handleLocalControlPlaneInterrupt,
} from "./local-control-handlers";
import { createDaemonLocalExecutionSlots } from "./local-execution-slots";
import { runDaemonSocketSession } from "./run-socket-session";
import { createStopAwareDelay } from "./stop-aware-delay";

export function buildDispatchPromptWithBootstrap(
  input: Parameters<typeof buildDispatchPromptWithBootstrapInternal>[0]
): string {
  return buildDispatchPromptWithBootstrapInternal(input);
}

export function buildDispatchPromptPlan(
  input: Parameters<typeof buildDispatchPromptPlanInternal>[0]
): ReturnType<typeof buildDispatchPromptPlanInternal> {
  return buildDispatchPromptPlanInternal(input);
}

export function buildDispatchBootstrapTemplateFacts(
  input: Parameters<typeof buildDispatchBootstrapTemplateFactsInternal>[0]
) {
  return buildDispatchBootstrapTemplateFactsInternal(input);
}

export function createMutableRouteCatalogState(
  routeCatalog: RouteCatalog
): MutableRouteCatalogState {
  return createMutableRouteCatalogStateInternal(routeCatalog);
}

function buildLocalServiceCapabilityHeaders(input: {
  localFolderPickerAvailable: boolean;
}): Record<string, string> {
  return {
    ...(input.localFolderPickerAvailable
      ? {
          [OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER]:
            LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
        }
      : {}),
    [OPENMELD_RUNTIME_CAPABILITIES_HEADER]:
      COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  };
}

// A stored session can be locally valid while its credentials are still not
// attachable to the gateway stream URL (for example authBaseUrl written by a
// different lane, so host compatibility fails). Dialing bare in that state is
// what produced the production 401 relaunch storm, so the connect path treats
// it as authentication_required and never sends the handshake.
type DaemonStreamCredentialFailure = {
  authHost: string | null;
  expectedGatewayHost: string | null;
  reason: AuthRequestCredentialFailureReason;
  requestHost: string | null;
  status: "dropped";
};

class DaemonStreamAuthenticationRequiredError extends Error {
  readonly authState: ServiceConnectionAuthState;
  readonly credentialFailure: DaemonStreamCredentialFailure | null;

  constructor(input: {
    authState: ServiceConnectionAuthState;
    credentialFailure?: DaemonStreamCredentialFailure;
  }) {
    super(
      input.credentialFailure
        ? `authentication required before connecting daemon stream (session=${input.authState}, credentials=${input.credentialFailure.reason}, requestHost=${input.credentialFailure.requestHost ?? "unknown"}, authHost=${input.credentialFailure.authHost ?? "unknown"}, expectedGatewayHost=${input.credentialFailure.expectedGatewayHost ?? "unknown"})`
        : `authentication required before connecting daemon stream (session=${input.authState})`
    );
    this.authState = input.authState;
    this.credentialFailure = input.credentialFailure ?? null;
    this.name = "DaemonStreamAuthenticationRequiredError";
  }
}

export async function syncDaemonRouteCatalogState(input: {
  catalogState: MutableRouteCatalogState;
  forceRegister?: boolean;
  leasesByProfileId: Map<string, number>;
  loadCatalog: () => Promise<RouteCatalog>;
  registerCatalog: (
    routeCatalog: RouteCatalog
  ) => Promise<
    import("@openmeld/schemas/types").RuntimeTransportRegisterSessionResponse
  >;
}): Promise<RouteCatalogSyncResult> {
  return await syncDaemonRouteCatalogStateInternal(input);
}

export function resolveAdaptiveHeartbeatIntervalMs(
  input: Parameters<typeof resolveAdaptiveHeartbeatIntervalMsInternal>[0]
): number {
  return resolveAdaptiveHeartbeatIntervalMsInternal(input);
}

export function applyIntervalJitterMs(
  input: Parameters<typeof applyIntervalJitterMsInternal>[0]
): number {
  return applyIntervalJitterMsInternal(input);
}

export function resolveCatalogSyncIntervalMs(
  input: Parameters<typeof resolveCatalogSyncIntervalMsInternal>[0]
): number {
  return resolveCatalogSyncIntervalMsInternal(input);
}

export async function resolveDaemonServiceOwnerContext(input: {
  openMeldProfileId?: string;
}): Promise<{
  ownerUserId: string;
  ownerName: string | null;
  openMeldProfile: Awaited<ReturnType<typeof requireOpenMeldProfile>> | null;
}> {
  const explicitOpenMeldProfileId = normalizeText(input.openMeldProfileId);
  if (explicitOpenMeldProfileId) {
    return resolveDaemonServiceOwnerContextFromProfile(
      await requireOpenMeldProfile({
        openMeldProfileId: explicitOpenMeldProfileId,
        persistSelection: false,
        authAction: "starting OpenMeld Service",
      }),
      "selected profile is missing owner user id"
    );
  }

  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => null);
  const authSession = authState?.session ?? null;
  const authOwnerUserId = normalizeText(authSession?.user?.id);
  if (authOwnerUserId) {
    return {
      ownerUserId: authOwnerUserId,
      ownerName: normalizeOptionalText(authSession?.user?.name),
      openMeldProfile: null,
    };
  }

  const fallbackProfile = await resolveOpenMeldProfileOrNull({
    allowDefaultFallback: true,
    allowUnauthenticated: false,
    persistSelection: false,
  }).catch(() => null);
  if (fallbackProfile) {
    return resolveDaemonServiceOwnerContextFromProfile(
      fallbackProfile,
      "resolved OpenMeld profile is missing owner user id"
    );
  }

  if (authState?.state !== "valid" || authSession === null) {
    console.warn("[openmeld.daemon.owner_auth_not_ready]", {
      error: authState?.errorMessage,
      reasonCode: authState?.reasonCode ?? "session_state_unavailable",
      state: authState?.state ?? "unavailable",
    });
    throw new DaemonServiceRunError({
      code: "daemon.run.auth_required",
      message: "authentication required before starting OpenMeld Service",
    });
  }

  throw new DaemonServiceRunError({
    code: "daemon.run.owner_missing",
    message:
      "authenticated session is missing user id and no OpenMeld profile could be resolved",
  });
}

export async function resolveDaemonStreamAuthContext(input: {
  requestUrl: string;
  selectedOpenMeldProfile: Awaited<
    ReturnType<typeof requireOpenMeldProfile>
  > | null;
}): Promise<
  | {
      authState: "valid";
      headers: Record<string, string>;
      status: "ready";
    }
  | {
      authState: Exclude<AuthSessionState, "valid">;
      credentialFailure?: DaemonStreamCredentialFailure;
      status: "authentication_required";
    }
> {
  let headers: Record<string, string>;
  try {
    headers = await buildDaemonStreamRequestHeaders({
      requestUrl: input.requestUrl,
      selectedOpenMeldProfile: input.selectedOpenMeldProfile,
    });
  } catch (error) {
    if (!(error instanceof AuthRequestCredentialError)) {
      throw error;
    }
    // Fail closed: a handshake that would go out without Authorization must
    // not be dialed at all. The session exists but is unusable for this
    // gateway, which the connection state machine models as "invalid".
    return {
      authState: resolveCredentialFailureAuthState(error.reason),
      credentialFailure: toDaemonStreamCredentialFailure(error),
      status: "authentication_required",
    };
  }
  if (!headers.Authorization) {
    return {
      authState: "missing",
      status: "authentication_required",
    };
  }

  return {
    authState: "valid",
    headers,
    status: "ready",
  };
}

function resolveCredentialFailureAuthState(
  reason: AuthRequestCredentialFailureReason
): Exclude<AuthSessionState, "valid"> {
  if (reason === "session_expired") {
    return "expired";
  }
  if (reason === "remote_session_revoked" || reason === "session_revoked") {
    return "revoked";
  }
  return "invalid";
}

function toDaemonStreamCredentialFailure(
  error: AuthRequestCredentialError
): DaemonStreamCredentialFailure {
  return {
    authHost: error.authHost,
    expectedGatewayHost: error.expectedGatewayHost,
    reason: error.reason,
    requestHost: error.requestHost,
    status: "dropped",
  };
}

async function buildDaemonStreamRequestHeaders(input: {
  authSession?: StoredAuthSession;
  requestUrl: string;
  selectedOpenMeldProfile: Awaited<
    ReturnType<typeof requireOpenMeldProfile>
  > | null;
}): Promise<Record<string, string>> {
  return input.selectedOpenMeldProfile
    ? await buildOpenMeldProfileRequestHeadersWithAuth({
        openMeldProfile: input.selectedOpenMeldProfile,
        ...(input.authSession ? { authSession: input.authSession } : {}),
        requestUrl: input.requestUrl,
      })
    : await buildRequestAuthHeaders({
        ...(input.authSession ? { authSession: input.authSession } : {}),
        requestUrl: input.requestUrl,
      });
}

export function createControlledShutdownCoordinator(input: {
  hasUndrainedWork: () => boolean;
  isStopRequested: () => boolean;
  markStopping: () => void;
}) {
  let activeSessionShutdownResolver:
    | ((stopCause: RuntimeTransportStopCause) => void)
    | null = null;
  let shutdownAttempt: PromiseWithResolvers<void> | null = null;

  const requestServiceStop = (
    stopCause: RuntimeTransportStopCause | Promise<RuntimeTransportStopCause>
  ): void => {
    if (input.isStopRequested()) {
      return;
    }
    input.markStopping();
    Promise.resolve(stopCause).then(
      (resolvedStopCause) => activeSessionShutdownResolver?.(resolvedStopCause),
      () => activeSessionShutdownResolver?.("unknown")
    );
  };

  return {
    attachSession(
      shutdownResolver: (stopCause: RuntimeTransportStopCause) => void
    ): void {
      activeSessionShutdownResolver = shutdownResolver;
    },
    detachSession(
      shutdownResolver: (stopCause: RuntimeTransportStopCause) => void
    ): void {
      if (activeSessionShutdownResolver === shutdownResolver) {
        activeSessionShutdownResolver = null;
      }
    },
    failOutstanding(): void {
      shutdownAttempt?.reject(
        new DaemonServiceRunError({
          code: "daemon.control.shutdown_drain_failed",
          message:
            "controlled shutdown ended before the runtime session drained",
        })
      );
    },
    handleSessionCompleted(): void {
      if (!shutdownAttempt) {
        return;
      }
      requestServiceStop("controlled_service_update");
      shutdownAttempt.resolve();
    },
    handleSessionFailure(error: unknown): void {
      shutdownAttempt?.reject(error);
    },
    requestServiceStop,
    async request(payload: {
      gracePeriodMs: number;
      mode: "force" | "graceful";
      onAdmission?: (commit: () => void) => Promise<void>;
    }): Promise<{
      accepted: true;
      gracePeriodMs: number;
      mode: "force" | "graceful";
    }> {
      const stopCause = await resolveRecentDaemonSignalStopCause();
      if (shutdownAttempt) {
        const existingAttempt = shutdownAttempt;
        await payload.onAdmission?.(() => undefined);
        await existingAttempt.promise;
      } else if (activeSessionShutdownResolver) {
        const currentAttempt = Promise.withResolvers<void>();
        const resolver = activeSessionShutdownResolver;
        const commit = () => {
          if (shutdownAttempt || activeSessionShutdownResolver !== resolver) {
            throw new Error("Service session changed before Stop admission.");
          }
          shutdownAttempt = currentAttempt;
          resolver(stopCause);
        };
        if (payload.onAdmission) {
          await payload.onAdmission(commit);
        } else {
          commit();
        }
        try {
          await currentAttempt.promise;
        } finally {
          if (shutdownAttempt === currentAttempt) {
            shutdownAttempt = null;
          }
        }
      } else {
        if (input.hasUndrainedWork()) {
          throw new DaemonServiceRunError({
            code: "daemon.control.shutdown_drain_unavailable",
            message:
              "controlled shutdown cannot verify active local work without a connected runtime session",
          });
        }
        const commit = () => {
          if (activeSessionShutdownResolver || input.hasUndrainedWork()) {
            throw new Error("Service work changed before Stop admission.");
          }
          requestServiceStop(stopCause);
        };
        if (payload.onAdmission) {
          await payload.onAdmission(commit);
        } else {
          commit();
        }
      }
      return {
        accepted: true,
        gracePeriodMs: payload.gracePeriodMs,
        mode: payload.mode,
      };
    },
  };
}

function hasUndrainedLocalWork(input: {
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  ledgerPaths: ReturnType<typeof buildLedgerPaths>;
}): boolean {
  return (
    input.inflightDispatchMetaByTaskId.size > 0 ||
    listDispatchResultOutboxPendingAcknowledgementKeys({
      ledgerPaths: input.ledgerPaths,
    }).length > 0
  );
}

async function runSocketSessionWithControlledShutdown(input: {
  controlledShutdown: ReturnType<typeof createControlledShutdownCoordinator>;
  sessionInput: Parameters<typeof runDaemonSocketSession>[0];
}): Promise<void> {
  const sessionShutdown = Promise.withResolvers<RuntimeTransportStopCause>();
  input.controlledShutdown.attachSession(sessionShutdown.resolve);
  try {
    await runDaemonSocketSession({
      ...input.sessionInput,
      shutdownRequested: sessionShutdown.promise,
    });
  } catch (error) {
    input.controlledShutdown.handleSessionFailure(error);
    throw error;
  } finally {
    input.controlledShutdown.detachSession(sessionShutdown.resolve);
  }
  input.controlledShutdown.handleSessionCompleted();
}

export const runDaemonServiceLoop = async (
  input: DaemonServiceRunInput
): Promise<void> => {
  const auth = await getAuthSessionState({ refreshExpired: true });
  if (auth.state !== "valid" || !auth.session?.user?.id) {
    throw new Error("A valid CLI account is required to start this Service.");
  }
  return await withAdmittedServiceSession(
    auth.session,
    async () => await runAccountBoundDaemonServiceLoop(input)
  );
};

const runAccountBoundDaemonServiceLoop = async (
  input: DaemonServiceRunInput
): Promise<void> => {
  await assertDaemonServiceLaunchScope();
  // OPENMELD_SERVICE_THIN_CORE: local-worker-carrier entrypoint.
  // This loop owns local service identity, adapter inventory, socket lifetime,
  // heartbeat, and delivery to local runtimes. It must not become a product
  // readiness, Space truth, Binding truth, or final Wake outcome owner.
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const ownerContext = await resolveDaemonServiceOwnerContext({
    openMeldProfileId: input.profile,
  });
  const selectedOpenMeldProfile = ownerContext.openMeldProfile;
  const ownerUserId = ownerContext.ownerUserId;

  const runtimePaths = await ensureDaemonRuntimePaths();
  const runtimeContractGuardResult = await ensureDaemonRuntimeContractState({
    runtimePaths,
  });
  if (runtimeContractGuardResult.action === "repair_applied") {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_state_repaired",
      text:
        "OpenMeld fixed a local runtime mismatch automatically.\n" +
        "Your account, profiles, and spaces were not changed.\n" +
        "No action needed.",
      payload: {
        reason: runtimeContractGuardResult.reason,
        report: runtimeContractGuardResult.report,
      },
    });
  }
  const contextStore = await loadContextStore(runtimePaths.contextStorePath);
  const inflightDispatchMetaByTaskId = new Map<string, InflightDispatchMeta>();
  const inflightTaskControlRegistry = createInflightTaskControlRegistry();
  const pendingAgentInteractionRegistry =
    createPendingAgentInteractionRegistry();
  const localTaskInterruptSender = createLocalTaskInterruptSender({
    registry: inflightTaskControlRegistry,
  });
  const deviceId = await resolveDaemonDeviceId({
    deviceId: input.deviceId,
    deviceIdPath: runtimePaths.deviceIdPath,
  });
  const localFolderPicker = createLocalFolderPickerService({
    deviceId,
    runHelper: resolveSystemLocalFolderPickerHelper(),
  });
  const daemonServiceContract = await readDaemonServiceContract().catch(
    () => null
  );
  const lane = resolveDaemonServiceLane(daemonServiceContract);
  const daemonSessionId = randomUUID();
  const heartbeatIntervalMs = normalizeHeartbeatIntervalMs(
    input.heartbeatIntervalMs
  );
  const dispatchLimits = await getConfiguredDaemonDispatchLimits();
  // A WebSocket is replaceable transport. Active controller ownership is a
  // process-lifetime invariant and must survive that transport reconnect.
  const localExecutionSlots = createDaemonLocalExecutionSlots({
    limits: dispatchLimits,
    presenter: input.presenter,
  });
  const ledgerPaths = buildLedgerPaths(runtimePaths.ledgerRootPath);
  const mode = resolveDaemonRunMode(input.mode);
  const now = nowIsoString();
  const runtimeMetadata = resolveDaemonServiceRuntimeMetadata();
  const profileOwnerName = ownerContext.ownerName;
  const daemonRuntimeState = createDaemonRuntimeState({
    heartbeatAt: null,
    mode,
    gatewayUrl: baseUrl,
    pid: process.pid,
    openMeldProfileId: normalizeText(
      selectedOpenMeldProfile?.openMeldProfileId
    ),
    workingDirectory: process.cwd(),
    startedAt: now,
    updatedAt: now,
    command: buildDaemonProcessCommand(),
    stopRequestedAt: null,
    runtimeMetadata,
  });
  const runtimeLeaseDescriptor = await resolveDaemonRuntimeLeaseDescriptor({
    command: daemonRuntimeState.command,
  });
  const runtimeStateTracker = createDaemonRuntimeStateTracker({
    initialState: daemonRuntimeState,
    leaseDescriptor: runtimeLeaseDescriptor,
  });
  // Correlation only: the existing connection tracker and retry counter still
  // own connection facts and policy. No recovery intent is persisted here.
  let recovery: { recoveryId: string; disconnectedAt: number } | null = null;
  const recoveryMetadata = () => ({
    ...describeConnectionRecovery(recovery),
    attempt: reconnectAttempt,
  });
  const connectionState = createRunLoopConnectionStateTracker(
    input.presenter,
    recoveryMetadata
  );

  const localAdapterContainer = createLocalAdapterContainer(
    createLocalAdapterEntries({
      registerRuntimeProcess: (event) => {
        const nextProcessId =
          event.phase === "process_exit" ? null : event.processId;
        const updatedRecord = inflightTaskControlRegistry.updateTaskProcess({
          processId: nextProcessId,
          signalTarget:
            event.phase === "process_exit" ? null : event.signalTarget,
          taskId: event.taskId,
        });
        if (!updatedRecord) {
          return;
        }
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.control_process_registered",
          text: `control process ${event.phase === "process_spawned" ? "registered" : "cleared"} for task ${event.taskId}`,
          payload: {
            adapterId: updatedRecord.adapterId,
            dispatchId: updatedRecord.dispatchId,
            phase: event.phase,
            processId: nextProcessId,
            signalTarget:
              event.phase === "process_exit" ? null : event.signalTarget,
            taskId: event.taskId,
          },
        });
      },
      runtimeWorkdir: process.cwd(),
      sendInterrupt: async (signal) => {
        await localTaskInterruptSender(signal);
      },
    })
  );
  if (localAdapterContainer.listAdapters().length === 0) {
    throw new DaemonServiceRunError({
      code: "daemon.run.adapter_missing",
      message: "no local adapters configured for daemon runtime",
    });
  }

  const serviceBundleId = daemonServiceContract?.bundleId ?? null;
  // The account-wide route catalog scan must not gate local service liveness.
  // Boot with an unresolved placeholder so the control plane, runtime state,
  // and socket session come up immediately; the first in-session catalog sync
  // resolves the real catalog and registers it (pending -> registered is the
  // documented Wake route registration shape). The placeholder may register
  // an empty profile set on this fresh daemon session, which is lease-neutral
  // on RuntimeTransport; only a RESOLVED catalog may shrink the registered set.
  const routeCatalogState = createMutableRouteCatalogStateInternal({
    profileIds: [],
    routeByProfileId: new Map(),
    skippedProfiles: [],
  });
  const routeCatalogLoader = createRouteCatalogSyncLoader({
    loadFresh: () =>
      loadFreshDaemonRouteCatalog({
        localAdapterContainer,
        ownerUserId,
        presenter: input.presenter,
      }),
    loadInitial: async () =>
      await loadInitialDaemonRouteCatalog({
        allowEmpty: true,
        lane,
        localAdapterContainer,
        ownerUserId,
        presenter: input.presenter,
        serviceBundleId,
      }),
  });

  let stopRequested = false;
  // Reconnect backoff waits must wake the moment a stop request arrives, or
  // the loop sleeps through the entire backoff tier (up to 15 minutes on the
  // auth_rejected ladder) before it can observe `stopRequested`.
  const reconnectBackoffDelay = createStopAwareDelay();
  let reconnectAttempt = 0;
  let activeSocket: WsClient | null = null;
  const recoverRuntimeReportingAuthentication =
    createRuntimeReportingAuthenticationRecovery({
      requestCarrierHandshake: () => {
        activeSocket?.close(1012, "runtime_reporting_auth_recovery");
      },
    });
  const requestRuntimeReportingAuthenticationRecovery = async (input: {
    expectedSocket: WsClient | null;
    failure: RuntimeReportingAuthenticationFailure;
  }): Promise<void> => {
    if (!input.expectedSocket || activeSocket !== input.expectedSocket) {
      warnDaemonEvent("[openmeld.runtime_reporting.auth_recovery_ignored]", {
        event: "cli.runtime_reporting.auth_recovery_ignored",
        reason: input.expectedSocket ? "stale_socket" : "socket_unavailable",
        reasonCode: input.failure.reasonCode,
      });
      return;
    }
    const recovery = await recoverRuntimeReportingAuthentication(input.failure);
    warnDaemonEvent("[openmeld.runtime_reporting.auth_recovery]", {
      event: "cli.runtime_reporting.auth_recovery",
      reasonCode: input.failure.reasonCode,
      ...(recovery.status === "debounced"
        ? { retryAfterMs: recovery.retryAfterMs }
        : {}),
      status: recovery.status,
    });
  };
  const currentSocketRef: CurrentDaemonSocketRef = {
    connectionGeneration: null,
    socket: null,
  };
  let requestActiveRouteCatalogSync:
    | ((reason: string) => Promise<RouteCatalogSyncResult>)
    | null = null;
  const controlledShutdown = createControlledShutdownCoordinator({
    hasUndrainedWork: () =>
      hasUndrainedLocalWork({
        inflightDispatchMetaByTaskId,
        ledgerPaths,
      }),
    isStopRequested: () => stopRequested,
    markStopping: () => {
      stopRequested = true;
      connectionState.set("stopping");
      reconnectBackoffDelay.interrupt();
    },
  });
  const controlPlaneDaemonVersion =
    daemonServiceContract?.daemonVersion ?? "unknown";
  let requestAgentActivitySync: (() => void) | null = null;
  const controlPlaneServer = await startLocalDaemonControlPlaneServer({
    // Resolve the current file-backed token per request. Older CLIs may rotate
    // that file before stopping this Service, so caching it here would make the
    // running Service reject every later control request until it restarts.
    resolveExpectedToken: async () => await ensureDaemonControlPlaneToken(),
    getContext: async () => ({
      healthPayload: {
        checkedAt: nowIsoString(),
        ...toHealthProjection(
          stopRequested
            ? { ...connectionState.get(), state: "stopping" }
            : connectionState.get()
        ),
      },
      historyEntries: [],
      interruptHandler: async (payload) =>
        await handleLocalControlPlaneInterrupt({
          localAdapterContainer,
          payload,
          presenter: input.presenter,
          registry: inflightTaskControlRegistry,
        }),
      cancelHandler: async (payload) =>
        await handleLocalControlPlaneCancel({
          localAdapterContainer,
          payload,
          presenter: input.presenter,
          registry: inflightTaskControlRegistry,
        }),
      conversationExecutionStatusHandler: async (payload) =>
        await resolveLocalConversationExecutionStatus(payload),
      requestAgentActivitySyncHandler: () => {
        if (!requestAgentActivitySync) {
          return { accepted: false };
        }
        requestAgentActivitySync();
        return { accepted: true };
      },
      syncRouteCatalogHandler: async (payload) =>
        await handleLocalControlPlaneRouteCatalogSync({
          payload,
          presenter: input.presenter,
          requestActiveRouteCatalogSync,
          routeCatalogState,
        }),
      setLocalAgentEnabledHandler: async (payload) => {
        const expectedSocket = activeSocket;
        const onAttempt = createRuntimeReportingAttemptObserver({
          onAuthenticationFailure: async (failure) => {
            await requestRuntimeReportingAuthenticationRecovery({
              expectedSocket,
              failure,
            });
          },
          serviceIdentity: {
            contractGeneration: daemonServiceContract?.generation ?? 0,
            deviceId,
          },
        });
        return await handleLocalControlPlaneSetLocalAgentEnabled({
          localAdapterContainer,
          onAttempt,
          payload,
          presenter: input.presenter,
          requestActiveRouteCatalogSync,
        });
      },
      shutdownHandler: async (payload) => {
        const admissionId = payload.accountAdmissionId;
        return await controlledShutdown.request({
          ...payload,
          ...(admissionId
            ? {
                onAdmission: async (commit: () => void) =>
                  await admitServiceAccountStop({
                    id: admissionId,
                    ownerUserId,
                    deviceId,
                    contractGeneration: daemonServiceContract?.generation ?? 0,
                    commit,
                  }),
              }
            : {}),
        });
      },
      serviceUpdateReadinessHandler: () => {
        const unacknowledgedResultCount =
          listDispatchResultOutboxPendingAcknowledgementKeys({
            ledgerPaths,
          }).length;
        const acceptedWakeCount = inflightDispatchMetaByTaskId.size;
        return {
          acceptedWakeCount,
          safeToSwitch: !hasUndrainedLocalWork({
            inflightDispatchMetaByTaskId,
            ledgerPaths,
          }),
          unacknowledgedResultCount,
        };
      },
      statusPayload: {
        checkedAt: nowIsoString(),
        daemonVersion: controlPlaneDaemonVersion,
        installed: true,
        running: !stopRequested,
        runtimeRoot: daemonRuntimeRootPath(),
      },
    }),
  });
  try {
    await runtimeStateTracker.touchRuntimeState({}, { forcePersist: true });
  } catch (error) {
    await controlPlaneServer.close();
    throw error;
  }

  const journalStopSignalEvidence = (signal: "SIGINT" | "SIGTERM"): void => {
    journalDaemonStopSignalEvidence(signal, {
      onWarn: (message, payload) => {
        warnDaemonEvent("[openmeld.service_registration.stop_signal]", {
          event: "cli.service_registration.stop_signal_warning",
          message,
          ...payload,
        });
      },
    });
  };
  const onSigint = () => {
    journalStopSignalEvidence("SIGINT");
    controlledShutdown.requestServiceStop("user_stop");
  };
  const onSigterm = () => {
    journalStopSignalEvidence("SIGTERM");
    controlledShutdown.requestServiceStop(resolveRecentDaemonSignalStopCause());
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  await refreshManagedAgentActivityIntegrations()
    .then((result) => {
      if (result.status !== "ready") {
        return;
      }
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_activity_integrations_ready",
        text: "Managed Agent integrations are ready.",
        payload: result.integrations,
      });
    })
    .catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_activity_integration_refresh_failed",
        text: `Managed Agent integration refresh failed: ${toErrorMessage(error)}`,
      });
    });

  const stopRegistrationReconcile = startDaemonServiceRegistrationReconcileLoop(
    {
      isStopRequested: () => stopRequested,
      onWarn: (message, payload) => {
        warnDaemonEvent("[openmeld.service_registration.reconcile]", {
          event: "cli.service_registration.reconcile_warning",
          message,
          ...payload,
        });
      },
    }
  );
  const openMeldToolsUpdateCoordinator = createOpenMeldToolsUpdateCoordinator(
    {
      reportBackgroundError: (error) => {
        warnDaemonEvent("[openmeld.tools.update_failed]", {
          event: "cli.openmeld_tools.update_failed",
          errorMessage: toErrorMessage(error),
        });
      },
    },
    { executeUpdates: false }
  );

  const agentActivitySync = startLocalAgentActivitySyncLoop({
    onError: (error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_activity_sync_failed",
        text: `Agent Activity sync failed: ${toErrorMessage(error)}`,
      });
    },
    onResult: (result) => {
      if (result.status === "idle") {
        return;
      }
      emitRunLine({
        presenter: input.presenter,
        code:
          result.status === "submitted"
            ? "daemon.run.agent_activity_sync"
            : "daemon.run.agent_activity_sync_unavailable",
        text:
          result.status === "submitted"
            ? `Local Agent reporting submitted ${String(result.submittedCount)} activity event(s), ${String(result.controllerTaskEventSubmittedCount)} task callback event(s), and ${String(result.sessionInventory.submittedSourceCount)} Session Inventory source(s).`
            : `Agent Activity sync deferred: ${result.reason ?? "unavailable"}.`,
        payload: {
          ...result.health,
          controllerTaskEventSubmittedCount:
            result.controllerTaskEventSubmittedCount,
          controllerTaskHealth: result.controllerTaskHealth,
          observedCount: result.observedCount,
          reason: result.reason,
          sessionInventory: result.sessionInventory,
          status: result.status,
          submittedCount: result.submittedCount,
        },
      });
    },
  });
  requestAgentActivitySync = () => {
    agentActivitySync.requestSync({
      reconcile: true,
      refreshContext: true,
    });
  };
  const agentActivityIntegrationRefresh =
    createManagedAgentActivityIntegrationRefreshScheduler({
      onError: (error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_activity_integration_refresh_failed",
          text: `Managed Agent integration refresh failed: ${toErrorMessage(error)}`,
        });
      },
      onResult: (result) => {
        if (result.status !== "ready") {
          return;
        }
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_activity_integrations_ready",
          text: "Managed Agent integrations are ready.",
          payload: result.integrations,
        });
      },
    });
  const refreshAgentActivityForProjectConnectionChange = () => {
    agentActivitySync.requestSync({
      reconcile: true,
      refreshContext: true,
    });
    agentActivityIntegrationRefresh.request();
  };

  try {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.start",
      text: `starting local service loop (gateway=${baseUrl}, owner=${ownerUserId}, profiles=resolving)`,
      payload: {
        adapterId: null,
        baseUrl,
        daemonSessionId,
        deviceId,
        dispatchLimits,
        dispatchId: null,
        durationMs: null,
        errorCode: null,
        heartbeatIntervalMs,
        localAdapterIds: localAdapterContainer
          .listAdapters()
          .map((entry) => entry.adapterId),
        ownerUserId,
        profileId: null,
        profileIds: routeCatalogState.profileIds,
        result: "started",
        routeCatalogResolved: routeCatalogLoader.isResolved(),
        step: "run.start",
        taskId: null,
        transportMode: null,
      },
    });
    // Waiting-for-profiles messaging now belongs to the in-session catalog
    // sync handlers: at this point the catalog is an unresolved placeholder,
    // so an empty profile list here says nothing about eligibility yet.

    while (!stopRequested) {
      try {
        connectionState.set("connecting", {
          reason: resolveConnectingReason(reconnectAttempt),
        });
        const wsUrl = toDaemonStreamUrl(baseUrl);
        const authContext = await resolveDaemonStreamAuthContext({
          requestUrl: wsUrl,
          selectedOpenMeldProfile,
        });
        if (authContext.status === "authentication_required") {
          throwDaemonStreamAuthenticationRequired({
            authState: authContext.authState,
            connectionState,
            credentialFailure: authContext.credentialFailure ?? null,
          });
        }
        const ws = await connectWebSocket(wsUrl, {
          headers: {
            ...authContext.headers,
            ...buildLocalServiceCapabilityHeaders({
              localFolderPickerAvailable: localFolderPicker.available,
            }),
          },
          openTimeoutMs: DAEMON_STREAM_CONNECT_TIMEOUT_MS,
        });
        if (stopRequested) {
          // A stop that lands while the handshake is in flight cannot reach
          // this socket through the stop coordinator (activeSocket is still
          // null), so
          // close it here instead of starting a session that outlives the
          // stop request.
          ws.close(1000, "shutdown");
          break;
        }
        activeSocket = ws;

        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.connected",
          text: `daemon stream connected (${wsUrl})`,
        });

        await runSocketSessionWithControlledShutdown({
          controlledShutdown,
          sessionInput: {
            attachRouteCatalogSyncInvoker: (invoker) => {
              requestActiveRouteCatalogSync = invoker;
            },
            contextStore,
            computerFileAccessStorePath: resolveComputerFileAccessStorePath(
              runtimePaths.dataRootPath
            ),
            currentSocketRef,
            daemonSessionId,
            deviceId,
            serviceContractGeneration: daemonServiceContract?.generation ?? 0,
            foregroundActive: mode === "foreground",
            heartbeatIntervalMs,
            inflightDispatchMetaByTaskId,
            inflightTaskControlRegistry,
            pendingAgentInteractionRegistry,
            isRouteCatalogResolved: routeCatalogLoader.isResolved,
            lane,
            ledgerPaths,
            loadRouteCatalog: routeCatalogLoader.load,
            localAdapterContainer,
            localExecutionSlots,
            onRuntimeReportingAuthenticationFailure: async (failure) => {
              await requestRuntimeReportingAuthenticationRecovery({
                expectedSocket: ws,
                failure,
              });
            },
            onAgentActivitySessionsChanged: requestAgentActivitySync,
            onLocalProjectConnectionsChanged:
              refreshAgentActivityForProjectConnectionChange,
            openMeldToolsUpdateCoordinator,
            ownerUserId,
            profileOwnerName,
            presenter: input.presenter,
            persistRouteCatalogCache: async (catalog) => {
              await persistDaemonRouteCatalogCache({
                lane,
                ownerUserId,
                presenter: input.presenter,
                routeCatalog: catalog,
                serviceBundleId,
              });
            },
            reconnectAttempt,
            routeCatalogState,
            selectLocalFolders: localFolderPicker.selectFolders,
            socket: ws,
            touchRuntimeState: async (updates) => {
              if (typeof updates.heartbeatAt === "string") {
                connectionState.set("online");
                reconnectAttempt = 0;
                recovery = null;
              }
              await runtimeStateTracker.touchRuntimeState(updates);
            },
          },
        });

        activeSocket = null;
        if (currentSocketRef.socket === ws) {
          currentSocketRef.socket = null;
          currentSocketRef.connectionGeneration = null;
        }
        requestActiveRouteCatalogSync = null;
      } catch (error) {
        activeSocket = null;
        currentSocketRef.socket = null;
        currentSocketRef.connectionGeneration = null;
        requestActiveRouteCatalogSync = null;
        if (stopRequested) {
          break;
        }
        recovery ??= { recoveryId: randomUUID(), disconnectedAt: Date.now() };
        reconnectAttempt += 1;
        const backoffMs = noteRunLoopReconnectScheduled({
          connectionState,
          error,
          foregroundActive: mode === "foreground",
          presenter: input.presenter,
          reconnectAttempt,
        });
        await reconnectBackoffDelay.wait(backoffMs);
      }
    }
  } finally {
    controlledShutdown.failOutstanding();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await Promise.all([
      controlPlaneServer.close(),
      clearDaemonServiceRuntimeState(),
      localFolderPicker.close(),
      agentActivityIntegrationRefresh.stop(),
      agentActivitySync.stop(),
      stopRegistrationReconcile(),
    ]);
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.stopped",
    text: "local service loop stopped",
  });
};

// Route refresh reads configured routes, never controller installation probes.
export async function loadFreshDaemonRouteCatalog(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  ownerUserId: string;
  presenter: Presenter;
}): Promise<RouteCatalog> {
  return await loadDaemonRouteCatalog({
    ...input,
    allowEmpty: true,
    localReplyStateMode: "check",
    quiet: true,
  });
}

// The first successful load resolves the bootstrap placeholder. Only then may
// a fresh empty catalog remove registered routes; load failures never do so.
export function createRouteCatalogSyncLoader(deps: {
  loadFresh: () => Promise<RouteCatalog>;
  loadInitial: () => Promise<RouteCatalog>;
}): {
  isResolved: () => boolean;
  load: () => Promise<RouteCatalog>;
} {
  let resolved = false;
  return {
    isResolved: () => resolved,
    load: async () => {
      if (resolved) {
        return await deps.loadFresh();
      }
      const catalog = await deps.loadInitial();
      resolved = true;
      return catalog;
    },
  };
}

async function loadInitialDaemonRouteCatalog(input: {
  allowEmpty: boolean;
  lane: string;
  localAdapterContainer: LocalDaemonAdapterContainer;
  ownerUserId: string;
  presenter: Presenter;
  serviceBundleId: string | null;
}): Promise<RouteCatalog> {
  const loadStartedAt = Date.now();
  const phaseTimings: RouteCatalogLoadPhaseTimings = {};
  await emitInitialRouteCatalogLoadEvent({
    result: "started",
    metadata: {},
  });
  try {
    const catalog = await loadDaemonRouteCatalog({
      allowEmpty: input.allowEmpty,
      localAdapterContainer: input.localAdapterContainer,
      localReplyStateMode: "check",
      ownerUserId: input.ownerUserId,
      phaseTimings,
      presenter: input.presenter,
    });
    await emitInitialRouteCatalogLoadEvent({
      result: "completed",
      metadata: {
        durationMs: Date.now() - loadStartedAt,
        phaseTimings,
        profileCount: catalog.profileIds.length,
        skippedProfileCount: catalog.skippedProfiles.length,
      },
    });
    return catalog;
  } catch (error) {
    const cached = await readDaemonRouteCatalogCache({
      lane: input.lane,
      ownerUserId: input.ownerUserId,
      serviceBundleId: input.serviceBundleId,
    });
    if (!cached) {
      // A startup-time network failure must not kill the service: an empty
      // catalog enters the main loop in the documented waiting-for-profiles
      // state and the periodic catalog sync re-registers everything as soon
      // as the gateway is reachable again. Exiting here turned transient
      // network faults into launchd crash loops with no degraded state.
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.route_catalog_initial_load_failed",
        text: `initial route catalog load failed; starting with an empty catalog and retrying via catalog sync: ${toErrorMessage(error)}`,
        payload: {
          reason: "initial_load_failed_no_cache",
        },
      });
      await emitInitialRouteCatalogLoadEvent({
        result: "failed_empty_start",
        metadata: {
          durationMs: Date.now() - loadStartedAt,
          errorMessage: toErrorMessage(error),
          phaseTimings,
        },
      });
      return {
        profileIds: [],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      };
    }
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.route_catalog_cache_recovered",
      text: `using last known route catalog after initial catalog load failed: ${toErrorMessage(error)}`,
      payload: {
        profileIds: cached.profileIds,
        reason: "initial_load_failed",
      },
    });
    await emitInitialRouteCatalogLoadEvent({
      result: "cache_recovered",
      metadata: {
        durationMs: Date.now() - loadStartedAt,
        errorMessage: toErrorMessage(error),
        phaseTimings,
        profileCount: cached.profileIds.length,
      },
    });
    return cached;
  }
}

// The background presenter does not persist run lines, so the initial catalog
// load also lands in the lifecycle journal with phase durations. This is the
// durable record that explains where daemon startup time went; journal write
// failures must never block or kill the load itself.
async function emitInitialRouteCatalogLoadEvent(input: {
  result: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await emitDaemonLifecycleEvent({
    type: "route_catalog.initial_load",
    result: input.result,
    metadata: input.metadata,
  }).catch(() => undefined);
}

async function persistDaemonRouteCatalogCache(input: {
  lane: string;
  ownerUserId: string;
  presenter: Presenter;
  routeCatalog: RouteCatalog;
  serviceBundleId: string | null;
}): Promise<void> {
  try {
    await writeDaemonRouteCatalogCache({
      lane: input.lane,
      ownerUserId: input.ownerUserId,
      routeCatalog: input.routeCatalog,
      serviceBundleId: input.serviceBundleId,
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.route_catalog_cache_write_failed",
      text: `route catalog cache write failed: ${toErrorMessage(error)}`,
    });
  }
}

function resolveDaemonServiceLane(
  contract: Awaited<ReturnType<typeof readDaemonServiceContract>> | null
): string {
  if (contract?.lane) {
    return contract.lane;
  }
  throw new DaemonServiceRunError({
    code: "daemon.run.service_contract_lane_missing",
    message:
      "OpenMeld Service cannot start because its service contract is missing the runtime lane. Run `openmeld service repair`, then `openmeld service start`.",
  });
}

function resolveDaemonServiceOwnerContextFromProfile(
  openMeldProfile: Awaited<ReturnType<typeof requireOpenMeldProfile>>,
  ownerMissingMessage: string
): {
  ownerUserId: string;
  ownerName: string | null;
  openMeldProfile: Awaited<ReturnType<typeof requireOpenMeldProfile>>;
} {
  const ownerUserId = normalizeText(openMeldProfile.ownerUserId);
  if (!ownerUserId) {
    throw new DaemonServiceRunError({
      code: "daemon.run.owner_missing",
      message: ownerMissingMessage,
    });
  }
  return {
    ownerUserId,
    ownerName: normalizeOptionalText(openMeldProfile.ownerName),
    openMeldProfile,
  };
}

type LocalControlSyncRouteCatalogPayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.sync_route_catalog" }
>["payload"];
type LocalControlSetLocalAgentEnabledPayload = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.set_local_agent_enabled" }
>["payload"];

async function handleLocalControlPlaneSetLocalAgentEnabled(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  onAttempt: RuntimeReportingAttemptObserver;
  payload: OpenMeldDaemonSetLocalAgentEnabledRequestPayload;
  presenter: Presenter;
  requestActiveRouteCatalogSync:
    | ((reason: string) => Promise<RouteCatalogSyncResult>)
    | null;
}): Promise<LocalControlSetLocalAgentEnabledPayload> {
  try {
    const result = await setAgentRegistrationEnabled({
      agentId: input.payload.agentId,
      enabled: input.payload.enabled,
    });
    let reportSyncStatus: LocalControlSetLocalAgentEnabledPayload["reportSyncStatus"] =
      "failed";
    try {
      const reportSync = await syncLocalServiceRuntimeAgentControllerReports({
        localAdapterContainer: input.localAdapterContainer,
        onAttempt: input.onAttempt,
        probePolicy: "fresh",
      });
      reportSyncStatus = reportSync.status;
    } catch (error) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_agent_enabled_report_sync_failed",
        text: `local agent report sync failed after enabled update: ${toErrorMessage(error)}`,
      });
    }

    if (result.changed && input.requestActiveRouteCatalogSync) {
      await input
        .requestActiveRouteCatalogSync("local_agent_enabled_changed")
        .catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.local_agent_enabled_route_sync_failed",
            text: `route catalog sync failed after enabled update: ${toErrorMessage(error)}`,
          });
        });
    }

    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.local_agent_enabled_updated",
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
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.local_agent_enabled_rejected",
      text: `local agent enabled update rejected: ${message}`,
      payload: {
        agentId: input.payload.agentId,
        enabled: input.payload.enabled,
        reasonCode: resolveLocalAgentEnabledErrorCode(error),
      },
    });
    return {
      accepted: false,
      agentId: input.payload.agentId,
      changed: false,
      enabled: input.payload.enabled,
      message,
      reasonCode: resolveLocalAgentEnabledErrorCode(error),
      reportSyncStatus: "failed",
      status: "rejected",
    };
  }
}

function resolveLocalAgentEnabledErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "agents.unexpected_error";
  }
  const [code] = error.message.split(":", 1);
  const normalized = code?.trim();
  return normalized?.includes(".") ? normalized : "agents.unexpected_error";
}

async function handleLocalControlPlaneRouteCatalogSync(input: {
  payload: OpenMeldDaemonSyncRouteCatalogRequestPayload;
  presenter: Presenter;
  requestActiveRouteCatalogSync:
    | ((reason: string) => Promise<RouteCatalogSyncResult>)
    | null;
  routeCatalogState: MutableRouteCatalogState;
}): Promise<LocalControlSyncRouteCatalogPayload> {
  if (!input.requestActiveRouteCatalogSync) {
    const payload: LocalControlSyncRouteCatalogPayload = {
      accepted: false,
      note: "daemon_stream_not_connected",
      profileIds: [...input.routeCatalogState.profileIds],
      syncStatus: "deferred",
    };
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.catalog_sync_deferred",
      text: "local route catalog sync deferred because the daemon stream is not connected",
      payload,
    });
    return payload;
  }

  const syncResult = await input.requestActiveRouteCatalogSync(
    input.payload.reason
  );
  const payload = toLocalControlSyncRouteCatalogPayload({
    routeCatalogState: input.routeCatalogState,
    syncResult,
  });
  const skippedProfilesSummary =
    summarizeLocalControlSyncSkippedProfiles(payload);
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.catalog_sync_requested",
    text: `local route catalog sync ${payload.accepted ? "completed" : "failed"} (${payload.syncStatus})${skippedProfilesSummary}`,
    payload: {
      ...payload,
      reason: input.payload.reason,
    },
  });
  return payload;
}

function toLocalControlSyncRouteCatalogPayload(input: {
  routeCatalogState: MutableRouteCatalogState;
  syncResult: RouteCatalogSyncResult;
}): LocalControlSyncRouteCatalogPayload {
  if (input.syncResult.status === "changed") {
    return {
      accepted: true,
      addedProfileIds: input.syncResult.diff.addedProfileIds,
      keptProfileIds: input.syncResult.diff.keptProfileIds,
      profileIds: [...input.routeCatalogState.profileIds],
      removedProfileIds: input.syncResult.diff.removedProfileIds,
      skippedProfiles: input.syncResult.skippedProfiles,
      syncStatus: "changed",
    };
  }
  if (input.syncResult.status === "registered") {
    return {
      accepted: true,
      keptProfileIds: [...input.routeCatalogState.profileIds],
      profileIds: [...input.routeCatalogState.profileIds],
      skippedProfiles: input.syncResult.skippedProfiles,
      syncStatus: "registered",
    };
  }
  if (input.syncResult.status === "unchanged") {
    return {
      accepted: true,
      profileIds: [...input.routeCatalogState.profileIds],
      skippedProfiles: input.syncResult.skippedProfiles,
      syncStatus: "unchanged",
    };
  }
  return {
    accepted: false,
    errorMessage: input.syncResult.errorMessage,
    note: input.syncResult.reason,
    profileIds: [...input.routeCatalogState.profileIds],
    syncStatus: "failed",
  };
}

function summarizeLocalControlSyncSkippedProfiles(
  payload: LocalControlSyncRouteCatalogPayload
): string {
  if (!payload.skippedProfiles || payload.skippedProfiles.length === 0) {
    return "";
  }
  return `; skipped=${payload.skippedProfiles.length} (${summarizeSkippedDaemonProfiles(
    payload.skippedProfiles
  )})`;
}

function describeConnectionRecovery(
  recovery: { recoveryId: string; disconnectedAt: number } | null
): Record<string, unknown> {
  return recovery
    ? {
        recoveryId: recovery.recoveryId,
        disconnectedAt: new Date(recovery.disconnectedAt).toISOString(),
        elapsedMs: Math.max(0, Date.now() - recovery.disconnectedAt),
      }
    : {};
}

function createRunLoopConnectionStateTracker(
  presenter: DaemonServiceRunInput["presenter"],
  recoveryMetadata: () => Record<string, unknown>
) {
  return createServiceConnectionStateTracker({
    onTransition: (next) => {
      emitRunLine({
        presenter,
        code: "daemon.run.connection_state",
        text: `connection state: ${next.state}${next.reason ? ` (${next.reason})` : ""}${next.detail ? ` - ${next.detail}` : ""}`,
        payload: {
          authState: next.authState,
          detail: next.detail,
          reason: next.reason,
          state: next.state,
          updatedAt: next.updatedAt,
        },
      });
      // The background presenter does not persist run lines, so transitions
      // also land in the lifecycle journal - the durable local record that
      // status surfaces and post-incident forensics read.
      emitDaemonLifecycleEvent({
        type: "connection.state",
        result: next.state,
        metadata: {
          ...recoveryMetadata(),
          authState: next.authState,
          detail: next.detail,
          reason: next.reason,
        },
      }).catch(() => undefined);
    },
  });
}

// Classifies a run-loop connection failure, records the degraded/auth state
// and reconcile evidence, and returns the backoff to wait before the next
// dial attempt.
function noteRunLoopReconnectScheduled(input: {
  connectionState: ReturnType<typeof createServiceConnectionStateTracker>;
  error: unknown;
  foregroundActive: boolean;
  presenter: Presenter;
  reconnectAttempt: number;
}): number {
  const errorMessage = toErrorMessage(input.error);
  const failureReason = classifyConnectionFailureReason(errorMessage);
  const authState =
    input.error instanceof DaemonStreamAuthenticationRequiredError
      ? input.error.authState
      : null;
  const backoffMs = resolveServiceConnectionReconnectBackoffMs({
    attempt: input.reconnectAttempt,
    reason: failureReason,
  });
  noteReconnectFailureState({
    authState,
    connectionState: input.connectionState,
    errorMessage,
    failureReason,
  });
  const reconcileDecision = resolveRouteRegistrationReconcileDecision({
    driftDetected: true,
    foregroundActive: input.foregroundActive,
  });
  emitDriftDetectedEvidence({
    action: reconcileDecision.action,
    backoffMs,
    driftClass: reconcileDecision.driftClass,
    error: errorMessage,
    foregroundActive: reconcileDecision.foregroundActive,
    lifecycleLocked: reconcileDecision.lifecycleLocked,
    owner: reconcileDecision.owner,
    reconnectAttempt: input.reconnectAttempt,
    skipReason: reconcileDecision.skipReason,
  });
  emitReconcileStartedEvidence({
    action: reconcileDecision.action,
    backoffMs,
    driftClass: reconcileDecision.driftClass,
    error: errorMessage,
    foregroundActive: reconcileDecision.foregroundActive,
    lifecycleLocked: reconcileDecision.lifecycleLocked,
    owner: reconcileDecision.owner,
    reconnectAttempt: input.reconnectAttempt,
    skipReason: reconcileDecision.skipReason,
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.reconnect",
    text: `daemon stream reconnect scheduled in ${String(backoffMs)}ms (${errorMessage})`,
    payload: {
      attempt: input.reconnectAttempt,
      authState,
      backoffMs,
      error: errorMessage,
      reason: failureReason,
      reasonCode: input.reconnectAttempt >= 2 ? "service_reconnecting" : null,
    },
  });
  if (input.reconnectAttempt === 2) {
    warnDaemonEvent("[openmeld.daemon.stream_reconnecting]", {
      automaticRetryContinues: true,
      error: errorMessage,
      reason: failureReason,
      reasonCode: "service_reconnecting",
      retryAfterMs: backoffMs,
    });
  }
  return backoffMs;
}

function noteReconnectFailureState(input: {
  authState: ServiceConnectionAuthState | null;
  connectionState: ReturnType<typeof createServiceConnectionStateTracker>;
  errorMessage: string;
  failureReason: ServiceConnectionDegradedReason;
}): void {
  if (input.failureReason === "auth_rejected") {
    input.connectionState.set("authentication_required", {
      authState: input.authState,
      detail: input.errorMessage,
      reason: "auth_rejected",
    });
    return;
  }
  input.connectionState.set("degraded", {
    detail: input.errorMessage,
    reason: input.failureReason,
  });
}

function throwDaemonStreamAuthenticationRequired(input: {
  authState: Exclude<AuthSessionState, "valid">;
  connectionState: ReturnType<typeof createServiceConnectionStateTracker>;
  credentialFailure: DaemonStreamCredentialFailure | null;
}): never {
  if (input.credentialFailure) {
    // stderr is wired to daemon-system-service.log by the service
    // controller, so the structured compatibility reason stays available
    // for diagnosis of "why did the daemon stop dialing".
    warnDaemonEvent("[openmeld.daemon.stream_credentials_not_attachable]", {
      authHost: input.credentialFailure.authHost,
      event: "cli.daemon.stream_credentials_not_attachable",
      expectedGatewayHost: input.credentialFailure.expectedGatewayHost,
      reason: input.credentialFailure.reason,
      requestHost: input.credentialFailure.requestHost,
    });
  }
  noteAuthenticationRequiredState({
    authState: input.authState,
    connectionState: input.connectionState,
    credentialFailure: input.credentialFailure,
  });
  throw new DaemonStreamAuthenticationRequiredError({
    authState: input.authState,
    ...(input.credentialFailure
      ? { credentialFailure: input.credentialFailure }
      : {}),
  });
}

function noteAuthenticationRequiredState(input: {
  authState: Exclude<AuthSessionState, "valid">;
  connectionState: ReturnType<typeof createServiceConnectionStateTracker>;
  credentialFailure?: DaemonStreamCredentialFailure | null;
}): void {
  const detail = input.credentialFailure
    ? `stored credentials are not attachable to the daemon stream (${input.credentialFailure.reason}: requestHost=${input.credentialFailure.requestHost ?? "unknown"}, authHost=${input.credentialFailure.authHost ?? "unknown"}, expectedGatewayHost=${input.credentialFailure.expectedGatewayHost ?? "unknown"})`
    : `connecting without credentials, session=${input.authState}`;
  input.connectionState.set("authentication_required", {
    authState: input.authState,
    detail,
    reason: "auth_rejected",
  });
}

function resolveConnectingReason(
  reconnectAttempt: number
): "reconnecting" | null {
  return reconnectAttempt > 0 ? "reconnecting" : null;
}
