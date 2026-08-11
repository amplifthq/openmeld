import { createDaemonRouteObservationSummary } from "../schemas/daemon/route-observation-summary";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "../schemas/daemon/runtime-transport";
import type {
  DaemonRouteObservationReasonCode,
  DaemonRouteObservationStatus,
  DaemonRouteObservationSummary,
} from "../types/daemon/route-observation-summary";
import type {
  AgentWakeRouteRegistration,
  WakeRouteStatus,
} from "../types/http/agent-execution-readiness";
import type {
  SpaceMemberAgentExecutionReadiness,
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "../types/http/space-members";

const DEFAULT_TIMESTAMP = "2026-03-13T00:00:00.000Z";
const DEFAULT_SPACE_ID = "space-1";
const DEFAULT_HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

type LegacyWakeabilityStatus = "ready" | "blocked";
type LegacyWakeState = "wakeable" | "offline";
type SpaceMemberAgentAgentWakeAvailability = NonNullable<
  SpaceMemberAgentSnapshot["agentWakeAvailability"]
>;
type SpaceMemberAgentAgentWakeAvailabilityInput =
  | SpaceMemberAgentAgentWakeAvailability
  | Pick<SpaceMemberAgentAgentWakeAvailability, "status">;

type CreateSpaceMemberHumanSnapshotInput = Partial<
  Omit<SpaceMemberHumanSnapshot, "profileId" | "profileKind" | "profileName">
> & {
  profileId?: string;
  profileKind?: "human";
  profileName?: string;
};

type CreateSpaceMemberAgentSnapshotInput = Partial<
  Omit<
    SpaceMemberAgentSnapshot,
    | "wakeRouteEvidence"
    | "profileId"
    | "profileKind"
    | "profileName"
    | "agentWakeAvailability"
    | "wakeState"
    | "wakeability"
  >
> & {
  agentExecutionReadiness?: SpaceMemberAgentExecutionReadiness;
  agentWakeRouteRegistration?: AgentWakeRouteRegistration;
  wakeRouteEvidence?: DaemonRouteObservationSummary;
  wakeRouteStatus?: WakeRouteStatus;
  daemonRouteReasonCode?: DaemonRouteObservationReasonCode | null;
  daemonRouteStatus?: DaemonRouteObservationStatus;
  includeAgentExecutionReadiness?: boolean;
  profileId?: string;
  profileKind?: "agent";
  profileName?: string;
  agentWakeAvailability?: SpaceMemberAgentAgentWakeAvailabilityInput;
  wakeabilityReasonCodes?: readonly string[];
  wakeabilityReasonText?: string;
  wakeabilityStatus?: LegacyWakeabilityStatus;
  wakeState?: LegacyWakeState;
};

type CreateSpaceMemberAgentExecutionReadinessInput = Partial<
  Omit<SpaceMemberAgentExecutionReadiness, "facts" | "reasonCodes">
> & {
  facts?: {
    profile?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["profile"]>;
    binding?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["binding"]>;
    claim?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["claim"]>;
    providerAccount?: Partial<
      SpaceMemberAgentExecutionReadiness["facts"]["providerAccount"]
    >;
    providerConversation?: Partial<
      SpaceMemberAgentExecutionReadiness["facts"]["providerConversation"]
    >;
    readinessImpact?: Partial<
      SpaceMemberAgentExecutionReadiness["facts"]["readinessImpact"]
    >;
    localService?: Partial<
      SpaceMemberAgentExecutionReadiness["facts"]["localService"]
    >;
    service?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["service"]>;
    route?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["route"]>;
    runtime?: Partial<SpaceMemberAgentExecutionReadiness["facts"]["runtime"]>;
  };
  reasonCodes?: readonly string[];
};
type SpaceMemberAgentExecutionBindingFact =
  SpaceMemberAgentExecutionReadiness["facts"]["binding"];
type SpaceMemberAgentExecutionProfileFact =
  SpaceMemberAgentExecutionReadiness["facts"]["profile"];
type SpaceMemberAgentExecutionClaimFact =
  SpaceMemberAgentExecutionReadiness["facts"]["claim"];
type SpaceMemberAgentExecutionProviderAccountFact =
  SpaceMemberAgentExecutionReadiness["facts"]["providerAccount"];
type SpaceMemberAgentExecutionProviderConversationFact =
  SpaceMemberAgentExecutionReadiness["facts"]["providerConversation"];
type SpaceMemberAgentExecutionReadinessImpactFact =
  SpaceMemberAgentExecutionReadiness["facts"]["readinessImpact"];
type SpaceMemberAgentExecutionLocalServiceFact =
  SpaceMemberAgentExecutionReadiness["facts"]["localService"];
type SpaceMemberAgentExecutionServiceFact =
  SpaceMemberAgentExecutionReadiness["facts"]["service"];
type SpaceMemberAgentExecutionRouteFact =
  SpaceMemberAgentExecutionReadiness["facts"]["route"];
type SpaceMemberAgentExecutionRuntimeFact =
  SpaceMemberAgentExecutionReadiness["facts"]["runtime"];

type CreateSpaceMembersSnapshotInput = {
  agents?: readonly SpaceMemberAgentSnapshot[];
  generatedAt?: string;
  humans?: readonly SpaceMemberHumanSnapshot[];
  spaceId?: string;
};

function resolveAgentExecutionReadiness(input: {
  agentExecutionReadiness?: SpaceMemberAgentExecutionReadiness;
  displayState: SpaceMemberAgentExecutionReadiness["displayState"];
  includeAgentExecutionReadiness: boolean;
  profileId: string;
  reasonCodes: readonly string[];
}): SpaceMemberAgentExecutionReadiness | undefined {
  if (input.agentExecutionReadiness) {
    return input.agentExecutionReadiness;
  }

  if (!input.includeAgentExecutionReadiness) {
    return;
  }

  const routeReasonCodes = input.reasonCodes.filter(
    isRouteUnavailableReadinessReasonCode
  );

  return createSpaceMemberAgentExecutionReadiness({
    agentProfileId: input.profileId,
    displayState: input.displayState,
    facts:
      routeReasonCodes.length === 0
        ? undefined
        : {
            route: {
              online: false,
              reasonCodes: routeReasonCodes,
              source: "daemon_route",
            },
          },
    reasonCodes: input.displayState === "ready" ? [] : [...input.reasonCodes],
  });
}

function resolveAgentExecutionDisplayState(
  input: CreateSpaceMemberAgentSnapshotInput
): SpaceMemberAgentExecutionReadiness["displayState"] {
  if (input.agentExecutionReadiness) {
    return input.agentExecutionReadiness.displayState;
  }
  if (input.wakeState) {
    return input.wakeState === "wakeable" ? "ready" : "not_ready";
  }
  if (input.wakeabilityStatus) {
    return input.wakeabilityStatus === "ready" ? "ready" : "not_ready";
  }
  return "ready";
}

function resolveAgentExecutionReasonCodes(
  input: CreateSpaceMemberAgentSnapshotInput,
  displayState: SpaceMemberAgentExecutionReadiness["displayState"]
): readonly string[] {
  if (input.agentExecutionReadiness) {
    return input.agentExecutionReadiness.reasonCodes;
  }
  if (displayState === "ready") {
    return [];
  }
  return input.wakeabilityReasonCodes ?? ["route.not_registered"];
}

function isRouteUnavailableReadinessReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "route.unavailable" ||
    reasonCode === "agent_execution.route_unavailable"
  );
}

function copyAgentExecutionReadiness(
  readiness: SpaceMemberAgentExecutionReadiness
): SpaceMemberAgentExecutionReadiness {
  return {
    ...readiness,
    facts: {
      binding: {
        ...readiness.facts.binding,
        reasonCodes: [...readiness.facts.binding.reasonCodes],
      },
      profile: {
        ...readiness.facts.profile,
        reasonCodes: [...readiness.facts.profile.reasonCodes],
      },
      claim: {
        ...readiness.facts.claim,
        reasonCodes: [...readiness.facts.claim.reasonCodes],
      },
      providerAccount: {
        ...readiness.facts.providerAccount,
        reasonCodes: [...readiness.facts.providerAccount.reasonCodes],
      },
      providerConversation: {
        ...readiness.facts.providerConversation,
        reasonCodes: [...readiness.facts.providerConversation.reasonCodes],
      },
      readinessImpact: {
        ...readiness.facts.readinessImpact,
        reasonCodes: [...readiness.facts.readinessImpact.reasonCodes],
      },
      localService: {
        ...readiness.facts.localService,
        reasonCodes: [...readiness.facts.localService.reasonCodes],
      },
      service: {
        ...readiness.facts.service,
        reasonCodes: [...readiness.facts.service.reasonCodes],
      },
      route: {
        ...readiness.facts.route,
        reasonCodes: [...readiness.facts.route.reasonCodes],
      },
      runtime: {
        ...readiness.facts.runtime,
        reasonCodes: [...readiness.facts.runtime.reasonCodes],
      },
    },
    reasonCodes: [...readiness.reasonCodes],
  };
}

function resolveDaemonRouteObservation(input: {
  wakeRouteEvidence?: DaemonRouteObservationSummary;
  daemonRouteReasonCode?: DaemonRouteObservationReasonCode | null;
  daemonRouteStatus?: DaemonRouteObservationStatus;
  displayState: SpaceMemberAgentExecutionReadiness["displayState"];
  observedAt: string;
}): DaemonRouteObservationSummary {
  if (input.wakeRouteEvidence) {
    return input.wakeRouteEvidence;
  }

  return createDaemonRouteObservationSummary({
    observedAt: input.observedAt,
    reasonCode: input.daemonRouteReasonCode,
    status:
      input.daemonRouteStatus ??
      (input.displayState === "ready" ? "online" : "offline"),
  });
}

export function createSpaceMemberAgentExecutionReadiness(
  input: CreateSpaceMemberAgentExecutionReadinessInput = {}
): SpaceMemberAgentExecutionReadiness {
  const displayState = input.displayState ?? "ready";
  const ready = displayState === "ready";
  const defaultReasonCodes = ready ? [] : ["agent_profile_binding.missing"];
  const binding = input.facts?.binding;
  const profile = input.facts?.profile;
  const claim = input.facts?.claim;
  const providerAccount = input.facts?.providerAccount;
  const providerConversation = input.facts?.providerConversation;
  const readinessImpact = input.facts?.readinessImpact;
  const localService = input.facts?.localService;
  const service = input.facts?.service;
  const route = input.facts?.route;
  const runtime = input.facts?.runtime;
  const primaryAction =
    input.primaryAction ??
    resolveDefaultAgentExecutionPrimaryAction(displayState);

  const readiness: SpaceMemberAgentExecutionReadiness = {
    agentProfileId: input.agentProfileId ?? DEFAULT_AGENT_PROFILE_ID,
    displayState,
    facts: createSpaceMemberAgentExecutionFacts({
      binding,
      claim,
      defaultReasonCodes,
      localService,
      profile,
      providerAccount,
      providerConversation,
      readinessImpact,
      ready,
      route,
      service,
      runtime,
    }),
    primaryAction,
    reasonCodes: [...(input.reasonCodes ?? defaultReasonCodes)],
  };
  assertAgentExecutionReadinessSemanticFixture(readiness);
  return readiness;
}

function assertAgentExecutionReadinessSemanticFixture(
  readiness: SpaceMemberAgentExecutionReadiness
): void {
  if (readiness.displayState !== "ready") {
    return;
  }

  const blockingFacts = resolveBlockingReadyFixtureFacts(readiness);
  if (blockingFacts.length === 0) {
    return;
  }

  throw new Error(
    `ready AgentExecutionReadiness fixture carries blocking facts: ${blockingFacts.join(", ")}`
  );
}

function resolveBlockingReadyFixtureFacts(
  readiness: SpaceMemberAgentExecutionReadiness
): string[] {
  const facts = readiness.facts;
  const blockingFacts: string[] = [];
  if (!facts.profile.active) {
    blockingFacts.push("profile.active=false");
  }
  if (!facts.binding.routable || facts.binding.source === "blocked") {
    blockingFacts.push("binding.not_routable");
  }
  if (facts.claim.executionBlocked) {
    blockingFacts.push("claim.executionBlocked=true");
  }
  if (facts.providerAccount.blocked) {
    blockingFacts.push("providerAccount.blocked=true");
  }
  if (!facts.providerConversation.ready) {
    blockingFacts.push("providerConversation.ready=false");
  }
  if (facts.readinessImpact.blocked) {
    blockingFacts.push("readinessImpact.blocked=true");
  }
  if (!facts.localService.reachable) {
    blockingFacts.push("localService.reachable=false");
  }
  if (!facts.service.executionCompatible) {
    blockingFacts.push("service.executionCompatible=false");
  }
  if (!facts.route.online) {
    blockingFacts.push("route.online=false");
  }
  if (!facts.runtime.ready) {
    blockingFacts.push("runtime.ready=false");
  }
  return blockingFacts;
}

function createSpaceMemberAgentExecutionFacts(input: {
  binding: Partial<SpaceMemberAgentExecutionBindingFact> | undefined;
  claim: Partial<SpaceMemberAgentExecutionClaimFact> | undefined;
  defaultReasonCodes: readonly string[];
  localService: Partial<SpaceMemberAgentExecutionLocalServiceFact> | undefined;
  profile: Partial<SpaceMemberAgentExecutionProfileFact> | undefined;
  providerAccount:
    | Partial<SpaceMemberAgentExecutionProviderAccountFact>
    | undefined;
  providerConversation:
    | Partial<SpaceMemberAgentExecutionProviderConversationFact>
    | undefined;
  readinessImpact:
    | Partial<SpaceMemberAgentExecutionReadinessImpactFact>
    | undefined;
  ready: boolean;
  route: Partial<SpaceMemberAgentExecutionRouteFact> | undefined;
  service: Partial<SpaceMemberAgentExecutionServiceFact> | undefined;
  runtime: Partial<SpaceMemberAgentExecutionRuntimeFact> | undefined;
}): SpaceMemberAgentExecutionReadiness["facts"] {
  return {
    profile: createSpaceMemberAgentExecutionProfileFact(input.profile),
    binding: createSpaceMemberAgentExecutionBindingFact({
      binding: input.binding,
      defaultReasonCodes: input.defaultReasonCodes,
      ready: input.ready,
    }),
    claim: createSpaceMemberAgentExecutionClaimFact(input.claim),
    providerAccount: createSpaceMemberAgentExecutionProviderAccountFact(
      input.providerAccount
    ),
    providerConversation:
      createSpaceMemberAgentExecutionProviderConversationFact(
        input.providerConversation
      ),
    readinessImpact: createSpaceMemberAgentExecutionReadinessImpactFact(
      input.readinessImpact
    ),
    localService: createSpaceMemberAgentExecutionLocalServiceFact({
      localService: input.localService,
      ready: input.ready,
    }),
    service: createSpaceMemberAgentExecutionServiceFact({
      ready: input.ready,
      service: input.service,
    }),
    route: createSpaceMemberAgentExecutionRouteFact(input.route),
    runtime: createSpaceMemberAgentExecutionRuntimeFact(input.runtime),
  };
}

function createSpaceMemberAgentExecutionProfileFact(
  profile: Partial<SpaceMemberAgentExecutionProfileFact> | undefined
): SpaceMemberAgentExecutionProfileFact {
  return {
    active: profile?.active ?? true,
    reasonCodes: [...(profile?.reasonCodes ?? [])],
    source: profile?.source ?? "profile_identity",
  };
}

function createSpaceMemberAgentExecutionClaimFact(
  claim: Partial<SpaceMemberAgentExecutionClaimFact> | undefined
): SpaceMemberAgentExecutionClaimFact {
  return {
    executionBlocked: claim?.executionBlocked ?? false,
    grantsClaimSuccess: false,
    reasonCodes: [...(claim?.reasonCodes ?? [])],
    source: claim?.source ?? "not_checked",
  };
}

function createSpaceMemberAgentExecutionProviderAccountFact(
  providerAccount:
    | Partial<SpaceMemberAgentExecutionProviderAccountFact>
    | undefined
): SpaceMemberAgentExecutionProviderAccountFact {
  return {
    blocked: providerAccount?.blocked ?? false,
    expiresAtMs: providerAccount?.expiresAtMs ?? null,
    observedAtMs: providerAccount?.observedAtMs ?? null,
    provider: providerAccount?.provider ?? null,
    reasonCodes: [...(providerAccount?.reasonCodes ?? [])],
    source: providerAccount?.source ?? "not_checked",
  };
}

function createSpaceMemberAgentExecutionProviderConversationFact(
  providerConversation:
    | Partial<SpaceMemberAgentExecutionProviderConversationFact>
    | undefined
): SpaceMemberAgentExecutionProviderConversationFact {
  return {
    agentControllerConversationId:
      providerConversation?.agentControllerConversationId ?? null,
    errorCode: providerConversation?.errorCode ?? null,
    errorMessage: providerConversation?.errorMessage ?? null,
    errorType: providerConversation?.errorType ?? null,
    expiresAtMs: providerConversation?.expiresAtMs ?? null,
    method: providerConversation?.method ?? null,
    observedAtMs: providerConversation?.observedAtMs ?? null,
    provider: providerConversation?.provider ?? null,
    ready: providerConversation?.ready ?? true,
    reasonCodes: [...(providerConversation?.reasonCodes ?? [])],
    required: providerConversation?.required ?? false,
    source: providerConversation?.source ?? "not_required",
    status: providerConversation?.status ?? "not_required",
  };
}

function createSpaceMemberAgentExecutionReadinessImpactFact(
  readinessImpact:
    | Partial<SpaceMemberAgentExecutionReadinessImpactFact>
    | undefined
): SpaceMemberAgentExecutionReadinessImpactFact {
  return {
    blocked: readinessImpact?.blocked ?? false,
    expiresAtMs: readinessImpact?.expiresAtMs ?? null,
    impactKind: readinessImpact?.impactKind ?? null,
    observedAtMs: readinessImpact?.observedAtMs ?? null,
    reasonCodes: [...(readinessImpact?.reasonCodes ?? [])],
    source: readinessImpact?.source ?? "not_checked",
  };
}

function createSpaceMemberAgentExecutionLocalServiceFact(input: {
  localService: Partial<SpaceMemberAgentExecutionLocalServiceFact> | undefined;
  ready: boolean;
}): SpaceMemberAgentExecutionLocalServiceFact {
  return {
    reachable: input.localService?.reachable ?? input.ready,
    refreshable: input.localService?.refreshable ?? input.ready,
    reasonCodes: [...(input.localService?.reasonCodes ?? [])],
    source:
      input.localService?.source ??
      (input.ready ? "runtime_transport" : "not_checked"),
  };
}

function createSpaceMemberAgentExecutionServiceFact(input: {
  ready: boolean;
  service: Partial<SpaceMemberAgentExecutionServiceFact> | undefined;
}): SpaceMemberAgentExecutionServiceFact {
  return {
    executionCompatible: input.service?.executionCompatible ?? input.ready,
    expectedEpoch:
      input.service?.expectedEpoch ?? CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    observedEpoch:
      input.service?.observedEpoch ??
      (input.ready ? CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH : null),
    reasonCodes: [...(input.service?.reasonCodes ?? [])],
    source:
      input.service?.source ??
      (input.ready ? "runtime_transport" : "not_checked"),
  };
}

function createSpaceMemberAgentExecutionRouteFact(
  route: Partial<SpaceMemberAgentExecutionRouteFact> | undefined
): SpaceMemberAgentExecutionRouteFact {
  return {
    deviceId: route?.deviceId ?? "device-1",
    lane: route?.lane ?? "dev-local",
    observedAt: route?.observedAt ?? DEFAULT_TIMESTAMP,
    online: route?.online ?? true,
    reasonCodes: [...(route?.reasonCodes ?? [])],
    source: route?.source ?? "daemon_route",
  };
}

function createSpaceMemberAgentExecutionRuntimeFact(
  runtime: Partial<SpaceMemberAgentExecutionRuntimeFact> | undefined
): SpaceMemberAgentExecutionRuntimeFact {
  return {
    ready: runtime?.ready ?? true,
    reasonCodes: [...(runtime?.reasonCodes ?? [])],
    source: runtime?.source ?? "prepare_readiness",
  };
}

function createSpaceMemberAgentExecutionBindingFact(input: {
  binding: Partial<SpaceMemberAgentExecutionBindingFact> | undefined;
  defaultReasonCodes: readonly string[];
  ready: boolean;
}): SpaceMemberAgentExecutionBindingFact {
  const routable = input.binding?.routable ?? input.ready;
  return {
    reasonCodes: [
      ...(input.binding?.reasonCodes ??
        resolveDefaultAgentExecutionBindingReasonCodes({
          defaultReasonCodes: input.defaultReasonCodes,
          routable,
        })),
    ],
    routable,
    source:
      input.binding?.source ??
      resolveDefaultAgentExecutionBindingSource(routable),
  };
}

function resolveDefaultAgentExecutionBindingReasonCodes(input: {
  defaultReasonCodes: readonly string[];
  routable: boolean;
}): readonly string[] {
  return input.routable ? [] : input.defaultReasonCodes;
}

function resolveDefaultAgentExecutionBindingSource(
  routable: boolean
): SpaceMemberAgentExecutionBindingFact["source"] {
  return routable ? "binding_truth" : "missing";
}

function resolveDefaultAgentExecutionPrimaryAction(
  displayState: SpaceMemberAgentExecutionReadiness["displayState"]
): SpaceMemberAgentExecutionReadiness["primaryAction"] {
  return displayState === "ready" ? "none" : "reconnect_binding";
}

export function createSpaceMemberHumanSnapshot(
  input: CreateSpaceMemberHumanSnapshotInput = {}
): SpaceMemberHumanSnapshot {
  const {
    addedAt = DEFAULT_TIMESTAMP,
    addedByDisplayName = null,
    addedByOwnerUserId = null,
    addedByProfileId = null,
    createdAt = DEFAULT_TIMESTAMP,
    firstEnteredAt = DEFAULT_TIMESTAMP,
    lastEnteredAt = DEFAULT_TIMESTAMP,
    lastSeenAt = DEFAULT_TIMESTAMP,
    lastSeenLabel = "Seen now",
    liveNow = false,
    memberSource = "space_creator",
    memberSourceLabel = memberSource === "joined_directly"
      ? "Joined directly"
      : "Creator",
    mentionAlias = null,
    ownerName = input.profileName ?? "Felix",
    ownerUserId = null,
    profileId = DEFAULT_HUMAN_PROFILE_ID,
    profileName = "Felix",
    removalReason = null,
    removedAt = null,
    removedByOwnerUserId = null,
    removedByProfileId = null,
    status = "active",
    updatedAt = DEFAULT_TIMESTAMP,
  } = input;

  return {
    addedAt,
    addedByDisplayName,
    addedByOwnerUserId,
    addedByProfileId,
    createdAt,
    firstEnteredAt,
    lastEnteredAt,
    lastSeenAt,
    lastSeenLabel,
    liveNow,
    memberSource,
    memberSourceLabel,
    mentionAlias,
    ownerName,
    ownerUserId,
    profileId,
    profileKind: "human",
    profileName,
    removalReason,
    removedAt,
    removedByOwnerUserId,
    removedByProfileId,
    status,
    updatedAt,
  };
}

export function createSpaceMemberAgentSnapshot(
  input: CreateSpaceMemberAgentSnapshotInput = {}
): SpaceMemberAgentSnapshot {
  const {
    addedAt = DEFAULT_TIMESTAMP,
    addedByDisplayName = "Felix",
    addedByOwnerUserId = "user_felix",
    addedByProfileId = DEFAULT_HUMAN_PROFILE_ID,
    agentExecutionReadiness,
    agentWakeRouteRegistration,
    agentControllerConversationId = null,
    agentControllerPermissionMode,
    agentControllerRef = "builtin:codex",
    createdAt = DEFAULT_TIMESTAMP,
    wakeRouteEvidence,
    wakeRouteStatus,
    daemonRouteReasonCode,
    daemonRouteStatus,
    firstEnteredAt = DEFAULT_TIMESTAMP,
    includeAgentExecutionReadiness = true,
    lastEnteredAt = DEFAULT_TIMESTAMP,
    lastSeenAt = DEFAULT_TIMESTAMP,
    lastSeenLabel = "Seen now",
    liveNow = false,
    memberSource = "added_by_member",
    memberSourceLabel = "Added by Felix",
    mentionAlias = null,
    ownerName = "Felix",
    ownerUserId = "user_felix",
    profileId = DEFAULT_AGENT_PROFILE_ID,
    profileName = "Ops Bot",
    agentWakeAvailability,
    removalReason = null,
    removedAt = null,
    removedByOwnerUserId = null,
    removedByProfileId = null,
    runtimeDeviceDisplayName,
    status = "active",
    updatedAt = DEFAULT_TIMESTAMP,
    ownerWakeDiagnostics,
    wakeabilityStatus,
    wakeabilityReasonCodes,
    wakeState,
    modelSelection,
    workingDirectory,
  } = input;

  const displayState = resolveAgentExecutionDisplayState({
    ...input,
    wakeabilityStatus,
    wakeabilityReasonCodes,
    wakeState,
  });
  const readinessReasonCodes = resolveAgentExecutionReasonCodes(
    {
      ...input,
      wakeabilityReasonCodes,
      wakeabilityStatus,
      wakeState,
    },
    displayState
  );
  const resolvedAgentExecutionReadiness = resolveAgentExecutionReadiness({
    agentExecutionReadiness,
    displayState,
    includeAgentExecutionReadiness,
    profileId,
    reasonCodes: readinessReasonCodes,
  });
  const resolvedDaemonRouteObservation = resolveDaemonRouteObservation({
    wakeRouteEvidence,
    daemonRouteReasonCode,
    daemonRouteStatus,
    displayState,
    observedAt: lastSeenAt ?? updatedAt,
  });
  const resolvedWakeRouteStatus =
    wakeRouteStatus ??
    createWakeRouteStatusFromEvidence(resolvedDaemonRouteObservation);
  const resolvedAgentWakeRouteRegistration =
    agentWakeRouteRegistration ??
    createAgentWakeRouteRegistrationFromWakeRouteStatus(
      resolvedWakeRouteStatus
    );
  const resolvedOwnerWakeDiagnostics =
    ownerWakeDiagnostics === undefined &&
    resolvedAgentExecutionReadiness !== undefined
      ? {
          state: resolveOwnerWakeDiagnosticsState({
            wakeRouteStatus: resolvedWakeRouteStatus,
            readiness: resolvedAgentExecutionReadiness,
          }),
          agentExecutionReadiness: copyAgentExecutionReadiness(
            resolvedAgentExecutionReadiness
          ),
          agentWakeRouteRegistration: {
            ...resolvedAgentWakeRouteRegistration,
          },
          wakeRouteEvidence: { ...resolvedDaemonRouteObservation },
          wakeRouteStatus: { ...resolvedWakeRouteStatus },
        }
      : ownerWakeDiagnostics;
  const rawAgentWakeAvailability =
    agentWakeAvailability ??
    (resolvedAgentExecutionReadiness === undefined
      ? undefined
      : createSpaceMemberAgentAgentWakeAvailability({
          wakeRouteStatus: resolvedWakeRouteStatus,
          readiness: resolvedAgentExecutionReadiness,
        }));
  const resolvedAgentWakeAvailability =
    rawAgentWakeAvailability === undefined
      ? undefined
      : normalizeSpaceMemberAgentAgentWakeAvailability(
          rawAgentWakeAvailability
        );

  return {
    addedAt,
    addedByDisplayName,
    addedByOwnerUserId,
    addedByProfileId,
    agentControllerConversationId,
    ...(agentControllerPermissionMode === undefined
      ? {}
      : { agentControllerPermissionMode }),
    agentControllerRef,
    ...(modelSelection === undefined ? {} : { modelSelection }),
    createdAt,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    firstEnteredAt,
    lastEnteredAt,
    lastSeenAt,
    lastSeenLabel,
    liveNow,
    memberSource,
    memberSourceLabel,
    mentionAlias,
    ownerName,
    ownerUserId,
    profileId,
    profileKind: "agent",
    profileName,
    ...(resolvedAgentWakeAvailability === undefined
      ? {}
      : { agentWakeAvailability: resolvedAgentWakeAvailability }),
    removalReason,
    removedAt,
    removedByOwnerUserId,
    removedByProfileId,
    ...(runtimeDeviceDisplayName === undefined
      ? {}
      : { runtimeDeviceDisplayName }),
    status,
    updatedAt,
    ...(resolvedOwnerWakeDiagnostics === undefined
      ? {}
      : { ownerWakeDiagnostics: resolvedOwnerWakeDiagnostics }),
  };
}

export function createSpaceMembersSnapshot(
  input: CreateSpaceMembersSnapshotInput = {}
): SpaceMembersSnapshot {
  const humans = [...(input.humans ?? [])];
  const agents = [...(input.agents ?? [])];
  const wakeableAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "available_for_wake"
  ).length;
  const checkingAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "checking_connection"
  ).length;
  const offlineAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "offline_for_wake"
  ).length;
  const unavailableAgentCount = agents.filter(
    (agent) => agent.agentWakeAvailability?.status === "unavailable_for_wake"
  ).length;

  return {
    agents,
    generatedAt: input.generatedAt ?? DEFAULT_TIMESTAMP,
    humans,
    spaceId: input.spaceId ?? DEFAULT_SPACE_ID,
    summary: {
      agentCount: agents.length,
      humanCount: humans.length,
      liveNowCount: [...humans, ...agents].filter((member) => member.liveNow)
        .length,
      checkingAgentCount,
      offlineAgentCount,
      totalCount: humans.length + agents.length,
      unavailableAgentCount,
      wakeableAgentCount,
    },
  };
}

function createSpaceMemberAgentAgentWakeAvailability(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: SpaceMemberAgentExecutionReadiness;
}): SpaceMemberAgentAgentWakeAvailability {
  if (
    input.readiness.displayState === "ready" &&
    input.wakeRouteStatus.status === "ready"
  ) {
    return createAgentWakeAvailabilityFromStatus("available_for_wake");
  }
  if (
    input.wakeRouteStatus.status === "unavailable" ||
    hasKnownPublicUnavailableReadiness(input.readiness)
  ) {
    return createAgentWakeAvailabilityFromStatus("unavailable_for_wake");
  }
  if (isCheckingAgentWakeAvailability(input)) {
    return createAgentWakeAvailabilityFromStatus("checking_connection");
  }
  if (
    input.wakeRouteStatus.status === "offline" ||
    hasKnownPublicOfflineReadiness(input.readiness)
  ) {
    return createAgentWakeAvailabilityFromStatus("offline_for_wake");
  }
  return createAgentWakeAvailabilityFromStatus("unavailable_for_wake");
}

function normalizeSpaceMemberAgentAgentWakeAvailability(
  input: SpaceMemberAgentAgentWakeAvailabilityInput
): SpaceMemberAgentAgentWakeAvailability {
  if ("badgeLabel" in input) {
    return input;
  }
  return createAgentWakeAvailabilityFromStatus(input.status);
}

function createAgentWakeAvailabilityFromStatus(
  status: SpaceMemberAgentAgentWakeAvailability["status"]
): SpaceMemberAgentAgentWakeAvailability {
  switch (status) {
    case "available_for_wake":
      return {
        action: "none",
        badgeLabel: "Available",
        category: "available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        reasonCode: "agent_execution.ready",
        status,
        summary: "Can reply from this computer in Spaces.",
        tooltip: "Available for Wake",
      };
    case "checking_connection":
      return {
        action: "check_status",
        badgeLabel: "Checking",
        category: "checking",
        isRefreshing: true,
        label: "Checking connection",
        phase: "checking_status",
        reasonCode: "agent_execution.check_status",
        status,
        summary: "Checking this agent's Wake availability.",
        tooltip: "Checking Wake availability",
      };
    case "offline_for_wake":
      return {
        action: "connect_service",
        badgeLabel: "Offline",
        category: "offline",
        isRefreshing: false,
        label: "Offline for Wake",
        phase: "service_not_connected",
        reasonCode: "service.not_running",
        status,
        summary:
          "Connect OpenMeld Service on this computer before this agent can reply.",
        tooltip: "OpenMeld Service is not connected on this computer.",
      };
    case "unavailable_for_wake":
      return {
        action: "reconnect_binding",
        badgeLabel: "Connect",
        category: "unavailable",
        isRefreshing: false,
        label: "Connect local agent",
        phase: "connect_local_agent",
        reasonCode: "agent_profile_binding.missing",
        status,
        summary: "Connect a local agent before this profile can reply.",
        tooltip: "Connect local agent",
      };
    default:
      return {
        action: "check_status",
        badgeLabel: "Checking",
        category: "checking",
        isRefreshing: true,
        label: "Checking connection",
        phase: "checking_status",
        reasonCode: null,
        status: "checking_connection",
        summary: "Checking this agent's Wake availability.",
        tooltip: "Checking Wake availability",
      };
  }
}

function isCheckingAgentWakeAvailability(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: SpaceMemberAgentExecutionReadiness;
}): boolean {
  if (requiresServiceUpdate(input.readiness)) {
    return false;
  }
  return isCheckingAvailabilityState(input);
}

function requiresServiceUpdate(
  readiness: SpaceMemberAgentExecutionReadiness
): boolean {
  return (
    readiness.primaryAction === "update_service" ||
    readiness.reasonCodes.includes("service.update_required")
  );
}

function hasKnownPublicUnavailableReadiness(
  readiness: SpaceMemberAgentExecutionReadiness
): boolean {
  const reasonCodes = new Set([
    ...readiness.reasonCodes,
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.providerAccount.reasonCodes,
    ...readiness.facts.readinessImpact.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ]);

  for (const reasonCode of reasonCodes) {
    if (isPublicUnavailableReadinessReason(reasonCode)) {
      return true;
    }
  }

  return false;
}

function hasKnownPublicOfflineReadiness(
  readiness: SpaceMemberAgentExecutionReadiness
): boolean {
  const reasonCodes = new Set([
    ...readiness.reasonCodes,
    ...readiness.facts.localService.reasonCodes,
    ...readiness.facts.route.reasonCodes,
  ]);

  for (const reasonCode of reasonCodes) {
    if (isPublicOfflineReadinessReason(reasonCode)) {
      return true;
    }
  }

  return false;
}

function isPublicOfflineReadinessReason(reasonCode: string): boolean {
  return (
    reasonCode === "service.not_running" ||
    reasonCode === "agent_execution.route_offline" ||
    reasonCode === "route.offline"
  );
}

function isPublicUnavailableReadinessReason(reasonCode: string): boolean {
  return (
    reasonCode === "profile.unbound" ||
    reasonCode === "profile.inactive" ||
    reasonCode === "route.unavailable" ||
    reasonCode === "agent_execution.route_unavailable" ||
    reasonCode === "service.update_required" ||
    reasonCode === "background_helper.update_required" ||
    isPublicUnavailableAgentProfileBindingReason(reasonCode) ||
    isPublicUnavailableClaimEligibilityReason(reasonCode) ||
    reasonCode.startsWith("controller.") ||
    reasonCode.startsWith("daemon.runtime_contract.") ||
    reasonCode.startsWith("organization_binding_authorization.") ||
    reasonCode.startsWith("provider_account.") ||
    reasonCode.startsWith("workspace.")
  );
}

function isPublicUnavailableAgentProfileBindingReason(
  reasonCode: string
): boolean {
  return (
    reasonCode === "agent_profile_binding.missing" ||
    reasonCode === "agent_profile_binding.disabled_historical" ||
    reasonCode === "agent_profile_binding.conflict" ||
    reasonCode === "agent_profile_binding.owner_mismatch" ||
    reasonCode === "agent_profile_binding.profile_owner_invalid" ||
    reasonCode === "agent_profile_binding.profile_owner_unavailable" ||
    reasonCode === "agent_profile_binding.read_unavailable" ||
    reasonCode === "agent_profile_binding.store_unavailable" ||
    reasonCode === "agent_profile_binding.runtime_owner_mismatch" ||
    reasonCode === "agent_profile_binding.agent_controller_report_missing" ||
    reasonCode === "agent_profile_binding.agent_controller_report_invalid" ||
    reasonCode === "agent_profile_binding.agent_controller_report_stale" ||
    reasonCode === "agent_profile_binding.agent_controller_report_disabled" ||
    reasonCode === "agent_profile_binding.agent_controller_report_unavailable"
  );
}

function isPublicUnavailableClaimEligibilityReason(
  reasonCode: string
): boolean {
  return (
    reasonCode === "claim_eligibility.binding_capability_mismatch" ||
    reasonCode === "claim_eligibility.binding_conflict" ||
    reasonCode === "claim_eligibility.binding_disabled" ||
    reasonCode === "claim_eligibility.binding_missing" ||
    reasonCode === "claim_eligibility.binding_not_routable" ||
    reasonCode === "claim_eligibility.binding_owner_mismatch" ||
    reasonCode === "claim_eligibility.binding_runtime_mismatch"
  );
}

function resolveOwnerWakeDiagnosticsState(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: SpaceMemberAgentExecutionReadiness;
}): NonNullable<SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]>["state"] {
  if (input.readiness.displayState === "ready") {
    return "none";
  }
  if (isCheckingAvailabilityState(input)) {
    return "checking_wake_status";
  }
  return "action_required";
}

function createAgentWakeRouteRegistrationFromWakeRouteStatus(
  wakeRouteStatus: WakeRouteStatus
): AgentWakeRouteRegistration {
  if (wakeRouteStatus.status === "ready") {
    return {
      status: "registered",
      reasonCode: "wake_route.registered",
      reportedAtMs: 1_768_000_000_000,
      daemonSessionId: wakeRouteStatus.daemonSessionId,
      deviceId: wakeRouteStatus.deviceId,
      lane: wakeRouteStatus.lane,
      serviceVersion: "0.7.52",
    };
  }
  if (wakeRouteStatus.status === "offline") {
    return {
      status: "pending",
      reasonCode: "wake_route.registration_pending",
      reportedAtMs: null,
      daemonSessionId: null,
      deviceId: null,
      lane: null,
      serviceVersion: null,
    };
  }
  return {
    status: "unavailable",
    reasonCode: "lookup_failed",
    reportedAtMs: null,
    daemonSessionId: null,
    deviceId: null,
    lane: null,
    serviceVersion: null,
  };
}

function createWakeRouteStatusFromEvidence(
  evidence: DaemonRouteObservationSummary
): WakeRouteStatus {
  if (evidence.status === "online") {
    return {
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-fixture",
      deviceId: "device_22222222-2222-4222-8222-222222222222",
      lane: "dev-local",
      lastHeartbeatMs: 1_768_000_000_000,
      leaseEpoch: 1,
      status: "ready",
    };
  }
  return {
    status: evidence.status,
  };
}

function isCheckingAvailabilityState(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: SpaceMemberAgentExecutionReadiness;
}): boolean {
  if (input.wakeRouteStatus.status === "unavailable") {
    return false;
  }
  return (
    input.readiness.displayState === "unknown" ||
    isRefreshableAgentExecutionCheck(input.readiness) ||
    isRefreshableRouteGap(input)
  );
}

function isRefreshableAgentExecutionCheck(
  readiness: SpaceMemberAgentExecutionReadiness
): boolean {
  return (
    readiness.primaryAction === "check_status" &&
    readiness.facts.localService.reachable &&
    readiness.facts.localService.refreshable
  );
}

function isRefreshableRouteGap(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: SpaceMemberAgentExecutionReadiness;
}): boolean {
  return (
    input.wakeRouteStatus.status !== "unavailable" &&
    input.readiness.facts.localService.reachable &&
    input.readiness.facts.localService.refreshable &&
    input.readiness.reasonCodes.some(isTransientRouteReasonCode)
  );
}

function isTransientRouteReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "agent_execution.route_missing" ||
    reasonCode === "route.not_registered"
  );
}
