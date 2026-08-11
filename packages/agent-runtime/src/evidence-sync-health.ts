import type { AgentExecutionStatusProjection } from "./agent-execution-status";

export type EvidenceSyncHealthStatus =
  | "blocked"
  | "degraded"
  | "healthy"
  | "not_checked";

export type EvidenceSyncHealthChannelId =
  | "binding_projection"
  | "execution_authority_diagnostic"
  | "local_service"
  | "profile_identity"
  | "provider_account_diagnostic"
  | "provider_conversation_diagnostic"
  | "readiness_impact_diagnostic"
  | "route_catalog_sync"
  | "runtime_registration"
  | "service_compatibility";

export type EvidenceSyncHealthChannelRole =
  | "owner_diagnostic"
  | "wake_path_evidence";

export type EvidenceSyncHealthChannel = {
  failureCode: string | null;
  id: EvidenceSyncHealthChannelId;
  label: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  reasonCodes: readonly string[];
  role: EvidenceSyncHealthChannelRole;
  source: string;
  status: EvidenceSyncHealthStatus;
  summary: string;
};

export type EvidenceSyncHealth = {
  agentProfileId: string;
  authoritative: false;
  channels: readonly EvidenceSyncHealthChannel[];
  generatedAt: string;
  scope: "owner_diagnostics";
  source: "evidence_sync_health";
  status: EvidenceSyncHealthStatus;
  summary: string;
  useInstead: readonly ["AgentWakeAvailability", "openmeld service trace"];
  verdict: "not_wake_readiness";
};

type EvidenceSyncHealthInput = {
  generatedAt?: string;
  readiness: AgentExecutionStatusProjection;
};

export function resolveEvidenceSyncHealth(
  input: EvidenceSyncHealthInput
): EvidenceSyncHealth {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const channels = buildEvidenceSyncHealthChannels({
    generatedAt,
    readiness: input.readiness,
  });
  const status = resolveEvidenceSyncHealthStatus(channels);
  return {
    agentProfileId: input.readiness.agentProfileId,
    authoritative: false,
    channels,
    generatedAt,
    scope: "owner_diagnostics",
    source: "evidence_sync_health",
    status,
    summary: summarizeEvidenceSyncHealthStatus(status),
    useInstead: ["AgentWakeAvailability", "openmeld service trace"],
    verdict: "not_wake_readiness",
  };
}

function buildEvidenceSyncHealthChannels(input: {
  generatedAt: string;
  readiness: AgentExecutionStatusProjection;
}): EvidenceSyncHealthChannel[] {
  const { facts } = input.readiness;
  return [
    buildProfileIdentityChannel({
      fact: facts.profile,
      generatedAt: input.generatedAt,
    }),
    buildBindingProjectionChannel({
      fact: facts.binding,
      generatedAt: input.generatedAt,
    }),
    buildLocalServiceChannel({
      fact: facts.localService,
      generatedAt: input.generatedAt,
    }),
    buildServiceCompatibilityChannel({
      fact: facts.service,
      generatedAt: input.generatedAt,
    }),
    buildRuntimeRegistrationChannel({
      fact: facts.runtime,
      generatedAt: input.generatedAt,
    }),
    buildRouteCatalogSyncChannel({
      fact: facts.route,
      generatedAt: input.generatedAt,
    }),
    buildExecutionAuthorityDiagnosticChannel({
      fact: facts.claim,
      generatedAt: input.generatedAt,
    }),
    buildProviderAccountDiagnosticChannel({
      fact: facts.providerAccount,
      generatedAt: input.generatedAt,
    }),
    buildProviderConversationDiagnosticChannel({
      fact: facts.providerConversation,
      generatedAt: input.generatedAt,
    }),
    buildReadinessImpactDiagnosticChannel({
      fact: facts.readinessImpact,
      generatedAt: input.generatedAt,
    }),
  ];
}

function buildProfileIdentityChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["profile"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.source === "unavailable") {
    return createChannel({
      failureCode: firstReasonCode(input.fact.reasonCodes),
      generatedAt: input.generatedAt,
      id: "profile_identity",
      label: "Profile identity",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "degraded",
      summary: "Profile identity evidence could not be read.",
    });
  }
  if (!input.fact.active) {
    return createChannel({
      failureCode:
        firstReasonCode(input.fact.reasonCodes) ?? "agent_profile.inactive",
      generatedAt: input.generatedAt,
      id: "profile_identity",
      label: "Profile identity",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "blocked",
      summary: "Profile identity evidence says this profile is not active.",
    });
  }
  return createChannel({
    generatedAt: input.generatedAt,
    id: "profile_identity",
    label: "Profile identity",
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: input.fact.source === "not_checked" ? "not_checked" : "healthy",
    summary:
      input.fact.source === "not_checked"
        ? "Profile identity was not checked in this diagnostic read."
        : "Profile identity evidence is available.",
  });
}

function buildBindingProjectionChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["binding"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.routable) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "binding_projection",
      label: "Binding projection",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "healthy",
      summary: "Binding projection is routable.",
    });
  }
  return createChannel({
    failureCode:
      firstReasonCode(input.fact.reasonCodes) ??
      "agent_profile_binding.missing",
    generatedAt: input.generatedAt,
    id: "binding_projection",
    label: "Binding projection",
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: input.fact.source === "not_checked" ? "not_checked" : "blocked",
    summary:
      input.fact.source === "not_checked"
        ? "Binding projection was not checked in this diagnostic read."
        : "Binding projection is not routable.",
  });
}

function buildLocalServiceChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["localService"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.reachable) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "local_service",
      label: "Local OpenMeld Service",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "healthy",
      summary: input.fact.refreshable
        ? "Local OpenMeld Service evidence is reachable and refreshable."
        : "Local OpenMeld Service evidence is reachable.",
    });
  }
  return createChannel({
    failureCode: firstReasonCode(input.fact.reasonCodes),
    generatedAt: input.generatedAt,
    id: "local_service",
    label: "Local OpenMeld Service",
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: input.fact.source === "not_checked" ? "not_checked" : "degraded",
    summary:
      input.fact.source === "not_checked"
        ? "Local OpenMeld Service evidence was not checked in this diagnostic read."
        : "Local OpenMeld Service evidence is not reachable.",
  });
}

function buildServiceCompatibilityChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["service"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.executionCompatible) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "service_compatibility",
      label: "Service compatibility",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: input.fact.source === "not_checked" ? "not_checked" : "healthy",
      summary:
        input.fact.source === "not_checked"
          ? "Service compatibility was not checked in this diagnostic read."
          : "OpenMeld Service execution contract is compatible.",
    });
  }
  return createChannel({
    failureCode:
      firstReasonCode(input.fact.reasonCodes) ??
      "service.execution_incompatible",
    generatedAt: input.generatedAt,
    id: "service_compatibility",
    label: "Service compatibility",
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: "blocked",
    summary: "OpenMeld Service execution contract is not compatible.",
  });
}

function buildRuntimeRegistrationChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["runtime"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.ready) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "runtime_registration",
      label: "Runtime registration",
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "healthy",
      summary: "Runtime registration evidence is ready.",
    });
  }
  return createChannel({
    failureCode: firstReasonCode(input.fact.reasonCodes),
    generatedAt: input.generatedAt,
    id: "runtime_registration",
    label: "Runtime registration",
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: input.fact.source === "missing" ? "degraded" : "blocked",
    summary: "Runtime registration evidence is not ready.",
  });
}

function buildRouteCatalogSyncChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["route"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.online) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "route_catalog_sync",
      label: "Route catalog sync",
      lastSuccessAt: input.fact.observedAt,
      reasonCodes: input.fact.reasonCodes,
      role: "wake_path_evidence",
      source: input.fact.source,
      status: "healthy",
      summary: "Route catalog has an online route for this profile.",
    });
  }
  return createChannel({
    failureCode: firstReasonCode(input.fact.reasonCodes),
    generatedAt: input.generatedAt,
    id: "route_catalog_sync",
    label: "Route catalog sync",
    lastSuccessAt: input.fact.observedAt,
    reasonCodes: input.fact.reasonCodes,
    role: "wake_path_evidence",
    source: input.fact.source,
    status: "degraded",
    summary: "Route catalog does not currently have an online route.",
  });
}

function buildExecutionAuthorityDiagnosticChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["claim"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (!input.fact.executionBlocked) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "execution_authority_diagnostic",
      label: "Execution authority diagnostic",
      reasonCodes: input.fact.reasonCodes,
      role: "owner_diagnostic",
      source: input.fact.source,
      status: input.fact.source === "not_checked" ? "not_checked" : "healthy",
      summary:
        input.fact.source === "not_checked"
          ? "Execution authority was not checked in this diagnostic read."
          : "Execution authority diagnostics do not currently block execution.",
    });
  }
  return createChannel({
    failureCode: firstReasonCode(input.fact.reasonCodes),
    generatedAt: input.generatedAt,
    id: "execution_authority_diagnostic",
    label: "Execution authority diagnostic",
    reasonCodes: input.fact.reasonCodes,
    role: "owner_diagnostic",
    source: input.fact.source,
    status: "blocked",
    summary: "Execution authority diagnostics currently block execution.",
  });
}

function buildProviderAccountDiagnosticChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["providerAccount"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.blocked) {
    return createChannel({
      failureCode: firstReasonCode(input.fact.reasonCodes),
      generatedAt: input.generatedAt,
      id: "provider_account_diagnostic",
      label: "Provider account diagnostic",
      lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
      reasonCodes: input.fact.reasonCodes,
      role: "owner_diagnostic",
      source: input.fact.source,
      status: "blocked",
      summary: "Provider account diagnostics currently block Wake.",
    });
  }
  return createChannel({
    generatedAt: input.generatedAt,
    id: "provider_account_diagnostic",
    label: "Provider account diagnostic",
    lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
    reasonCodes: input.fact.reasonCodes,
    role: "owner_diagnostic",
    source: input.fact.source,
    status: input.fact.source === "not_checked" ? "not_checked" : "healthy",
    summary:
      input.fact.source === "not_checked"
        ? "Provider account diagnostics were not checked in this diagnostic read."
        : "Provider account diagnostics do not currently block Wake.",
  });
}

function buildProviderConversationDiagnosticChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["providerConversation"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.status === "not_required") {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "provider_conversation_diagnostic",
      label: "Provider conversation diagnostic",
      reasonCodes: input.fact.reasonCodes,
      role: "owner_diagnostic",
      source: input.fact.source,
      status: "healthy",
      summary: "Provider conversation proof is not required.",
    });
  }
  if (input.fact.ready) {
    return createChannel({
      generatedAt: input.generatedAt,
      id: "provider_conversation_diagnostic",
      label: "Provider conversation diagnostic",
      lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
      reasonCodes: input.fact.reasonCodes,
      role: "owner_diagnostic",
      source: input.fact.source,
      status: "healthy",
      summary: "Provider conversation proof is ready.",
    });
  }
  return createChannel({
    failureCode:
      firstReasonCode(input.fact.reasonCodes) ??
      input.fact.errorCode ??
      "provider_conversation.not_ready",
    generatedAt: input.generatedAt,
    id: "provider_conversation_diagnostic",
    label: "Provider conversation diagnostic",
    lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
    reasonCodes: input.fact.reasonCodes,
    role: "owner_diagnostic",
    source: input.fact.source,
    status: "degraded",
    summary: input.fact.required
      ? "Provider conversation proof is required but not ready."
      : "Provider conversation proof is diagnostic and not ready.",
  });
}

function buildReadinessImpactDiagnosticChannel(input: {
  fact: AgentExecutionStatusProjection["facts"]["readinessImpact"];
  generatedAt: string;
}): EvidenceSyncHealthChannel {
  if (input.fact.blocked) {
    return createChannel({
      failureCode: firstReasonCode(input.fact.reasonCodes),
      generatedAt: input.generatedAt,
      id: "readiness_impact_diagnostic",
      label: "Readiness impact diagnostic",
      lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
      nextRetryAt: fromEpochMs(input.fact.expiresAtMs),
      reasonCodes: input.fact.reasonCodes,
      role: "owner_diagnostic",
      source: input.fact.source,
      status: "blocked",
      summary: "Recent Wake failure evidence currently blocks readiness.",
    });
  }
  return createChannel({
    generatedAt: input.generatedAt,
    id: "readiness_impact_diagnostic",
    label: "Readiness impact diagnostic",
    lastSuccessAt: fromEpochMs(input.fact.observedAtMs),
    nextRetryAt: fromEpochMs(input.fact.expiresAtMs),
    reasonCodes: input.fact.reasonCodes,
    role: "owner_diagnostic",
    source: input.fact.source,
    status: input.fact.source === "not_checked" ? "not_checked" : "healthy",
    summary:
      input.fact.source === "not_checked"
        ? "Readiness impact diagnostics were not checked in this diagnostic read."
        : "No recent Wake failure impact currently blocks readiness.",
  });
}

function createChannel(input: {
  failureCode?: string | null;
  generatedAt: string;
  id: EvidenceSyncHealthChannelId;
  label: string;
  lastSuccessAt?: string | null;
  nextRetryAt?: string | null;
  reasonCodes: readonly string[];
  role: EvidenceSyncHealthChannelRole;
  source: string;
  status: EvidenceSyncHealthStatus;
  summary: string;
}): EvidenceSyncHealthChannel {
  return {
    failureCode: input.failureCode ?? null,
    id: input.id,
    label: input.label,
    lastAttemptAt: input.generatedAt,
    lastSuccessAt:
      input.lastSuccessAt ??
      (input.status === "healthy" ? input.generatedAt : null),
    nextRetryAt: input.nextRetryAt ?? null,
    reasonCodes: input.reasonCodes,
    role: input.role,
    source: input.source,
    status: input.status,
    summary: input.summary,
  };
}

function resolveEvidenceSyncHealthStatus(
  channels: readonly EvidenceSyncHealthChannel[]
): EvidenceSyncHealthStatus {
  if (channels.some((channel) => channel.status === "blocked")) {
    return "blocked";
  }
  if (channels.some((channel) => channel.status === "degraded")) {
    return "degraded";
  }
  if (channels.every((channel) => channel.status === "not_checked")) {
    return "not_checked";
  }
  return "healthy";
}

function summarizeEvidenceSyncHealthStatus(
  status: EvidenceSyncHealthStatus
): string {
  switch (status) {
    case "blocked":
      return "Owner diagnostics found evidence that needs repair.";
    case "degraded":
      return "Owner diagnostics found missing or stale evidence.";
    case "healthy":
      return "Owner diagnostics have current evidence for the Wake path.";
    case "not_checked":
      return "Owner diagnostics were not checked.";
    default:
      return "Owner diagnostics are unavailable.";
  }
}

function firstReasonCode(reasonCodes: readonly string[]): string | null {
  return reasonCodes[0] ?? null;
}

function fromEpochMs(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}
