import { randomUUID } from "node:crypto";
import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import {
  applyIntervalJitterMs as applyIntervalJitterMsInternal,
  resolveAdaptiveHeartbeatIntervalMs as resolveAdaptiveHeartbeatIntervalMsInternal,
  resolveCatalogSyncIntervalMs as resolveCatalogSyncIntervalMsInternal,
} from "@openmeld/local-service/heartbeat-policy";
import { resolveRouteRegistrationReconcileDecision } from "@openmeld/local-service/service-reconcile-decision";
import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  COMPUTER_POWER_CAPABILITY_HEADER,
  daemonServiceLaneSchema,
  LOCAL_EXECUTION_INPUT_CAPABILITY_HEADER,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_ADMISSION_EVIDENCE_HEADER,
  OPENMELD_COMPUTER_CARE_HEADER,
  OPENMELD_EXECUTION_ADMISSION_HEADER,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_REASONING_STREAM_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
  SERVICE_CONNECTION_ID_QUERY_PARAMETER,
  SPACE_WORK_HANDOFF_CAPABILITY_HEADER,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonControlPlaneResponse,
  OpenMeldDaemonSyncRouteCatalogRequestPayload,
  RuntimeTransportStopCause,
} from "@openmeld/schemas/types";
import {
  type AuthSessionState,
  buildStoredAuthSessionIdentity,
  getAuthSessionState,
  onAuthSessionCredentialAvailable,
  onAuthSessionCredentialObservation,
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
import { resolveOpenMeldRootDir } from "../../config/paths";
import {
  AuthRequestCredentialError,
  type AuthRequestCredentialFailureReason,
  buildOpenMeldProfileRequestHeadersWithAuth,
  buildRequestAuthHeaders,
  fingerprintRequestAuthorization,
} from "../../config/request-headers";
import {
  requireOpenMeldProfile,
  resolveOpenMeldProfileOrNull,
} from "../../config/resolve-openmeld-profile";
import { getConfiguredDaemonDispatchLimits } from "../../config/runtime-config";
import { ServiceAccountAdmissionError } from "../../config/service-account-admission";
import type { Presenter } from "../../runtime/presenter";
import { OPENMELD_VERSION } from "../../runtime/version";
import {
  CURRENT_PROCESS_START_IDENTITY,
  isPreciseProcessStartIdentity,
  readProcessStartIdentity,
} from "../../system/process-identity";
import type { WsClient } from "../../transport/ws";
import { connectWebSocket, WebSocketConnectionError } from "../../transport/ws";
import { startLocalDaemonControlPlaneServer } from "../control-plane/server";
import {
  DAEMON_STREAM_CONNECT_TIMEOUT_MS,
  DEFAULT_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from "../core/constants";
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
  DaemonServiceRunInput,
  MutableRouteCatalogState,
  RouteCatalog,
  RouteCatalogSyncResult,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import {
  emitDriftDetectedEvidence,
  emitReconcileStartedEvidence,
} from "../diagnostics/service-evidence-trace";
import {
  buildDispatchBootstrapTemplateFacts as buildDispatchBootstrapTemplateFactsInternal,
  buildDispatchPromptPlan as buildDispatchPromptPlanInternal,
  buildDispatchPromptWithBootstrap as buildDispatchPromptWithBootstrapInternal,
} from "../dispatch/parse-dispatch-task";
import { createExecutionHostCatalogClient } from "../execution-host/catalog-client";
import { ExecutionHostError } from "../execution-host/channel";
import { launchExecutionHost } from "../execution-host/launch";
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
import { createServiceConnectionEvidenceObserver } from "../lifecycle/service-connection-evidence-observer";
import { createOpenMeldToolsUpdateCoordinator } from "../maintenance/openmeld-tools-update-coordinator";
import type { RuntimeReportingAuthenticationFailure } from "../reporting/runtime-reporting-auth-recovery";
import { createRuntimeReportingAuthenticationRecovery } from "../reporting/runtime-reporting-auth-recovery";
import {
  createMutableRouteCatalogState as createMutableRouteCatalogStateInternal,
  summarizeSkippedDaemonProfiles,
  syncDaemonRouteCatalogState as syncDaemonRouteCatalogStateInternal,
} from "../routing/route-catalog-state";
import {
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
import { runDaemonSocketSession } from "./run-socket-session";
import { createServiceLocalComponentsObservation } from "./service-local-components-observation";
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
    [COMPUTER_POWER_CAPABILITY_HEADER]: "1",
    [LOCAL_EXECUTION_INPUT_CAPABILITY_HEADER]: "1",
    ...(process.platform === "darwin"
      ? { [SPACE_WORK_HANDOFF_CAPABILITY_HEADER]: "1" }
      : {}),
    [OPENMELD_REASONING_STREAM_HEADER]: "1",
    [OPENMELD_COMPUTER_CARE_HEADER]: "1",
    [OPENMELD_EXECUTION_ADMISSION_HEADER]: "1",
    [OPENMELD_ADMISSION_EVIDENCE_HEADER]: "1",
    ...(input.localFolderPickerAvailable
      ? {
          [OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER]:
            LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
        }
      : {}),
    [OPENMELD_RUNTIME_CAPABILITIES_HEADER]:
      COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
    [SESSION_HISTORY_CAPABILITY_HEADER]: SESSION_HISTORY_RUNTIME_CAPABILITY,
  };
}

// A stored session can be locally valid while its credentials are still not
// attachable to the gateway stream URL (for example authBaseUrl written by a
// different lane, so host compatibility fails). Dialing bare in that state is
// what produced the production 401 relaunch storm, so the connect path treats
// it as authentication_required and never sends the handshake.
type DaemonStreamCredentialFailure = {
  retryAfterMs?: number;
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
      credentialFingerprint: string;
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
    credentialFingerprint: fingerprintRequestAuthorization(
      headers.Authorization
    ),
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
    ...(error.retryAfterMs !== undefined
      ? { retryAfterMs: error.retryAfterMs }
      : {}),
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
  drainHost: () => Promise<void>;
  hasUndrainedWork: () => boolean;
  isStopRequested: () => boolean;
  markStopping: () => void;
}) {
  let activeSessionShutdownResolver:
    | ((stopCause: RuntimeTransportStopCause) => void)
    | null = null;
  // Drain closes admission for this Host's lifetime. Reconnects observe the
  // same operation instead of accumulating unbounded pending Host RPCs.
  let hostDrain: Promise<void> | null = null;
  let idleAdmission: Promise<boolean> | null = null;
  let shutdownAttempt:
    | (PromiseWithResolvers<void> & { stopCause: RuntimeTransportStopCause })
    | null = null;

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

  const failHostShutdown = (error: unknown): never => {
    shutdownAttempt?.reject(error);
    throw error;
  };

  const createShutdownAttempt = (stopCause: RuntimeTransportStopCause) => {
    const attempt = { ...Promise.withResolvers<void>(), stopCause };
    const clear = () => {
      if (shutdownAttempt === attempt) {
        shutdownAttempt = null;
      }
    };
    attempt.promise.then(clear, clear);
    return attempt;
  };

  return {
    async requestIfIdle(payload: {
      gracePeriodMs: number;
      tryBeginDrain: () => Promise<boolean>;
      onAdmitted?: () => void;
    }) {
      const stopCause = await resolveRecentDaemonSignalStopCause();
      if (shutdownAttempt || input.isStopRequested()) {
        return {
          accepted: false,
          mode: "graceful" as const,
          gracePeriodMs: payload.gracePeriodMs,
        };
      }
      const concurrentAdmission = idleAdmission;
      const admission = payload.tryBeginDrain().catch((error: unknown) => {
        if (
          !(error instanceof ExecutionHostError) ||
          error.code !== "host.draining" ||
          !concurrentAdmission
        ) {
          throw error;
        }
        // The Host's refusal may arrive before the first admission reply.
        // Share that actual result; host.draining alone proves no acceptance.
        return concurrentAdmission;
      });
      idleAdmission ??= admission;
      let admitted: boolean;
      try {
        admitted = await admission;
      } finally {
        if (idleAdmission === admission) {
          idleAdmission = null;
        }
      }
      if (!admitted) {
        return {
          accepted: false,
          mode: "graceful" as const,
          gracePeriodMs: payload.gracePeriodMs,
        };
      }
      if (input.isStopRequested()) {
        payload.onAdmitted?.();
        return {
          accepted: true,
          mode: "graceful" as const,
          gracePeriodMs: payload.gracePeriodMs,
        };
      }
      // Host admission is now closed. A reconnect during the Host call must
      // carry this stop forward, not reject it and leave an orphaned fence.
      const attempt = shutdownAttempt ?? createShutdownAttempt(stopCause);
      shutdownAttempt = attempt;
      if (activeSessionShutdownResolver) {
        activeSessionShutdownResolver(attempt.stopCause);
      } else {
        requestServiceStop(attempt.stopCause);
        attempt.resolve();
      }
      payload.onAdmitted?.();
      await attempt.promise;
      return {
        accepted: true,
        mode: "graceful" as const,
        gracePeriodMs: payload.gracePeriodMs,
      };
    },
    failHostShutdown,
    isDraining: () => shutdownAttempt !== null || input.isStopRequested(),
    async completeQuiescentStop(): Promise<boolean> {
      if (!shutdownAttempt || input.hasUndrainedWork()) {
        return false;
      }
      await this.waitForDrain();
      this.handleSessionCompleted();
      return true;
    },
    waitForDrain(): Promise<void> {
      hostDrain ??= input.drainHost().catch((error: unknown) => {
        // A Host refusal/failure is not a transport interruption. Report it to
        // the admitted caller, and do not cache it as a completed drain.
        hostDrain = null;
        return failHostShutdown(error);
      });
      return hostDrain;
    },
    attachSession(
      shutdownResolver: (stopCause: RuntimeTransportStopCause) => void
    ): void {
      activeSessionShutdownResolver = shutdownResolver;
      // A connector failure does not revoke an admitted stop. The same Host
      // still owns its work; the replacement connection must finish that drain.
      if (shutdownAttempt) {
        shutdownResolver(shutdownAttempt.stopCause);
      }
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
      requestServiceStop(shutdownAttempt.stopCause);
      shutdownAttempt.resolve();
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
      return await withControlledStopRefusalProof({
        guarded: payload.onAdmission !== undefined,
        isStopping: () => shutdownAttempt !== null || input.isStopRequested(),
        run: async (markCommitted) => {
          const stopCause = await resolveRecentDaemonSignalStopCause();
          if (shutdownAttempt) {
            markCommitted();
            const existingAttempt = shutdownAttempt;
            await payload.onAdmission?.(() => undefined);
            await existingAttempt.promise;
          } else if (activeSessionShutdownResolver) {
            const currentAttempt = createShutdownAttempt(stopCause);
            // Admission acknowledgement can fail after commit. The original
            // drain still owns completion and must retain its rejection handler.
            const resolver = activeSessionShutdownResolver;
            const commit = () => {
              if (
                shutdownAttempt ||
                activeSessionShutdownResolver !== resolver
              ) {
                throw new Error(
                  "Service session changed before Stop admission."
                );
              }
              markCommitted();
              shutdownAttempt = currentAttempt;
              resolver(stopCause);
            };
            await (payload.onAdmission ?? commitControlledStop)(commit);
            await currentAttempt.promise;
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
              markCommitted();
              requestServiceStop(stopCause);
            };
            await (payload.onAdmission ?? commitControlledStop)(commit);
          }
          return {
            accepted: true as const,
            gracePeriodMs: payload.gracePeriodMs,
            mode: payload.mode,
          };
        },
      });
    },
  };
}

function commitControlledStop(commit: () => void): void {
  commit();
}

async function withControlledStopRefusalProof<T>(input: {
  guarded: boolean;
  isStopping: () => boolean;
  run: (markCommitted: () => void) => Promise<T>;
}): Promise<T> {
  let committed = input.isStopping();
  try {
    return await input.run(() => {
      committed = true;
    });
  } catch (error) {
    // Only the existing stop coordinator can prove that its commit never
    // happened. A missing acknowledgement or a pending disk record cannot.
    if (input.guarded && !committed && !input.isStopping()) {
      throw new ServiceAccountAdmissionError(
        "stop_refused",
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }
}

async function runSocketSessionWithControlledShutdown(input: {
  controlledShutdown: ReturnType<typeof createControlledShutdownCoordinator>;
  sessionInput: Omit<
    Parameters<typeof runDaemonSocketSession>[0],
    "drainExecutionHost" | "failHostShutdown"
  >;
}): Promise<void> {
  const sessionShutdown = Promise.withResolvers<RuntimeTransportStopCause>();
  input.controlledShutdown.attachSession(sessionShutdown.resolve);
  try {
    await runDaemonSocketSession({
      ...input.sessionInput,
      drainExecutionHost: input.controlledShutdown.waitForDrain,
      failHostShutdown: input.controlledShutdown.failHostShutdown,
      shutdownRequested: sessionShutdown.promise,
    });
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

async function launchAccountExecutionHost(input: {
  ownerUserId: string;
  deviceId: string;
  lane: string;
  daemonSessionId: string;
  contract: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  baseUrl: string;
  presenter: Presenter;
}) {
  const session = (await getAuthSessionState()).session;
  if (!(session && input.contract) || session.user?.id !== input.ownerUserId) {
    throw new DaemonServiceRunError({
      code: "daemon.run.host_identity_missing",
      message:
        "The Service account or installation cannot be verified for local execution.",
    });
  }
  const parentProcessStartedAt =
    process.platform === "win32"
      ? CURRENT_PROCESS_START_IDENTITY
      : readProcessStartIdentity(process.pid);
  if (!parentProcessStartedAt) {
    throw new DaemonServiceRunError({
      code: "daemon.run.host_parent_unknown",
      message: "The Service process cannot be verified for local execution.",
    });
  }
  return launchExecutionHost({
    identity: {
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: daemonServiceLaneSchema.parse(input.lane),
      daemonSessionId: input.daemonSessionId,
      serviceContractGeneration: input.contract.generation,
      sessionIdentity: buildStoredAuthSessionIdentity(session),
      stateRoot: resolveOpenMeldRootDir(),
      authBaseUrl: session.authBaseUrl,
      gatewayBaseUrl: input.baseUrl,
      parentPid: process.pid,
      parentProcessStartedAt,
    },
    onFailure: (error) =>
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.execution_host_unavailable",
        text: `Local execution is unavailable: ${toErrorMessage(error)}`,
      }),
  });
}

async function finishDisconnectedControlledStop(input: {
  stopRequested: boolean;
  controlledShutdown: ReturnType<typeof createControlledShutdownCoordinator>;
  executionHost: Awaited<ReturnType<typeof launchExecutionHost>>;
  presenter: Presenter;
}): Promise<boolean> {
  if (input.stopRequested) {
    return true;
  }
  if (!input.controlledShutdown.isDraining()) {
    return false;
  }
  // Refresh through the Host owner. Accepted work may still require reconnect;
  // an idle Host can preserve its durable results without another cloud session.
  try {
    await input.executionHost.call("health", {});
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.controlled_shutdown_host_unconfirmed",
      text: `Local work is not confirmed drained: ${toErrorMessage(error)}`,
    });
    return false;
  }
  if (!(await input.controlledShutdown.completeQuiescentStop())) {
    return false;
  }
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.controlled_shutdown_offline",
    text: "Local work drained. Pending results remain on disk for the next Service start.",
  });
  return true;
}

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
  const mode = resolveDaemonRunMode(input.mode);
  const now = nowIsoString();
  const runtimeMetadata = resolveDaemonServiceRuntimeMetadata();
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
  const connectionEvidence = createServiceConnectionEvidenceObserver({
    ownerUserId: ownerContext.ownerUserId,
    gatewayUrl: baseUrl,
    identity: {
      deviceId,
      runtimeLane: daemonServiceLaneSchema.parse(lane),
      serviceSessionId: daemonSessionId,
      serviceVersion: OPENMELD_VERSION,
    },
    getRecovery: () => recovery,
    isStopping: () => stopRequested,
  });
  const recoveryMetadata = () => ({
    ...describeConnectionRecovery(recovery),
    connectionDiagnosticId: connectionEvidence.connectionDiagnosticId,
    attempt: reconnectAttempt,
  });
  const connectionState = createRunLoopConnectionStateTracker(
    input.presenter,
    recoveryMetadata
  );
  const localComponentsObservation = createServiceLocalComponentsObservation({
    onError: (error) =>
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_components_status_failed",
        text: `local components status unavailable: ${toErrorMessage(error)}`,
      }),
  });

  const executionHost = await launchAccountExecutionHost({
    ownerUserId,
    deviceId,
    lane,
    daemonSessionId,
    contract: daemonServiceContract,
    baseUrl,
    presenter: input.presenter,
  });
  // Start transport with a lease-neutral placeholder; Host initialization and
  // provider discovery never block control or the first cloud registration.
  const routeCatalogState = createMutableRouteCatalogStateInternal({
    profileIds: [],
    routeByProfileId: new Map(),
    skippedProfiles: [],
  });
  const routeCatalogLoader = createExecutionHostCatalogClient(executionHost);

  let stopRequested = false;
  // Reconnect backoff waits must wake the moment a stop request arrives, or
  // the loop sleeps through the entire backoff tier (up to 15 minutes on the
  // auth_rejected ladder) before it can observe `stopRequested`.
  const reconnectBackoffDelay = createStopAwareDelay();
  let reconnectAttempt = 0;
  let connectionGeneration = 0;
  let activeSocket: WsClient | null = null;
  let activeCredentialFingerprint: string | null = null;
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
    if (input.failure.credentialFingerprint !== activeCredentialFingerprint) {
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
  let requestActiveRouteCatalogSync:
    | ((reason: string) => Promise<RouteCatalogSyncResult>)
    | null = null;
  const controlledShutdown = createControlledShutdownCoordinator({
    drainHost: async () => {
      await executionHost.call("drain", {}, { timeoutMs: null });
    },
    hasUndrainedWork: () => {
      const observed = executionHost.snapshot();
      return !(executionHost.available() && observed?.localQuiescent);
    },
    isStopRequested: () => stopRequested,
    markStopping: () => {
      stopRequested = true;
      connectionState.set("stopping");
      reconnectBackoffDelay.interrupt();
    },
  });
  const controlPlaneDaemonVersion =
    daemonServiceContract?.daemonVersion ?? "unknown";
  const requestAgentActivitySync = (refreshIntegrations = false) => {
    executionHost
      .call(
        "syncActivity",
        refreshIntegrations ? { refreshIntegrations: true } : {}
      )
      .catch((error: unknown) =>
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_activity_sync_failed",
          text: `Agent Activity sync unavailable: ${toErrorMessage(error)}`,
        })
      );
  };
  const controlPlaneServer = await startLocalDaemonControlPlaneServer({
    // Resolve the current file-backed token per request. Older CLIs may rotate
    // that file before stopping this Service, so caching it here would make the
    // running Service reject every later control request until it restarts.
    resolveExpectedToken: async () => await ensureDaemonControlPlaneToken(),
    onRequestPhase: (event) => {
      emitRunLine({
        presenter: input.presenter,
        code: `daemon.control.request_${event.phase}`,
        text: `local Service control request ${event.phase.replaceAll("_", " ")}`,
        payload: {
          ...(event.command ? { command: event.command } : {}),
          ...(event.requestId ? { requestId: event.requestId } : {}),
        },
      });
    },
    getContext: async () => ({
      accountCheckedServiceControl: isPreciseProcessStartIdentity(
        CURRENT_PROCESS_START_IDENTITY
      ),
      healthPayload: {
        checkedAt: nowIsoString(),
        ...toHealthProjection(
          controlledShutdown.isDraining()
            ? { ...connectionState.get(), state: "stopping" }
            : connectionState.get()
        ),
      },
      historyEntries: [],
      interruptHandler: async (payload) =>
        await executionHost.call("interrupt", payload),
      cancelHandler: async (payload) =>
        await executionHost.call("cancel", payload),
      conversationExecutionStatusHandler: async (payload) =>
        await executionHost.call("conversationStatus", payload),
      requestAgentActivitySyncHandler: async () => {
        await executionHost.call("syncActivity", {});
        return { accepted: true };
      },
      syncRouteCatalogHandler: async (payload) =>
        await handleLocalControlPlaneRouteCatalogSync({
          payload,
          presenter: input.presenter,
          requestActiveRouteCatalogSync,
          routeCatalogState,
        }),
      setLocalAgentEnabledHandler: async (payload) =>
        await executionHost.call("setEnabled", payload),
      shutdownIfIdleHandler: async (payload, lifecycle) => {
        return await controlledShutdown.requestIfIdle({
          gracePeriodMs: payload.gracePeriodMs,
          onAdmitted: lifecycle?.onAdmitted,
          tryBeginDrain: async () => {
            const state = await executionHost.call("beginDrain", {
              onlyIfIdle: true,
            });
            return state.admission === "draining";
          },
        });
      },
      shutdownHandler: async (payload, lifecycle) => {
        // Read local work through its owner, not a network session's registry.
        // This observation grants no admission; the existing account-checked
        // coordinator below still owns Stop and its pre-commit refusal proof.
        await executionHost.call("health", {});
        const admissionId = payload.accountAdmissionId;
        return await controlledShutdown.request({
          ...payload,
          onAdmission: async (commit: () => void) => {
            const commitAndReportAdmission = () => {
              commit();
              lifecycle?.onAdmitted();
            };
            if (admissionId) {
              await admitServiceAccountStop({
                id: admissionId,
                ownerUserId,
                deviceId,
                contractGeneration: daemonServiceContract?.generation ?? 0,
                commit: commitAndReportAdmission,
              });
              return;
            }
            commitAndReportAdmission();
          },
        });
      },
      serviceUpdateReadinessHandler: async () => {
        const observed = await executionHost.call("health", {});
        return {
          acceptedWakeCount: observed.activeCount + observed.pendingCount,
          safeToSwitch:
            observed.admission === "open" &&
            !observed.startupReplayPending &&
            observed.localQuiescent &&
            observed.unacknowledgedResultCount === 0,
          unacknowledgedResultCount: observed.unacknowledgedResultCount,
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
  }).catch(async (error: unknown) => {
    await executionHost.close();
    localComponentsObservation.dispose();
    await localFolderPicker.close();
    throw error;
  });
  try {
    await runtimeStateTracker.touchRuntimeState({}, { forcePersist: true });
  } catch (error) {
    await controlPlaneServer.close();
    await executionHost.close();
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

  const refreshAgentActivityForProjectConnectionChange = () =>
    requestAgentActivitySync(true);

  const unsubscribeCredentialAvailability = onAuthSessionCredentialAvailable(
    () => {
      if (connectionState.get().reason === "auth_unavailable") {
        reconnectBackoffDelay.wake();
      }
    }
  );
  const unsubscribeCredentialObservation = onAuthSessionCredentialObservation(
    (reason) => connectionEvidence.credential(reason)
  );
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
        localAdapterIds: executionHost.snapshot()?.adapterIds ?? [],
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
        connectionEvidence.beginAttempt();
        connectionState.set("connecting", {
          reason: resolveConnectingReason(reconnectAttempt),
        });
        const connectionUrl = new URL(toDaemonStreamUrl(baseUrl));
        connectionUrl.searchParams.set(
          SERVICE_CONNECTION_ID_QUERY_PARAMETER,
          connectionEvidence.connectionDiagnosticId
        );
        const wsUrl = connectionUrl.toString();
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
        connectionEvidence.opening();
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
        activeCredentialFingerprint = authContext.credentialFingerprint;
        connectionEvidence.opened(ws);

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
            executionHost,
            computerFileAccessStorePath: resolveComputerFileAccessStorePath(
              runtimePaths.dataRootPath
            ),
            daemonSessionId,
            deviceId,
            serviceContractGeneration: daemonServiceContract?.generation ?? 0,
            foregroundActive: mode === "foreground",
            heartbeatIntervalMs,
            isRouteCatalogResolved: routeCatalogLoader.isResolved,
            lane,
            loadRouteCatalog: routeCatalogLoader.load,
            localComponentsObservation,
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
            presenter: input.presenter,
            persistRouteCatalogCache: routeCatalogLoader.persist,
            reconnectAttempt,
            connectionGeneration: ++connectionGeneration,
            routeCatalogState,
            selectLocalFolders: localFolderPicker.selectFolders,
            socket: ws,
            touchRuntimeState: async (updates) => {
              if (typeof updates.heartbeatAt === "string") {
                connectionEvidence.acknowledged(
                  updates.heartbeatAt,
                  connectionState.get().state !== "online"
                );
                connectionState.set("online");
                reconnectAttempt = 0;
                recovery = null;
              }
              await runtimeStateTracker.touchRuntimeState(updates);
            },
          },
        });

        activeSocket = null;
        requestActiveRouteCatalogSync = null;
      } catch (error) {
        activeSocket = null;
        requestActiveRouteCatalogSync = null;
        if (
          await finishDisconnectedControlledStop({
            stopRequested,
            controlledShutdown,
            executionHost,
            presenter: input.presenter,
          })
        ) {
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
        connectionEvidence.retry(
          error,
          connectionState.get().reason,
          backoffMs
        );
        await reconnectBackoffDelay.wait(backoffMs);
      }
    }
  } finally {
    connectionEvidence.dispose();
    localComponentsObservation.dispose();
    unsubscribeCredentialObservation();
    unsubscribeCredentialAvailability();
    controlledShutdown.failOutstanding();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    try {
      // Do not clear the runtime or report stopped while its accepted work is
      // still draining. A lost Host fails explicitly instead of claiming exit.
      await executionHost.close();
      await clearDaemonServiceRuntimeState();
    } finally {
      await Promise.all([
        controlPlaneServer.close(),
        localFolderPicker.close(),
        stopRegistrationReconcile(),
      ]);
    }
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
  const { loadDaemonRouteCatalog } = await import("../routing/route-catalog");
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
  const credentialFailure =
    input.error instanceof DaemonStreamAuthenticationRequiredError
      ? input.error.credentialFailure
      : null;
  let failureReason = classifyConnectionFailureReason(errorMessage);
  if (credentialFailure?.reason === "session_token_unavailable") {
    failureReason = "auth_unavailable";
  } else if (
    input.error instanceof DaemonStreamAuthenticationRequiredError ||
    (input.error instanceof WebSocketConnectionError &&
      input.error.status === 401)
  ) {
    failureReason = "auth_rejected";
  }
  let authState =
    input.error instanceof DaemonStreamAuthenticationRequiredError
      ? input.error.authState
      : null;
  if (failureReason === "auth_unavailable") {
    authState = null;
  }
  const policyBackoffMs = resolveServiceConnectionReconnectBackoffMs({
    attempt: input.reconnectAttempt,
    reason: failureReason,
  });
  const credentialRetryAfterMs = credentialFailure?.retryAfterMs ?? 0;
  let backoffMs = policyBackoffMs;
  if (failureReason === "auth_unavailable" && credentialRetryAfterMs > 0) {
    backoffMs = credentialRetryAfterMs;
  } else if (failureReason !== "auth_rejected") {
    backoffMs = applyIntervalJitterMs({
      baseIntervalMs: policyBackoffMs,
      minIntervalMs: DEFAULT_RECONNECT_DELAY_MS,
      maxIntervalMs: MAX_RECONNECT_DELAY_MS,
      jitterRatio: 0.2,
    });
  }
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
  if (input.credentialFailure?.reason === "session_token_unavailable") {
    input.connectionState.set("degraded", {
      detail,
      reason: "auth_unavailable",
    });
    return;
  }
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

import {
  SESSION_HISTORY_CAPABILITY_HEADER,
  SESSION_HISTORY_RUNTIME_CAPABILITY,
} from "@openmeld/schemas";
