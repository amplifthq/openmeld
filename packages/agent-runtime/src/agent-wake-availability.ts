import { resolvePublicAgentAvailabilityCopy } from "@openmeld/schemas";
import { parseAgentControllerRef } from "./agent-controller-ref";
import type { AgentExecutionStatusProjection } from "./agent-execution-status";

export type WakeRouteLane = "prod" | "dev-local" | "canary";

export type AgentWakeAvailabilityCategory =
  | "available"
  | "checking"
  | "offline"
  | "unavailable";

export type AgentWakeAvailabilityPhase =
  | "available"
  | "checking_route"
  | "checking_runtime"
  | "checking_service"
  | "checking_status"
  | "connect_local_agent"
  | "offline"
  | "provider_blocked"
  | "provider_sign_in_needed"
  | "service_not_connected"
  | "service_update_required"
  | "unavailable";

export type AgentWakeAvailabilityStatus =
  | "available_for_wake"
  | "checking_connection"
  | "offline_for_wake"
  | "unavailable_for_wake";

export type AgentWakeRouteRegistrationStatus =
  | "registered"
  | "pending"
  | "skipped"
  | "rejected"
  | "expired"
  | "unavailable";

export type AgentWakeRouteRegistration = {
  status: AgentWakeRouteRegistrationStatus;
  reasonCode: string | null;
  reportedAtMs: number | null;
  daemonSessionId: string | null;
  deviceId: string | null;
  lane: WakeRouteLane | null;
  serviceVersion: string | null;
};

export type AgentWakeAvailabilityReasonRole =
  | "blocking_offline"
  | "blocking_unavailable"
  | "diagnostic"
  | "nonblocking_warning"
  | "transient_checking";

export type AgentWakeAvailability = {
  action: AgentExecutionStatusProjection["primaryAction"];
  badgeLabel: string;
  category: AgentWakeAvailabilityCategory;
  isRefreshing: boolean;
  label: string;
  phase: AgentWakeAvailabilityPhase;
  reasonCode: string | null;
  status: AgentWakeAvailabilityStatus;
  summary: string;
  tooltip: string;
};

export type WakeRouteStatus =
  | {
      connectionGeneration: number;
      daemonSessionId: string;
      deviceId: string;
      lane: WakeRouteLane;
      lastHeartbeatMs: number;
      leaseEpoch: number;
      status: "ready";
    }
  | {
      status: "checking" | "offline" | "unavailable";
    };

const serviceNotConnectedReasonCodes = [
  "local_service.not_connected_for_account",
  "local_service.unavailable",
  "service.not_running",
  "service.current_runtime_session_missing",
  "daemon.session.not_found",
] as const;

const workspaceUnavailableReasonCodes = new Set([
  "agent_profile.organization_context_missing",
  "agent_profile.organization_lookup_failed",
  "agent_profile.space_organization_unavailable",
  "organization_binding_authorization.lookup_failed",
  "organization_binding_authorization.preference_unavailable",
  "organization_binding_authorization.space_org_unavailable",
]);

export function isAgentProfileWorkspaceBlockerReasonCode(
  reasonCode: string
): boolean {
  return (
    reasonCode === "agent_profile.organization_context_missing" ||
    reasonCode === "agent_profile.organization_lookup_failed" ||
    reasonCode === "agent_profile.organization_mismatch" ||
    reasonCode === "agent_profile.space_organization_unavailable" ||
    reasonCode.startsWith("organization_binding_authorization.")
  );
}

const routeOfflineReasonCodes = [
  "agent_execution.route_offline",
  "route.offline",
] as const;

const unavailableWakeAvailabilityFallbackCopy = {
  badgeLabel: "Unavailable",
  summary: "This agent cannot reply from this computer right now.",
  tooltip: "Unavailable for Wake",
} as const;

const availableWakeAvailabilityFallbackCopy = {
  badgeLabel: "Available",
  summary: "Can reply from this computer in Spaces.",
  tooltip: "Available for Wake",
} as const;

const signInNeededWakeAvailabilityFallbackCopy = {
  badgeLabel: "Sign-in needed",
  summary: "Sign in to this local agent from a terminal on this computer.",
  tooltip: "This local agent is not signed in on this computer.",
} as const;

const checkingWakeAvailabilityFallbackCopy = {
  badgeLabel: "Checking",
  summary: "Checking this agent's Wake availability.",
  tooltip: "Checking Wake availability",
} as const;

const reconnectingOpenMeldServiceAvailabilityFallbackCopy = {
  badgeLabel: "Reconnecting",
  summary: "OpenMeld Service is reconnecting on this computer.",
  tooltip: "Reconnecting OpenMeld Service",
} as const;

const offlineWakeAvailabilityFallbackCopy = {
  badgeLabel: "Offline",
  summary:
    "This agent's connection is offline. Check OpenMeld Service on its computer.",
  tooltip:
    "Agent connection is offline. Check OpenMeld Service on its computer.",
} as const;

const routeCheckingWakeAvailabilityFallbackCopy = {
  badgeLabel: "Checking",
  summary: "Checking this agent's Wake route.",
  tooltip: "Checking Wake route",
} as const;

const routeUnavailableWakeAvailabilityFallbackCopy = {
  badgeLabel: "Unavailable",
  summary:
    "This agent's Wake route is unavailable right now. Check OpenMeld Service on its computer.",
  tooltip: "Wake route unavailable. Check OpenMeld Service on its computer.",
} as const;

const connectLocalAgentAvailabilityFallbackCopy = {
  badgeLabel: "Connect",
  summary: "Connect a local agent before this profile can reply.",
  tooltip: "Connect local agent",
} as const;

const routeRejectedWakeAvailabilityFallbackCopy = {
  badgeLabel: "Unavailable",
  summary: "Resolve this agent's Wake route before it can reply.",
  tooltip: "Wake route unavailable",
} as const;

export function resolveAgentWakeAvailability(input: {
  agentControllerRef?: string | null;
  agentWakeRouteRegistration?: AgentWakeRouteRegistration | null;
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): AgentWakeAvailability {
  // Authoritative identity verdict: the auth owner says this profile row no
  // longer exists. That is terminal — no local reconnect/update can repair a
  // deleted profile, so it must win over every repair-flavored branch below.
  // Transient identity lookup failures stay on the generic unknown paths.
  if (hasReasonCode(input.readiness, "agent_profile.not_found")) {
    return createAvailability(input.readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Agent profile deleted",
      phase: "unavailable",
      reasonCode: "agent_profile.not_found",
      status: "unavailable_for_wake",
    });
  }

  if (requiresServiceUpdate(input.readiness)) {
    return createAvailability(input.readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Update OpenMeld Service",
      phase: "service_update_required",
      reasonCode: pickReasonCode(input.readiness, [
        "service.update_required",
        "background_helper.update_required",
      ]),
      status: "unavailable_for_wake",
    });
  }

  if (isAgentWakeAvailable(input)) {
    return createAvailableWakeAvailability();
  }

  if (
    input.wakeRouteStatus.status === "unavailable" &&
    input.readiness.primaryAction === "connect_service"
  ) {
    return createWakeRouteUnavailableAvailability(input.readiness);
  }

  if (hasKnownPublicUnavailableReadiness(input.readiness)) {
    return createUnavailableWakeAvailability(
      input.readiness,
      input.agentControllerRef
    );
  }

  const routeRegistrationAvailability =
    createWakeRouteRegistrationAvailability(input);
  if (routeRegistrationAvailability) {
    return routeRegistrationAvailability;
  }

  if (isCheckingAgentWakeAvailability(input)) {
    return createCheckingWakeAvailability(input);
  }

  if (input.readiness.primaryAction === "connect_service") {
    return createUnavailableWakeAvailability(
      input.readiness,
      input.agentControllerRef
    );
  }

  if (hasKnownPublicOfflineReadiness(input)) {
    if (isRefreshableRouteGap(input)) {
      return createCheckingAgentConnectionAvailability({
        reasonCode: pickRouteGapReasonCode(input.readiness),
        readiness: input.readiness,
      });
    }
    return createOfflineWakeAvailability({ readiness: input.readiness });
  }

  return createUnavailableWakeAvailability(
    input.readiness,
    input.agentControllerRef
  );
}

export function resolveHostedAgentWakeAvailability(input: {
  readiness: AgentExecutionStatusProjection;
}): AgentWakeAvailability {
  const { readiness } = input;
  if (
    collectReasonCodes(readiness).some(isAgentProfileWorkspaceBlockerReasonCode)
  ) {
    return createUnavailableWakeAvailability(readiness);
  }
  const reasonCode = pickHostedAgentReasonCode(readiness);

  if (hasReasonCode(readiness, "agent_profile.not_found")) {
    return createStandaloneAvailability({
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Agent profile deleted",
      phase: "unavailable",
      reasonCode: "agent_profile.not_found",
      status: "unavailable_for_wake",
    });
  }

  if (hasHostedCenterAgentDisconnectedReason(readiness)) {
    return createStandaloneAvailability({
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Disconnected",
      phase: "unavailable",
      reasonCode: pickReasonCode(readiness, [
        "center_agent.designation_required",
        "center_agent.designation_lookup_failed",
        "center_agent.designation_store_unavailable",
      ]),
      status: "unavailable_for_wake",
    });
  }

  if (
    readiness.displayState === "ready" ||
    readiness.facts.runtime.ready ||
    hasReasonCode(readiness, "remote_agent.available")
  ) {
    return createStandaloneAvailability({
      ...availableWakeAvailabilityFallbackCopy,
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "remote_agent.available",
      status: "available_for_wake",
    });
  }

  if (reasonCode === "remote_agent.budget_resting") {
    return createStandaloneAvailability({
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Remote Agent resting",
      phase: "unavailable",
      reasonCode,
      status: "unavailable_for_wake",
    });
  }

  return createStandaloneAvailability(
    {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Remote Agent unavailable",
      phase: "unavailable",
      reasonCode,
      status: "unavailable_for_wake",
    },
    { copyReasonCode: reasonCode ?? "remote_agent.unavailable" }
  );
}

// A surface that has not received an availability verdict yet shows the
// transient checking state, never a hard verdict (developing/clients/web.md,
// Wake Availability And Recovery Presentation). Surfaces must use this
// instead of re-deriving their own category-or-default mapping.
export function resolveAgentWakeAvailabilityDisplayCategory(
  availability: Pick<AgentWakeAvailability, "category"> | null | undefined
): AgentWakeAvailabilityCategory {
  return availability?.category ?? "checking";
}

function createAvailableWakeAvailability(): AgentWakeAvailability {
  return createStandaloneAvailability({
    ...availableWakeAvailabilityFallbackCopy,
    category: "available",
    isRefreshing: false,
    label: "Available for Wake",
    phase: "available",
    reasonCode: "agent_execution.ready",
    status: "available_for_wake",
  });
}

function createControllerSignInNeededAvailability(
  agentControllerRef: string | null | undefined
): AgentWakeAvailability {
  const agentControllerId = parseAgentControllerRef(agentControllerRef)?.id;
  const sharedCopy = resolvePublicAgentAvailabilityCopy(
    "controller.auth.unauthenticated",
    { agentControllerId }
  );

  return {
    action: "none",
    badgeLabel:
      sharedCopy?.availabilityBadgeLabel ??
      signInNeededWakeAvailabilityFallbackCopy.badgeLabel,
    category: "unavailable",
    isRefreshing: false,
    label: "Sign-in needed",
    phase: "provider_sign_in_needed",
    reasonCode: "controller.auth.unauthenticated",
    status: "unavailable_for_wake",
    summary:
      sharedCopy?.availabilitySummary ??
      signInNeededWakeAvailabilityFallbackCopy.summary,
    tooltip:
      sharedCopy?.availabilityTooltip ??
      signInNeededWakeAvailabilityFallbackCopy.tooltip,
  };
}

function hasHostedCenterAgentDisconnectedReason(
  readiness: AgentExecutionStatusProjection
): boolean {
  return [
    "center_agent.designation_required",
    "center_agent.designation_lookup_failed",
    "center_agent.designation_store_unavailable",
  ].some((reasonCode) => hasReasonCode(readiness, reasonCode));
}

function createCheckingAgentConnectionAvailability(input: {
  readiness: AgentExecutionStatusProjection;
  reasonCode: string;
}): AgentWakeAvailability {
  return createAvailability(input.readiness, {
    ...routeCheckingWakeAvailabilityFallbackCopy,
    category: "checking",
    isRefreshing: true,
    label: "Checking connection",
    phase: "checking_route",
    reasonCode: input.reasonCode,
    status: "checking_connection",
  });
}

function createOfflineWakeAvailability(input: {
  readiness: AgentExecutionStatusProjection;
  routeReasonCode?: string;
}): AgentWakeAvailability {
  const serviceReasonCode = pickKnownReasonCode(
    input.readiness,
    serviceNotConnectedReasonCodes
  );
  if (serviceReasonCode) {
    return createServiceNotConnectedAvailability({
      readiness: input.readiness,
      reasonCode: serviceReasonCode,
    });
  }

  return createOfflineAgentConnectionAvailability({
    readiness: input.readiness,
    reasonCode:
      pickKnownReasonCode(input.readiness, routeOfflineReasonCodes) ??
      input.routeReasonCode ??
      "agent_execution.route_offline",
  });
}

function createServiceNotConnectedAvailability(input: {
  readiness: AgentExecutionStatusProjection;
  reasonCode: string;
}): AgentWakeAvailability {
  return createAvailability(input.readiness, {
    ...offlineWakeAvailabilityFallbackCopy,
    category: "offline",
    isRefreshing: false,
    label: "Offline for Wake",
    phase: "service_not_connected",
    reasonCode: input.reasonCode,
    status: "offline_for_wake",
  });
}

function createOfflineAgentConnectionAvailability(input: {
  readiness: AgentExecutionStatusProjection;
  reasonCode: string;
}): AgentWakeAvailability {
  return createAvailability(input.readiness, {
    ...offlineWakeAvailabilityFallbackCopy,
    category: "offline",
    isRefreshing: false,
    label: "Offline for Wake",
    phase: "offline",
    reasonCode: input.reasonCode,
    status: "offline_for_wake",
  });
}

function createWakeRouteUnavailableAvailability(
  readiness: AgentExecutionStatusProjection
): AgentWakeAvailability {
  return createAvailability(readiness, {
    ...routeUnavailableWakeAvailabilityFallbackCopy,
    category: "unavailable",
    isRefreshing: false,
    label: "Unavailable for Wake",
    phase: "unavailable",
    reasonCode: pickReasonCode(readiness, [
      "agent_execution.route_unavailable",
      "route.unavailable",
      "lookup_failed",
    ]),
    status: "unavailable_for_wake",
  });
}

function createCheckingWakeAvailability(input: {
  agentWakeRouteRegistration?: AgentWakeRouteRegistration | null;
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): AgentWakeAvailability {
  if (hasReasonCode(input.readiness, "usage_checking")) {
    return createAvailability(input.readiness, {
      badgeLabel: "Checking",
      category: "checking",
      isRefreshing: true,
      label: "Checking Usage",
      phase: "checking_status",
      reasonCode: "usage_checking",
      status: "checking_connection",
      summary: "Checking this agent's current Usage.",
      tooltip: "Checking Usage",
    });
  }

  if (hasReasonCode(input.readiness, "local_service.reconnecting")) {
    return createReconnectingOpenMeldServiceAvailability(input.readiness);
  }

  if (isRefreshableRouteGap(input) || isReadyRouteMissingDispatchClaim(input)) {
    return createAvailability(input.readiness, {
      ...routeCheckingWakeAvailabilityFallbackCopy,
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_route",
      reasonCode: pickRouteGapReasonCode(input.readiness),
      status: "checking_connection",
    });
  }

  if (input.readiness.facts.runtime.source === "missing") {
    return createAvailability(input.readiness, {
      ...checkingWakeAvailabilityFallbackCopy,
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_runtime",
      reasonCode: pickReasonCode(input.readiness, [
        "runtime.agent_controller_report_stale",
        "runtime.projection_missing",
      ]),
      status: "checking_connection",
    });
  }

  if (
    input.readiness.facts.localService.source === "not_checked" ||
    input.readiness.facts.service.source === "not_checked"
  ) {
    return createAvailability(input.readiness, {
      ...checkingWakeAvailabilityFallbackCopy,
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_service",
      reasonCode: pickReasonCode(input.readiness, [
        "local_service.not_checked",
        "service.not_checked",
      ]),
      status: "checking_connection",
    });
  }

  return createAvailability(input.readiness, {
    ...checkingWakeAvailabilityFallbackCopy,
    category: "checking",
    isRefreshing: true,
    label: "Checking connection",
    phase: "checking_status",
    reasonCode: pickReasonCode(input.readiness, [
      "controller.interface.check_failed",
      "agent_execution.check_status",
    ]),
    status: "checking_connection",
  });
}

function createReconnectingOpenMeldServiceAvailability(
  readiness: AgentExecutionStatusProjection
): AgentWakeAvailability {
  return createAvailability(readiness, {
    ...reconnectingOpenMeldServiceAvailabilityFallbackCopy,
    category: "checking",
    isRefreshing: true,
    label: "Reconnecting OpenMeld Service",
    phase: "checking_route",
    reasonCode: "local_service.reconnecting",
    status: "checking_connection",
  });
}

function createWakeRouteRegistrationAvailability(input: {
  agentWakeRouteRegistration?: AgentWakeRouteRegistration | null;
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): AgentWakeAvailability | null {
  const registration = input.agentWakeRouteRegistration ?? null;
  if (!registration || registration.status === "registered") {
    return null;
  }

  if (registration.status === "pending") {
    if (
      !(
        input.readiness.facts.localService.reachable &&
        input.readiness.facts.localService.refreshable
      )
    ) {
      return null;
    }
    if (hasReasonCode(input.readiness, "local_service.reconnecting")) {
      return createReconnectingOpenMeldServiceAvailability(input.readiness);
    }
    return createAvailability(input.readiness, {
      ...routeCheckingWakeAvailabilityFallbackCopy,
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_route",
      reasonCode: registration.reasonCode ?? "wake_route.registration_pending",
      status: "checking_connection",
    });
  }

  if (registration.status === "expired") {
    return createOfflineWakeAvailability({
      readiness: input.readiness,
      routeReasonCode:
        registration.reasonCode ?? "wake_route.registration_expired",
    });
  }

  if (registration.status === "skipped") {
    return createAvailability(input.readiness, {
      ...connectLocalAgentAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Connect local agent",
      phase: "connect_local_agent",
      reasonCode: registration.reasonCode ?? "wake_route.registration_skipped",
      status: "unavailable_for_wake",
    });
  }

  if (registration.status === "rejected") {
    return createAvailability(input.readiness, {
      ...routeRejectedWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Unavailable for Wake",
      phase: "unavailable",
      reasonCode: registration.reasonCode ?? "wake_route.registration_rejected",
      status: "unavailable_for_wake",
    });
  }

  return createAvailability(input.readiness, {
    ...routeUnavailableWakeAvailabilityFallbackCopy,
    category: "unavailable",
    isRefreshing: false,
    label: "Unavailable for Wake",
    phase: "unavailable",
    reasonCode:
      registration.reasonCode ?? "wake_route.registration_unavailable",
    status: "unavailable_for_wake",
  });
}

function createUnavailableWakeAvailability(
  readiness: AgentExecutionStatusProjection,
  agentControllerRef?: string | null
): AgentWakeAvailability {
  const workspaceUnavailableReasonCode = collectReasonCodes(readiness).find(
    (reasonCode) => workspaceUnavailableReasonCodes.has(reasonCode)
  );
  if (workspaceUnavailableReasonCode) {
    return createAvailability(readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Workspace unavailable",
      phase: "unavailable",
      reasonCode: workspaceUnavailableReasonCode,
      status: "unavailable_for_wake",
    });
  }
  if (hasReasonCode(readiness, "agent_profile.organization_mismatch")) {
    return createAvailability(readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Wrong workspace",
      phase: "unavailable",
      reasonCode: "agent_profile.organization_mismatch",
      status: "unavailable_for_wake",
    });
  }
  const retiredAuthorizationReasonCode = collectReasonCodes(readiness).find(
    (reasonCode) => reasonCode.startsWith("organization_binding_authorization.")
  );
  if (retiredAuthorizationReasonCode) {
    return createAvailability(readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Wrong workspace",
      phase: "unavailable",
      reasonCode: retiredAuthorizationReasonCode,
      status: "unavailable_for_wake",
    });
  }

  if (readiness.primaryAction === "connect_service") {
    return createServiceNotConnectedAvailability({
      readiness,
      reasonCode:
        pickKnownReasonCode(readiness, serviceNotConnectedReasonCodes) ??
        pickReasonCode(readiness, serviceNotConnectedReasonCodes) ??
        "service.not_running",
    });
  }

  if (
    readiness.primaryAction === "reconnect_binding" ||
    readiness.primaryAction === "run_prepare"
  ) {
    if (
      readiness.primaryAction === "run_prepare" &&
      hasReasonCode(readiness, "controller.auth.unauthenticated")
    ) {
      return createControllerSignInNeededAvailability(agentControllerRef);
    }

    return createAvailability(
      readiness,
      {
        ...connectLocalAgentAvailabilityFallbackCopy,
        category: "unavailable",
        isRefreshing: false,
        label: "Connect local agent",
        phase: "connect_local_agent",
        reasonCode: pickReasonCode(readiness, [
          "agent_profile_binding.missing",
          "profile.unbound",
          "claim_eligibility.binding_missing",
        ]),
        status: "unavailable_for_wake",
      },
      {
        copyReasonCode: pickKnownReasonCode(readiness, [
          "controller.registry.disabled",
          "controller.bootstrap.failed",
          "controller.gateway.unhealthy",
          "agent_profile_binding.agent_controller_report_missing",
          "agent_profile_binding.agent_controller_report_stale",
        ]),
      }
    );
  }

  if (readiness.primaryAction === "fix_provider_account") {
    const usageExhausted = hasReasonCode(readiness, "usage_exhausted");
    return createAvailability(readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: usageExhausted ? "Usage Limit reached" : "Provider access needed",
      phase: "provider_blocked",
      reasonCode: pickReasonCode(readiness, [
        "usage_exhausted",
        "provider_account.capacity_exhausted",
        "provider_account.subscription_access_unavailable",
        "provider_account.organization_access_disabled",
        "provider_account.access_required",
      ]),
      status: "unavailable_for_wake",
    });
  }

  if (
    hasReasonCode(
      readiness,
      "agent_profile_binding.controller_conversation_conflict"
    )
  ) {
    return createAvailability(readiness, {
      ...unavailableWakeAvailabilityFallbackCopy,
      category: "unavailable",
      isRefreshing: false,
      label: "Unavailable for Wake",
      phase: "unavailable",
      reasonCode: "agent_profile_binding.controller_conversation_conflict",
      status: "unavailable_for_wake",
    });
  }

  return createAvailability(readiness, {
    ...unavailableWakeAvailabilityFallbackCopy,
    category: "unavailable",
    isRefreshing: false,
    label: "Unavailable for Wake",
    phase: "unavailable",
    reasonCode: pickReasonCode(readiness, [
      "profile.inactive",
      "profile.unbound",
      "runtime.agent_controller_report_stale",
      "agent_profile_binding.controller_conversation_conflict",
      "agent_profile_binding.missing",
      "route.unavailable",
      "agent_execution.route_unavailable",
    ]),
    status: "unavailable_for_wake",
  });
}

function hasReasonCode(
  readiness: AgentExecutionStatusProjection,
  reasonCode: string
): boolean {
  return collectReasonCodes(readiness).includes(reasonCode);
}

export function classifyAgentWakeAvailabilityReason(
  reasonCode: string
): AgentWakeAvailabilityReasonRole {
  if (isPublicUnavailableReasonCode(reasonCode)) {
    return "blocking_unavailable";
  }
  if (isPublicOfflineReasonCode(reasonCode)) {
    return "blocking_offline";
  }
  if (isTransientCheckingReasonCode(reasonCode)) {
    return "transient_checking";
  }
  return "diagnostic";
}

function createAvailability(
  readiness: AgentExecutionStatusProjection,
  values: Omit<AgentWakeAvailability, "action">,
  options: { copyReasonCode?: string | null } = {}
): AgentWakeAvailability {
  return createAvailabilityWithAction(readiness.primaryAction, values, options);
}

function createStandaloneAvailability(
  values: Omit<AgentWakeAvailability, "action">,
  options: { copyReasonCode?: string | null } = {}
): AgentWakeAvailability {
  return createAvailabilityWithAction("none", values, options);
}

function createAvailabilityWithAction(
  action: AgentWakeAvailability["action"],
  values: Omit<AgentWakeAvailability, "action">,
  options: { copyReasonCode?: string | null }
): AgentWakeAvailability {
  const sharedCopy = resolvePublicAgentAvailabilityCopy(
    options.copyReasonCode ?? values.reasonCode
  );
  return {
    ...values,
    action,
    badgeLabel: sharedCopy?.availabilityBadgeLabel ?? values.badgeLabel,
    summary: sharedCopy?.availabilitySummary ?? values.summary,
    tooltip: sharedCopy?.availabilityTooltip ?? values.tooltip,
  };
}

function isCheckingAgentWakeAvailability(input: {
  agentWakeRouteRegistration?: AgentWakeRouteRegistration | null;
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  if (requiresServiceUpdate(input.readiness)) {
    return false;
  }
  if (input.wakeRouteStatus.status === "unavailable") {
    return false;
  }
  if (
    input.agentWakeRouteRegistration &&
    !["pending", "registered"].includes(input.agentWakeRouteRegistration.status)
  ) {
    return false;
  }

  return (
    isRefreshableAgentExecutionCheck(input) ||
    isRefreshableRouteGap(input) ||
    isReadyRouteMissingDispatchClaim(input)
  );
}

function isAgentWakeAvailable(input: {
  agentWakeRouteRegistration?: AgentWakeRouteRegistration | null;
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  return (
    isWakeRouteReady(input.wakeRouteStatus) &&
    (input.agentWakeRouteRegistration?.status ?? "registered") ===
      "registered" &&
    !hasTransientWakeAvailabilityBlocker(input.readiness) &&
    !hasHardUnavailableReadinessForReadyRoute(input.readiness)
  );
}

function hasTransientWakeAvailabilityBlocker(
  readiness: AgentExecutionStatusProjection
): boolean {
  return collectReasonCodes(readiness).some(
    (reasonCode) =>
      reasonCode === "controller.interface.check_failed" ||
      isTransientRouteReason(reasonCode)
  );
}

function hasHardUnavailableReadinessForReadyRoute(
  readiness: AgentExecutionStatusProjection
): boolean {
  const reasonCodes = new Set(collectReasonCodes(readiness));
  for (const reasonCode of reasonCodes) {
    if (isUnauthenticatedControllerCompanionReason(reasonCode, reasonCodes)) {
      continue;
    }
    if (isReadyRouteBlockingUnavailableReason(reasonCode)) {
      return true;
    }
  }
  return false;
}

function isReadyRouteBlockingUnavailableReason(reasonCode: string): boolean {
  if (
    reasonCode === "agent_execution.route_unavailable" ||
    reasonCode === "route.unavailable"
  ) {
    return false;
  }
  return isPublicUnavailableReadinessReason(reasonCode);
}

function isRefreshableAgentExecutionCheck(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  return (
    input.readiness.primaryAction === "check_status" &&
    input.readiness.facts.localService.reachable &&
    input.readiness.facts.localService.refreshable
  );
}

function isRefreshableRouteGap(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  return (
    input.wakeRouteStatus.status !== "unavailable" &&
    input.readiness.facts.localService.reachable &&
    input.readiness.facts.localService.refreshable &&
    input.readiness.reasonCodes.some(isTransientRouteReason)
  );
}

function requiresServiceUpdate(
  readiness: AgentExecutionStatusProjection
): boolean {
  return (
    readiness.primaryAction === "update_service" ||
    readiness.reasonCodes.includes("service.update_required")
  );
}

function hasKnownPublicUnavailableReadiness(
  readiness: AgentExecutionStatusProjection
): boolean {
  if (requiresServiceUpdate(readiness)) {
    return true;
  }

  const reasonCodes = new Set([
    ...readiness.reasonCodes,
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.providerAccount.reasonCodes,
    ...readiness.facts.providerConversation.reasonCodes,
    ...readiness.facts.readinessImpact.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ]);

  for (const reasonCode of reasonCodes) {
    if (isUnauthenticatedControllerCompanionReason(reasonCode, reasonCodes)) {
      continue;
    }
    if (isPublicUnavailableReadinessReason(reasonCode)) {
      return true;
    }
  }

  return false;
}

function isUnauthenticatedControllerCompanionReason(
  reasonCode: string,
  reasonCodes: ReadonlySet<string>
): boolean {
  return (
    reasonCodes.has("controller.auth.unauthenticated") &&
    reasonCode === "provider_account.access_required"
  );
}

function pickReasonCode(
  readiness: AgentExecutionStatusProjection,
  preferredReasonCodes: readonly string[]
): string | null {
  const reasonCodes = collectReasonCodes(readiness);

  for (const preferredReasonCode of preferredReasonCodes) {
    if (reasonCodes.includes(preferredReasonCode)) {
      return preferredReasonCode;
    }
  }

  return reasonCodes[0] ?? null;
}

function pickHostedAgentReasonCode(
  readiness: AgentExecutionStatusProjection
): string | null {
  const reasonCodes = collectReasonCodes(readiness);
  return (
    reasonCodes.find((reasonCode) => reasonCode.startsWith("remote_agent.")) ??
    null
  );
}

function pickKnownReasonCode(
  readiness: AgentExecutionStatusProjection,
  preferredReasonCodes: readonly string[]
): string | null {
  const reasonCodes = collectReasonCodes(readiness);

  for (const preferredReasonCode of preferredReasonCodes) {
    if (reasonCodes.includes(preferredReasonCode)) {
      return preferredReasonCode;
    }
  }

  return null;
}

function pickRouteGapReasonCode(
  readiness: AgentExecutionStatusProjection
): string {
  const reasonCodes = collectReasonCodes(readiness);
  for (const routeReasonCode of [
    "agent_execution.route_missing",
    "route.not_registered",
  ]) {
    if (reasonCodes.includes(routeReasonCode)) {
      return routeReasonCode;
    }
  }
  return "agent_execution.route_missing";
}

function collectReasonCodes(
  readiness: AgentExecutionStatusProjection
): readonly string[] {
  return [
    ...readiness.reasonCodes,
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.providerAccount.reasonCodes,
    ...readiness.facts.providerConversation.reasonCodes,
    ...readiness.facts.readinessImpact.reasonCodes,
    ...readiness.facts.localService.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.route.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ];
}

function hasKnownPublicOfflineReadiness(input: {
  wakeRouteStatus: WakeRouteStatus;
  readiness: AgentExecutionStatusProjection;
}): boolean {
  if (input.wakeRouteStatus.status === "offline") {
    return true;
  }

  const reasonCodes = new Set([
    ...input.readiness.reasonCodes,
    ...input.readiness.facts.localService.reasonCodes,
    ...input.readiness.facts.route.reasonCodes,
  ]);

  for (const reasonCode of reasonCodes) {
    if (isPublicOfflineReadinessReason(reasonCode)) {
      return true;
    }
  }

  return false;
}

function isPublicOfflineReadinessReason(reasonCode: string): boolean {
  return classifyAgentWakeAvailabilityReason(reasonCode) === "blocking_offline";
}

function isPublicUnavailableReadinessReason(reasonCode: string): boolean {
  return (
    classifyAgentWakeAvailabilityReason(reasonCode) === "blocking_unavailable"
  );
}

function isPublicOfflineReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "local_service.not_connected_for_account" ||
    reasonCode === "local_service.unavailable" ||
    reasonCode === "service.not_running" ||
    reasonCode === "service.current_runtime_session_missing" ||
    reasonCode === "daemon.session.not_found" ||
    reasonCode === "agent_execution.route_offline" ||
    reasonCode === "route.offline"
  );
}

// Stale local evidence (for example runtime.agent_controller_report_stale)
// is intentionally NOT a public-unavailable reason: evidence freshness is a
// diagnostic concern, while public availability is decided by binding, route,
// service, and account facts (developing/architecture owner docs - evidence
// sync health is owner-only diagnostics, not public availability).
function isPublicUnavailableReasonCode(reasonCode: string): boolean {
  if (reasonCode === "controller.interface.check_failed") {
    return false;
  }

  return (
    reasonCode === "usage_exhausted" ||
    reasonCode === "profile.unbound" ||
    reasonCode === "profile.inactive" ||
    reasonCode === "route.unavailable" ||
    reasonCode === "agent_execution.route_unavailable" ||
    reasonCode === "service.update_required" ||
    reasonCode === "service.not_installed" ||
    reasonCode === "service.drifted" ||
    reasonCode === "local_service.identity_mismatch" ||
    reasonCode === "background_helper.update_required" ||
    isAgentProfileWorkspaceBlockerReasonCode(reasonCode) ||
    isPublicUnavailableAgentProfileBindingReason(reasonCode) ||
    isPublicUnavailableClaimEligibilityReason(reasonCode) ||
    reasonCode.startsWith("controller.") ||
    reasonCode.startsWith("daemon.runtime_contract.") ||
    reasonCode.startsWith("provider_account.") ||
    reasonCode.startsWith("workspace.")
  );
}

function isPublicUnavailableAgentProfileBindingReason(
  reasonCode: string
): boolean {
  return (
    reasonCode === "agent_profile_binding.missing" ||
    reasonCode === "agent_profile_binding.disabled" ||
    reasonCode === "agent_profile_binding.disabled_historical" ||
    reasonCode === "agent_profile_binding.conflict" ||
    reasonCode === "agent_profile_binding.owner_mismatch" ||
    reasonCode === "agent_profile_binding.controller_conversation_conflict" ||
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

function isTransientRouteReason(reasonCode: string): boolean {
  return (
    classifyAgentWakeAvailabilityReason(reasonCode) === "transient_checking"
  );
}

function isTransientCheckingReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "usage_checking" ||
    reasonCode === "agent_execution.route_missing" ||
    reasonCode === "local_service.reconnecting" ||
    reasonCode === "route.not_registered"
  );
}

function isReadyRouteMissingDispatchClaim(input: {
  wakeRouteStatus: WakeRouteStatus;
}): boolean {
  return (
    input.wakeRouteStatus.status === "ready" &&
    !isWakeRouteReady(input.wakeRouteStatus)
  );
}

function isWakeRouteReady(wakeRouteStatus: WakeRouteStatus): boolean {
  if (wakeRouteStatus.status !== "ready") {
    return false;
  }

  const route = wakeRouteStatus as Partial<
    Extract<WakeRouteStatus, { status: "ready" }>
  >;
  return (
    isNonEmptyString(route.daemonSessionId) &&
    isNonEmptyString(route.deviceId) &&
    isNonEmptyString(route.lane) &&
    isPositiveInteger(route.connectionGeneration) &&
    isPositiveInteger(route.leaseEpoch) &&
    isNonNegativeInteger(route.lastHeartbeatMs)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
