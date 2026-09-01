import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  parseAgentControllerRef,
  resolveConversationPolicyFromModelSelection,
  resolveNativeAgentControllerCollaborationModeForController,
  resolveNativeAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import type {
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  AgentProfileBindingModelSelection,
  GetAgentProfilePrimaryBindingResponse,
  ModelCatalog,
  OpenCodePermissionConfig,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import {
  type AgentsRegistryRuntimeAdapterMatch,
  resolveRegistryRuntimeAdapterByAgentControllerRef,
} from "../../agents/registry-source";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import {
  createDefaultRuntimeAgentControllerSettings,
  getConfiguredDeviceRuntimeState,
  type RuntimeAgentControllerSettings,
  type RuntimeAgentControllerState,
} from "../../config/runtime-config";
import {
  normalizeOptionalText,
  normalizeText,
  parseContextIdMappingSpec,
  parseRuntimeTransportMode,
  parseStreamingMode,
  parseTransportMode,
} from "../core/logger";
import type {
  DaemonProfileRouteResolution,
  DaemonProfileSkipReason,
} from "../core/types";

type ResolveLocalDaemonRouteCandidateInput = {
  localAdapterContainer: LocalDaemonAdapterContainer;
  localControllers: Map<string, RuntimeAgentControllerState>;
  modelCatalog: ModelCatalog;
  ownerUserId: string;
  primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
  profile: OpenMeldProfile;
};

export type ResolvedBoundProfileLocalRouteCandidate = {
  agentControllerRef: string;
  agentControllerConversationId: string | null;
  openMeldServiceRuntimeId: string;
  bindingId: string | null;
  configurationRevision?: number;
  agentControllerCollaborationMode?: AgentControllerCollaborationMode;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  modelSelection?: AgentProfileBindingModelSelection;
  openCodePermission?: OpenCodePermissionConfig;
  profileId: string;
};

export type LocalRuntimeControllerSupport =
  | {
      localAdapterEntry: ReturnType<
        LocalDaemonAdapterContainer["getRequiredAdapter"]
      >;
      reasonCode?: never;
      reasonDetail?: never;
      runtimeAdapterMatch: AgentsRegistryRuntimeAdapterMatch;
      supported: true;
    }
  | {
      reasonCode: "runtime.adapter.unsupported";
      reasonDetail: string;
      supported: false;
    };

export async function readLocalEnabledControllers(): Promise<
  Map<string, RuntimeAgentControllerState>
> {
  const runtimeState = await getConfiguredDeviceRuntimeState();
  const map = new Map<string, RuntimeAgentControllerState>();
  for (const controller of runtimeState?.controllers ?? []) {
    const controllerId = normalizeText(controller.agentId);
    if (!controllerId) {
      continue;
    }
    map.set(controllerId, controller);
  }
  return map;
}

export function resolveLocalController(input: {
  agentControllerRef: string;
  localControllers: Map<string, RuntimeAgentControllerState>;
}): RuntimeAgentControllerState | null {
  const direct = input.localControllers.get(input.agentControllerRef);
  if (direct) {
    return direct;
  }

  const [agentControllerRefKind, controllerId] = splitAgentControllerRef(
    input.agentControllerRef
  );
  if (agentControllerRefKind && controllerId) {
    const bySplit = input.localControllers.get(controllerId);
    if (bySplit) {
      return bySplit;
    }
  }
  return null;
}

export function splitAgentControllerRef(
  value: string
): ["builtin" | "custom" | null, string | null] {
  const normalized = normalizeText(value);
  if (!normalized.includes(":")) {
    return [null, normalized || null];
  }
  const [kind, ref] = normalized.split(":", 2);
  if (!(kind && ref)) {
    return [null, null];
  }
  if (kind === "builtin" || kind === "custom") {
    return [kind, ref];
  }
  return [null, normalized];
}

export function isEligibleOwnerAgentProfile(
  profile: OpenMeldProfile,
  ownerUserId: string
): boolean {
  if (profile.profileKind !== "agent") {
    return false;
  }
  if (profile.status !== "active") {
    return false;
  }
  if (normalizeText(profile.ownerUserId) !== ownerUserId) {
    return false;
  }
  return true;
}

export function resolveLocalRuntimeControllerSupport(input: {
  agentControllerRef: string;
  localAdapterContainer: LocalDaemonAdapterContainer;
}): LocalRuntimeControllerSupport {
  const runtimeAdapterMatch = resolveRegistryRuntimeAdapterByAgentControllerRef(
    input.agentControllerRef
  );
  if (!runtimeAdapterMatch) {
    return {
      supported: false,
      reasonCode: "runtime.adapter.unsupported",
      reasonDetail: `unsupported agentControllerRef '${input.agentControllerRef}' (no runtime adapter match found in registry)`,
    };
  }

  const localAdapterEntry = input.localAdapterContainer.getAdapter(
    runtimeAdapterMatch.adapterId
  );
  if (!localAdapterEntry) {
    return {
      supported: false,
      reasonCode: "runtime.adapter.unsupported",
      reasonDetail: `unsupported agentControllerRef '${input.agentControllerRef}' (matched adapter '${runtimeAdapterMatch.adapterId}', local daemon adapter container does not provide this adapter)`,
    };
  }

  return {
    supported: true,
    runtimeAdapterMatch,
    localAdapterEntry,
  };
}

export function buildRuntimeRouteTargets(input: {
  agentControllerRef: string;
  launchContract?: RuntimeAgentControllerState["launchContract"] | null;
  runtimeControllerSupport: Extract<
    LocalRuntimeControllerSupport,
    { supported: true }
  >;
}): Array<{
  adapter: RuntimeAdapter;
  agentControllerRef: string;
  controllerRefMatcher: AgentsRegistryRuntimeAdapterMatch["controllerRefMatcher"];
  transportMode: RuntimeTransportMode;
}> {
  const routeTransportModes = new Set<RuntimeTransportMode>();
  for (const transportMode of input.runtimeControllerSupport.runtimeAdapterMatch
    .transportModes) {
    const parsedTransportMode = parseRuntimeTransportMode(transportMode);
    if (!parsedTransportMode) {
      continue;
    }
    routeTransportModes.add(parsedTransportMode);
  }

  if (routeTransportModes.size === 0) {
    const defaultTransportMode = parseRuntimeTransportMode(
      createDefaultRuntimeAgentControllerSettings(input.agentControllerRef)
        .transportMode
    );
    if (defaultTransportMode) {
      routeTransportModes.add(defaultTransportMode);
    }
  }

  return [...routeTransportModes].map((transportMode) => ({
    adapter: input.runtimeControllerSupport.localAdapterEntry.adapter,
    agentControllerRef: input.agentControllerRef,
    controllerRefMatcher:
      input.runtimeControllerSupport.runtimeAdapterMatch.controllerRefMatcher,
    ...(input.launchContract ? { launchContract: input.launchContract } : {}),
    transportMode,
  }));
}

export function resolveLocalDaemonRouteCandidate(
  input: ResolveLocalDaemonRouteCandidateInput
): DaemonProfileRouteResolution {
  const routeCandidate = resolveBoundProfileLocalRouteCandidate(input);
  if ("status" in routeCandidate) {
    return routeCandidate;
  }

  return resolveLocalRouteCandidateFromBoundTarget({
    boundTarget: routeCandidate,
    localAdapterContainer: input.localAdapterContainer,
    localControllers: input.localControllers,
    modelCatalog: input.modelCatalog,
  });
}

// The local half of route candidate resolution: given a Core-confirmed bound
// execution target, decide whether THIS device can carry it (controller
// registered + enabled + launchable + adapter support). Shared by the
// per-profile binding path and the expected-routes projection path.
export function resolveLocalRouteCandidateFromBoundTarget(input: {
  boundTarget: ResolvedBoundProfileLocalRouteCandidate;
  localAdapterContainer: LocalDaemonAdapterContainer;
  localControllers: Map<string, RuntimeAgentControllerState>;
  modelCatalog: ModelCatalog;
}): DaemonProfileRouteResolution {
  const {
    agentControllerRef,
    agentControllerConversationId,
    openMeldServiceRuntimeId,
    bindingId,
    configurationRevision,
    profileId,
  } = input.boundTarget;
  const agentControllerPermissionMode =
    resolveNativeAgentControllerPermissionModeForController(
      input.boundTarget.agentControllerPermissionMode,
      { agentControllerRef }
    );
  const agentControllerCollaborationMode =
    resolveNativeAgentControllerCollaborationModeForController(
      input.boundTarget.agentControllerCollaborationMode,
      { agentControllerRef }
    );

  const localController = resolveLocalController({
    agentControllerRef,
    localControllers: input.localControllers,
  });
  if (!localController) {
    return {
      profileId,
      skipReason: "projection.missing",
      status: "skipped",
    };
  }

  if (localController.enabled !== true) {
    return {
      profileId,
      skipReason: "controller.registry.disabled",
      status: "skipped",
    };
  }
  if (!localController.launchContract) {
    return {
      profileId,
      skipReason: "controller.launch.needs_repair",
      status: "skipped",
    };
  }

  const runtimeControllerSupport = resolveLocalRuntimeControllerSupport({
    agentControllerRef,
    localAdapterContainer: input.localAdapterContainer,
  });
  if (!runtimeControllerSupport.supported) {
    return {
      profileId,
      skipReason: runtimeControllerSupport.reasonCode,
      status: "skipped",
    };
  }

  return buildAcceptedLocalDaemonRouteCandidate({
    agentControllerRef,
    agentControllerConversationId,
    agentControllerCollaborationMode,
    agentControllerPermissionMode,
    openMeldServiceRuntimeId,
    bindingId,
    configurationRevision,
    localController,
    modelCatalog: input.modelCatalog,
    modelSelection: input.boundTarget.modelSelection,
    openCodePermission: input.boundTarget.openCodePermission,
    profileId,
    runtimeControllerSupport,
  });
}

function resolveBoundProfileLocalRouteCandidate(input: {
  ownerUserId: string;
  primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
  profile: OpenMeldProfile;
}):
  | Extract<DaemonProfileRouteResolution, { status: "skipped" }>
  | ResolvedBoundProfileLocalRouteCandidate {
  const ineligibleResolution = resolveIneligibleLocalRouteCandidate(input);
  if (ineligibleResolution) {
    return ineligibleResolution;
  }

  const profileId = normalizeText(input.profile.openMeldProfileId);
  const binding = input.primaryBinding;
  if (!binding || binding.bindingState === "missing") {
    return buildSkippedLocalDaemonRouteCandidate({
      profileId,
      skipReason: "profile.binding.unbound",
    });
  }
  if (binding.bindingState !== "enabled_primary" || !binding.routable) {
    return buildSkippedLocalDaemonRouteCandidate({
      profileId,
      skipReason: "controller.binding.disabled",
    });
  }

  const executionTarget = binding.executionTarget;
  const agentControllerRef = parseAgentControllerRef(
    executionTarget?.agentControllerRef
  );
  if (!(agentControllerRef && executionTarget && profileId)) {
    return buildSkippedLocalDaemonRouteCandidate({
      profileId,
      skipReason: "controller.binding.incomplete",
    });
  }

  const agentControllerPermissionMode =
    resolveNativeAgentControllerPermissionModeForController(
      binding.agentControllerPermissionMode,
      { agentControllerRef: agentControllerRef.ref }
    );
  const agentControllerCollaborationMode =
    resolveNativeAgentControllerCollaborationModeForController(
      binding.agentControllerCollaborationMode,
      { agentControllerRef: agentControllerRef.ref }
    );

  return {
    agentControllerRef: agentControllerRef.ref,
    agentControllerConversationId: normalizeOptionalText(
      executionTarget.agentControllerConversationId
    ),
    openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId.value,
    bindingId: normalizeOptionalText(binding.bindingId),
    ...(agentControllerCollaborationMode
      ? { agentControllerCollaborationMode }
      : {}),
    ...(agentControllerPermissionMode ? { agentControllerPermissionMode } : {}),
    ...(binding.modelSelection
      ? { modelSelection: binding.modelSelection }
      : {}),
    ...(binding.openCodePermission
      ? { openCodePermission: binding.openCodePermission }
      : {}),
    profileId,
  };
}

function resolveIneligibleLocalRouteCandidate(input: {
  ownerUserId: string;
  profile: OpenMeldProfile;
}): Extract<DaemonProfileRouteResolution, { status: "skipped" }> | null {
  if (isEligibleOwnerAgentProfile(input.profile, input.ownerUserId)) {
    return null;
  }

  const profileId = normalizeText(input.profile.openMeldProfileId);
  if (!(profileId && input.profile.profileKind === "agent")) {
    return buildSkippedLocalDaemonRouteCandidate();
  }

  if (normalizeText(input.profile.ownerUserId) !== input.ownerUserId) {
    return buildSkippedLocalDaemonRouteCandidate();
  }

  if (input.profile.status !== "active") {
    return buildSkippedLocalDaemonRouteCandidate({
      profileId,
      skipReason: "profile.status.inactive",
    });
  }

  return buildSkippedLocalDaemonRouteCandidate();
}

function buildAcceptedLocalDaemonRouteCandidate(input: {
  agentControllerRef: string;
  agentControllerConversationId: string | null;
  agentControllerCollaborationMode?: AgentControllerCollaborationMode;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  openMeldServiceRuntimeId: string;
  bindingId: string | null;
  configurationRevision?: number;
  localController: RuntimeAgentControllerState;
  modelCatalog: ModelCatalog;
  modelSelection?: AgentProfileBindingModelSelection;
  openCodePermission?: OpenCodePermissionConfig;
  profileId: string;
  runtimeControllerSupport: Extract<
    LocalRuntimeControllerSupport,
    { supported: true }
  >;
}): DaemonProfileRouteResolution {
  const defaults = createDefaultRuntimeAgentControllerSettings(
    input.agentControllerRef
  );
  const conversationPolicyResolution =
    resolveConversationPolicyFromModelSelection({
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerRef: input.agentControllerRef,
      catalog: input.modelCatalog,
      modelSelection: input.modelSelection,
    });
  return {
    profileId: input.profileId,
    route: {
      ...(input.bindingId ? { bindingId: input.bindingId } : {}),
      ...(input.configurationRevision
        ? { configurationRevision: input.configurationRevision }
        : {}),
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      ...(input.agentControllerPermissionMode
        ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
        : {}),
      ...(input.agentControllerCollaborationMode
        ? {
            agentControllerCollaborationMode:
              input.agentControllerCollaborationMode,
          }
        : {}),
      conversationPolicy: {
        ...conversationPolicyResolution.conversationPolicy,
        ...(input.agentControllerCollaborationMode
          ? {
              collaborationMode:
                input.agentControllerCollaborationMode === "codex:plan"
                  ? "plan"
                  : "default",
            }
          : {}),
      },
      ...(input.openCodePermission
        ? { openCodePermission: input.openCodePermission }
        : {}),
      contextIdMappingSpec:
        parseContextIdMappingSpec(input.localController.contextIdMappingSpec) ??
        defaults.contextIdMappingSpec,
      agentControllerRef: input.agentControllerRef,
      agentControllerConversationId: input.agentControllerConversationId,
      launchContract: input.localController.launchContract,
      profileId: input.profileId,
      streamingMode:
        parseStreamingMode(input.localController.streamingMode) ??
        parseStreamingMode(
          input.runtimeControllerSupport.runtimeAdapterMatch
            .defaultStreamingMode
        ) ??
        defaults.streamingMode,
      transportMode: resolveAcceptedRouteTransportMode({
        defaults,
        localController: input.localController,
        runtimeControllerSupport: input.runtimeControllerSupport,
      }),
    },
    status: "accepted",
  };
}

function resolveAcceptedRouteTransportMode(input: {
  defaults: RuntimeAgentControllerSettings;
  localController: RuntimeAgentControllerState;
  runtimeControllerSupport: Extract<
    LocalRuntimeControllerSupport,
    { supported: true }
  >;
}): RuntimeTransportMode {
  const supportedTransportModes = new Set<RuntimeTransportMode>();
  for (const transportMode of input.runtimeControllerSupport.runtimeAdapterMatch
    .transportModes) {
    const parsedTransportMode = parseRuntimeTransportMode(transportMode);
    if (parsedTransportMode) {
      supportedTransportModes.add(parsedTransportMode);
    }
  }

  const configuredTransportMode = parseTransportMode(
    input.localController.transportMode
  );
  if (
    configuredTransportMode &&
    supportedTransportModes.has(configuredTransportMode)
  ) {
    return configuredTransportMode;
  }

  const registryDefaultTransportMode = parseRuntimeTransportMode(
    input.runtimeControllerSupport.runtimeAdapterMatch.defaultTransportMode
  );
  if (
    registryDefaultTransportMode &&
    supportedTransportModes.has(registryDefaultTransportMode)
  ) {
    return registryDefaultTransportMode;
  }

  const firstSupportedTransportMode = [...supportedTransportModes][0] ?? null;
  if (firstSupportedTransportMode) {
    return firstSupportedTransportMode;
  }

  return input.defaults.transportMode;
}

function buildSkippedLocalDaemonRouteCandidate(input?: {
  profileId?: string | null;
  skipReason?: DaemonProfileSkipReason;
}): Extract<DaemonProfileRouteResolution, { status: "skipped" }> {
  return {
    ...(input?.profileId ? { profileId: input.profileId } : {}),
    ...(input?.skipReason ? { skipReason: input.skipReason } : {}),
    status: "skipped",
  };
}
