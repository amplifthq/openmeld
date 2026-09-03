import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type {
  ProviderDispatchRuntimeContext,
  ReplyReadinessLevel as SharedReplyReadinessLevel,
  ReplyReadinessReasonCode as SharedReplyReadinessReasonCode,
} from "@openmeld/schemas/types";
import { resolveAgentTargetState } from "../agents/registry";
import { resolveRegistryRuntimeAdapterContractByAgentControllerRef } from "../agents/registry-source";
import type {
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../config/daemon-state";
import { getDaemonStatus } from "../config/daemon-state";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { createDefaultRuntimeAgentControllerSettings } from "../config/runtime-config";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  classifyDaemonServiceWakeability,
  DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES,
  type DaemonServiceWakeabilityClassification,
} from "../local-service/lifecycle/daemon-service-anomaly-groups";
import type { DaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import {
  getEffectiveDaemonRuntimeStatus,
  resolveDaemonRuntimeState,
  resolveDaemonServiceManagerForRuntimeState,
} from "../local-service/lifecycle/daemon-service-runtime";
import type { LocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import { resolveLocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import type { DeviceRuntimeStateSyncResult } from "../local-service/reporting/device-runtime-state-sync";
import { syncDeviceRuntimeStateProjection } from "../local-service/reporting/device-runtime-state-sync";
import {
  type EffectiveProfileWorkingFolderRuntimeResolution,
  resolveEffectiveProfileWorkingFolderRuntime,
} from "../profile-workspace/effective-runtime-resolution";
import {
  isOpenClawLocalDiagnosticsFailure,
  type OpenClawLocalDiagnostics,
  type OpenClawLocalDiagnosticsState,
} from "../provider-hosts/openclaw/diagnostics";
import { prepareProviderRuntime } from "../provider-hosts/prepare-provider-runtime";
import {
  type AgentProfilePrimaryAgentControllerReport,
  resolveAgentProfilePrimaryAgentControllerReport,
} from "./agent-profile-primary-binding";
import type {
  GatewayChainProfile,
  GatewayChainReadiness,
} from "./gateway-chain-readiness";
import { resolveGatewayChainReadiness } from "./gateway-chain-readiness";
import type { PrimaryBindingReadSession } from "./primary-binding-read-session";
import { resolveOpenClawDiagnosticsGuidance } from "./provider-diagnostics/openclaw/guidance";
import {
  formatManualSpaceParticipationReasonCopy,
  formatReplyReadinessUnavailableLabelCopy,
  REPLY_READINESS_COPY,
  resolveReplyReadinessAvailabilityReasonCopy,
  resolveReplyReadinessGuidanceSummaryCopy,
  resolveReplyReadinessReconnectingReasonCopy,
  resolveReplyReadinessStatusReasonCopy,
} from "./reply-readiness-copy";

const REPLY_READINESS_REASON_PRIORITY = [
  "profile.not_selected",
  "profile.inactive",
  "profile.unbound",
  "controller.binding.disabled",
  "projection.missing",
  "controller.registry.disabled",
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "workspace.missing",
  "workspace.invalid",
  "runtime.adapter.unsupported",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
  "service.not_installed",
  "service.drifted",
  "service.account_mismatch",
  "service.auth_missing",
  "service.auth_stale",
  "service.not_running",
  "dispatch.storage_not_ready",
  "service.gateway_chain_unhealthy",
  "local_agents.none_needed",
  "route.offline",
  "route.not_registered",
] satisfies readonly ReplyReadinessReasonCode[];

export type ReplyReadinessLevel = SharedReplyReadinessLevel;

export type ReplyReadinessReasonCode = SharedReplyReadinessReasonCode;

export type DeviceReplyReadinessStatus = {
  reasonCodes: ReplyReadinessReasonCode[];
  reasonText: string;
  replyReadiness: ReplyReadinessLevel;
  serviceWakeability?: Pick<
    DaemonServiceWakeabilityClassification,
    | "advisoryCodes"
    | "blockingCodes"
    | "conditionalCodes"
    | "executionEvidenceSafe"
  >;
  updatedAt: string;
  wakeableRouteCount: number;
};

export type AgentReplyReadinessStatus = {
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  localAgentId?: string | null;
  profileId: string;
  reasonCodes: ReplyReadinessReasonCode[];
  reasonText: string;
  replyReadiness: ReplyReadinessLevel;
  transportMode: string | null;
  updatedAt: string;
};

type ResolveDeviceReplyReadinessInput = {
  baseUrl?: string;
  checkGatewayChain?: boolean;
  gatewayChainProfile?: GatewayChainProfile | null;
  gatewayChainReadiness?: GatewayChainReadiness | null;
  gatewayChainTimeoutMs?: number;
  inventory?: DaemonServiceInventory | null;
  localDemand?: LocalServiceDemand | null;
  ownerUserId?: string | null;
  profile?: OpenMeldProfile | null;
  profileWorkspaceRuntimeResolution?: EffectiveProfileWorkingFolderRuntimeResolution | null;
  runtimeProjection?: DeviceRuntimeStateSyncResult | null;
  runtimeStatus?: DaemonServiceRuntimeStatus | null;
  runtimeWorkdir?: string;
  status?: DaemonStatus;
};

type ResolveAgentReplyReadinessInput = {
  bindingReads?: PrimaryBindingReadSession;
  coreWakeRouteOnline?: boolean;
  deviceReplyReadiness?: DeviceReplyReadinessStatus;
  openClawLocalDiagnostics?: OpenClawLocalDiagnosticsState | null;
  primaryAgentControllerReport?: AgentProfilePrimaryAgentControllerReport | null;
  profile: OpenMeldProfile;
  profileWorkspaceRuntimeResolution?: EffectiveProfileWorkingFolderRuntimeResolution | null;
};

type AgentPrimaryRuntimeContext = {
  executionTarget: AgentProfilePrimaryAgentControllerReport | null;
  targetState: Awaited<ReturnType<typeof resolveAgentTargetState>> | null;
  transportMode: string | null;
};

export async function resolveDeviceReplyReadinessStatus(
  input: ResolveDeviceReplyReadinessInput = {}
): Promise<DeviceReplyReadinessStatus> {
  const status = input.status ?? (await getDaemonStatus());
  if (!status.installed) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "service.not_installed",
      reasonText: resolveReplyReadinessAvailabilityReasonCopy(
        "service.not_installed"
      ),
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
  }

  const inventory =
    input.inventory ?? (await resolveReplyReadinessInventory(status));
  const runtimeStatus =
    input.runtimeStatus ??
    inventory?.runtimeStatus ??
    (await resolveDaemonRuntimeState(status));
  const runtimeProjection = await resolveDeviceReadinessRuntimeProjection(
    input.runtimeProjection
  );
  const localDemand = await resolveDeviceReadinessLocalDemand({
    localDemand: input.localDemand,
    ownerUserId: input.ownerUserId,
    projection: runtimeProjection,
    runtimeWorkdir: input.runtimeWorkdir,
  });
  const profileWorkspaceRuntimeResolution =
    input.profileWorkspaceRuntimeResolution ??
    (input.profile?.profileKind === "agent"
      ? await resolveEffectiveProfileWorkingFolderRuntime({
          defaultProjectId: input.profile.defaultProjectId,
          openMeldProfileId: input.profile.openMeldProfileId,
          mode: "inspect",
        })
      : null);

  const serviceReadiness = await resolveDeviceReplyReadinessFromServiceState({
    inventory,
    localDemand,
    runtimeStatus,
    status,
  });
  if (serviceReadiness) {
    return serviceReadiness;
  }

  const gatewayChainReadiness =
    input.checkGatewayChain === true
      ? (input.gatewayChainReadiness ??
        (await resolveGatewayChainReadinessFromInput({
          baseUrl: input.baseUrl,
          profile: input.gatewayChainProfile ?? input.profile ?? null,
          timeoutMs: input.gatewayChainTimeoutMs,
        }).catch(() => null)))
      : null;
  if (gatewayChainReadiness?.applicable && !gatewayChainReadiness.ready) {
    const gatewayChainReasonCode =
      gatewayChainReadiness.failureKind === "dispatch_storage_not_ready"
        ? "dispatch.storage_not_ready"
        : "service.gateway_chain_unhealthy";
    return createDeviceReplyReadinessStatus({
      reasonCode: gatewayChainReasonCode,
      reasonText: gatewayChainReadiness.summary,
      replyReadiness: "blocked",
      wakeableRouteCount: localDemand?.localExecutionRouteCount ?? 0,
    });
  }

  const profileWorkspaceReadiness =
    resolveDeviceReplyReadinessFromProfileWorkspace({
      localDemand,
      profile: input.profile ?? null,
      profileWorkspaceRuntimeResolution,
    });
  if (profileWorkspaceReadiness) {
    return profileWorkspaceReadiness;
  }

  if (localDemand?.hasLocalExecutionRoute) {
    return createDeviceReplyReadinessStatus({
      reasonText: REPLY_READINESS_COPY.deviceReadyReason,
      replyReadiness: "ready",
      wakeableRouteCount: localDemand.localExecutionRouteCount,
    });
  }

  const projectionBlockedStatus =
    resolveDeviceReplyReadinessFromRuntimeProjection(runtimeProjection);
  if (projectionBlockedStatus) {
    return projectionBlockedStatus;
  }

  return createRouteNotRegisteredReplyReadinessStatus({
    localDemand,
    runtimeProjection,
  });
}

async function resolveGatewayChainReadinessFromInput(input: {
  baseUrl?: string;
  profile: GatewayChainProfile | OpenMeldProfile | null;
  timeoutMs?: number;
}): Promise<GatewayChainReadiness | null> {
  if (!input.profile) {
    return null;
  }

  return await resolveGatewayChainReadiness({
    baseUrl: input.baseUrl,
    profile: {
      openMeldProfileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
    },
    timeoutMs: input.timeoutMs,
  });
}

export async function resolveAgentReplyReadinessStatus(
  input: ResolveAgentReplyReadinessInput
): Promise<AgentReplyReadinessStatus | null> {
  if (input.profile.profileKind !== "agent") {
    return null;
  }

  const deviceReplyReadiness =
    input.deviceReplyReadiness ??
    (await resolveDeviceReplyReadinessStatus({
      ownerUserId: input.profile.ownerUserId,
      profile: input.profile,
      profileWorkspaceRuntimeResolution:
        input.profileWorkspaceRuntimeResolution,
    }));
  const profileWorkspaceRuntimeResolution =
    input.profileWorkspaceRuntimeResolution ??
    (await resolveEffectiveProfileWorkingFolderRuntime({
      defaultProjectId: input.profile.defaultProjectId,
      openMeldProfileId: input.profile.openMeldProfileId,
      mode: "inspect",
    }));
  const { executionTarget, targetState, transportMode } =
    await resolveAgentPrimaryRuntimeContext({
      bindingReads: input.bindingReads,
      primaryAgentControllerReport: input.primaryAgentControllerReport,
      profile: input.profile,
    });
  const localAgentId = executionTarget?.localAgentId ?? null;
  const deviceReasonCodes = resolveAgentDeviceReasonCodes({
    coreWakeRouteOnline: input.coreWakeRouteOnline === true,
    deviceReasonCodes: deviceReplyReadiness.reasonCodes,
    serviceWakeability: deviceReplyReadiness.serviceWakeability,
  });
  const reasonCodes = collectAgentReplyReadinessReasonCodes({
    bindingReady:
      executionTarget?.bindingState === "enabled_primary" &&
      executionTarget.routable,
    deviceReasonCodes,
    profile: input.profile,
    targetState,
  });
  const workspaceReasonCode = resolveBlockingWorkspaceReasonCode({
    profileWorkspaceRuntimeResolution,
    reasonCodes,
  });
  if (workspaceReasonCode) {
    pushReasonCode(reasonCodes, workspaceReasonCode);
    const primaryReasonCode = sortReplyReadinessReasonCodes(reasonCodes)[0];
    return createAgentReplyReadinessStatus({
      deviceReplyReadiness,
      localAgentId,
      profileId: input.profile.openMeldProfileId,
      reasonCodes,
      reasonText: describeReplyReadinessReason(
        primaryReasonCode ?? workspaceReasonCode
      ),
      transportMode,
      replyReadiness: resolveReplyReadinessLevel(
        sortReplyReadinessReasonCodes(reasonCodes),
        deviceReplyReadiness
      ),
    });
  }
  const openClawLocalReadinessFailure =
    await resolveOpenClawLocalReadinessFailure({
      agentControllerRef: executionTarget?.agentControllerRef ?? null,
      diagnostics: input.openClawLocalDiagnostics ?? null,
      effectiveRuntimeWorkingDirectory:
        profileWorkspaceRuntimeResolution.status === "ready"
          ? profileWorkspaceRuntimeResolution.effectiveRuntimeWorkingDirectory
          : undefined,
      isOpenClawRuntime:
        executionTarget?.localAgentId === "openclaw" ||
        executionTarget?.capabilityId === "openclaw",
      profile: input.profile,
      reasonCodes,
    });
  if (openClawLocalReadinessFailure) {
    pushReasonCode(reasonCodes, openClawLocalReadinessFailure.reasonCode);
  }

  if (reasonCodes.length === 0) {
    return createAgentReplyReadinessStatus({
      deviceReplyReadiness,
      localAgentId,
      profileId: input.profile.openMeldProfileId,
      reasonText: REPLY_READINESS_COPY.agentReadyReason,
      transportMode,
      replyReadiness: "ready",
    });
  }

  const primaryReasonCode = reasonCodes[0] ?? "route.not_registered";
  return createAgentReplyReadinessStatus({
    deviceReplyReadiness,
    localAgentId,
    profileId: input.profile.openMeldProfileId,
    reasonCodes,
    reasonText:
      (primaryReasonCode === "controller.bootstrap.failed" ||
        primaryReasonCode === "controller.gateway.unhealthy") &&
      openClawLocalReadinessFailure
        ? openClawLocalReadinessFailure.message
        : describeReplyReadinessReason(primaryReasonCode),
    transportMode,
    replyReadiness: resolveReplyReadinessLevel(
      reasonCodes,
      deviceReplyReadiness
    ),
  });
}

function resolveAgentDeviceReasonCodes(input: {
  coreWakeRouteOnline: boolean;
  deviceReasonCodes: readonly ReplyReadinessReasonCode[];
  serviceWakeability?: DeviceReplyReadinessStatus["serviceWakeability"];
}): ReplyReadinessReasonCode[] {
  if (!input.coreWakeRouteOnline) {
    return [...input.deviceReasonCodes];
  }

  return input.deviceReasonCodes.filter(
    (reasonCode) =>
      reasonCode !== "service.not_running" &&
      reasonCode !== "route.offline" &&
      reasonCode !== "route.not_registered" &&
      !(
        reasonCode === "service.drifted" &&
        isConditionalServiceDrift(input.serviceWakeability)
      )
  );
}

function isConditionalServiceDrift(
  serviceWakeability: DeviceReplyReadinessStatus["serviceWakeability"]
): boolean {
  if (!serviceWakeability || serviceWakeability.blockingCodes.length === 0) {
    return false;
  }
  return serviceWakeability.blockingCodes.every((code) =>
    DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES.has(code)
  );
}

async function resolveAgentPrimaryRuntimeContext(input: {
  bindingReads?: PrimaryBindingReadSession;
  primaryAgentControllerReport?: AgentProfilePrimaryAgentControllerReport | null;
  profile: OpenMeldProfile;
}): Promise<AgentPrimaryRuntimeContext> {
  const executionTarget =
    input.primaryAgentControllerReport !== undefined
      ? input.primaryAgentControllerReport
      : await resolveAgentProfilePrimaryAgentControllerReport({
          ...(input.bindingReads ? { bindingReads: input.bindingReads } : {}),
          profile: input.profile,
        }).catch(() => null);
  const localAgentId = executionTarget?.localAgentId;
  if (!localAgentId) {
    return {
      executionTarget,
      targetState: null,
      transportMode: null,
    };
  }

  const fallbackTransportMode =
    createDefaultRuntimeAgentControllerSettings(localAgentId).transportMode;
  const targetState = await resolveAgentTargetState(localAgentId).catch(
    () => null
  );
  return {
    executionTarget,
    targetState,
    transportMode:
      targetState?.registration?.transportMode ?? fallbackTransportMode,
  };
}

function collectAgentReplyReadinessReasonCodes(input: {
  bindingReady: boolean;
  deviceReasonCodes: readonly ReplyReadinessReasonCode[];
  profile: OpenMeldProfile;
  targetState: Awaited<ReturnType<typeof resolveAgentTargetState>> | null;
}): ReplyReadinessReasonCode[] {
  const reasonCodes = [...input.deviceReasonCodes];
  const launchStatus = input.targetState?.launchStatus ?? null;
  if (input.profile.status !== "active") {
    pushReasonCode(reasonCodes, "profile.inactive");
  }
  if (!input.bindingReady) {
    pushReasonCode(reasonCodes, "profile.unbound");
  }
  if (
    input.targetState?.registered === false &&
    !(launchStatus === "needs_choice" || launchStatus === "needs_repair")
  ) {
    pushReasonCode(reasonCodes, "projection.missing");
  }
  if (
    input.targetState?.registered === true &&
    input.targetState.enabled !== true
  ) {
    pushReasonCode(reasonCodes, "controller.registry.disabled");
  }
  if (launchStatus === "needs_choice") {
    pushReasonCode(reasonCodes, "controller.launch.choice_required");
  }
  if (launchStatus === "needs_repair") {
    pushReasonCode(reasonCodes, "controller.launch.needs_repair");
  }
  return reasonCodes;
}

async function resolveOpenClawLocalReadinessFailure(input: {
  agentControllerRef: string | null;
  diagnostics?: OpenClawLocalDiagnosticsState | null;
  effectiveRuntimeWorkingDirectory?: string;
  isOpenClawRuntime: boolean;
  profile: OpenMeldProfile;
  reasonCodes: readonly ReplyReadinessReasonCode[];
}): Promise<{
  message: string;
  reasonCode: "controller.bootstrap.failed" | "controller.gateway.unhealthy";
} | null> {
  if (input.reasonCodes.length > 0 || !input.isOpenClawRuntime) {
    return null;
  }
  if (input.diagnostics) {
    return resolveOpenClawLocalReadinessFailureFromAvailableDiagnostics({
      diagnostics: input.diagnostics,
      profileId: input.profile.openMeldProfileId,
    });
  }
  const agentControllerRef = normalizeOptionalText(input.agentControllerRef);
  const runtimeAdapterContract = agentControllerRef
    ? resolveRegistryRuntimeAdapterContractByAgentControllerRef(
        agentControllerRef
      )
    : null;
  if (
    !agentControllerRef ||
    runtimeAdapterContract?.capabilityDeclaration.preparationRequirement !==
      "required"
  ) {
    return null;
  }
  try {
    if (!input.effectiveRuntimeWorkingDirectory) {
      throw Object.assign(
        new Error(
          `controller.bootstrap.failed: missing effective runtime working directory for ${input.profile.openMeldProfileId}`
        ),
        {
          code: "controller.bootstrap.failed",
        }
      );
    }
    await prepareProviderRuntime({
      agentControllerRef,
      daemonWorkingDirectory: input.effectiveRuntimeWorkingDirectory,
      mode: "reply_readiness",
      profileName: input.profile.profileName,
      runtimeContext: resolveReplyReadinessRuntimeContext(
        input.effectiveRuntimeWorkingDirectory,
        input.profile.openMeldProfileId
      ),
      targetProfileId: input.profile.openMeldProfileId,
    });
    return null;
  } catch (error) {
    const errorCode = extractPreparationFailureCode(error);
    return {
      message: error instanceof Error ? error.message : String(error),
      reasonCode:
        errorCode === "controller.bootstrap.failed"
          ? "controller.bootstrap.failed"
          : "controller.gateway.unhealthy",
    };
  }
}

function resolveReplyReadinessRuntimeContext(
  effectiveRuntimeWorkingDirectory: string,
  profileId: string
): ProviderDispatchRuntimeContext {
  const parsed = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: effectiveRuntimeWorkingDirectory,
  });
  if (parsed.success) {
    return parsed.data;
  }
  throw Object.assign(
    new Error(
      `controller.bootstrap.failed: invalid providerRuntimeWorkingDirectory for ${profileId}`
    ),
    {
      code: "controller.bootstrap.failed",
    }
  );
}

function resolveDeviceReplyReadinessFromProfileWorkspace(input: {
  localDemand: LocalServiceDemand | null;
  profile: OpenMeldProfile | null;
  profileWorkspaceRuntimeResolution: EffectiveProfileWorkingFolderRuntimeResolution | null;
}): DeviceReplyReadinessStatus | null {
  if (
    input.profile?.profileKind !== "agent" ||
    !input.profileWorkspaceRuntimeResolution ||
    input.profileWorkspaceRuntimeResolution.status === "ready"
  ) {
    return null;
  }

  return createDeviceReplyReadinessStatus({
    reasonCode: input.profileWorkspaceRuntimeResolution.reasonCode,
    reasonText: describeReplyReadinessReason(
      input.profileWorkspaceRuntimeResolution.reasonCode
    ),
    replyReadiness: "blocked",
    wakeableRouteCount: input.localDemand?.localExecutionRouteCount ?? 0,
  });
}

function resolveBlockingWorkspaceReasonCode(input: {
  profileWorkspaceRuntimeResolution: EffectiveProfileWorkingFolderRuntimeResolution | null;
  reasonCodes: readonly ReplyReadinessReasonCode[];
}): "workspace.invalid" | "workspace.missing" | null {
  if (input.reasonCodes.includes("workspace.missing")) {
    return "workspace.missing";
  }
  if (input.reasonCodes.includes("workspace.invalid")) {
    return "workspace.invalid";
  }
  if (!input.profileWorkspaceRuntimeResolution) {
    return null;
  }
  if (input.profileWorkspaceRuntimeResolution.status === "missing") {
    return "workspace.missing";
  }
  if (input.profileWorkspaceRuntimeResolution.status === "invalid") {
    return "workspace.invalid";
  }
  return null;
}

function extractPreparationFailureCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  const normalized = String((error as { code?: unknown }).code ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveOpenClawLocalReadinessFailureFromAvailableDiagnostics(input: {
  diagnostics: OpenClawLocalDiagnosticsState;
  profileId: string;
}): {
  message: string;
  reasonCode: "controller.bootstrap.failed" | "controller.gateway.unhealthy";
} | null {
  if (isOpenClawLocalDiagnosticsFailure(input.diagnostics)) {
    return {
      message: input.diagnostics.message,
      reasonCode:
        input.diagnostics.errorCode?.startsWith("openclaw.gateway") === true
          ? "controller.gateway.unhealthy"
          : "controller.bootstrap.failed",
    };
  }
  return resolveOpenClawLocalReadinessFailureFromDiagnostics({
    diagnostics: input.diagnostics,
    profileId: input.profileId,
  });
}

function resolveOpenClawLocalReadinessFailureFromDiagnostics(input: {
  diagnostics: OpenClawLocalDiagnostics;
  profileId: string;
}): {
  message: string;
  reasonCode: "controller.bootstrap.failed" | "controller.gateway.unhealthy";
} | null {
  const guidance = resolveOpenClawDiagnosticsGuidance({
    diagnostics: input.diagnostics,
    profileId: input.profileId,
  });
  if (input.diagnostics.bootstrapStatus !== "healthy") {
    return {
      message: guidance.summary,
      reasonCode: "controller.bootstrap.failed",
    };
  }
  if (
    input.diagnostics.gatewayHealth !== "healthy" ||
    input.diagnostics.gatewayVisibility === "not_checked" ||
    input.diagnostics.gatewayVisibility === "not_visible" ||
    input.diagnostics.gatewayVisibility === "restart_failed"
  ) {
    return {
      message: guidance.summary,
      reasonCode: "controller.gateway.unhealthy",
    };
  }
  return null;
}

export function formatDeviceReplyReadinessLabel(
  input: DeviceReplyReadinessStatus
): string {
  return formatReplyReadinessSummary({
    replyReadiness: input.replyReadiness,
    reasonText: input.reasonText,
    reasonCodes: input.reasonCodes,
  });
}

export function formatReplyReadinessSummary(input: {
  replyReadiness: ReplyReadinessLevel;
  reasonText: string;
  reasonCodes?: readonly ReplyReadinessReasonCode[];
}): string {
  if (input.replyReadiness === "ready") {
    return REPLY_READINESS_COPY.canReplyLabel;
  }
  if (input.reasonCodes?.[0] === "profile.unbound") {
    return formatReplyReadinessUnavailableLabelCopy(
      "blocked",
      resolveReplyReadinessAvailabilityReasonCopy("profile.unbound")
    );
  }
  return formatReplyReadinessUnavailableLabelCopy(
    input.replyReadiness,
    input.reasonText
  );
}

export function formatAgentReplyReadinessLabel(
  input: AgentReplyReadinessStatus
): string {
  return formatReplyReadinessSummary({
    replyReadiness: input.replyReadiness,
    reasonText: input.reasonText,
    reasonCodes: input.reasonCodes,
  });
}

export function formatHumanReplyReadinessReason(input: {
  replyReadiness: ReplyReadinessLevel;
  reasonText: string;
  reasonCodes?: readonly ReplyReadinessReasonCode[];
}): string {
  if (
    input.replyReadiness === "blocked" &&
    input.reasonCodes?.[0] === "profile.unbound"
  ) {
    return formatManualSpaceParticipationReasonCopy(
      resolveReplyReadinessAvailabilityReasonCopy("profile.unbound")
    );
  }
  return input.reasonText;
}

export function mapAgentReplyReadinessToLegacyAutoReply(
  input: AgentReplyReadinessStatus
): {
  ready: boolean;
  reason: string | null;
} {
  return {
    ready: input.replyReadiness === "ready",
    reason: input.replyReadiness === "ready" ? null : input.reasonText,
  };
}

async function resolveDeviceLocalDemand(input: {
  ownerUserId?: string | null;
  projection?: DeviceRuntimeStateSyncResult | null;
  runtimeWorkdir?: string;
}): Promise<LocalServiceDemand | null> {
  return await resolveLocalServiceDemand({
    ownerUserId: input.ownerUserId,
    projection: input.projection,
    runtimeWorkdir: input.runtimeWorkdir,
  }).catch(() => null);
}

async function resolveEffectiveRuntimeStatus(input: {
  inventory?: DaemonServiceInventory | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  status: DaemonStatus;
}): Promise<DaemonServiceRuntimeStatus["status"] | "not_installed"> {
  if (!input.status.installed) {
    return "not_installed";
  }
  if (input.inventory) {
    return getEffectiveDaemonRuntimeStatus({
      runtimeState: input.inventory.runtimeStatus,
      serviceManagerStatus: input.inventory.serviceManagerStatus,
    });
  }
  if (!input.runtimeStatus) {
    return "unknown";
  }

  const { serviceManagerStatus } =
    await resolveDaemonServiceManagerForRuntimeState({
      runtimeState: input.runtimeStatus,
      status: input.status,
    });
  return getEffectiveDaemonRuntimeStatus({
    runtimeState: input.runtimeStatus,
    serviceManagerStatus,
  });
}

async function resolveDeviceReadinessRuntimeProjection(
  runtimeProjection: DeviceRuntimeStateSyncResult | null | undefined
): Promise<DeviceRuntimeStateSyncResult | null> {
  if (runtimeProjection !== undefined) {
    return runtimeProjection;
  }
  return await resolveReplyReadinessRuntimeProjection();
}

async function resolveDeviceReadinessLocalDemand(input: {
  localDemand?: LocalServiceDemand | null;
  ownerUserId?: string | null;
  projection: DeviceRuntimeStateSyncResult | null;
  runtimeWorkdir?: string;
}): Promise<LocalServiceDemand | null> {
  if (input.localDemand !== undefined) {
    return input.localDemand;
  }
  return await resolveDeviceLocalDemand({
    ownerUserId: input.ownerUserId,
    projection: input.projection,
    runtimeWorkdir: input.runtimeWorkdir,
  });
}

async function resolveReplyReadinessInventory(
  _status: DaemonStatus
): Promise<DaemonServiceInventory | null> {
  return await inspectDaemonServiceInventory({
    expectedVersion: resolveCurrentDaemonExpectedVersion(),
    intent: "status_cleanup",
  }).catch(() => null);
}

async function resolveReplyReadinessRuntimeProjection(): Promise<DeviceRuntimeStateSyncResult | null> {
  return await syncDeviceRuntimeStateProjection({
    mode: "check",
  }).catch(() => null);
}

async function resolveDeviceReplyReadinessFromServiceState(input: {
  inventory?: DaemonServiceInventory | null;
  localDemand: LocalServiceDemand | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  status: DaemonStatus;
}): Promise<DeviceReplyReadinessStatus | null> {
  const wakeability = classifyDaemonServiceWakeability({
    inventory: input.inventory,
  });
  const effectiveRuntimeStatus = await resolveEffectiveRuntimeStatus({
    inventory: input.inventory,
    runtimeStatus: input.runtimeStatus,
    status: input.status,
  });
  if (effectiveRuntimeStatus === "stale") {
    return createDeviceReplyReadinessStatus({
      reasonCode: "service.not_running",
      reasonText: resolveReplyReadinessReconnectingReasonCopy(),
      replyReadiness: "degraded",
      wakeableRouteCount: input.localDemand?.localExecutionRouteCount ?? 0,
    });
  }
  if (effectiveRuntimeStatus !== "running") {
    return createDeviceReplyReadinessStatus({
      reasonCode: "service.not_running",
      reasonText: resolveReplyReadinessAvailabilityReasonCopy(
        "service.not_running"
      ),
      replyReadiness:
        effectiveRuntimeStatus === "unknown" ? "unknown" : "blocked",
      wakeableRouteCount: input.localDemand?.localExecutionRouteCount ?? 0,
    });
  }
  if (wakeability.blocksWake) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "service.drifted",
      reasonText:
        resolveReplyReadinessAvailabilityReasonCopy("service.drifted"),
      replyReadiness: "blocked",
      serviceWakeability: wakeability,
      wakeableRouteCount: input.localDemand?.localExecutionRouteCount ?? 0,
    });
  }
  return null;
}

function resolveDeviceReplyReadinessFromRuntimeProjection(
  runtimeProjection?: DeviceRuntimeStateSyncResult | null
): DeviceReplyReadinessStatus | null {
  if (runtimeProjection?.status !== "degraded") {
    return null;
  }
  if (runtimeProjection.missingControllerIds.length > 0) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "projection.missing",
      reasonText:
        resolveReplyReadinessAvailabilityReasonCopy("projection.missing"),
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
  }
  if (runtimeProjection.disabledControllerIds.length > 0) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "controller.registry.disabled",
      reasonText: resolveReplyReadinessAvailabilityReasonCopy(
        "controller.registry.disabled"
      ),
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
  }
  if ((runtimeProjection.repairRequiredControllerIds?.length ?? 0) > 0) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "controller.launch.needs_repair",
      reasonText: resolveReplyReadinessGuidanceSummaryCopy(
        "controller.launch.needs_repair",
        {
          targetLabel: REPLY_READINESS_COPY.localAgentRecoveryTargetLabel,
        }
      ),
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
  }
  return null;
}

function createRouteNotRegisteredReplyReadinessStatus(input: {
  localDemand: LocalServiceDemand | null;
  runtimeProjection?: DeviceRuntimeStateSyncResult | null;
}): DeviceReplyReadinessStatus {
  const projectionWithoutLocalDemand =
    input.localDemand?.projection ?? input.runtimeProjection;
  const noProjectedLocalControllers = hasNoProjectedLocalControllers(
    projectionWithoutLocalDemand
  );
  if (
    input.localDemand?.reason === "owner user is unavailable" &&
    !noProjectedLocalControllers
  ) {
    return createDeviceReplyReadinessStatus({
      reasonCode: "profile.not_selected",
      reasonText: resolveReplyReadinessAvailabilityReasonCopy(
        "profile.not_selected"
      ),
      replyReadiness: "unknown",
      wakeableRouteCount: 0,
    });
  }
  const reasonCode =
    input.runtimeProjection?.status === "skipped" || noProjectedLocalControllers
      ? "local_agents.none_needed"
      : "route.not_registered";
  return createDeviceReplyReadinessStatus({
    reasonCode,
    reasonText:
      normalizeOptionalText(
        input.localDemand?.reason ?? input.runtimeProjection?.reason
      ) ?? resolveReplyReadinessAvailabilityReasonCopy(reasonCode),
    replyReadiness:
      input.runtimeProjection?.status === "skipped" ||
      noProjectedLocalControllers
        ? "unknown"
        : "blocked",
    wakeableRouteCount: 0,
  });
}

function hasNoProjectedLocalControllers(
  projection: DeviceRuntimeStateSyncResult | null | undefined
): boolean {
  return (
    projection?.status === "ok" &&
    projection.projectedControllerIds.length === 0
  );
}

function createDeviceReplyReadinessStatus(input: {
  reasonCode?: ReplyReadinessReasonCode;
  reasonText: string;
  replyReadiness: ReplyReadinessLevel;
  serviceWakeability?: DeviceReplyReadinessStatus["serviceWakeability"];
  wakeableRouteCount: number;
}): DeviceReplyReadinessStatus {
  return {
    reasonCodes: sortReplyReadinessReasonCodes(
      input.reasonCode ? [input.reasonCode] : []
    ),
    reasonText: input.reasonText,
    replyReadiness: input.replyReadiness,
    ...(input.serviceWakeability
      ? { serviceWakeability: input.serviceWakeability }
      : {}),
    updatedAt: new Date().toISOString(),
    wakeableRouteCount: input.wakeableRouteCount,
  };
}

function createAgentReplyReadinessStatus(input: {
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  localAgentId: string | null;
  profileId: string;
  reasonCodes?: ReplyReadinessReasonCode[];
  reasonText: string;
  transportMode: string | null;
  replyReadiness: ReplyReadinessLevel;
}): AgentReplyReadinessStatus {
  return {
    deviceReplyReadiness: input.deviceReplyReadiness,
    localAgentId: input.localAgentId,
    profileId: input.profileId,
    reasonCodes: sortReplyReadinessReasonCodes(input.reasonCodes ?? []),
    reasonText: input.reasonText,
    replyReadiness: input.replyReadiness,
    transportMode: input.transportMode,
    updatedAt: new Date().toISOString(),
  };
}

function resolveReplyReadinessLevel(
  reasonCodes: ReplyReadinessReasonCode[],
  deviceReplyReadiness: DeviceReplyReadinessStatus
): ReplyReadinessLevel {
  if (reasonCodes.length === 0) {
    return "ready";
  }
  if (
    deviceReplyReadiness.replyReadiness === "degraded" &&
    reasonCodes[0] === "service.not_running"
  ) {
    return "degraded";
  }
  if (deviceReplyReadiness.replyReadiness === "unknown") {
    return "unknown";
  }
  return "blocked";
}

function pushReasonCode(
  target: ReplyReadinessReasonCode[],
  reasonCode: ReplyReadinessReasonCode
): void {
  if (target.includes(reasonCode)) {
    return;
  }
  target.push(reasonCode);
}

function sortReplyReadinessReasonCodes(
  reasonCodes: ReplyReadinessReasonCode[]
): ReplyReadinessReasonCode[] {
  return [...reasonCodes].sort(
    (left, right) =>
      REPLY_READINESS_REASON_PRIORITY.indexOf(left) -
      REPLY_READINESS_REASON_PRIORITY.indexOf(right)
  );
}

function describeReplyReadinessReason(
  reasonCode: ReplyReadinessReasonCode
): string {
  return resolveReplyReadinessStatusReasonCopy(reasonCode);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function isOpenClawAgentControllerReport(input: {
  capabilityId?: string | null;
  localAgentId?: string | null;
}): boolean {
  return input.localAgentId === "openclaw" || input.capabilityId === "openclaw";
}
