import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import { applyAcceptedLeases } from "@openmeld/local-service/heartbeat-policy";
import type { RuntimeTransportRegisterSessionResponse } from "@openmeld/schemas/types";
import { toErrorMessage } from "../core/logger";
import type {
  DaemonProfileSkipReason,
  MutableRouteCatalogState,
  RouteCatalog,
  RouteCatalogDiff,
  RouteCatalogSyncResult,
  SkippedDaemonProfile,
} from "../core/types";

export function buildRouteCatalogDiff(input: {
  currentProfileIds: string[];
  nextProfileIds: string[];
}): RouteCatalogDiff {
  const currentProfileIdsSet = new Set(input.currentProfileIds);
  const nextProfileIdsSet = new Set(input.nextProfileIds);
  const addedProfileIds = [...nextProfileIdsSet]
    .filter((profileId) => !currentProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  const removedProfileIds = [...currentProfileIdsSet]
    .filter((profileId) => !nextProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  const keptProfileIds = [...nextProfileIdsSet]
    .filter((profileId) => currentProfileIdsSet.has(profileId))
    .sort((left, right) => left.localeCompare(right));
  return {
    addedProfileIds,
    keptProfileIds,
    removedProfileIds,
  };
}

export function replaceRouteCatalogMap(input: {
  nextRouteByProfileId: RouteCatalog["routeByProfileId"];
  routeByProfileId: RouteCatalog["routeByProfileId"];
}): void {
  input.routeByProfileId.clear();
  for (const [profileId, routeConfig] of input.nextRouteByProfileId) {
    input.routeByProfileId.set(profileId, routeConfig);
  }
}

export function createMutableRouteCatalogState(
  routeCatalog: RouteCatalog
): MutableRouteCatalogState {
  return {
    ...(routeCatalog.expectedRoutesContractVersion
      ? {
          expectedRoutesContractVersion:
            routeCatalog.expectedRoutesContractVersion,
        }
      : {}),
    executionHostCatalogRevision: routeCatalog.executionHostCatalogRevision,
    fingerprint: buildRouteCatalogFingerprint(routeCatalog),
    profileIds: [...routeCatalog.profileIds],
    routeByProfileId: new Map(routeCatalog.routeByProfileId),
    skippedProfiles: [...routeCatalog.skippedProfiles],
    workingFolderExpectedProfileIds: [
      ...(routeCatalog.workingFolderExpectedProfileIds ?? []),
    ],
    workingFolderObservations: [
      ...(routeCatalog.workingFolderObservations ?? []),
    ],
  };
}

export function createRouteCatalogFromMutableState(
  state: MutableRouteCatalogState
): RouteCatalog {
  return {
    ...(state.expectedRoutesContractVersion
      ? { expectedRoutesContractVersion: state.expectedRoutesContractVersion }
      : {}),
    executionHostCatalogRevision: state.executionHostCatalogRevision,
    profileIds: [...state.profileIds],
    routeByProfileId: new Map(state.routeByProfileId),
    skippedProfiles: [...state.skippedProfiles],
    workingFolderExpectedProfileIds: [
      ...(state.workingFolderExpectedProfileIds ?? []),
    ],
    workingFolderObservations: [...(state.workingFolderObservations ?? [])],
  };
}

export async function syncDaemonRouteCatalogState(input: {
  catalogState: MutableRouteCatalogState;
  forceRegister?: boolean;
  leasesByProfileId: Map<string, number>;
  loadCatalog: () => Promise<RouteCatalog>;
  registerCatalog: (
    routeCatalog: RouteCatalog
  ) => Promise<RuntimeTransportRegisterSessionResponse>;
}): Promise<RouteCatalogSyncResult> {
  let nextCatalog: RouteCatalog;
  try {
    nextCatalog = await input.loadCatalog();
  } catch (error) {
    return {
      status: "failed",
      reason: "load_failed",
      errorMessage: toErrorMessage(error),
    };
  }

  const nextFingerprint = buildRouteCatalogFingerprint(nextCatalog);
  if (nextFingerprint === input.catalogState.fingerprint) {
    const shouldRefreshLeases =
      input.forceRegister ||
      nextCatalog.expectedRoutesContractVersion === "v4" ||
      nextCatalog.profileIds.some(
        (profileId) => !input.leasesByProfileId.has(profileId)
      );
    if (shouldRefreshLeases) {
      let registerResponse: RuntimeTransportRegisterSessionResponse;
      try {
        registerResponse = await input.registerCatalog(nextCatalog);
      } catch (error) {
        return {
          status: "failed",
          reason: "register_failed",
          errorMessage: toErrorMessage(error),
        };
      }

      applyAcceptedLeases({
        acceptedLeases: registerResponse.acceptedLeases,
        leasesByProfileId: input.leasesByProfileId,
      });
      replaceRouteCatalogMap({
        routeByProfileId: input.catalogState.routeByProfileId,
        nextRouteByProfileId: nextCatalog.routeByProfileId,
      });
      input.catalogState.profileIds = [...nextCatalog.profileIds];
      input.catalogState.fingerprint = nextFingerprint;
      input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
      input.catalogState.executionHostCatalogRevision =
        nextCatalog.executionHostCatalogRevision;
      input.catalogState.expectedRoutesContractVersion =
        nextCatalog.expectedRoutesContractVersion;
      input.catalogState.workingFolderExpectedProfileIds = [
        ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
      ];
      input.catalogState.workingFolderObservations = [
        ...(nextCatalog.workingFolderObservations ?? []),
      ];
      return {
        registerResponse,
        skippedProfiles: nextCatalog.skippedProfiles,
        status: "registered",
      };
    }
    input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
    input.catalogState.executionHostCatalogRevision =
      nextCatalog.executionHostCatalogRevision;
    input.catalogState.expectedRoutesContractVersion =
      nextCatalog.expectedRoutesContractVersion;
    input.catalogState.workingFolderExpectedProfileIds = [
      ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
    ];
    input.catalogState.workingFolderObservations = [
      ...(nextCatalog.workingFolderObservations ?? []),
    ];
    return {
      skippedProfiles: nextCatalog.skippedProfiles,
      status: "unchanged",
    };
  }

  let registerResponse: RuntimeTransportRegisterSessionResponse;
  try {
    registerResponse = await input.registerCatalog(nextCatalog);
  } catch (error) {
    return {
      status: "failed",
      reason: "register_failed",
      errorMessage: toErrorMessage(error),
    };
  }

  const diff = buildRouteCatalogDiff({
    currentProfileIds: input.catalogState.profileIds,
    nextProfileIds: nextCatalog.profileIds,
  });

  applyAcceptedLeases({
    acceptedLeases: registerResponse.acceptedLeases,
    leasesByProfileId: input.leasesByProfileId,
  });
  replaceRouteCatalogMap({
    routeByProfileId: input.catalogState.routeByProfileId,
    nextRouteByProfileId: nextCatalog.routeByProfileId,
  });
  input.catalogState.profileIds = [...nextCatalog.profileIds];
  input.catalogState.fingerprint = nextFingerprint;
  input.catalogState.skippedProfiles = [...nextCatalog.skippedProfiles];
  input.catalogState.executionHostCatalogRevision =
    nextCatalog.executionHostCatalogRevision;
  input.catalogState.expectedRoutesContractVersion =
    nextCatalog.expectedRoutesContractVersion;
  input.catalogState.workingFolderExpectedProfileIds = [
    ...(nextCatalog.workingFolderExpectedProfileIds ?? []),
  ];
  input.catalogState.workingFolderObservations = [
    ...(nextCatalog.workingFolderObservations ?? []),
  ];
  return {
    status: "changed",
    diff,
    registerResponse,
    skippedProfiles: nextCatalog.skippedProfiles,
  };
}

export function summarizeSkippedDaemonProfiles(
  skippedProfiles: SkippedDaemonProfile[]
): string {
  if (skippedProfiles.length === 0) {
    return "none";
  }
  const preview = skippedProfiles
    .slice(0, 3)
    .map((profile) => {
      const displayName = profile.profileName ?? profile.profileId;
      return `${displayName} (${profile.profileId}): ${formatDaemonProfileSkipReason(
        profile.skipReason
      )}`;
    })
    .join("; ");
  const remainingCount = skippedProfiles.length - 3;
  if (remainingCount <= 0) {
    return preview;
  }
  return `${preview}; +${String(remainingCount)} more`;
}

export function formatDaemonProfileSkipReason(
  skipReason: DaemonProfileSkipReason
): string {
  switch (skipReason) {
    case "model.retired":
      return "model retired; change this agent's model";
    case "model.unavailable":
      return "model unavailable; check this agent's model settings";
    case "projection.missing":
      return "local device runtime projection is missing";
    case "controller.registry.disabled":
      return "controller is disabled in the local agents registry";
    case "controller.launch.needs_repair":
      return "controller launch needs repair on this device";
    case "runtime.adapter.unsupported":
      return "local runtime adapter support is missing on this device";
    case "controller.binding.disabled":
      return "controller binding is disabled";
    case "controller.binding.incomplete":
      return "controller binding metadata is incomplete";
    case "profile.status.inactive":
      return "profile is not active";
    case "profile.binding.read_unavailable":
      return "profile binding could not be read";
    case "profile.binding.unbound":
      return "profile binding is not bound";
    case "workspace.missing":
      return "local profile workspace is missing";
    case "workspace.invalid":
      return "local profile workspace is invalid";
    default:
      return skipReason;
  }
}

function buildRouteCatalogFingerprint(routeCatalog: RouteCatalog): string {
  const entries = routeCatalog.profileIds.map((profileId) => {
    const route = routeCatalog.routeByProfileId.get(profileId);
    return {
      profileId,
      bindingId: route?.bindingId ?? null,
      configurationRevision: route?.configurationRevision ?? null,
      openMeldServiceRuntimeId: route?.openMeldServiceRuntimeId ?? null,
      agentControllerRef: route?.agentControllerRef ?? null,
      agentControllerConversationId:
        route?.agentControllerConversationId ?? null,
      agentControllerPermissionMode:
        route?.agentControllerPermissionMode ?? null,
      conversationPolicy: route?.conversationPolicy ?? null,
      openCodePermission: route?.openCodePermission ?? null,
      streamingMode: route?.streamingMode ?? null,
      transportMode: route?.transportMode ?? null,
      contextIdMappingSpec: route?.contextIdMappingSpec
        ? {
            sourceField: route.contextIdMappingSpec.sourceField,
            mappingVersion: route.contextIdMappingSpec.mappingVersion,
          }
        : null,
      workingFolderFact: route?.workingFolderRuntime?.workingFolderFact
        ? {
            defaultProjectId:
              route.workingFolderRuntime.workingFolderFact.defaultProjectId,
            localProjectBindingGeneration:
              route.workingFolderRuntime.workingFolderFact
                .localProjectBindingGeneration,
            source: route.workingFolderRuntime.workingFolderFact.source,
            status: route.workingFolderRuntime.workingFolderFact.status,
          }
        : null,
      workingFolderPathFingerprint:
        route?.workingFolderRuntime?.status === "ready" &&
        route.workingFolderRuntime.effectiveRuntimeWorkingDirectory
          ? buildRuntimeWorkspaceFingerprint(
              route.workingFolderRuntime.effectiveRuntimeWorkingDirectory
            )
          : null,
    };
  });
  const skippedProfiles = routeCatalog.skippedProfiles.map((profile) => ({
    profileId: profile.profileId,
    profileName: profile.profileName,
    skipReason: profile.skipReason,
  }));
  const workingFolderObservations = (
    routeCatalog.workingFolderObservations ?? []
  ).map((observation) => ({
    bindingId: observation.bindingId,
    configurationRevision: observation.configurationRevision,
    defaultProjectId: observation.defaultProjectId,
    localProjectBindingGeneration: observation.localProjectBindingGeneration,
    profileId: observation.profileId,
    reasonCode: observation.reasonCode,
    source: observation.source,
    status: observation.status,
  }));
  return JSON.stringify({
    entries,
    expectedRoutesContractVersion:
      routeCatalog.expectedRoutesContractVersion ?? null,
    skippedProfiles,
    workingFolderExpectedProfileIds:
      routeCatalog.workingFolderExpectedProfileIds ?? [],
    workingFolderObservations,
  });
}
