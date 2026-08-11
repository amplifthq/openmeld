import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";
import {
  resolveSpaceMemberAgentOwnerWakeDiagnosticsView,
  resolveSpaceMemberAgentPublicCollaborationView,
} from "./space-member-agent-views";

type SpaceMemberAgentAgentWakeAvailability = NonNullable<
  SpaceMemberAgentSnapshot["agentWakeAvailability"]
>;

export type SpaceMemberAgentPresencePresentation = {
  availabilityAction: SpaceMemberAgentAgentWakeAvailability["action"] | null;
  availabilityBadgeLabel: string | null;
  availabilityCategory:
    | SpaceMemberAgentAgentWakeAvailability["category"]
    | null;
  availabilityIsRefreshing: boolean;
  availabilityPhase: SpaceMemberAgentAgentWakeAvailability["phase"] | null;
  availabilityReasonCode: string | null;
  availabilitySummary: string | null;
  availabilityTooltip: string | null;
  detailLabel:
    | "Live agent"
    | "Wakeable agent"
    | "Checking connection"
    | "Offline agent"
    | "Reply blocked"
    | "Reply route unavailable";
  shortLabel:
    | "live now"
    | "wakeable"
    | "checking connection"
    | "offline"
    | "reply blocked"
    | "reply route unavailable";
  status:
    | "live"
    | "wakeable"
    | "checking_connection"
    | "offline"
    | "unavailable";
};

export function buildSpaceMemberAgentPresencePresentation(
  member: SpaceMemberAgentSnapshot
): SpaceMemberAgentPresencePresentation {
  return buildSpaceMemberAgentPublicCollaborationPresencePresentation(member);
}

export function buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation(
  member: SpaceMemberAgentSnapshot
): SpaceMemberAgentPresencePresentation {
  const ownerWakeDiagnostics =
    resolveSpaceMemberAgentOwnerWakeDiagnosticsView(member);
  if (ownerWakeDiagnostics.agentExecutionReadiness) {
    return buildReadinessPresencePresentation({
      liveNow: member.liveNow,
      readiness: ownerWakeDiagnostics.agentExecutionReadiness,
    });
  }

  const { agentWakeAvailability } =
    resolveSpaceMemberAgentPublicCollaborationView(member);
  if (agentWakeAvailability) {
    return buildAgentWakeAvailabilityPresentation({
      liveNow: member.liveNow,
      agentWakeAvailability,
    });
  }

  if (member.liveNow) {
    return {
      ...fallbackAvailabilityPresentation(),
      detailLabel: "Live agent",
      shortLabel: "live now",
      status: "live",
    };
  }

  if (ownerWakeDiagnostics.wakeRouteEvidence?.status === "unavailable") {
    return {
      ...fallbackUnavailableAvailabilityPresentation(),
      detailLabel: "Reply route unavailable",
      shortLabel: "reply route unavailable",
      status: "unavailable",
    };
  }

  return {
    ...fallbackCheckingAvailabilityPresentation(),
    detailLabel: "Checking connection",
    shortLabel: "checking connection",
    status: "checking_connection",
  };
}

export function buildSpaceMemberAgentPublicCollaborationPresencePresentation(
  member: SpaceMemberAgentSnapshot
): SpaceMemberAgentPresencePresentation {
  const { agentWakeAvailability } =
    resolveSpaceMemberAgentPublicCollaborationView(member);
  if (agentWakeAvailability) {
    return buildAgentWakeAvailabilityPresentation({
      liveNow: member.liveNow,
      agentWakeAvailability,
    });
  }

  if (member.liveNow) {
    return {
      ...fallbackAvailabilityPresentation(),
      detailLabel: "Live agent",
      shortLabel: "live now",
      status: "live",
    };
  }

  return {
    ...fallbackCheckingAvailabilityPresentation(),
    detailLabel: "Checking connection",
    shortLabel: "checking connection",
    status: "checking_connection",
  };
}

function buildReadinessPresencePresentation(input: {
  liveNow: boolean;
  readiness: NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"];
}): SpaceMemberAgentPresencePresentation {
  if (input.readiness.displayState === "ready") {
    return input.liveNow
      ? {
          ...fallbackAvailabilityPresentation(),
          detailLabel: "Live agent",
          shortLabel: "live now",
          status: "live",
        }
      : {
          ...fallbackAvailabilityPresentation(),
          detailLabel: "Wakeable agent",
          shortLabel: "wakeable",
          status: "wakeable",
        };
  }

  if (hasUnavailableRoute(input.readiness.facts.route.reasonCodes)) {
    return {
      ...fallbackUnavailableAvailabilityPresentation(),
      detailLabel: "Reply route unavailable",
      shortLabel: "reply route unavailable",
      status: "unavailable",
    };
  }

  // A blocked verdict is a known blocker; rendering it as transient checking
  // would hide it (docs/architecture/facts.md - Checking must stay temporary,
  // never a sink that hides known blockers).
  if (input.readiness.displayState === "blocked") {
    return {
      ...fallbackUnavailableAvailabilityPresentation(),
      detailLabel: "Reply blocked",
      shortLabel: "reply blocked",
      status: "unavailable",
    };
  }

  return {
    ...fallbackCheckingAvailabilityPresentation(),
    detailLabel: "Checking connection",
    shortLabel: "checking connection",
    status: "checking_connection",
  };
}

function buildAgentWakeAvailabilityPresentation(input: {
  liveNow: boolean;
  agentWakeAvailability: SpaceMemberAgentAgentWakeAvailability;
}): SpaceMemberAgentPresencePresentation {
  if (input.agentWakeAvailability.status === "available_for_wake") {
    return input.liveNow
      ? {
          ...projectAgentWakeAvailability(input.agentWakeAvailability),
          detailLabel: "Live agent",
          shortLabel: "live now",
          status: "live",
        }
      : {
          ...projectAgentWakeAvailability(input.agentWakeAvailability),
          detailLabel: "Wakeable agent",
          shortLabel: "wakeable",
          status: "wakeable",
        };
  }

  if (input.agentWakeAvailability.status === "unavailable_for_wake") {
    return {
      ...projectAgentWakeAvailability(input.agentWakeAvailability),
      detailLabel: "Reply route unavailable",
      shortLabel: "reply route unavailable",
      status: "unavailable",
    };
  }

  if (input.agentWakeAvailability.status === "checking_connection") {
    return {
      ...projectAgentWakeAvailability(input.agentWakeAvailability),
      detailLabel: "Checking connection",
      shortLabel: "checking connection",
      status: "checking_connection",
    };
  }

  if (input.agentWakeAvailability.status === "offline_for_wake") {
    return {
      ...projectAgentWakeAvailability(input.agentWakeAvailability),
      detailLabel: "Offline agent",
      shortLabel: "offline",
      status: "offline",
    };
  }

  return {
    ...fallbackCheckingAvailabilityPresentation(),
    detailLabel: "Checking connection",
    shortLabel: "checking connection",
    status: "checking_connection",
  };
}

function projectAgentWakeAvailability(
  agentWakeAvailability: SpaceMemberAgentAgentWakeAvailability
): Pick<
  SpaceMemberAgentPresencePresentation,
  | "availabilityAction"
  | "availabilityBadgeLabel"
  | "availabilityCategory"
  | "availabilityIsRefreshing"
  | "availabilityPhase"
  | "availabilityReasonCode"
  | "availabilitySummary"
  | "availabilityTooltip"
> {
  return {
    availabilityAction: agentWakeAvailability.action,
    availabilityBadgeLabel: agentWakeAvailability.badgeLabel,
    availabilityCategory: agentWakeAvailability.category,
    availabilityIsRefreshing: agentWakeAvailability.isRefreshing,
    availabilityPhase: agentWakeAvailability.phase,
    availabilityReasonCode: agentWakeAvailability.reasonCode,
    availabilitySummary: agentWakeAvailability.summary,
    availabilityTooltip: agentWakeAvailability.tooltip,
  };
}

function fallbackAvailabilityPresentation(): ReturnType<
  typeof projectAgentWakeAvailability
> {
  return {
    availabilityAction: null,
    availabilityBadgeLabel: null,
    availabilityCategory: null,
    availabilityIsRefreshing: false,
    availabilityPhase: null,
    availabilityReasonCode: null,
    availabilitySummary: null,
    availabilityTooltip: null,
  };
}

function fallbackCheckingAvailabilityPresentation(): ReturnType<
  typeof projectAgentWakeAvailability
> {
  return {
    availabilityAction: null,
    availabilityBadgeLabel: "Checking",
    availabilityCategory: "checking",
    availabilityIsRefreshing: true,
    availabilityPhase: "checking_status",
    availabilityReasonCode: null,
    availabilitySummary: "Checking this agent's Wake availability.",
    availabilityTooltip: "Checking Wake availability",
  };
}

function fallbackUnavailableAvailabilityPresentation(): ReturnType<
  typeof projectAgentWakeAvailability
> {
  return {
    availabilityAction: null,
    availabilityBadgeLabel: "Unavailable",
    availabilityCategory: "unavailable",
    availabilityIsRefreshing: false,
    availabilityPhase: "unavailable",
    availabilityReasonCode: null,
    availabilitySummary:
      "This agent cannot reply from this computer right now.",
    availabilityTooltip: "Unavailable for Wake",
  };
}

function hasUnavailableRoute(reasonCodes: readonly string[]): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "route.unavailable" ||
      reasonCode === "agent_execution.route_unavailable"
  );
}
