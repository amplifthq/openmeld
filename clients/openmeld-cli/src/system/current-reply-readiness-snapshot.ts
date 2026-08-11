import type { RuntimeTransportLookupRouteResponse } from "@openmeld/schemas/types";
import { buildDaemonRouteObservationPresentation } from "@openmeld/start";
import {
  DaemonRouteObservationFetchError,
  fetchDaemonRouteObservation,
} from "../config/daemon-route-observation-api";
import type {
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../config/daemon-state";
import { getDaemonStatus } from "../config/daemon-state";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { resolveOpenMeldEnvPreset } from "../config/paths";
import type { RouteCatalog } from "../local-service/core/types";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import type { DaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "../local-service/lifecycle/daemon-service-manager";
import {
  resolveDaemonRuntimeState,
  resolveDaemonServiceManagerForRuntimeState,
} from "../local-service/lifecycle/daemon-service-runtime";
import { resolveLocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import type { DeviceRuntimeStateSyncResult } from "../local-service/reporting/device-runtime-state-sync";
import { syncDeviceRuntimeStateProjection } from "../local-service/reporting/device-runtime-state-sync";
import { readDaemonRouteCatalogCache } from "../local-service/state/route-catalog-cache";
import { resolveProfileWorkspaceRuntime } from "../profile-workspace/runtime-resolution";
import type {
  OpenClawDiagnosticsMode,
  OpenClawLocalDiagnosticsState,
} from "../provider-hosts/openclaw/diagnostics";
import {
  createOpenClawLocalDiagnosticsFailure,
  resolveOpenClawLocalDiagnostics,
} from "../provider-hosts/openclaw/diagnostics";
import {
  type AgentProfilePrimaryAgentControllerReport,
  resolveAgentProfilePrimaryAgentControllerReport,
} from "./agent-profile-primary-binding";
import {
  createExpectedRoutesReadSession,
  type ExpectedRoutesReadSession,
} from "./expected-routes-read-session";
import type {
  GatewayChainProfile,
  GatewayChainReadiness,
} from "./gateway-chain-readiness";
import { resolveGatewayChainReadiness } from "./gateway-chain-readiness";
import {
  createPrimaryBindingReadSession,
  type PrimaryBindingReadSession,
} from "./primary-binding-read-session";
import {
  type AgentReplyReadinessStatus,
  type DeviceReplyReadinessStatus,
  isOpenClawAgentControllerReport,
  resolveAgentReplyReadinessStatus,
  resolveDeviceReplyReadinessStatus,
} from "./reply-readiness";

export type CurrentReplyReadinessSnapshot = {
  daemonRouteObservation: DaemonRouteObservation;
  observedAt: string;
  daemonStatus: DaemonStatus;
  inventory: DaemonServiceInventory | null;
  runtimeProjection: DeviceRuntimeStateSyncResult | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  displayRuntimeStatus: DaemonServiceRuntimeStatus | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
  gatewayChainReadiness: GatewayChainReadiness | null;
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  agentReplyReadiness: AgentReplyReadinessStatus | null;
  openClawLocalDiagnostics: OpenClawLocalDiagnosticsState | null;
  profileWorkspaceRuntimeResolution: ReturnType<
    typeof resolveProfileWorkspaceRuntime
  > extends Promise<infer TValue>
    ? TValue | null
    : never;
};

export type CurrentReplyReadinessLocalServiceObservation = {
  daemonStatus: DaemonStatus;
  inventory: DaemonServiceInventory | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
};

export type DaemonRouteObservation =
  | {
      detail: null;
      observedAt: string;
      profileId: string;
      reasonCode: "online";
      route: RuntimeTransportLookupRouteResponse;
      status: "online";
    }
  | {
      detail: string;
      observedAt: string;
      profileId: string;
      reasonCode: "route.not_registered";
      route: RuntimeTransportLookupRouteResponse;
      status: "offline";
    }
  | {
      detail: string;
      observedAt: string;
      profileId: string | null;
      reasonCode:
        | "lookup_failed"
        | "not_requested"
        | "profile_not_agent"
        | "profile_not_selected"
        | "server_unsupported";
      route: null;
      status: "unavailable";
    };

export async function resolveCurrentReplyReadinessSnapshot(
  input: {
    baseUrl?: string;
    checkGatewayChain?: boolean;
    gatewayChainProfile?: GatewayChainProfile | null;
    gatewayChainTimeoutMs?: number;
    includeDaemonRouteObservation?: boolean;
    localServiceObservation?: CurrentReplyReadinessLocalServiceObservation;
    openClawDiagnosticsMode?: OpenClawDiagnosticsMode | null;
    ownerUserId?: string | null;
    preferActiveServiceRouteCatalog?: boolean;
    profile?: OpenMeldProfile | null;
    runtimeProjection?: DeviceRuntimeStateSyncResult | null;
    runtimeWorkdir?: string;
  } = {}
): Promise<CurrentReplyReadinessSnapshot> {
  const daemonStatus = await resolveDaemonStatusForSnapshot(
    input.localServiceObservation
  );
  // One snapshot = one binding read per profile: the runtime projection
  // check, the local-service demand catalog, and the agent readiness lookup
  // all share this operation-scoped session instead of re-fanning out.
  const bindingReads = createPrimaryBindingReadSession({
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
  });
  const expectedRoutesRead = createExpectedRoutesReadSession({
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
  });
  const primaryAgentControllerReportPromise =
    resolvePrimaryAgentControllerReportForSnapshot({
      baseUrl: input.baseUrl,
      bindingReads,
      profile: input.profile ?? null,
    });
  const daemonRouteObservationPromise = resolveDaemonRouteObservation({
    baseUrl: input.baseUrl,
    includeDaemonRouteObservation: input.includeDaemonRouteObservation === true,
    profile: input.profile ?? null,
  });
  const inventoryPromise = resolveInventoryForSnapshot(
    input.localServiceObservation
  );
  const ownerUserId = input.ownerUserId ?? input.profile?.ownerUserId ?? null;
  const activeServiceRouteCatalogPromise = inventoryPromise.then(
    async (inventory) =>
      await resolveActiveServiceRouteCatalogForSnapshot({
        enabled: input.preferActiveServiceRouteCatalog === true,
        inventory,
        ownerUserId,
      })
  );
  const runtimeProjectionPromise = resolveRuntimeProjectionForSnapshot({
    activeServiceRouteCatalog: activeServiceRouteCatalogPromise,
    bindingReads,
    daemonStatus,
    expectedRoutesRead,
    runtimeProjection: input.runtimeProjection,
  });
  const runtimeStatusPromise = resolveRuntimeStatusForSnapshot({
    daemonStatus,
    localServiceObservation: input.localServiceObservation,
  });
  const profileWorkspaceRuntimeResolutionPromise =
    resolveProfileWorkspaceRuntimeForSnapshot(input.profile ?? null);
  const runtimeStatus = await runtimeStatusPromise;
  const { serviceManager, serviceManagerStatus } =
    await resolveServiceManagerForSnapshot({
      daemonStatus,
      localServiceObservation: input.localServiceObservation,
      runtimeStatus,
    });
  const [
    runtimeProjection,
    inventory,
    profileWorkspaceRuntimeResolution,
    activeServiceRouteCatalog,
  ] = await Promise.all([
    runtimeProjectionPromise,
    inventoryPromise,
    profileWorkspaceRuntimeResolutionPromise,
    activeServiceRouteCatalogPromise,
  ]);
  const displayRuntimeStatus = enrichRuntimeStateWithManager({
    runtimeState: runtimeStatus,
    serviceManager,
    serviceManagerStatus,
  });
  const localDemand = await resolveLocalServiceDemand({
    bindingReads,
    expectedRoutesRead,
    ownerUserId,
    projection: runtimeProjection,
    ...(activeServiceRouteCatalog
      ? { routeCatalog: activeServiceRouteCatalog }
      : {}),
    runtimeWorkdir: input.runtimeWorkdir,
  }).catch(() => null);
  const localDeviceReplyReadiness = await resolveDeviceReplyReadinessStatus({
    baseUrl: input.baseUrl,
    checkGatewayChain: false,
    gatewayChainProfile: input.gatewayChainProfile,
    gatewayChainReadiness: null,
    gatewayChainTimeoutMs: input.gatewayChainTimeoutMs,
    inventory,
    localDemand,
    ownerUserId,
    profile: input.profile ?? null,
    profileWorkspaceRuntimeResolution,
    runtimeProjection,
    runtimeStatus: displayRuntimeStatus ?? runtimeStatus,
    runtimeWorkdir: input.runtimeWorkdir,
    status: daemonStatus,
  }).catch(() =>
    createFallbackDeviceReplyReadiness({
      daemonStatus,
      runtimeStatus: displayRuntimeStatus ?? runtimeStatus,
    })
  );
  const shouldProbeGatewayChain =
    input.checkGatewayChain === true &&
    !isWakeableLocalReplyReady(localDeviceReplyReadiness) &&
    !localDeviceReplyReadiness.reasonCodes.some(
      (reasonCode) =>
        reasonCode === "service.drifted" ||
        reasonCode === "service.not_installed" ||
        reasonCode === "service.not_running" ||
        reasonCode === "workspace.invalid" ||
        reasonCode === "workspace.missing"
    );
  const gatewayChainReadiness = shouldProbeGatewayChain
    ? await resolveGatewayChainReadiness({
        baseUrl: input.baseUrl,
        profile:
          input.gatewayChainProfile ??
          (input.profile
            ? {
                openMeldProfileId: input.profile.openMeldProfileId,
                profileName: input.profile.profileName,
              }
            : null),
        timeoutMs: input.gatewayChainTimeoutMs,
      }).catch(() => null)
    : null;
  const deviceReplyReadiness = localDeviceReplyReadiness;
  const openClawLocalDiagnostics =
    await resolveOpenClawLocalDiagnosticsForSnapshot({
      mode: input.openClawDiagnosticsMode ?? null,
      primaryAgentControllerReport: primaryAgentControllerReportPromise,
      profile: input.profile ?? null,
      profileWorkspaceRuntimeResolution,
    });
  const [daemonRouteObservation, primaryAgentControllerReport] =
    await Promise.all([
      daemonRouteObservationPromise,
      primaryAgentControllerReportPromise,
    ]);
  const agentReplyReadiness =
    input.profile?.profileKind === "agent"
      ? await resolveAgentReplyReadinessStatus({
          bindingReads,
          coreWakeRouteOnline: daemonRouteObservation.status === "online",
          deviceReplyReadiness,
          openClawLocalDiagnostics,
          primaryAgentControllerReport,
          profile: input.profile,
          profileWorkspaceRuntimeResolution,
        }).catch(() => null)
      : null;

  return {
    daemonRouteObservation,
    observedAt: new Date().toISOString(),
    daemonStatus,
    inventory,
    runtimeProjection,
    runtimeStatus,
    displayRuntimeStatus,
    serviceManagerStatus,
    gatewayChainReadiness,
    deviceReplyReadiness,
    agentReplyReadiness,
    openClawLocalDiagnostics,
    profileWorkspaceRuntimeResolution,
  };
}

function resolveDaemonStatusForSnapshot(
  localServiceObservation?: CurrentReplyReadinessLocalServiceObservation
): Promise<DaemonStatus> {
  if (localServiceObservation) {
    return Promise.resolve(localServiceObservation.daemonStatus);
  }
  return getDaemonStatus();
}

function resolveRuntimeStatusForSnapshot(input: {
  daemonStatus: DaemonStatus;
  localServiceObservation?: CurrentReplyReadinessLocalServiceObservation;
}): Promise<DaemonServiceRuntimeStatus | null> {
  if (input.localServiceObservation) {
    return Promise.resolve(input.localServiceObservation.runtimeStatus);
  }
  return resolveDaemonRuntimeState(input.daemonStatus).catch(() => null);
}

function resolveInventoryForSnapshot(
  localServiceObservation?: CurrentReplyReadinessLocalServiceObservation
): Promise<DaemonServiceInventory | null> {
  if (localServiceObservation) {
    return Promise.resolve(localServiceObservation.inventory);
  }
  return inspectDaemonServiceInventory({
    expectedVersion: resolveCurrentDaemonExpectedVersion(),
    intent: "status_cleanup",
  }).catch(() => null);
}

async function resolveServiceManagerForSnapshot(input: {
  daemonStatus: DaemonStatus;
  localServiceObservation?: CurrentReplyReadinessLocalServiceObservation;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
}): Promise<{
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}> {
  if (input.localServiceObservation) {
    return {
      serviceManager:
        input.localServiceObservation.inventory?.serviceManager ?? null,
      serviceManagerStatus: input.localServiceObservation.serviceManagerStatus,
    };
  }
  return await resolveDaemonServiceManagerForRuntimeState({
    runtimeState: input.runtimeStatus,
    status: input.daemonStatus,
  }).catch(() => ({
    serviceManager: null,
    serviceManagerStatus: null,
    legacySharedService: null,
  }));
}

function isWakeableLocalReplyReady(
  localDeviceReplyReadiness: DeviceReplyReadinessStatus
): boolean {
  return (
    localDeviceReplyReadiness.replyReadiness === "ready" &&
    localDeviceReplyReadiness.wakeableRouteCount > 0
  );
}

async function resolveRuntimeProjectionForSnapshot(input: {
  activeServiceRouteCatalog: Promise<RouteCatalog | null>;
  bindingReads: PrimaryBindingReadSession;
  daemonStatus: DaemonStatus;
  expectedRoutesRead: ExpectedRoutesReadSession;
  runtimeProjection?: DeviceRuntimeStateSyncResult | null;
}): Promise<DeviceRuntimeStateSyncResult | null> {
  if (!input.daemonStatus.installed) {
    return null;
  }
  if (input.runtimeProjection !== undefined) {
    return input.runtimeProjection;
  }
  if (await input.activeServiceRouteCatalog) {
    return {
      status: "skipped",
      mode: "check",
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "active service route catalog already exists",
    };
  }
  return await syncDeviceRuntimeStateProjection({
    bindingReads: input.bindingReads,
    expectedRoutesRead: input.expectedRoutesRead,
    mode: "check",
  }).catch(() => null);
}

async function resolveActiveServiceRouteCatalogForSnapshot(input: {
  enabled: boolean;
  inventory: DaemonServiceInventory | null;
  ownerUserId: string | null;
}): Promise<RouteCatalog | null> {
  const serviceBundleId = input.inventory?.activeBundle?.bundleId ?? null;
  if (!(input.enabled && input.ownerUserId && serviceBundleId)) {
    return null;
  }
  return await readDaemonRouteCatalogCache({
    lane: resolveOpenMeldEnvPreset(),
    ownerUserId: input.ownerUserId,
    serviceBundleId,
  }).catch(() => null);
}

function resolveProfileWorkspaceRuntimeForSnapshot(
  profile: OpenMeldProfile | null
): Promise<CurrentReplyReadinessSnapshot["profileWorkspaceRuntimeResolution"]> {
  if (profile?.profileKind !== "agent") {
    return Promise.resolve(null);
  }
  return resolveProfileWorkspaceRuntime({
    openMeldProfileId: profile.openMeldProfileId,
    mode: "inspect",
  });
}

async function resolveOpenClawLocalDiagnosticsForSnapshot(input: {
  mode: OpenClawDiagnosticsMode | null;
  primaryAgentControllerReport: Promise<AgentProfilePrimaryAgentControllerReport | null>;
  profile: OpenMeldProfile | null;
  profileWorkspaceRuntimeResolution: CurrentReplyReadinessSnapshot["profileWorkspaceRuntimeResolution"];
}): Promise<OpenClawLocalDiagnosticsState | null> {
  if (
    input.profile?.profileKind !== "agent" ||
    !input.mode ||
    input.profileWorkspaceRuntimeResolution?.status !== "ready"
  ) {
    return null;
  }

  const primaryAgentControllerReport = await input.primaryAgentControllerReport;
  if (!isOpenClawAgentControllerReport(primaryAgentControllerReport ?? {})) {
    return null;
  }

  return resolveOpenClawLocalDiagnostics({
    mode: input.mode,
    profile: input.profile,
    providerRuntimeWorkingDirectory:
      input.profileWorkspaceRuntimeResolution.effectiveRuntimeWorkingDirectory,
  }).catch((error) => createOpenClawLocalDiagnosticsFailure(error));
}

function resolvePrimaryAgentControllerReportForSnapshot(input: {
  baseUrl?: string;
  bindingReads: PrimaryBindingReadSession;
  profile: OpenMeldProfile | null;
}): Promise<AgentProfilePrimaryAgentControllerReport | null> {
  if (input.profile?.profileKind !== "agent") {
    return Promise.resolve(null);
  }
  return resolveAgentProfilePrimaryAgentControllerReport({
    baseUrl: input.baseUrl,
    bindingReads: input.bindingReads,
    profile: input.profile,
  }).catch(() => null);
}

async function resolveDaemonRouteObservation(input: {
  baseUrl?: string;
  includeDaemonRouteObservation: boolean;
  profile: OpenMeldProfile | null;
}): Promise<DaemonRouteObservation> {
  const observedAt = new Date().toISOString();
  if (!input.includeDaemonRouteObservation) {
    return {
      detail: buildCanonicalUnavailableRouteObservationDetail({
        observedAt,
        reasonCode: "not_requested",
      }),
      observedAt,
      profileId: input.profile?.openMeldProfileId ?? null,
      reasonCode: "not_requested",
      route: null,
      status: "unavailable",
    };
  }

  if (!input.profile) {
    return {
      detail: buildCanonicalUnavailableRouteObservationDetail({
        observedAt,
        reasonCode: "profile_not_selected",
      }),
      observedAt,
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    };
  }

  if (input.profile.profileKind !== "agent") {
    return {
      detail: buildCanonicalUnavailableRouteObservationDetail({
        observedAt,
        reasonCode: "profile_not_agent",
      }),
      observedAt,
      profileId: input.profile.openMeldProfileId,
      reasonCode: "profile_not_agent",
      route: null,
      status: "unavailable",
    };
  }

  try {
    const response = await fetchDaemonRouteObservation({
      requestContext: buildOpenMeldRequestContextFromProfile({
        openMeldProfile: input.profile,
      }),
      baseUrl: input.baseUrl,
      profileId: input.profile.openMeldProfileId,
    });
    if (response.route.online) {
      return {
        detail: null,
        observedAt: response.observedAt,
        profileId: response.profileId,
        reasonCode: "online",
        route: response.route,
        status: "online",
      };
    }
    return {
      detail: `Server can't currently see an active reply route for this agent profile (server reported ${response.route.reasonCode}).`,
      observedAt: response.observedAt,
      profileId: response.profileId,
      reasonCode: "route.not_registered",
      route: response.route,
      status: "offline",
    };
  } catch (error) {
    const reasonCode =
      error instanceof DaemonRouteObservationFetchError
        ? error.code
        : "lookup_failed";
    const detail =
      reasonCode === "server_unsupported"
        ? buildCanonicalUnavailableRouteObservationDetail({
            observedAt,
            reasonCode: "server_unsupported",
          })
        : buildLookupFailedRouteObservationDetail({
            error,
            observedAt,
          });
    return {
      detail,
      observedAt,
      profileId: input.profile.openMeldProfileId,
      reasonCode,
      route: null,
      status: "unavailable",
    };
  }
}

function buildCanonicalUnavailableRouteObservationDetail(input: {
  observedAt: string;
  reasonCode:
    | "lookup_failed"
    | "not_requested"
    | "profile_not_agent"
    | "profile_not_selected"
    | "server_unsupported";
}): string {
  const detail = buildDaemonRouteObservationPresentation({
    observedAt: input.observedAt,
    reasonCode: input.reasonCode,
    status: "unavailable",
  }).detail;
  if (!detail) {
    throw new Error(
      `missing unavailable reply route detail for ${input.reasonCode}`
    );
  }
  return detail;
}

function buildLookupFailedRouteObservationDetail(input: {
  error: unknown;
  observedAt: string;
}): string {
  const detail = buildCanonicalUnavailableRouteObservationDetail({
    observedAt: input.observedAt,
    reasonCode: "lookup_failed",
  });
  const rawError = toErrorMessage(input.error).trim();
  if (rawError.length === 0 || rawError === detail) {
    return detail;
  }
  return `${detail} Raw lookup error: ${rawError}`;
}

function createFallbackDeviceReplyReadiness(input: {
  daemonStatus: DaemonStatus;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
}): DeviceReplyReadinessStatus {
  if (!input.daemonStatus.installed) {
    return {
      reasonCodes: ["service.not_installed"],
      reasonText: "OpenMeld Service is not installed on this device",
      replyReadiness: "blocked",
      updatedAt: new Date().toISOString(),
      wakeableRouteCount: 0,
    };
  }

  return {
    reasonCodes:
      input.runtimeStatus?.status === "stale" ? ["service.not_running"] : [],
    reasonText:
      input.runtimeStatus?.status === "stale"
        ? "OpenMeld Service is reconnecting on this device"
        : "OpenMeld couldn't confirm current reply readiness on this device",
    replyReadiness:
      input.runtimeStatus?.status === "stale" ? "degraded" : "unknown",
    updatedAt: new Date().toISOString(),
    wakeableRouteCount: 0,
  };
}

function enrichRuntimeStateWithManager(input: {
  runtimeState: DaemonServiceRuntimeStatus | null;
  serviceManager: DaemonServiceManager | null;
  serviceManagerStatus: DaemonServiceManagerRuntimeStatus | null;
}): DaemonServiceRuntimeStatus | null {
  if (!input.runtimeState) {
    return null;
  }
  return {
    ...input.runtimeState,
    managedBySystemService:
      input.runtimeState.managedBySystemService ||
      input.serviceManagerStatus?.installed === true,
    serviceController:
      input.runtimeState.serviceController === "unknown" &&
      input.serviceManager?.controller !== undefined
        ? input.serviceManager.controller
        : input.runtimeState.serviceController,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
