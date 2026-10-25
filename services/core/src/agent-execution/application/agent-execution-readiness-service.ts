import {
  type AgentExecutionBindingEvidence,
  type AgentExecutionClaimDiagnosticEvidence,
  type AgentExecutionLocalServiceEvidence,
  type AgentExecutionProfileEvidence,
  type AgentExecutionProviderAccountEvidence,
  type AgentExecutionProviderConversationEvidence,
  type AgentExecutionReadinessImpactEvidence,
  type AgentExecutionRouteEvidence,
  type AgentExecutionServiceEvidence,
  type AgentExecutionStatusProjection,
  type AgentProfileBindingDisplayProjection,
  type AgentWakeRouteRegistration,
  createAuthorityOpenMeldServiceRuntimeId,
  type PrepareReadinessSummary,
  parseAgentControllerRef,
  resolveAgentControllerUsageLimitSupport,
  resolveAgentControllerUsageProviderId,
  resolveAgentExecutionStatus,
  resolveAgentProfileUsageWakeability,
  resolvePrepareReadinessFromAgentControllerReports,
  type WakeRouteLane,
  type WakeRouteStatus,
} from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  isHostedAgentControllerRef,
} from "@openmeld/schemas";
import type {
  AgentControllerPermissionMode,
  AgentProfileBindingModelSelection,
  DaemonExecutionCompatibility,
  DaemonRouteObservationSummary,
  DaemonServiceLane,
  LocalComponentsStatus,
  LocalWakeRouteReport,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportLookupRouteResponse,
  SpaceMemberAgentExecutionReadiness,
} from "@openmeld/schemas/types";
import { createAgentProfileBindingProjectionFromRecord } from "../../agent-profile-binding/application/agent-profile-binding-lookup-service";
import { resolveCurrentWorkingFolderObservation } from "../../agent-profile-binding/application/current-working-folder-observation";
import { isAgentProfileEligibleForOrganization } from "../../center-agent/center-agent-organization-scope";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../../center-agent/center-agent-repository";
import { resolveCurrentAgentModelAvailability } from "../../config/agent-model-availability";
import {
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoute,
} from "../../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../../lib/bindings";
import {
  type CoreLocalComponentsRelease,
  readCoreLocalComponentsRelease,
} from "../../local-components/release-source";
import { resolveCoreRuntimeContractRollout } from "../../local-components/runtime-contract-rollout";
import { resolveLocalComponentUpdateProjection } from "../../local-components/update-projection";
import { resolveRemoteAgentRuntimeAvailability } from "../../remote-agent/application/remote-agent-runtime-policy";
import {
  listOwnedDeviceExecutionTargetRecords,
  type RuntimeRegistryRecord,
} from "../../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  resolveConnectedLocalRuntimeDisplayNamesUseCase,
  resolveConnectedLocalRuntimeDisplayNameUseCase,
} from "../../start/application/current-device-target-service";
import { resolveCurrentDeviceFromBindings } from "../../start/infrastructure/postgresql/current-device-derivation-repo";
import { listOwnedDeviceRegistryRecords } from "../../start/infrastructure/postgresql/owned-device-registry-repo";
import { RUNTIME_TRANSPORT_LEASE_TTL_MS } from "../../strategy-constants";
import {
  type AgentExecutionReadinessReads,
  createAgentExecutionReadinessReads,
} from "./agent-execution-readiness-reads";

export type AgentExecutionReadinessAgentInput = {
  controllerRefSnapshot: string | null;
  ownerUserIdSnapshot: string | null;
  profileId: string;
  profileNameSnapshot: string | null;
};

export type CoreAgentExecutionReadiness = {
  agentExecutionReadiness: AgentExecutionStatusProjection;
  agentControllerRef: string | null;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  modelSelection?: AgentProfileBindingModelSelection;
  primaryBinding: AgentProfileBindingDisplayProjection | null;
  daemonRouteObservation: DaemonRouteObservationSummary;
  ownerUserId: string | null;
  profileName: string | null;
  agentWakeRouteRegistration: AgentWakeRouteRegistration;
  wakeRouteStatus: WakeRouteStatus;
  routeDeviceId: string | null;
  routeLane: string | null;
  runtimeDeviceDisplayName: string | null;
  spaceMemberAgentExecutionReadiness: SpaceMemberAgentExecutionReadiness;
};

export type AgentExecutionReadinessProfileInput = {
  reads?: AgentExecutionReadinessReads;
  activeOrganizationId?: string | null;
  env: CoreBindings;
  generatedAt?: string;
  includeRuntimeDeviceDisplayName?: boolean;
  // Batch callers prefetch all routes in one RuntimeTransport round trip and hand
  // each profile its slice here; per-profile callers leave it undefined and
  // the live lookup runs as before.
  preloadedDaemonRoute?: RuntimeTransportLookupRouteResponse | null;
  preloadedOwnerService?: RuntimeTransportLookupOwnerServiceResponse | null;
  preloadedRuntimeDeviceDisplayName?: string | null;
  profileId: string;
  targetRuntime?: AgentExecutionTargetRuntimeContext | null;
};

export type AgentExecutionTargetRuntimeContext = {
  deviceId: string;
  lane: DaemonServiceLane;
  ownerUserId: string;
  openMeldServiceRuntimeId: string | null;
  source: "current_local_runtime" | "openmeld_service_runtime_id";
};

type AgentBindingSnapshot = {
  agentExecutionBinding: AgentExecutionBindingEvidence | null;
  bindingEnabled: boolean;
  bindingState: "bound" | "missing";
  claimDiagnostics: AgentExecutionClaimDiagnosticEvidence | null;
  agentControllerRef: string | null;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  modelSelection?: AgentProfileBindingModelSelection;
  primaryBinding: AgentProfileBindingDisplayProjection | null;
  daemonRouteObservation: DaemonRouteObservationSummary;
  localService: AgentExecutionLocalServiceEvidence | null;
  ownerUserId: string | null;
  profileEvidence: AgentExecutionProfileEvidence;
  profileName: string | null;
  providerAccount: AgentExecutionProviderAccountEvidence | null;
  providerConversation: AgentExecutionProviderConversationEvidence | null;
  agentWakeRouteRegistration: AgentWakeRouteRegistration;
  wakeRouteStatus: WakeRouteStatus;
  routeEvidence?: AgentExecutionRouteEvidence;
  readinessImpact: AgentExecutionReadinessImpactEvidence | null;
  routeDeviceId: string | null;
  routeLane: string | null;
  runtimeDeviceDisplayName: string | null;
  runtimeReadiness: PrepareReadinessSummary | null;
  service: AgentExecutionServiceEvidence | null;
};

type ProfileIdentitySnapshot = Omit<
  AgentBindingSnapshot,
  | "agentExecutionBinding"
  | "claimDiagnostics"
  | "localService"
  | "providerAccount"
  | "providerConversation"
  | "readinessImpact"
  | "runtimeReadiness"
  | "service"
> & { defaultProjectId: string | null };

type ResolveAgentBindingSnapshotInput = {
  reads: AgentExecutionReadinessReads;
  activeOrganizationId: string | null;
  preloadedDaemonRoute?: RuntimeTransportLookupRouteResponse | null;
  preloadedOwnerService?: RuntimeTransportLookupOwnerServiceResponse | null;
  preloadedRuntimeDeviceDisplayName?: string | null;
  agent: AgentExecutionReadinessAgentInput;
  env: CoreBindings;
  generatedAt: string;
  includeRuntimeDeviceDisplayName: boolean;
  targetRuntime: AgentExecutionTargetRuntimeContext | null;
  timing: ReadinessTimingRecorder;
  localComponentsRelease: CoreLocalComponentsRelease;
};

type LocalExecutionServiceEvidenceResolution = {
  localService: AgentExecutionLocalServiceEvidence | null;
  service: AgentExecutionServiceEvidence | null;
};

type RuntimeRouteSnapshot = {
  daemonRouteObservation: DaemonRouteObservationSummary;
  agentWakeRouteRegistration: AgentWakeRouteRegistration;
  wakeRouteStatus: WakeRouteStatus;
  routeEvidence?: AgentExecutionRouteEvidence;
  hasFreshRouteLease: boolean;
  currentSession: {
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
  } | null;
  localWakeRouteReport: LocalWakeRouteReport | null;
  pendingFirstReportOwnerService: {
    deviceId: string;
    lane: DaemonServiceLane;
  } | null;
  routeDeviceId: string | null;
  routeLane: string | null;
  runtimeDeviceDisplayName: string | null;
  serviceCompatibility: DaemonExecutionCompatibility | null;
  localComponentsStatus: LocalComponentsStatus | null;
  serviceVersion: string | null;
};

type ReadinessTimingStep =
  | "profile_identity_lookup"
  | "binding_evidence_read"
  | "claim_diagnostics_read"
  | "daemon_route_lookup"
  | "provider_account_evidence_read"
  | "provider_conversation_evidence_read"
  | "readiness_impact_evidence_read"
  | "runtime_device_display_read"
  | "runtime_readiness_read";

type ReadinessTimingRecorder = {
  durationsMs: Partial<Record<ReadinessTimingStep, number>>;
};

type AuthWorkerWithProfileLookup = NonNullable<
  CoreBindings["OPENMELD_AUTH_WORKER"]
> & {
  resolveProfileById: NonNullable<
    NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
  >;
};

export function resolveCoreAgentExecutionReadinessForProfile(
  input: AgentExecutionReadinessProfileInput
): Promise<CoreAgentExecutionReadiness> {
  return resolveCoreAgentExecutionReadiness({
    reads: input.reads,
    activeOrganizationId: input.activeOrganizationId ?? null,
    agent: {
      controllerRefSnapshot: null,
      ownerUserIdSnapshot: null,
      profileId: input.profileId,
      profileNameSnapshot: null,
    },
    env: input.env,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    includeRuntimeDeviceDisplayName:
      input.includeRuntimeDeviceDisplayName ?? true,
    ...(input.preloadedDaemonRoute === undefined
      ? {}
      : { preloadedDaemonRoute: input.preloadedDaemonRoute }),
    ...(input.preloadedOwnerService === undefined
      ? {}
      : { preloadedOwnerService: input.preloadedOwnerService }),
    ...(input.preloadedRuntimeDeviceDisplayName === undefined
      ? {}
      : {
          preloadedRuntimeDeviceDisplayName:
            input.preloadedRuntimeDeviceDisplayName,
        }),
    targetRuntime: input.targetRuntime ?? null,
  });
}

export async function resolveCoreAgentExecutionReadiness(input: {
  reads?: AgentExecutionReadinessReads;
  activeOrganizationId?: string | null;
  agent: AgentExecutionReadinessAgentInput;
  env: CoreBindings;
  generatedAt: string;
  includeRuntimeDeviceDisplayName?: boolean;
  preloadedDaemonRoute?: RuntimeTransportLookupRouteResponse | null;
  preloadedOwnerService?: RuntimeTransportLookupOwnerServiceResponse | null;
  preloadedRuntimeDeviceDisplayName?: string | null;
  targetRuntime?: AgentExecutionTargetRuntimeContext | null;
}): Promise<CoreAgentExecutionReadiness> {
  const startedAtMs = Date.now();
  const timing: ReadinessTimingRecorder = { durationsMs: {} };
  const localComponentsRelease = await readCoreLocalComponentsRelease(
    input.env.OPENMELD_CLI_RELEASES
  );
  const bindingSnapshot = await resolveAgentBindingSnapshot({
    localComponentsRelease,
    reads: input.reads ?? createAgentExecutionReadinessReads(),
    activeOrganizationId: input.activeOrganizationId ?? null,
    agent: input.agent,
    env: input.env,
    generatedAt: input.generatedAt,
    includeRuntimeDeviceDisplayName:
      input.includeRuntimeDeviceDisplayName ?? true,
    ...(input.preloadedDaemonRoute === undefined
      ? {}
      : { preloadedDaemonRoute: input.preloadedDaemonRoute }),
    ...(input.preloadedOwnerService === undefined
      ? {}
      : { preloadedOwnerService: input.preloadedOwnerService }),
    ...(input.preloadedRuntimeDeviceDisplayName === undefined
      ? {}
      : {
          preloadedRuntimeDeviceDisplayName:
            input.preloadedRuntimeDeviceDisplayName,
        }),
    targetRuntime: input.targetRuntime ?? null,
    timing,
  });
  const agentExecutionReadiness = resolveAgentExecutionStatus({
    agentProfileId: input.agent.profileId,
    binding: bindingSnapshot.agentExecutionBinding,
    claimDiagnostics: bindingSnapshot.claimDiagnostics,
    executionFamily: resolveReadinessExecutionFamily(bindingSnapshot),
    route:
      bindingSnapshot.routeEvidence ??
      createAgentExecutionRouteEvidence({
        daemonRouteObservation: bindingSnapshot.daemonRouteObservation,
        deviceId: bindingSnapshot.routeDeviceId,
        lane: bindingSnapshot.routeLane,
      }),
    localService: bindingSnapshot.localService,
    profile: bindingSnapshot.profileEvidence,
    providerAccount: bindingSnapshot.providerAccount,
    providerConversation: bindingSnapshot.providerConversation,
    readinessImpact: bindingSnapshot.readinessImpact,
    runtimeReadiness: bindingSnapshot.runtimeReadiness,
    service: bindingSnapshot.service,
  });

  logReadinessTiming({
    agentProfileId: input.agent.profileId,
    displayState: agentExecutionReadiness.displayState,
    primaryAction: agentExecutionReadiness.primaryAction,
    reasonCodes: agentExecutionReadiness.reasonCodes,
    routeReasonCode: bindingSnapshot.daemonRouteObservation.reasonCode,
    routeStatus: bindingSnapshot.daemonRouteObservation.status,
    startedAtMs,
    timing,
  });

  return {
    agentExecutionReadiness,
    agentControllerRef: bindingSnapshot.agentControllerRef,
    ...(bindingSnapshot.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            bindingSnapshot.agentControllerPermissionMode,
        }
      : {}),
    ...(bindingSnapshot.modelSelection
      ? { modelSelection: bindingSnapshot.modelSelection }
      : {}),
    primaryBinding: bindingSnapshot.primaryBinding,
    daemonRouteObservation: bindingSnapshot.daemonRouteObservation,
    ownerUserId: bindingSnapshot.ownerUserId,
    profileName: bindingSnapshot.profileName,
    agentWakeRouteRegistration: bindingSnapshot.agentWakeRouteRegistration,
    wakeRouteStatus: bindingSnapshot.wakeRouteStatus,
    routeDeviceId: bindingSnapshot.routeDeviceId,
    routeLane: bindingSnapshot.routeLane,
    runtimeDeviceDisplayName: bindingSnapshot.runtimeDeviceDisplayName,
    spaceMemberAgentExecutionReadiness: toSpaceMemberAgentExecutionReadiness(
      agentExecutionReadiness,
      localComponentsRelease
    ),
  };
}

function resolveReadinessExecutionFamily(
  snapshot: AgentBindingSnapshot
): "native" | "workstation" | "unknown" {
  if (!snapshot.agentControllerRef) {
    return "unknown";
  }
  return isHostedAgentControllerRef(snapshot.agentControllerRef)
    ? "native"
    : "workstation";
}

async function resolveAgentBindingSnapshot(
  input: ResolveAgentBindingSnapshotInput
): Promise<AgentBindingSnapshot> {
  const authWorker = input.env.OPENMELD_AUTH_WORKER;
  if (!hasProfileIdentityLookup(authWorker)) {
    return enrichAgentBindingSnapshot(
      createEnrichAgentBindingSnapshotInput({
        input,
        snapshot: createProfileIdentitySnapshot({
          agent: input.agent,
          generatedAt: input.generatedAt,
          ownerUserId: null,
          profileEvidence: {
            active: false,
            reasonCodes: ["agent_profile.identity_lookup_unavailable"],
            source: "unavailable",
          },
          profileName: input.agent.profileNameSnapshot,
        }),
      })
    );
  }
  try {
    const result = await measureReadinessStep(
      input.timing,
      "profile_identity_lookup",
      () =>
        input.reads.resolveProfileById({
          authWorker,
          profileId: input.agent.profileId,
        })
    );
    if (!result.ok) {
      return resolveProfileIdentityLookupFailureBindingSnapshot({
        code: result.code,
        input,
      });
    }

    if (result.profile.profileId !== input.agent.profileId) {
      return resolveProfileIdentityLookupFailureBindingSnapshot({
        code: "profile.identity_mismatch",
        input,
      });
    }

    const profileEvidence = resolveProfileIdentityEvidence(result.profile);
    const ownerUserId = normalizeOptionalText(result.profile.ownerUserId);
    const profileName = normalizeOptionalText(result.profile.profileName);
    if (!profileEvidence.active) {
      return createProfileIdentityOnlyBindingSnapshot({
        agent: input.agent,
        generatedAt: input.generatedAt,
        localComponentsRelease: input.localComponentsRelease,
        ownerUserId,
        profileEvidence,
        profileName,
      });
    }

    return enrichAgentBindingSnapshot(
      createEnrichAgentBindingSnapshotInput({
        input,
        snapshot: createProfileIdentitySnapshot({
          agent: input.agent,
          generatedAt: input.generatedAt,
          ownerUserId,
          defaultProjectId: result.profile.defaultProjectId,
          profileEvidence:
            ownerUserId ||
            (result.profile.managedRole === "center_agent" &&
              result.profile.organizationId)
              ? profileEvidence
              : {
                  active: false,
                  reasonCodes: ["agent_profile.owner_unavailable"],
                  source: "unavailable",
                },
          profileName,
        }),
      })
    );
  } catch {
    return enrichAgentBindingSnapshot(
      createEnrichAgentBindingSnapshotInput({
        input,
        snapshot: createProfileIdentitySnapshot({
          agent: input.agent,
          generatedAt: input.generatedAt,
          ownerUserId: null,
          profileEvidence: {
            active: false,
            reasonCodes: ["agent_profile.identity_lookup_failed"],
            source: "unavailable",
          },
          profileName: input.agent.profileNameSnapshot,
        }),
      })
    );
  }
}

function createEnrichAgentBindingSnapshotInput(input: {
  input: ResolveAgentBindingSnapshotInput;
  snapshot: ProfileIdentitySnapshot;
}): Parameters<typeof enrichAgentBindingSnapshot>[0] {
  return {
    reads: input.input.reads,
    ...(input.input.preloadedDaemonRoute === undefined
      ? {}
      : { preloadedDaemonRoute: input.input.preloadedDaemonRoute }),
    ...(input.input.preloadedOwnerService === undefined
      ? {}
      : { preloadedOwnerService: input.input.preloadedOwnerService }),
    ...(input.input.preloadedRuntimeDeviceDisplayName === undefined
      ? {}
      : {
          preloadedRuntimeDeviceDisplayName:
            input.input.preloadedRuntimeDeviceDisplayName,
        }),
    activeOrganizationId: input.input.activeOrganizationId,
    agent: input.input.agent,
    env: input.input.env,
    generatedAt: input.input.generatedAt,
    includeRuntimeDeviceDisplayName:
      input.input.includeRuntimeDeviceDisplayName,
    snapshot: input.snapshot,
    targetRuntime: input.input.targetRuntime,
    timing: input.input.timing,
    localComponentsRelease: input.input.localComponentsRelease,
  };
}

function resolveProfileIdentityLookupFailureBindingSnapshot(input: {
  code: string;
  input: ResolveAgentBindingSnapshotInput;
}): Promise<AgentBindingSnapshot> | AgentBindingSnapshot {
  const profileEvidence: AgentExecutionProfileEvidence = {
    active: false,
    reasonCodes: [mapProfileIdentityLookupFailureReason(input.code)],
    source:
      input.code === "profile.not_found" ? "profile_identity" : "unavailable",
  };
  if (input.code === "profile.not_found") {
    return createProfileIdentityOnlyBindingSnapshot({
      agent: input.input.agent,
      generatedAt: input.input.generatedAt,
      localComponentsRelease: input.input.localComponentsRelease,
      ownerUserId: null,
      profileEvidence,
      profileName: input.input.agent.profileNameSnapshot,
    });
  }
  return enrichAgentBindingSnapshot(
    createEnrichAgentBindingSnapshotInput({
      input: input.input,
      snapshot: createProfileIdentitySnapshot({
        agent: input.input.agent,
        generatedAt: input.input.generatedAt,
        ownerUserId: null,
        profileEvidence,
        profileName: input.input.agent.profileNameSnapshot,
      }),
    })
  );
}

function hasProfileIdentityLookup(
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined
): authWorker is AuthWorkerWithProfileLookup {
  return Boolean(
    authWorker && typeof authWorker.resolveProfileById === "function"
  );
}

function createProfileIdentitySnapshot(input: {
  agent: AgentExecutionReadinessAgentInput;
  generatedAt: string;
  defaultProjectId?: string | null;
  ownerUserId: string | null;
  profileEvidence: AgentExecutionProfileEvidence;
  profileName: string | null;
}): ProfileIdentitySnapshot {
  const daemonRouteObservation = resolveSkippedDaemonRouteObservation({
    bindingEnabled: false,
    bindingState: "missing",
    agentControllerRef: null,
    generatedAt: input.generatedAt,
    ownerUserId: input.ownerUserId,
    reasonCode: "not_requested",
  });
  return {
    defaultProjectId: normalizeOptionalText(input.defaultProjectId),
    bindingEnabled: false,
    bindingState: "missing",
    agentControllerRef: null,
    primaryBinding: null,
    daemonRouteObservation,
    ownerUserId: input.ownerUserId,
    profileEvidence: input.profileEvidence,
    profileName: input.profileName,
    agentWakeRouteRegistration: createUnavailableAgentWakeRouteRegistration({
      reasonCode: "not_requested",
    }),
    wakeRouteStatus: createWakeRouteStatusFromEvidence(daemonRouteObservation),
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: null,
  };
}

function createProfileIdentityOnlyBindingSnapshot(input: {
  agent: AgentExecutionReadinessAgentInput;
  generatedAt: string;
  localComponentsRelease: CoreLocalComponentsRelease;
  ownerUserId: string | null;
  profileEvidence: AgentExecutionProfileEvidence;
  profileName: string | null;
}): AgentBindingSnapshot {
  return {
    ...createProfileIdentitySnapshot(input),
    agentExecutionBinding: {
      reasonCodes: [],
      status: "not_checked",
    },
    claimDiagnostics: {
      status: "not_checked",
    },
    localService: {
      reachable: false,
      refreshable: false,
      reasonCodes: [],
      source: "not_checked",
    },
    providerAccount: null,
    providerConversation: null,
    readinessImpact: null,
    runtimeReadiness: null,
    service: createNotCheckedServiceEvidence(input.localComponentsRelease),
  };
}

function resolveProfileIdentityEvidence(profile: {
  profileKind: "human" | "agent" | "system";
  status: "active" | "disabled";
}): AgentExecutionProfileEvidence {
  if (profile.profileKind !== "agent") {
    return {
      active: false,
      reasonCodes: ["agent_profile.not_agent"],
      source: "profile_identity",
    };
  }
  if (profile.status !== "active") {
    return {
      active: false,
      reasonCodes: ["agent_profile.inactive"],
      source: "profile_identity",
    };
  }
  return {
    active: true,
    reasonCodes: [],
    source: "profile_identity",
  };
}

function mapProfileIdentityLookupFailureReason(code: string): string {
  return code === "profile.not_found"
    ? "agent_profile.not_found"
    : "agent_profile.identity_lookup_failed";
}

async function enrichAgentBindingSnapshot(input: {
  reads: AgentExecutionReadinessReads;
  activeOrganizationId: string | null;
  agent: AgentExecutionReadinessAgentInput;
  env: CoreBindings;
  generatedAt: string;
  includeRuntimeDeviceDisplayName: boolean;
  preloadedDaemonRoute?: RuntimeTransportLookupRouteResponse | null;
  preloadedOwnerService?: RuntimeTransportLookupOwnerServiceResponse | null;
  preloadedRuntimeDeviceDisplayName?: string | null;
  snapshot: ProfileIdentitySnapshot;
  targetRuntime: AgentExecutionTargetRuntimeContext | null;
  timing: ReadinessTimingRecorder;
  localComponentsRelease: CoreLocalComponentsRelease;
}): Promise<AgentBindingSnapshot> {
  const bindingStartedAtMs = Date.now();
  const { evidence: agentExecutionBinding, configurationRevision } =
    await resolveAgentExecutionBindingEvidence({
      reads: input.reads,
      agentProfileId: input.agent.profileId,
      env: input.env,
      ownerUserId: input.snapshot.ownerUserId,
    });
  recordReadinessDuration(
    input.timing,
    "binding_evidence_read",
    bindingStartedAtMs
  );
  const bindingProjection = isAgentProfileBindingProjection(
    agentExecutionBinding
  )
    ? agentExecutionBinding
    : null;
  const executionTarget = bindingProjection?.executionTarget ?? null;
  const parsedAgentControllerRef = parseAgentControllerRef(
    executionTarget?.agentControllerRef
  );
  const bindingEnabled =
    bindingProjection?.dispatchEligibility.routable === true &&
    Boolean(executionTarget);
  const bindingState =
    bindingProjection?.bindingState === "enabled_primary"
      ? ("bound" as const)
      : ("missing" as const);
  if (!parsedAgentControllerRef) {
    // Retain identity/binding failures, without guessing that this Agent uses
    // the member's local Computer or probing that unrelated Service.
    return {
      ...createProfileIdentityOnlyBindingSnapshot({
        agent: input.agent,
        generatedAt: input.generatedAt,
        localComponentsRelease: input.localComponentsRelease,
        ownerUserId: input.snapshot.ownerUserId,
        profileEvidence: input.snapshot.profileEvidence,
        profileName: input.snapshot.profileName,
      }),
      agentExecutionBinding,
      primaryBinding: bindingProjection,
      claimDiagnostics: await resolveAgentProfileOrganizationClaimDiagnostics({
        reads: input.reads,
        activeOrganizationId: input.activeOrganizationId,
        binding: agentExecutionBinding,
        env: input.env,
        resolveRuntimeClaimDiagnostics: async () => ({ status: "not_checked" }),
      }),
      routeEvidence: {
        status: "unavailable",
        source: "not_checked",
        reasonCodes: [],
      },
    };
  }
  if (
    bindingProjection &&
    isHostedAgentControllerRef(parsedAgentControllerRef?.ref)
  ) {
    const claimDiagnostics = await measureReadinessStep(
      input.timing,
      "claim_diagnostics_read",
      () =>
        resolveAgentProfileOrganizationClaimDiagnostics({
          reads: input.reads,
          activeOrganizationId: input.activeOrganizationId,
          binding: agentExecutionBinding,
          env: input.env,
          resolveRuntimeClaimDiagnostics: async () => ({
            reasonCodes: [],
            status: "not_checked",
          }),
        })
    );
    return await createHostedAgentBindingSnapshot({
      localComponentsRelease: input.localComponentsRelease,
      activeOrganizationId: input.activeOrganizationId,
      agent: input.agent,
      agentControllerRef: parsedAgentControllerRef?.ref ?? null,
      agentExecutionBinding,
      bindingEnabled,
      bindingProjection,
      bindingState,
      claimDiagnostics,
      env: input.env,
      generatedAt: input.generatedAt,
      ownerUserId: input.snapshot.ownerUserId,
      profileEvidence: input.snapshot.profileEvidence,
      profileName: input.snapshot.profileName,
      snapshot: input.snapshot,
    });
  }
  const runtimeRoute =
    input.snapshot.ownerUserId && bindingEnabled && parsedAgentControllerRef
      ? await resolveRuntimeRouteSnapshot({
          env: input.env,
          generatedAt: input.generatedAt,
          includeRuntimeDeviceDisplayName:
            input.includeRuntimeDeviceDisplayName,
          ownerUserId: input.snapshot.ownerUserId,
          ...(input.preloadedDaemonRoute === undefined
            ? {}
            : { preloadedResult: input.preloadedDaemonRoute }),
          ...(input.preloadedRuntimeDeviceDisplayName === undefined
            ? {}
            : {
                preloadedRuntimeDeviceDisplayName:
                  input.preloadedRuntimeDeviceDisplayName,
              }),
          profileId: input.agent.profileId,
          timing: input.timing,
        })
      : createSkippedRuntimeRouteSnapshot({
          bindingEnabled,
          bindingState,
          agentControllerRef: parsedAgentControllerRef?.ref ?? null,
          generatedAt: input.generatedAt,
          ownerUserId: input.snapshot.ownerUserId,
          reasonCode: "not_requested",
        });
  const baseRuntimeReadinessPromise = measureReadinessStep(
    input.timing,
    "runtime_readiness_read",
    () =>
      resolveAgentRuntimeReadiness({
        reads: input.reads,
        binding: agentExecutionBinding,
        env: input.env,
        generatedAt: input.generatedAt,
      })
  );
  const currentWorkingFolderReadiness = resolveCurrentWorkingFolderReadiness({
    binding: agentExecutionBinding,
    configurationRevision,
    currentSession: runtimeRoute.currentSession,
    defaultProjectId: input.snapshot.defaultProjectId,
    generatedAt: input.generatedAt,
    localWakeRouteReport: runtimeRoute.localWakeRouteReport,
  });
  const [
    baseRuntimeReadiness,
    claimDiagnostics,
    localExecutionService,
    providerAccount,
    providerConversation,
    readinessImpact,
  ] = await Promise.all([
    baseRuntimeReadinessPromise,
    measureReadinessStep(input.timing, "claim_diagnostics_read", () =>
      resolveAgentProfileOrganizationClaimDiagnostics({
        reads: input.reads,
        activeOrganizationId: input.activeOrganizationId,
        binding: agentExecutionBinding,
        env: input.env,
        resolveRuntimeClaimDiagnostics: () =>
          resolveAgentClaimDiagnostics({
            reads: input.reads,
            binding: agentExecutionBinding,
            env: input.env,
            ownerUserId: input.snapshot.ownerUserId,
            routeDeviceId: runtimeRoute.routeDeviceId,
            routeLane: runtimeRoute.routeLane,
          }),
      })
    ),
    resolveAgentLocalExecutionServiceEvidence({
      localComponentsRelease: input.localComponentsRelease,
      reads: input.reads,
      binding: agentExecutionBinding,
      env: input.env,
      hasFreshRouteLease: runtimeRoute.hasFreshRouteLease,
      ownerUserId: input.snapshot.ownerUserId,
      pendingFirstReportOwnerService:
        runtimeRoute.pendingFirstReportOwnerService,
      routeDeviceId: runtimeRoute.routeDeviceId,
      routeLane: runtimeRoute.routeLane,
      runtimeReadiness: baseRuntimeReadinessPromise,
      serviceCompatibility: runtimeRoute.serviceCompatibility,
      localComponentsStatus: runtimeRoute.localComponentsStatus,
      serviceVersion: runtimeRoute.serviceVersion,
      ...(input.preloadedOwnerService === undefined
        ? {}
        : { preloadedOwnerService: input.preloadedOwnerService }),
      targetRuntime: input.targetRuntime,
    }),
    measureReadinessStep(input.timing, "provider_account_evidence_read", () =>
      resolveAgentProviderAccountEvidence({
        reads: input.reads,
        agentProfileId: input.agent.profileId,
        binding: agentExecutionBinding,
        env: input.env,
        generatedAt: input.generatedAt,
      })
    ),
    measureReadinessStep(
      input.timing,
      "provider_conversation_evidence_read",
      () =>
        resolveAgentProviderConversationEvidence({
          reads: input.reads,
          agentProfileId: input.agent.profileId,
          binding: agentExecutionBinding,
          env: input.env,
          generatedAt: input.generatedAt,
        })
    ),
    measureReadinessStep(input.timing, "readiness_impact_evidence_read", () =>
      resolveAgentReadinessImpactEvidence({
        reads: input.reads,
        agentProfileId: input.agent.profileId,
        binding: agentExecutionBinding,
        env: input.env,
        generatedAt: input.generatedAt,
      })
    ),
  ]);
  const runtimeReadiness = mergeCurrentWorkingFolderReadiness({
    currentWorkingFolderReadiness,
    runtimeReadiness: baseRuntimeReadiness,
  });
  return {
    ...input.snapshot,
    agentExecutionBinding,
    bindingEnabled,
    bindingState,
    claimDiagnostics,
    agentControllerRef: parsedAgentControllerRef?.ref ?? null,
    ...(bindingProjection?.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            bindingProjection.agentControllerPermissionMode,
        }
      : {}),
    ...(bindingProjection?.modelSelection
      ? { modelSelection: bindingProjection.modelSelection }
      : {}),
    primaryBinding: bindingProjection,
    daemonRouteObservation: runtimeRoute.daemonRouteObservation,
    localService: localExecutionService.localService,
    providerAccount,
    providerConversation,
    agentWakeRouteRegistration: runtimeRoute.agentWakeRouteRegistration,
    wakeRouteStatus: runtimeRoute.wakeRouteStatus,
    ...(runtimeRoute.routeEvidence === undefined
      ? {}
      : { routeEvidence: runtimeRoute.routeEvidence }),
    readinessImpact,
    routeDeviceId: runtimeRoute.routeDeviceId,
    routeLane: runtimeRoute.routeLane,
    runtimeDeviceDisplayName: runtimeRoute.runtimeDeviceDisplayName,
    runtimeReadiness,
    service: localExecutionService.service,
  };
}

async function createHostedAgentBindingSnapshot(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  activeOrganizationId: string | null;
  agent: AgentExecutionReadinessAgentInput;
  agentControllerRef: string | null;
  agentExecutionBinding: AgentExecutionBindingEvidence;
  bindingEnabled: boolean;
  bindingProjection: AgentProfileBindingDisplayProjection;
  bindingState: "bound" | "missing";
  claimDiagnostics: AgentExecutionClaimDiagnosticEvidence | null;
  env: CoreBindings;
  generatedAt: string;
  ownerUserId: string | null;
  profileEvidence: AgentExecutionProfileEvidence;
  profileName: string | null;
  snapshot: ProfileIdentitySnapshot;
}): Promise<AgentBindingSnapshot> {
  const readiness =
    input.claimDiagnostics?.status === "not_checked"
      ? await resolveHostedCenterAgentReadiness({
          activeOrganizationId: input.activeOrganizationId,
          agentProfileId: input.agent.profileId,
          ownerUserId: input.ownerUserId,
          personalAgent:
            input.agentControllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF,
          env: input.env,
        })
      : null;
  const routeEvidence = createHostedAgentRouteEvidence({
    generatedAt: input.generatedAt,
    readiness,
  });
  const daemonRouteObservation: DaemonRouteObservationSummary = {
    observedAt: input.generatedAt,
    reasonCode: "not_requested",
    status: "unavailable",
  };

  return {
    ...input.snapshot,
    agentExecutionBinding: input.agentExecutionBinding,
    agentControllerRef: input.agentControllerRef,
    bindingEnabled: input.bindingEnabled,
    bindingState: input.bindingState,
    claimDiagnostics: input.claimDiagnostics,
    daemonRouteObservation,
    localService: {
      reachable: false,
      refreshable: false,
      reasonCodes: [],
      source: "not_checked",
    },
    providerAccount: null,
    providerConversation: null,
    readinessImpact: null,
    ...(input.bindingProjection.modelSelection
      ? { modelSelection: input.bindingProjection.modelSelection }
      : {}),
    primaryBinding: input.bindingProjection,
    agentWakeRouteRegistration: {
      daemonSessionId: null,
      deviceId: null,
      lane: null,
      reasonCode: "not_requested",
      reportedAtMs: null,
      serviceVersion: null,
      status: "skipped",
    },
    wakeRouteStatus: { status: "unavailable" },
    routeEvidence,
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: "Remote Agent",
    runtimeReadiness: readiness
      ? {
          ready: readiness.available,
          displayState: readiness.available ? "ready" : "unavailable",
          reasonCodes: readiness.reasonCodes,
        }
      : null,
    service: createNotCheckedServiceEvidence(input.localComponentsRelease),
  };
}

function createHostedAgentRouteEvidence(input: {
  generatedAt: string;
  readiness: {
    available: boolean;
    reasonCodes: string[];
  } | null;
}): AgentExecutionRouteEvidence {
  if (!input.readiness) {
    return {
      reasonCodes: [],
      source: "not_checked",
      status: "unavailable",
    };
  }
  if (input.readiness.available) {
    return {
      observedAt: input.generatedAt,
      reasonCodes: ["remote_agent.available"],
      source: "hosted_route",
      status: "online",
    };
  }
  return {
    observedAt: input.generatedAt,
    reasonCodes: input.readiness.reasonCodes,
    source: "hosted_route",
    status: "unavailable",
  };
}

async function resolveHostedCenterAgentReadiness(input: {
  activeOrganizationId: string | null;
  agentProfileId: string;
  ownerUserId: string | null;
  personalAgent: boolean;
  env: CoreBindings;
}): Promise<{
  available: boolean;
  reasonCodes: string[];
}> {
  if (!input.activeOrganizationId) {
    return {
      available: false,
      reasonCodes: ["remote_agent.organization_context_missing"],
    };
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return {
      available: false,
      reasonCodes: ["center_agent.designation_store_unavailable"],
    };
  }
  try {
    if (input.personalAgent) {
      if (!input.ownerUserId) {
        return {
          available: false,
          reasonCodes: ["remote_agent.personal_profile_unavailable"],
        };
      }
      const { requirePersonalRemoteAgentBinding } = await import(
        "../../remote-agent/application/personal-remote-agent-binding"
      );
      await requirePersonalRemoteAgentBinding({
        agentProfileId: input.agentProfileId,
        db,
        organizationId: input.activeOrganizationId,
        ownerUserId: input.ownerUserId,
      });
      const availability = resolveRemoteAgentRuntimeAvailability({
        env: input.env,
        organizationId: input.activeOrganizationId,
      });
      return {
        available: availability.ok,
        reasonCodes: availability.ok ? [] : [availability.code],
      };
    }
    const designation = await readCenterAgentDesignationRecord({
      db,
      organizationId: input.activeOrganizationId,
    });
    if (designation?.agentProfileId !== input.agentProfileId) {
      return {
        available: false,
        reasonCodes: ["center_agent.designation_required"],
      };
    }
    if (!isCenterAgentDesignationActive(designation)) {
      return {
        available: false,
        reasonCodes: ["center_agent.paused"],
      };
    }
  } catch (error) {
    console.warn("[core.agent_execution.hosted_agent_authorization_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.activeOrganizationId,
      profileId: input.agentProfileId,
    });
    return {
      available: false,
      reasonCodes: [
        input.personalAgent
          ? "remote_agent.personal_profile_unavailable"
          : "center_agent.designation_lookup_failed",
      ],
    };
  }
  const availability = resolveRemoteAgentRuntimeAvailability({
    env: input.env,
    organizationId: input.activeOrganizationId,
  });
  if (!availability.ok) {
    return {
      available: false,
      reasonCodes: [availability.code],
    };
  }
  if (!input.env.OPENMELD_REMOTE_AGENT_WORKER?.submitConversationTurn) {
    return {
      available: false,
      reasonCodes: ["remote_agent.worker_unavailable"],
    };
  }
  return {
    available: true,
    reasonCodes: [],
  };
}

async function resolveAgentExecutionBindingEvidence(input: {
  reads: AgentExecutionReadinessReads;
  agentProfileId: string;
  env: CoreBindings;
  ownerUserId: string | null;
}): Promise<{
  configurationRevision: number | null;
  evidence: AgentExecutionBindingEvidence;
}> {
  const domainDb = getPostgresDatabase(input.env);
  if (!domainDb) {
    return {
      configurationRevision: null,
      evidence: {
        reasonCodes: ["agent_profile_binding.store_unavailable"],
        status: "unavailable",
      },
    };
  }

  try {
    const organizationProfile = input.ownerUserId
      ? null
      : await input.reads.readAgentProfileOrganizationContext({
          agentProfileId: input.agentProfileId,
          db: domainDb,
        });
    let owner: { id: string; kind: "owner_account" | "organization" } | null =
      null;
    if (input.ownerUserId) {
      owner = { id: input.ownerUserId, kind: "owner_account" };
    } else if (
      organizationProfile?.managedRole === "center_agent" &&
      organizationProfile.organizationId &&
      !organizationProfile.ownerUserId
    ) {
      owner = { id: organizationProfile.organizationId, kind: "organization" };
    }
    if (!owner) {
      return {
        configurationRevision: null,
        evidence: {
          reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
          status: "unavailable",
        },
      };
    }
    const bindingRecord =
      await input.reads.readPrimaryAgentProfileBindingRecord({
        agentProfileId: input.agentProfileId,
        db: domainDb,
        owner,
      });
    if (bindingRecord?.agentControllerConversationId && input.ownerUserId) {
      const conflictingBinding =
        await input.reads.readPrimaryAgentProfileBindingRecordByControllerConversation(
          {
            agentControllerConversationId:
              bindingRecord.agentControllerConversationId,
            agentControllerRef: bindingRecord.agentControllerRef,
            db: domainDb,
            excludeAgentProfileId: input.agentProfileId,
            owner: {
              id: input.ownerUserId,
              kind: "owner_account",
            },
          }
        );
      if (conflictingBinding) {
        const conflictingProfileIsCurrent =
          await isCurrentConflictingAgentProfile({
            reads: input.reads,
            authWorker: input.env.OPENMELD_AUTH_WORKER,
            conflictingAgentProfileId: conflictingBinding.agentProfileId,
            ownerUserId: input.ownerUserId,
          });
        if (!conflictingProfileIsCurrent) {
          console.warn(
            "[core.agent_execution.binding_stale_controller_conversation_conflict_ignored]",
            {
              agentControllerConversationId:
                bindingRecord.agentControllerConversationId,
              agentControllerRef: bindingRecord.agentControllerRef,
              agentProfileId: input.agentProfileId,
              bindingId: bindingRecord.bindingId,
              conflictingAgentProfileId: conflictingBinding.agentProfileId,
              conflictingBindingId: conflictingBinding.bindingId,
            }
          );
          return {
            configurationRevision: bindingRecord.configurationRevision,
            evidence: createAgentProfileBindingProjectionFromRecord({
              agentProfileId: input.agentProfileId,
              binding: bindingRecord,
            }),
          };
        }
        console.warn(
          "[core.agent_execution.binding_controller_conversation_conflict]",
          {
            agentControllerConversationId:
              bindingRecord.agentControllerConversationId,
            agentControllerRef: bindingRecord.agentControllerRef,
            agentProfileId: input.agentProfileId,
            bindingId: bindingRecord.bindingId,
            conflictingAgentProfileId: conflictingBinding.agentProfileId,
            conflictingBindingId: conflictingBinding.bindingId,
          }
        );
        return {
          configurationRevision: null,
          evidence: {
            reasonCodes: [
              "agent_profile_binding.controller_conversation_conflict",
            ],
            status: "unavailable",
          },
        };
      }
    }
    return {
      configurationRevision: bindingRecord?.configurationRevision ?? null,
      evidence: createAgentProfileBindingProjectionFromRecord({
        agentProfileId: input.agentProfileId,
        binding: bindingRecord,
      }),
    };
  } catch {
    return {
      configurationRevision: null,
      evidence: {
        reasonCodes: ["agent_profile_binding.read_unavailable"],
        status: "unavailable",
      },
    };
  }
}

async function isCurrentConflictingAgentProfile(input: {
  reads: AgentExecutionReadinessReads;
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
  conflictingAgentProfileId: string;
  ownerUserId: string;
}): Promise<boolean> {
  if (!hasProfileIdentityLookup(input.authWorker)) {
    return true;
  }

  try {
    const result = await input.reads.resolveProfileById({
      authWorker: input.authWorker,
      profileId: input.conflictingAgentProfileId,
    });
    if (!result.ok) {
      return result.code !== "profile.not_found";
    }
    const profileEvidence = resolveProfileIdentityEvidence(result.profile);
    const ownerUserId = normalizeOptionalText(result.profile.ownerUserId);
    return Boolean(profileEvidence.active && ownerUserId === input.ownerUserId);
  } catch {
    return true;
  }
}

async function resolveAgentRuntimeReadiness(input: {
  reads: AgentExecutionReadinessReads;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  generatedAt: string;
}): Promise<PrepareReadinessSummary | null> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return null;
  }
  const executionTarget = input.binding.executionTarget;
  if (!executionTarget) {
    return null;
  }
  const domainDb = getPostgresDatabase(input.env);
  if (!domainDb) {
    return {
      displayState: "unavailable",
      ready: false,
      reasonCodes: ["runtime.agent_controller_report_store_unavailable"],
    };
  }

  try {
    const currentReports =
      await input.reads.readCurrentRuntimeAgentControllerReports({
        agentControllerRefs: [executionTarget.agentControllerRef],
        db: domainDb,
        openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
          openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
          source: "runtime_registry_authority",
        }),
      });
    const readiness = resolvePrepareReadinessFromAgentControllerReports({
      agentControllerRefsToEvaluate: [executionTarget.agentControllerRef],
      currentReports: currentReports.map((report) => ({
        agentControllerRef: report.agentControllerRef,
        expiresAtMs: report.expiresAtMs,
        observedAtMs: report.observedAtMs,
        reasonCodes: report.reasonCodes,
        status: report.status,
      })),
      nowMs: parseGeneratedAtMs(input.generatedAt),
    }).summary;
    const currentReport = currentReports.find(
      (report) =>
        report.agentControllerRef === executionTarget.agentControllerRef
    );
    const modelAvailability = resolveCurrentAgentModelAvailability({
      agentControllerRef: executionTarget.agentControllerRef,
      modelId: input.binding.modelSelection?.modelId,
      openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
        source: "runtime_registry_authority",
      }).value,
      currentReport,
      nowMs: parseGeneratedAtMs(input.generatedAt),
    });
    if (!modelAvailability.available) {
      return {
        displayState: "unavailable",
        ready: false,
        reasonCodes: [modelAvailability.reasonCode, ...readiness.reasonCodes],
      };
    }
    const usageWakeability = resolveAgentProfileUsageWakeability({
      agentControllerRef: executionTarget.agentControllerRef,
      nowMs: parseGeneratedAtMs(input.generatedAt),
      providerId: resolveAgentControllerUsageProviderId({
        agentControllerRef: executionTarget.agentControllerRef,
        modelId: input.binding.modelSelection?.modelId,
      }),
      report: currentReport
        ? {
            expiresAtMs: currentReport.expiresAtMs,
            status: currentReport.status,
            usageAdmission:
              currentReport.agentControllerInterface?.usageAdmission,
            usageLimits: currentReport.agentControllerInterface?.usageLimits,
            usageLimitsSupportMatrixVersion:
              currentReport.agentControllerInterface
                ?.usageLimitsSupportMatrixVersion,
          }
        : null,
    });
    if (usageWakeability.status === "available") {
      return readiness;
    }
    return {
      displayState: "unavailable",
      ready: false,
      reasonCodes: [
        ...new Set([...readiness.reasonCodes, usageWakeability.reasonCode]),
      ],
    };
  } catch {
    return {
      displayState: "unavailable",
      ready: false,
      reasonCodes: ["runtime.agent_controller_report_read_unavailable"],
    };
  }
}

type CurrentWorkingFolderReadiness = {
  displayState: "ready" | "unavailable" | "unknown";
  ready: boolean;
  reasonCodes: readonly string[];
};

function resolveCurrentWorkingFolderReadiness(input: {
  binding: AgentExecutionBindingEvidence | null;
  configurationRevision: number | null;
  currentSession: RuntimeRouteSnapshot["currentSession"];
  defaultProjectId: string | null;
  generatedAt: string;
  localWakeRouteReport: LocalWakeRouteReport | null;
}): CurrentWorkingFolderReadiness | null {
  if (
    !(isAgentProfileBindingProjection(input.binding) && input.currentSession)
  ) {
    return null;
  }
  if (!input.localWakeRouteReport) {
    return unknownCurrentWorkingFolderReadiness(
      "working_folder.current_report_missing"
    );
  }
  if (!("expectedRoutesContractVersion" in input.localWakeRouteReport)) {
    return {
      displayState: "unknown",
      ready: false,
      reasonCodes: [
        "working_folder.legacy_contract",
        "service.update_required",
      ],
    };
  }
  if (input.configurationRevision === null || !input.binding.bindingId) {
    return unknownCurrentWorkingFolderReadiness(
      "working_folder.expected_routes_invalid"
    );
  }
  const result = resolveCurrentWorkingFolderObservation({
    currentSession: input.currentSession,
    expectedRoute: {
      agentProfileId: input.binding.agentProfileId,
      bindingId: input.binding.bindingId,
      configurationRevision: input.configurationRevision,
      defaultProjectId: input.defaultProjectId,
    },
    freshnessMs: RUNTIME_TRANSPORT_LEASE_TTL_MS,
    nowMs: parseGeneratedAtMs(input.generatedAt),
    report: input.localWakeRouteReport,
  });
  if (result.status === "unknown") {
    return unknownCurrentWorkingFolderReadiness(result.reasonCode);
  }
  if (result.observation.status === "ready") {
    return { displayState: "ready", ready: true, reasonCodes: [] };
  }
  return {
    displayState: "unavailable",
    ready: false,
    reasonCodes: [result.observation.reasonCode],
  };
}

function unknownCurrentWorkingFolderReadiness(
  reasonCode: string
): CurrentWorkingFolderReadiness {
  return { displayState: "unknown", ready: false, reasonCodes: [reasonCode] };
}

function mergeCurrentWorkingFolderReadiness(input: {
  currentWorkingFolderReadiness: CurrentWorkingFolderReadiness | null;
  runtimeReadiness: PrepareReadinessSummary | null;
}): PrepareReadinessSummary | null {
  if (!input.currentWorkingFolderReadiness) {
    return input.runtimeReadiness;
  }
  // Working-folder evidence is the final current-readiness gate. A more
  // specific current Controller or provider blocker must keep its own recovery
  // action instead of being obscured by a secondary unknown folder read.
  if (input.runtimeReadiness && !input.runtimeReadiness.ready) {
    return input.runtimeReadiness;
  }
  const reasonCodes = uniqueReasonCodes([
    ...(input.runtimeReadiness?.reasonCodes ?? []),
    ...input.currentWorkingFolderReadiness.reasonCodes,
  ]);
  if (
    input.runtimeReadiness?.ready === true &&
    input.currentWorkingFolderReadiness.ready
  ) {
    return input.runtimeReadiness;
  }
  return {
    displayState:
      input.runtimeReadiness?.displayState === "unavailable" ||
      input.currentWorkingFolderReadiness.displayState === "unavailable"
        ? "unavailable"
        : "unknown",
    ready: false,
    reasonCodes,
  };
}

async function resolveAgentProviderAccountEvidence(input: {
  reads: AgentExecutionReadinessReads;
  agentProfileId: string;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  generatedAt: string;
}): Promise<AgentExecutionProviderAccountEvidence | null> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return null;
  }
  const executionTarget = input.binding.executionTarget;
  const bindingId =
    input.binding.bindingId ?? input.binding.dispatchReadableFacts?.bindingId;
  const domainDb = getPostgresDatabase(input.env);
  if (!(bindingId && executionTarget && domainDb)) {
    return null;
  }

  try {
    const evidence =
      await input.reads.readFreshProviderAccessEvidenceForBinding({
        agentProfileId: input.agentProfileId,
        bindingId,
        agentControllerRef: executionTarget.agentControllerRef,
        db: domainDb,
        nowMs: parseGeneratedAtMs(input.generatedAt),
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      });
    if (!evidence) {
      return null;
    }
    if (evidence.reasonCode === "provider_account.capacity_exhausted") {
      // Mixed-version services may still submit the legacy wording-derived
      // classification. It is diagnostic compatibility only; only the exact
      // structured Usage classification can change Wakeability.
      return null;
    }
    if (
      evidence.reasonCode === "usage_exhausted" &&
      resolveAgentControllerUsageLimitSupport(
        executionTarget.agentControllerRef
      ) !== "native"
    ) {
      return null;
    }
    // This fresh, accepted Wake failure is bound to the exact execution
    // identity and is more specific than generic controller sign-in guidance,
    // so it remains blocking and takes precedence.
    return {
      blocked: true,
      expiresAtMs: evidence.expiresAtMs,
      observedAtMs: evidence.observedAtMs,
      provider: evidence.provider,
      reasonCodes: [evidence.reasonCode],
      source: evidence.source,
    };
  } catch (error) {
    console.warn(
      "[core.agent_execution.provider_account_evidence_read_failed]",
      {
        agentProfileId: input.agentProfileId,
        bindingId,
        error: formatUnknownErrorMessage(error),
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      }
    );
    return null;
  }
}

async function resolveAgentProviderConversationEvidence(input: {
  reads: AgentExecutionReadinessReads;
  agentProfileId: string;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  generatedAt: string;
}): Promise<AgentExecutionProviderConversationEvidence | null> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return null;
  }
  const executionTarget = input.binding.executionTarget;
  const bindingId =
    input.binding.bindingId ?? input.binding.dispatchReadableFacts?.bindingId;
  const agentControllerConversationId = normalizeOptionalText(
    executionTarget?.agentControllerConversationId
  );
  if (
    !(
      bindingId &&
      executionTarget &&
      agentControllerConversationId &&
      executionTarget.agentControllerRef === "builtin:codex"
    )
  ) {
    return null;
  }

  const requiredBase = {
    agentControllerConversationId,
    method: "codex_app_server_thread_read" as const,
    provider: "codex" as const,
    required: true,
  };

  const domainDb = getPostgresDatabase(input.env);
  if (!domainDb) {
    return {
      ...requiredBase,
      errorCode: null,
      errorMessage: null,
      errorType: null,
      expiresAtMs: null,
      observedAtMs: null,
      ready: false,
      reasonCodes: ["provider_conversation.proof_unavailable"],
      source: "unavailable",
      status: "unavailable",
    };
  }

  try {
    const proof =
      await input.reads.readFreshProviderConversationProofForBinding({
        agentProfileId: input.agentProfileId,
        bindingId,
        agentControllerRef: executionTarget.agentControllerRef,
        agentControllerConversationId,
        db: domainDb,
        methods: [
          "codex_app_server_thread_read",
          "codex_app_server_thread_resume",
        ],
        nowMs: parseGeneratedAtMs(input.generatedAt),
        provider: "codex",
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      });
    if (!proof) {
      return {
        ...requiredBase,
        errorCode: null,
        errorMessage: null,
        errorType: null,
        expiresAtMs: null,
        observedAtMs: null,
        ready: false,
        reasonCodes: ["provider_conversation.proof_missing"],
        source: "runtime_reporting",
        status: "missing",
      };
    }
    if (proof.status === "passed") {
      return {
        ...requiredBase,
        method: proof.method,
        errorCode: null,
        errorMessage: null,
        errorType: null,
        expiresAtMs: proof.expiresAtMs,
        observedAtMs: proof.observedAtMs,
        ready: true,
        reasonCodes: [],
        source: "runtime_reporting",
        status: "passed",
      };
    }
    return {
      ...requiredBase,
      errorCode: proof.errorCode,
      method: proof.method,
      errorMessage: proof.errorMessage,
      errorType: proof.errorType,
      expiresAtMs: proof.expiresAtMs,
      observedAtMs: proof.observedAtMs,
      ready: false,
      reasonCodes: uniqueReasonCodes([
        "provider_conversation.proof_failed",
        proof.errorCode ?? "",
      ]),
      source: "runtime_reporting",
      status: "failed",
    };
  } catch (error) {
    console.warn(
      "[core.agent_execution.provider_conversation_evidence_read_failed]",
      {
        agentProfileId: input.agentProfileId,
        bindingId,
        error: formatUnknownErrorMessage(error),
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      }
    );
    return {
      ...requiredBase,
      errorCode: null,
      errorMessage: null,
      errorType: null,
      expiresAtMs: null,
      observedAtMs: null,
      ready: false,
      reasonCodes: ["provider_conversation.proof_unavailable"],
      source: "unavailable",
      status: "unavailable",
    };
  }
}

async function resolveAgentReadinessImpactEvidence(input: {
  reads: AgentExecutionReadinessReads;
  agentProfileId: string;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  generatedAt: string;
}): Promise<AgentExecutionReadinessImpactEvidence | null> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return null;
  }
  const executionTarget = input.binding.executionTarget;
  const bindingId =
    input.binding.bindingId ?? input.binding.dispatchReadableFacts?.bindingId;
  const domainDb = getPostgresDatabase(input.env);
  if (!(bindingId && executionTarget && domainDb)) {
    return null;
  }

  try {
    const impact =
      await input.reads.readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: input.agentProfileId,
        bindingId,
        agentControllerRef: executionTarget.agentControllerRef,
        db: domainDb,
        nowMs: parseGeneratedAtMs(input.generatedAt),
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      });
    if (!impact) {
      return null;
    }
    return {
      blocked: true,
      expiresAtMs: impact.expiresAtMs,
      impactKind: impact.impactKind,
      observedAtMs: impact.observedAtMs,
      reasonCodes: [impact.reasonCode],
      source: impact.source,
    };
  } catch (error) {
    console.warn(
      "[core.agent_execution.readiness_impact_evidence_read_failed]",
      {
        agentProfileId: input.agentProfileId,
        bindingId,
        error: formatUnknownErrorMessage(error),
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      }
    );
    return null;
  }
}

async function resolveAgentClaimDiagnostics(input: {
  reads: AgentExecutionReadinessReads;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  ownerUserId: string | null;
  routeDeviceId: string | null;
  routeLane: string | null;
}): Promise<AgentExecutionClaimDiagnosticEvidence | null> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return null;
  }
  const executionTarget = input.binding.executionTarget;
  if (
    !(
      executionTarget &&
      input.ownerUserId &&
      input.routeDeviceId &&
      input.routeLane
    )
  ) {
    return null;
  }
  const domainDb = getPostgresDatabase(input.env);
  if (!domainDb) {
    return claimDiagnosticsUnavailable("claim_eligibility.runtime_unavailable");
  }

  try {
    const bindingRuntime =
      await input.reads.readRuntimeRegistryRecordByRuntimeId({
        db: domainDb,
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      });
    if (bindingRuntime.status === "missing") {
      return {
        reasonCodes: ["claim_eligibility.runtime_missing"],
        status: "missing",
      };
    }
    if (bindingRuntime.status === "conflict") {
      return claimDiagnosticsUnavailable(
        "claim_eligibility.openmeld_service_runtime_identity_invalid"
      );
    }

    const bindingRuntimeLookup = bindingRuntime.record.runtimeLookupInput;
    if (
      bindingRuntimeLookup.owner.kind !== "owner_account" ||
      bindingRuntimeLookup.owner.id !== input.ownerUserId
    ) {
      return {
        reasonCodes: ["claim_eligibility.owner_mismatch"],
        status: "mismatch",
      };
    }
    if (
      bindingRuntimeLookup.deviceId !== input.routeDeviceId ||
      bindingRuntimeLookup.lane !== input.routeLane
    ) {
      return {
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        status: "mismatch",
      };
    }

    const routeRuntime = await input.reads.readRuntimeRegistryRecord({
      db: domainDb,
      runtimeLookupInput: {
        ...bindingRuntimeLookup,
        deviceId: input.routeDeviceId,
        lane: input.routeLane,
      },
    });
    if (routeRuntime.status === "missing") {
      return {
        reasonCodes: ["claim_eligibility.runtime_missing"],
        status: "missing",
      };
    }
    if (routeRuntime.status === "conflict") {
      return claimDiagnosticsUnavailable("claim_eligibility.runtime_conflict");
    }
    if (
      routeRuntime.openMeldServiceRuntimeId.value !==
      executionTarget.openMeldServiceRuntimeId
    ) {
      return {
        reasonCodes: ["claim_eligibility.openmeld_service_runtime_id_mismatch"],
        status: "mismatch",
      };
    }

    return {
      reasonCodes: [],
      status: "accepted",
    };
  } catch {
    return claimDiagnosticsUnavailable("claim_eligibility.runtime_unavailable");
  }
}

export async function resolveAgentProfileOrganizationClaimDiagnostics(input: {
  reads?: AgentExecutionReadinessReads;
  activeOrganizationId: string | null;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  resolveRuntimeClaimDiagnostics: () => Promise<AgentExecutionClaimDiagnosticEvidence | null>;
}): Promise<AgentExecutionClaimDiagnosticEvidence | null> {
  const runtimeClaimDiagnostics = await input.resolveRuntimeClaimDiagnostics();
  if (!input.activeOrganizationId) {
    return mergeAgentProfileOrganizationClaimFailure({
      reasonCode: "agent_profile.organization_context_missing",
      runtimeClaimDiagnostics,
      status: "unavailable",
    });
  }
  if (
    !isAgentProfileBindingProjection(input.binding) ||
    input.binding.bindingState !== "enabled_primary" ||
    !input.binding.bindingId
  ) {
    return runtimeClaimDiagnostics;
  }

  const db = getPostgresDatabase(input.env);
  if (!db) {
    return mergeAgentProfileOrganizationClaimFailure({
      reasonCode: "agent_profile.organization_lookup_failed",
      runtimeClaimDiagnostics,
      status: "unavailable",
    });
  }

  try {
    const profileContext = await (
      input.reads ?? createAgentExecutionReadinessReads()
    ).readAgentProfileOrganizationContext({
      agentProfileId: input.binding.agentProfileId,
      db,
    });
    if (!profileContext) {
      return mergeAgentProfileOrganizationClaimFailure({
        reasonCode: "agent_profile.organization_context_missing",
        runtimeClaimDiagnostics,
        status: "unavailable",
      });
    }
    if (
      !isAgentProfileEligibleForOrganization({
        managedRole: profileContext.managedRole,
        profileOrganizationId: profileContext.organizationId,
        targetOrganizationId: input.activeOrganizationId,
      })
    ) {
      return mergeAgentProfileOrganizationClaimFailure({
        reasonCode: "agent_profile.organization_mismatch",
        runtimeClaimDiagnostics,
        status: "rejected",
      });
    }
    return runtimeClaimDiagnostics;
  } catch (error) {
    console.warn(
      "[core.agent_execution.agent_profile_organization_lookup_failed]",
      {
        event: CORE_LOG_EVENTS.coreInternalError,
        agentProfileId: input.binding.agentProfileId,
        bindingId: input.binding.bindingId,
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.activeOrganizationId,
      }
    );
    return mergeAgentProfileOrganizationClaimFailure({
      reasonCode: "agent_profile.organization_lookup_failed",
      runtimeClaimDiagnostics,
      status: "unavailable",
    });
  }
}

function mergeAgentProfileOrganizationClaimFailure(input: {
  reasonCode: string;
  runtimeClaimDiagnostics: AgentExecutionClaimDiagnosticEvidence | null;
  status: "rejected" | "unavailable";
}): AgentExecutionClaimDiagnosticEvidence {
  return {
    reasonCodes: [
      ...new Set([
        ...(input.runtimeClaimDiagnostics?.reasonCodes ?? []),
        input.reasonCode,
      ]),
    ],
    status: input.status,
  };
}

async function resolveAgentLocalExecutionServiceEvidence(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  reads: AgentExecutionReadinessReads;
  binding: AgentExecutionBindingEvidence | null;
  env: CoreBindings;
  hasFreshRouteLease: boolean;
  ownerUserId: string | null;
  pendingFirstReportOwnerService: {
    deviceId: string;
    lane: DaemonServiceLane;
  } | null;
  routeDeviceId: string | null;
  routeLane: string | null;
  runtimeReadiness: Promise<PrepareReadinessSummary | null>;
  serviceCompatibility: DaemonExecutionCompatibility | null;
  localComponentsStatus: LocalComponentsStatus | null;
  serviceVersion: string | null;
  preloadedOwnerService?: RuntimeTransportLookupOwnerServiceResponse | null;
  targetRuntime: AgentExecutionTargetRuntimeContext | null;
}): Promise<LocalExecutionServiceEvidenceResolution> {
  if (!isAgentProfileBindingProjection(input.binding)) {
    return {
      localService: null,
      service: createNotCheckedServiceEvidence(input.localComponentsRelease),
    };
  }
  const executionTarget = input.binding.executionTarget;
  if (!(executionTarget && input.ownerUserId)) {
    return {
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: [],
        source: "not_checked",
      },
      service: createNotCheckedServiceEvidence(input.localComponentsRelease),
    };
  }

  const domainDb = getPostgresDatabase(input.env);
  if (!domainDb) {
    return {
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.unavailable"],
        source: "unavailable",
      },
      service: createUnavailableServiceEvidence(input.localComponentsRelease),
    };
  }

  try {
    const bindingRuntime =
      await input.reads.readRuntimeRegistryRecordByRuntimeId({
        db: domainDb,
        openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
      });
    if (bindingRuntime.status !== "found") {
      return {
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.identity_mismatch"],
          source: "runtime_transport",
        },
        service: createNotCheckedServiceEvidence(input.localComponentsRelease),
      };
    }

    if (
      input.targetRuntime &&
      !doesBindingRuntimeMatchTargetRuntime({
        bindingRuntime: bindingRuntime.record,
        ownerUserId: input.ownerUserId,
        targetRuntime: input.targetRuntime,
      })
    ) {
      return {
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.identity_mismatch"],
          source: "runtime_transport",
        },
        service: createNotCheckedServiceEvidence(input.localComponentsRelease),
      };
    }

    const routeServiceEvidence = resolveRouteLocalExecutionServiceEvidence({
      localComponentsRelease: input.localComponentsRelease,
      bindingRuntime: bindingRuntime.record,
      routeDeviceId: input.routeDeviceId,
      routeLane: input.routeLane,
      serviceCompatibility: input.serviceCompatibility,
      localComponentsStatus: input.localComponentsStatus,
      serviceVersion: input.serviceVersion,
    });
    if (routeServiceEvidence) {
      return routeServiceEvidence;
    }

    const runtimeReadiness = await input.runtimeReadiness;
    const ownerService =
      input.preloadedOwnerService === undefined
        ? await lookupRuntimeTransportOwnerService({
            blockForgottenDevices: true,
            env: input.env,
            ownerUserId: input.ownerUserId,
          })
        : input.preloadedOwnerService;
    if (ownerService === null) {
      return {
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.unavailable"],
          source: "unavailable",
        },
        service: createUnavailableServiceEvidence(input.localComponentsRelease),
      };
    }
    if (!ownerService.online) {
      return createRuntimeTransportMissServiceEvidence({
        localComponentsRelease: input.localComponentsRelease,
        reasonCode: "local_service.not_connected_for_account",
        runtimeReadiness,
      });
    }

    const targetDeviceId = bindingRuntime.record.runtimeLookupInput.deviceId;
    const targetLane = bindingRuntime.record.runtimeLookupInput.lane;
    const targetRuntimeSession = ownerService.sessions.find(
      (session) =>
        session.deviceId === targetDeviceId && session.lane === targetLane
    );
    if (!targetRuntimeSession) {
      return createMissingRuntimeSessionServiceEvidence({
        localComponentsRelease: input.localComponentsRelease,
        bindingRuntime: bindingRuntime.record,
        hasFreshRouteLease: input.hasFreshRouteLease,
        pendingFirstReportOwnerService: input.pendingFirstReportOwnerService,
        runtimeReadiness,
        targetRuntime: input.targetRuntime,
      });
    }

    const service = createServiceEvidenceFromLiveSession({
      localComponentsRelease: input.localComponentsRelease,
      compatibility: targetRuntimeSession.executionCompatibility,
      localComponentsStatus:
        targetRuntimeSession.capabilities.localComponents ?? null,
      serviceVersion: targetRuntimeSession.serviceVersion ?? null,
    });
    return {
      localService: {
        reachable: true,
        refreshable: service.executionCompatible,
        reasonCodes: service.executionCompatible
          ? ["local_service.refresh_in_progress"]
          : [],
        source: "runtime_transport",
      },
      service,
    };
  } catch {
    return {
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.unavailable"],
        source: "unavailable",
      },
      service: createUnavailableServiceEvidence(input.localComponentsRelease),
    };
  }
}

function createRuntimeTransportMissServiceEvidence(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  reasonCode:
    | "local_service.identity_mismatch"
    | "local_service.not_connected_for_account";
  runtimeReadiness: PrepareReadinessSummary | null;
}): LocalExecutionServiceEvidenceResolution {
  if (input.runtimeReadiness?.ready) {
    return {
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.refresh_in_progress"],
        source: "runtime_transport",
      },
      service: createNotCheckedServiceEvidence(input.localComponentsRelease),
    };
  }
  return {
    localService: {
      reachable: false,
      refreshable: false,
      reasonCodes: [input.reasonCode],
      source: "runtime_transport",
    },
    service: createNotCheckedServiceEvidence(input.localComponentsRelease),
  };
}

function createMissingRuntimeSessionServiceEvidence(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  bindingRuntime: RuntimeRegistryRecord;
  hasFreshRouteLease: boolean;
  pendingFirstReportOwnerService: {
    deviceId: string;
    lane: DaemonServiceLane;
  } | null;
  runtimeReadiness: PrepareReadinessSummary | null;
  targetRuntime: AgentExecutionTargetRuntimeContext | null;
}): LocalExecutionServiceEvidenceResolution {
  const hasMatchingPendingFirstReportOwnerService =
    input.pendingFirstReportOwnerService !== null &&
    input.bindingRuntime.runtimeLookupInput.deviceId ===
      input.pendingFirstReportOwnerService.deviceId &&
    input.bindingRuntime.runtimeLookupInput.lane ===
      input.pendingFirstReportOwnerService.lane;
  if (
    input.runtimeReadiness?.ready &&
    (input.hasFreshRouteLease || hasMatchingPendingFirstReportOwnerService)
  ) {
    return createRuntimeTransportMissServiceEvidence({
      localComponentsRelease: input.localComponentsRelease,
      reasonCode: "local_service.not_connected_for_account",
      runtimeReadiness: input.runtimeReadiness,
    });
  }
  const reasonCode =
    input.targetRuntime &&
    input.bindingRuntime.runtimeLookupInput.deviceId ===
      input.targetRuntime.deviceId &&
    input.bindingRuntime.runtimeLookupInput.lane === input.targetRuntime.lane
      ? "local_service.not_connected_for_account"
      : "local_service.identity_mismatch";
  return createRuntimeTransportMissServiceEvidence({
    localComponentsRelease: input.localComponentsRelease,
    reasonCode,
    runtimeReadiness: null,
  });
}

function resolveRouteLocalExecutionServiceEvidence(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  bindingRuntime: RuntimeRegistryRecord;
  routeDeviceId: string | null;
  routeLane: string | null;
  serviceCompatibility: DaemonExecutionCompatibility | null;
  localComponentsStatus: LocalComponentsStatus | null;
  serviceVersion: string | null;
}): {
  localService: AgentExecutionLocalServiceEvidence;
  service: AgentExecutionServiceEvidence;
} | null {
  if (input.routeDeviceId && input.routeLane) {
    const service = createServiceEvidenceFromLiveSession({
      localComponentsRelease: input.localComponentsRelease,
      compatibility: input.serviceCompatibility,
      localComponentsStatus: input.localComponentsStatus,
      serviceVersion: input.serviceVersion,
    });
    if (
      input.bindingRuntime.runtimeLookupInput.deviceId !==
        input.routeDeviceId ||
      input.bindingRuntime.runtimeLookupInput.lane !== input.routeLane
    ) {
      return {
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.identity_mismatch"],
          source: "runtime_transport",
        },
        service,
      };
    }
    return {
      localService: {
        reachable: true,
        refreshable: service.executionCompatible,
        reasonCodes: [],
        source: "runtime_transport",
      },
      service,
    };
  }

  if (!input.serviceCompatibility) {
    return null;
  }

  const service = createServiceEvidenceFromCompatibility(
    input.serviceCompatibility,
    input.localComponentsRelease
  );
  return {
    localService: {
      reachable: true,
      refreshable: service.executionCompatible,
      reasonCodes: service.executionCompatible
        ? ["local_service.refresh_in_progress"]
        : [],
      source: "runtime_transport",
    },
    service,
  };
}

function createServiceEvidenceFromCompatibility(
  compatibility: DaemonExecutionCompatibility | null,
  localComponentsRelease: CoreLocalComponentsRelease
): AgentExecutionServiceEvidence {
  if (!compatibility) {
    return createNotCheckedServiceEvidence(localComponentsRelease);
  }

  if (compatibility.status === "compatible") {
    return {
      executionCompatible: true,
      expectedEpoch: compatibility.expectedEpoch,
      observedEpoch: compatibility.observedEpoch,
      reasonCodes: [],
      source: "runtime_transport",
    };
  }

  return {
    executionCompatible: false,
    expectedEpoch: compatibility.expectedEpoch,
    observedEpoch: compatibility.observedEpoch,
    reasonCodes: ["service.update_required", compatibility.reasonCode],
    source: "runtime_transport",
  };
}

function createServiceEvidenceFromLiveSession(input: {
  localComponentsRelease: CoreLocalComponentsRelease;
  compatibility: DaemonExecutionCompatibility | null;
  localComponentsStatus: LocalComponentsStatus | null;
  serviceVersion: string | null;
}): AgentExecutionServiceEvidence {
  const service = createServiceEvidenceFromCompatibility(
    input.compatibility,
    input.localComponentsRelease
  );
  if (!service.executionCompatible) {
    return service;
  }

  const localComponents = resolveLocalComponentUpdateProjection({
    release: input.localComponentsRelease,
    generatedAt: new Date().toISOString(),
    localComponentsStatus: input.localComponentsStatus,
    serviceConnected: true,
    serviceVersion: input.serviceVersion,
  });
  if (!localComponents.service.wakeBlocked) {
    return service;
  }

  return {
    executionCompatible: false,
    expectedEpoch: service.expectedEpoch,
    observedEpoch: service.observedEpoch,
    reasonCodes: [
      "service.update_required",
      ...localComponents.service.reasonCodes,
    ],
    source: "runtime_transport",
  };
}

function doesBindingRuntimeMatchTargetRuntime(input: {
  bindingRuntime: RuntimeRegistryRecord;
  ownerUserId: string;
  targetRuntime: AgentExecutionTargetRuntimeContext;
}): boolean {
  const bindingLookup = input.bindingRuntime.runtimeLookupInput;
  if (
    bindingLookup.owner.kind !== "owner_account" ||
    bindingLookup.owner.id !== input.ownerUserId
  ) {
    return false;
  }
  if (
    bindingLookup.deviceId !== input.targetRuntime.deviceId ||
    bindingLookup.lane !== input.targetRuntime.lane
  ) {
    return false;
  }
  return (
    input.targetRuntime.openMeldServiceRuntimeId === null ||
    input.bindingRuntime.openMeldServiceRuntimeId.value ===
      input.targetRuntime.openMeldServiceRuntimeId
  );
}

function createNotCheckedServiceEvidence(
  release: CoreLocalComponentsRelease
): AgentExecutionServiceEvidence {
  return {
    executionCompatible: true,
    expectedEpoch: resolveCoreRuntimeContractRollout(release.manifest)
      .expectedEpoch,
    observedEpoch: null,
    reasonCodes: [],
    source: "not_checked",
  };
}

function createUnavailableServiceEvidence(
  release: CoreLocalComponentsRelease
): AgentExecutionServiceEvidence {
  return {
    executionCompatible: true,
    expectedEpoch: resolveCoreRuntimeContractRollout(release.manifest)
      .expectedEpoch,
    observedEpoch: null,
    reasonCodes: [],
    source: "unavailable",
  };
}

function claimDiagnosticsUnavailable(
  reasonCode: string
): AgentExecutionClaimDiagnosticEvidence {
  return {
    reasonCodes: [reasonCode],
    status: "unavailable",
  };
}

function isAgentProfileBindingProjection(
  binding: AgentExecutionBindingEvidence | null
): binding is AgentProfileBindingDisplayProjection {
  return Boolean(binding && "agentProfileId" in binding);
}

function createAgentExecutionRouteEvidence(input: {
  daemonRouteObservation: DaemonRouteObservationSummary;
  deviceId: string | null;
  lane: string | null;
}): AgentExecutionRouteEvidence {
  const statusReasonCodes: string[] = [];
  if (input.daemonRouteObservation.status === "offline") {
    statusReasonCodes.push("agent_execution.route_offline");
  }
  if (input.daemonRouteObservation.status === "unavailable") {
    statusReasonCodes.push("agent_execution.route_unavailable");
  }
  if (input.daemonRouteObservation.reasonCode !== "online") {
    statusReasonCodes.push(input.daemonRouteObservation.reasonCode);
  }
  const reasonCodes = uniqueReasonCodes(statusReasonCodes);
  if (input.daemonRouteObservation.status === "online") {
    return {
      deviceId: input.deviceId,
      lane: input.lane,
      observedAt: input.daemonRouteObservation.observedAt,
      reasonCodes,
      status: "online",
    };
  }

  return {
    deviceId: input.deviceId,
    lane: input.lane,
    observedAt: input.daemonRouteObservation.observedAt,
    reasonCodes:
      reasonCodes.length > 0 ? reasonCodes : ["agent_execution.route_missing"],
    status:
      input.daemonRouteObservation.status === "offline"
        ? "offline"
        : "unavailable",
  };
}

function toSpaceMemberAgentExecutionReadiness(
  readiness: AgentExecutionStatusProjection,
  localComponentsRelease: CoreLocalComponentsRelease
): SpaceMemberAgentExecutionReadiness {
  return {
    agentProfileId: readiness.agentProfileId,
    displayState: readiness.displayState,
    facts: {
      profile: {
        active: readiness.facts.profile.active,
        reasonCodes: [...readiness.facts.profile.reasonCodes],
        source: readiness.facts.profile.source,
      },
      binding: {
        reasonCodes: [...readiness.facts.binding.reasonCodes],
        routable: readiness.facts.binding.routable,
        source: readiness.facts.binding.source,
      },
      claim: {
        executionBlocked: readiness.facts.claim.executionBlocked,
        grantsClaimSuccess: readiness.facts.claim.grantsClaimSuccess,
        reasonCodes: [...readiness.facts.claim.reasonCodes],
        source: readiness.facts.claim.source,
      },
      providerAccount: {
        blocked: readiness.facts.providerAccount.blocked,
        expiresAtMs: readiness.facts.providerAccount.expiresAtMs,
        observedAtMs: readiness.facts.providerAccount.observedAtMs,
        provider: readiness.facts.providerAccount.provider,
        reasonCodes: [...readiness.facts.providerAccount.reasonCodes],
        source: readiness.facts.providerAccount.source,
      },
      providerConversation: {
        agentControllerConversationId:
          readiness.facts.providerConversation.agentControllerConversationId,
        errorCode: readiness.facts.providerConversation.errorCode,
        errorMessage: readiness.facts.providerConversation.errorMessage,
        errorType: readiness.facts.providerConversation.errorType,
        expiresAtMs: readiness.facts.providerConversation.expiresAtMs,
        method: readiness.facts.providerConversation.method,
        observedAtMs: readiness.facts.providerConversation.observedAtMs,
        provider: readiness.facts.providerConversation.provider,
        ready: readiness.facts.providerConversation.ready,
        reasonCodes: [...readiness.facts.providerConversation.reasonCodes],
        required: readiness.facts.providerConversation.required,
        source: readiness.facts.providerConversation.source,
        status: readiness.facts.providerConversation.status,
      },
      readinessImpact: {
        blocked: readiness.facts.readinessImpact.blocked,
        expiresAtMs: readiness.facts.readinessImpact.expiresAtMs,
        impactKind: readiness.facts.readinessImpact.impactKind,
        observedAtMs: readiness.facts.readinessImpact.observedAtMs,
        reasonCodes: [...readiness.facts.readinessImpact.reasonCodes],
        source: readiness.facts.readinessImpact.source,
      },
      localService: {
        reachable: readiness.facts.localService.reachable,
        refreshable: readiness.facts.localService.refreshable,
        reasonCodes: [...readiness.facts.localService.reasonCodes],
        source: readiness.facts.localService.source,
      },
      service: {
        executionCompatible: readiness.facts.service.executionCompatible,
        expectedEpoch: resolveCoreRuntimeContractRollout(
          localComponentsRelease.manifest
        ).expectedEpoch,
        observedEpoch: readiness.facts.service.observedEpoch,
        reasonCodes: [...readiness.facts.service.reasonCodes],
        source: readiness.facts.service.source,
      },
      route: {
        deviceId: readiness.facts.route.deviceId,
        lane: toSpaceMemberAgentExecutionRouteLane(readiness.facts.route.lane),
        observedAt: readiness.facts.route.observedAt,
        online: readiness.facts.route.online,
        reasonCodes: [...readiness.facts.route.reasonCodes],
        source: readiness.facts.route.source,
      },
      runtime: {
        ready: readiness.facts.runtime.ready,
        reasonCodes: [...readiness.facts.runtime.reasonCodes],
        source: readiness.facts.runtime.source,
      },
    },
    primaryAction: readiness.primaryAction,
    reasonCodes: [...readiness.reasonCodes],
  };
}

function toSpaceMemberAgentExecutionRouteLane(
  lane: string | null
): DaemonServiceLane | null {
  if (
    lane === null ||
    lane === "prod" ||
    lane === "dev-local" ||
    lane === "canary"
  ) {
    return lane;
  }
  throw new Error(
    `Invalid daemon service lane in agent execution route: ${lane}`
  );
}

function toWakeRouteLane(lane: string): WakeRouteLane {
  const parsed = toSpaceMemberAgentExecutionRouteLane(lane);
  if (parsed === null) {
    throw new Error("WakeRouteStatus requires a daemon service lane.");
  }
  return parsed;
}

function createRegisteredAgentWakeRouteRegistration(
  result: Extract<RuntimeTransportLookupRouteResponse, { online: true }>
): AgentWakeRouteRegistration {
  return {
    status: "registered",
    reasonCode: "wake_route.registered",
    reportedAtMs: result.localWakeRouteReport?.reportedAtMs ?? null,
    daemonSessionId: result.daemonSessionId,
    deviceId: result.deviceId,
    lane: toWakeRouteLane(result.lane),
    serviceVersion: result.serviceVersion ?? null,
  };
}

function createUnavailableAgentWakeRouteRegistration(input: {
  reasonCode: string | null;
}): AgentWakeRouteRegistration {
  return {
    status: "unavailable",
    reasonCode: input.reasonCode,
    reportedAtMs: null,
    daemonSessionId: null,
    deviceId: null,
    lane: null,
    serviceVersion: null,
  };
}

function createUnavailableAgentWakeRouteRegistrationFromLookup(input: {
  profileId: string;
  result: Extract<RuntimeTransportLookupRouteResponse, { online: false }>;
}): AgentWakeRouteRegistration {
  const rejectedProfileRegistration = input.result.rejectedProfileRegistration;
  if (rejectedProfileRegistration) {
    return {
      status: "rejected",
      reasonCode: rejectedProfileRegistration.reasonCode,
      reportedAtMs: rejectedProfileRegistration.rejectedAtMs,
      daemonSessionId: rejectedProfileRegistration.daemonSessionId,
      deviceId: rejectedProfileRegistration.deviceId,
      lane: toWakeRouteLane(rejectedProfileRegistration.lane),
      serviceVersion: rejectedProfileRegistration.serviceVersion ?? null,
    };
  }

  const ownerService = input.result.ownerService ?? null;

  // The single liveness verdict for every offline lookup that is not an explicit
  // daemon rejection or skip. ServiceRuntime liveness -- NOT socket presence,
  // NOT the daemon's route-report snapshot -- is the source of truth
  // (agent-transport-contract.md, "Service Online Evidence": socket presence is
  // delivery evidence, not online evidence). A present `lastHeartbeatMs` means
  // the lease is still fresh and only the socket is mid-replacement (a transient
  // Cloudflare 1006 / hibernation blip), so the route stays a transient
  // "pending" (Checking) -- mirroring the wakeRouteStatus split in
  // resolveRuntimeRouteSnapshot. A lease reaped past the freshness TTL has no
  // `lastHeartbeatMs` = stable Offline evidence, collapsed to a terminal
  // "expired" so the badge does not strand on "Checking" (the forbidden stable
  // sink). Both socket presence and report coverage are transient / asynchronous
  // by design and must never flip a fresh lease to Offline.
  let livenessRegistration:
    | { status: "pending"; reasonCode: "wake_route.registration_pending" }
    | {
        status: "pending";
        reasonCode: "wake_route.registration_pending_first_report";
      }
    | { status: "expired"; reasonCode: "wake_route.registration_expired" };
  if (typeof input.result.lastHeartbeatMs === "number") {
    livenessRegistration = {
      status: "pending",
      reasonCode: "wake_route.registration_pending",
    };
  } else if (ownerService) {
    livenessRegistration = {
      status: "pending",
      reasonCode: "wake_route.registration_pending_first_report",
    };
  } else {
    livenessRegistration = {
      status: "expired",
      reasonCode: "wake_route.registration_expired",
    };
  }

  const localWakeRouteReport = input.result.localWakeRouteReport ?? null;
  if (!localWakeRouteReport) {
    return {
      ...livenessRegistration,
      reportedAtMs: null,
      daemonSessionId: ownerService?.daemonSessionId ?? null,
      deviceId: ownerService?.deviceId ?? null,
      lane: ownerService ? toWakeRouteLane(ownerService.lane) : null,
      serviceVersion: ownerService?.serviceVersion ?? null,
    };
  }

  const reportSource = {
    reportedAtMs: localWakeRouteReport.reportedAtMs,
    daemonSessionId: localWakeRouteReport.daemonSessionId,
    deviceId: localWakeRouteReport.deviceId,
    lane: toWakeRouteLane(localWakeRouteReport.lane),
    serviceVersion: localWakeRouteReport.serviceVersion ?? null,
  };
  const skippedProfile = localWakeRouteReport.skippedProfiles.find(
    (profile) => profile.profileId === input.profileId
  );
  if (skippedProfile) {
    return {
      status: "skipped",
      reasonCode: skippedProfile.skipReason,
      ...reportSource,
    };
  }

  // Whether the report still *covers* this profile (includedProfileIds) is
  // asynchronous snapshot metadata, NOT a state signal: a stale "the daemon
  // manages this agent" snapshot must never decide whether the route is online
  // right now. Report-covered and report-uncovered profiles resolve identically
  // by lease freshness; the report only fills the diagnostic source. Treating
  // report coverage as a terminal Offline was the production Available<->Offline
  // flap (it bypassed the lease-freshness gate).
  return {
    ...livenessRegistration,
    ...reportSource,
  };
}

async function resolveRuntimeRouteSnapshot(input: {
  env: CoreBindings;
  generatedAt: string;
  includeRuntimeDeviceDisplayName: boolean;
  ownerUserId: string;
  preloadedResult?: RuntimeTransportLookupRouteResponse | null;
  preloadedRuntimeDeviceDisplayName?: string | null;
  profileId: string;
  timing: ReadinessTimingRecorder;
}): Promise<RuntimeRouteSnapshot> {
  try {
    if (input.preloadedResult === null) {
      throw new Error("Runtime route batch lookup was unavailable.");
    }
    const result =
      input.preloadedResult ??
      (await measureReadinessStep(input.timing, "daemon_route_lookup", () =>
        lookupRuntimeTransportRoute({
          blockForgottenDevices: true,
          env: input.env,
          ownerUserId: input.ownerUserId,
          profileId: input.profileId,
        })
      ));
    if (result.online) {
      const agentWakeRouteRegistration =
        createRegisteredAgentWakeRouteRegistration(result);
      let runtimeDeviceDisplayName: string | null = null;
      if (input.includeRuntimeDeviceDisplayName) {
        runtimeDeviceDisplayName =
          input.preloadedRuntimeDeviceDisplayName === undefined
            ? await measureReadinessStep(
                input.timing,
                "runtime_device_display_read",
                () =>
                  readRuntimeDeviceDisplayName({
                    deviceId: result.deviceId,
                    env: input.env,
                    ownerUserId: input.ownerUserId,
                    profileId: input.profileId,
                    runtimeLane: result.lane,
                  })
              )
            : input.preloadedRuntimeDeviceDisplayName;
      }
      return {
        currentSession: {
          daemonSessionId: result.daemonSessionId,
          deviceId: result.deviceId,
          lane: result.lane,
        },
        daemonRouteObservation: createDaemonRouteObservation({
          observedAt: input.generatedAt,
          reasonCode: "online",
          status: "online",
        }),
        agentWakeRouteRegistration,
        ...resolveWakeRouteAdmissionSnapshot(result, input.generatedAt),
        hasFreshRouteLease: false,
        localWakeRouteReport: toNullableLocalWakeRouteReport(
          result.localWakeRouteReport
        ),
        localComponentsStatus: result.capabilities.localComponents ?? null,
        pendingFirstReportOwnerService: null,
        routeDeviceId: result.deviceId,
        routeLane: result.lane,
        runtimeDeviceDisplayName,
        serviceCompatibility: result.executionCompatibility,
        serviceVersion: result.serviceVersion ?? null,
      };
    }

    const agentWakeRouteRegistration =
      createUnavailableAgentWakeRouteRegistrationFromLookup({
        profileId: input.profileId,
        result,
      });
    // A fresh profile lease whose socket is mid-replacement, or a fresh owner
    // service waiting for this profile's first route report, is transient
    // evidence. Socket presence is delivery evidence, not online evidence
    // (agent-transport-contract.md, "Service Online Evidence"), so the public
    // verdict stays on the checking path until service alignment or lease
    // freshness fails closed.
    if (
      typeof result.lastHeartbeatMs === "number" ||
      result.ownerService !== undefined
    ) {
      return {
        currentSession: null,
        daemonRouteObservation: createDaemonRouteObservation({
          observedAt: input.generatedAt,
          reasonCode: "route.not_registered",
          status: "offline",
        }),
        agentWakeRouteRegistration,
        wakeRouteStatus: {
          status: "checking",
        },
        routeEvidence: {
          observedAt: input.generatedAt,
          reasonCodes:
            typeof result.lastHeartbeatMs === "number"
              ? ["route.not_registered", "local_service.reconnecting"]
              : ["route.not_registered"],
          status: "offline",
        },
        hasFreshRouteLease: typeof result.lastHeartbeatMs === "number",
        localWakeRouteReport: null,
        localComponentsStatus:
          result.ownerService?.capabilities.localComponents ?? null,
        pendingFirstReportOwnerService: result.ownerService
          ? {
              deviceId: result.ownerService.deviceId,
              lane: result.ownerService.lane,
            }
          : null,
        routeDeviceId: null,
        routeLane: null,
        runtimeDeviceDisplayName: null,
        serviceCompatibility: result.executionCompatibility ?? null,
        serviceVersion: null,
      };
    }
    return {
      currentSession: null,
      daemonRouteObservation: createDaemonRouteObservation({
        observedAt: input.generatedAt,
        reasonCode: "route.not_registered",
        status: "offline",
      }),
      agentWakeRouteRegistration,
      wakeRouteStatus: {
        status: "offline",
      },
      hasFreshRouteLease: false,
      localWakeRouteReport: null,
      localComponentsStatus: null,
      pendingFirstReportOwnerService: null,
      routeDeviceId: null,
      routeLane: null,
      runtimeDeviceDisplayName: null,
      serviceCompatibility: result.executionCompatibility ?? null,
      serviceVersion: null,
    };
  } catch {
    return {
      currentSession: null,
      daemonRouteObservation: createDaemonRouteObservation({
        observedAt: input.generatedAt,
        reasonCode: "lookup_failed",
        status: "unavailable",
      }),
      agentWakeRouteRegistration: createUnavailableAgentWakeRouteRegistration({
        reasonCode: "lookup_failed",
      }),
      wakeRouteStatus: {
        status: "unavailable",
      },
      hasFreshRouteLease: false,
      localWakeRouteReport: null,
      localComponentsStatus: null,
      pendingFirstReportOwnerService: null,
      routeDeviceId: null,
      routeLane: null,
      runtimeDeviceDisplayName: null,
      serviceCompatibility: null,
      serviceVersion: null,
    };
  }
}

function toNullableLocalWakeRouteReport(
  report: LocalWakeRouteReport | undefined
): LocalWakeRouteReport | null {
  return report ?? null;
}

function resolveWakeRouteAdmissionSnapshot(
  result: Extract<RuntimeTransportLookupRouteResponse, { online: true }>,
  generatedAt: string
): Pick<RuntimeRouteSnapshot, "wakeRouteStatus" | "routeEvidence"> {
  // A live socket can keep reporting accepted work while the Service drains
  // or waits for its host. It is not a route for a new Wake.
  if (result.acceptingDispatches === false) {
    return {
      routeEvidence: {
        deviceId: result.deviceId,
        lane: result.lane,
        observedAt: generatedAt,
        reasonCodes: ["local_service.not_accepting_wakes"],
        status: "unavailable",
      },
      wakeRouteStatus: { status: "unavailable" },
    };
  }
  return {
    wakeRouteStatus: {
      connectionGeneration: result.connectionGeneration,
      daemonSessionId: result.daemonSessionId,
      deviceId: result.deviceId,
      lane: toWakeRouteLane(result.lane),
      lastHeartbeatMs: result.lastHeartbeatMs,
      leaseEpoch: result.leaseEpoch,
      status: "ready",
    },
  };
}

function createSkippedRuntimeRouteSnapshot(input: {
  agentControllerRef: string | null;
  bindingEnabled: boolean;
  bindingState: "bound" | "missing";
  generatedAt: string;
  ownerUserId: string | null;
  reasonCode: "lookup_failed" | "not_requested";
}): RuntimeRouteSnapshot {
  const daemonRouteObservation = resolveSkippedDaemonRouteObservation(input);
  return {
    currentSession: null,
    daemonRouteObservation,
    agentWakeRouteRegistration: createUnavailableAgentWakeRouteRegistration({
      reasonCode: daemonRouteObservation.reasonCode,
    }),
    wakeRouteStatus: createWakeRouteStatusFromEvidence(daemonRouteObservation),
    hasFreshRouteLease: false,
    localWakeRouteReport: null,
    localComponentsStatus: null,
    pendingFirstReportOwnerService: null,
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: null,
    serviceCompatibility: null,
    serviceVersion: null,
  };
}

function createWakeRouteStatusFromEvidence(
  daemonRouteObservation: DaemonRouteObservationSummary
): WakeRouteStatus {
  if (daemonRouteObservation.status === "online") {
    return {
      status: "checking",
    };
  }
  return {
    status: daemonRouteObservation.status,
  };
}

function resolveSkippedDaemonRouteObservation(input: {
  bindingEnabled: boolean;
  bindingState: "bound" | "missing";
  agentControllerRef: string | null;
  generatedAt: string;
  ownerUserId: string | null;
  reasonCode: "lookup_failed" | "not_requested";
}): DaemonRouteObservationSummary {
  if (
    input.bindingState === "bound" &&
    input.bindingEnabled &&
    input.ownerUserId &&
    input.agentControllerRef
  ) {
    return createDaemonRouteObservation({
      observedAt: input.generatedAt,
      reasonCode: input.reasonCode,
      status: "unavailable",
    });
  }

  return createDaemonRouteObservation({
    observedAt: input.generatedAt,
    reasonCode: "not_requested",
    status: "unavailable",
  });
}

function createDaemonRouteObservation(input: {
  observedAt: string;
  reasonCode: DaemonRouteObservationSummary["reasonCode"];
  status: DaemonRouteObservationSummary["status"];
}): DaemonRouteObservationSummary {
  return {
    observedAt: input.observedAt,
    reasonCode: input.reasonCode,
    status: input.status,
  };
}

async function readRuntimeDeviceDisplayName(input: {
  deviceId: string;
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
  runtimeLane: DaemonServiceLane;
}): Promise<string | null> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return null;
  }

  try {
    return await resolveConnectedLocalRuntimeDisplayNameUseCase({
      deviceId: input.deviceId,
      runtimeLane: input.runtimeLane,
      store: {
        readCurrentDeviceTarget: async (targetInput) =>
          await resolveCurrentDeviceFromBindings({
            db,
            userId: targetInput.userId,
          }),
        readOwnedDevices: async (devicesInput) =>
          await listOwnedDeviceRegistryRecords({
            db,
            userId: devicesInput.userId,
          }),
        readOwnedDeviceExecutionTargets: async (targetsInput) =>
          await listOwnedDeviceExecutionTargetRecords({
            db,
            nowMs: targetsInput.nowMs,
            userId: targetsInput.userId,
          }),
      },
      userId: input.ownerUserId,
    });
  } catch (error) {
    console.warn("[core.agent_execution.runtime_device_display_read_failed]", {
      agentProfileId: input.profileId,
      deviceId: input.deviceId,
      error: formatUnknownErrorMessage(error),
      runtimeLane: input.runtimeLane,
    });
    return null;
  }
}

export async function preloadRuntimeDeviceDisplayNamesForOwner(input: {
  env: CoreBindings;
  ownerUserId: string;
  targets: readonly {
    deviceId: string;
    runtimeLane: DaemonServiceLane;
  }[];
}): Promise<ReadonlyMap<string, string | null> | null> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return null;
  }
  const targets = [
    ...new Map(
      input.targets.map((target) => [
        runtimeDeviceDisplayNameTargetKey(target),
        target,
      ])
    ).values(),
  ];
  if (targets.length === 0) {
    return new Map();
  }
  try {
    const resolved = await resolveConnectedLocalRuntimeDisplayNamesUseCase({
      store: {
        readCurrentDeviceTarget: async (targetInput) =>
          await resolveCurrentDeviceFromBindings({
            db,
            userId: targetInput.userId,
          }),
        readOwnedDevices: async (devicesInput) =>
          await listOwnedDeviceRegistryRecords({
            db,
            userId: devicesInput.userId,
          }),
        readOwnedDeviceExecutionTargets: async (targetsInput) =>
          await listOwnedDeviceExecutionTargetRecords({
            db,
            nowMs: targetsInput.nowMs,
            userId: targetsInput.userId,
          }),
      },
      targets,
      userId: input.ownerUserId,
    });
    return new Map(
      resolved.map((target) => [
        runtimeDeviceDisplayNameTargetKey(target),
        target.displayName,
      ])
    );
  } catch (error) {
    console.warn("[core.agent_execution.runtime_device_display_batch_failed]", {
      error: formatUnknownErrorMessage(error),
      ownerUserId: input.ownerUserId,
      targetCount: targets.length,
    });
    return null;
  }
}

export function readPreloadedRuntimeDeviceDisplayName(input: {
  deviceId: string;
  preloaded: ReadonlyMap<string, string | null>;
  runtimeLane: DaemonServiceLane;
}): string | null {
  return input.preloaded.get(runtimeDeviceDisplayNameTargetKey(input)) ?? null;
}

function runtimeDeviceDisplayNameTargetKey(input: {
  deviceId: string;
  runtimeLane: DaemonServiceLane;
}): string {
  return `${input.deviceId}\u0000${input.runtimeLane}`;
}

function uniqueReasonCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    const reasonCode = code.trim();
    if (!reasonCode || seen.has(reasonCode)) {
      continue;
    }
    seen.add(reasonCode);
    result.push(reasonCode);
  }
  return result;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGeneratedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordReadinessDuration(
  timing: ReadinessTimingRecorder,
  step: ReadinessTimingStep,
  startedAtMs: number
) {
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  timing.durationsMs[step] = (timing.durationsMs[step] ?? 0) + durationMs;
}

async function measureReadinessStep<T>(
  timing: ReadinessTimingRecorder,
  step: ReadinessTimingStep,
  operation: () => Promise<T>
): Promise<T> {
  const startedAtMs = Date.now();
  try {
    return await operation();
  } finally {
    recordReadinessDuration(timing, step, startedAtMs);
  }
}

function logReadinessTiming(input: {
  agentProfileId: string;
  displayState: AgentExecutionStatusProjection["displayState"];
  primaryAction: AgentExecutionStatusProjection["primaryAction"];
  reasonCodes: readonly string[];
  routeReasonCode: string;
  routeStatus: string;
  startedAtMs: number;
  timing: ReadinessTimingRecorder;
}) {
  const totalDurationMs = Math.max(0, Date.now() - input.startedAtMs);
  if (input.displayState === "ready" && totalDurationMs < 500) {
    return;
  }

  console.info("[core.agent_execution.readiness_resolved]", {
    agentProfileId: input.agentProfileId,
    displayState: input.displayState,
    event: CORE_LOG_EVENTS.agentExecutionReadinessResolved,
    primaryAction: input.primaryAction,
    reasonCodeCount: input.reasonCodes.length,
    reasonCodes: input.reasonCodes,
    routeReasonCode: input.routeReasonCode,
    routeStatus: input.routeStatus,
    stepDurationsMs: input.timing.durationsMs,
    totalDurationMs,
  });
}
