import type { AgentTargetState } from "../agents/registry";
import type { ServiceParticipationReadiness } from "./service-participation-readiness";

export type ActionParticipationIntent =
  | "start"
  | "space_join"
  | "space_create_join"
  | "space_add_members";

export type LocalParticipationState =
  | "not_needed"
  | "membership_only"
  | "needs_agent_prepare"
  | "needs_openmeld_service"
  | "ready";

export type LocalParticipationRootCause =
  | "human_only"
  | "profile_unbound"
  | "controller_disabled"
  | "target_not_selectable"
  | "target_needs_repair"
  | "workspace_not_ready"
  | "daemon_service_not_ready"
  | "daemon_service_drifted"
  | "unknown";

export type ActionParticipationCandidate = {
  profileId: string;
  profileName: string;
  profileKind: "human" | "agent";
  localTargetSelectable?: boolean | null;
  localTargetLaunchStatus?: AgentTargetState["launchStatus"] | null;
  localParticipationReadiness?: ServiceParticipationReadiness | null;
  localParticipationReasonCodes?: readonly string[];
};

export type LocalParticipationAssessment = {
  profileId: string;
  profileName: string;
  profileKind: "human" | "agent";
  membershipAllowed: boolean;
  localParticipationState: LocalParticipationState;
  rootCause: LocalParticipationRootCause;
  reasonCodes: string[];
};

export type ActionParticipationPlan = {
  intent: ActionParticipationIntent;
  assessments: LocalParticipationAssessment[];
  shouldOfferServiceGate: boolean;
  hasAgentPreparationWork: boolean;
  hasReadyLocalAgentParticipation: boolean;
  explicitLocalAgentCount: number;
};

export type LocalParticipationOrchestratorOutcome =
  | { status: "continued" }
  | { status: "recheck_required" }
  | { status: "cancelled" };

const OPENMELD_SERVICE_REASON_CODES: ReadonlySet<string> = new Set([
  "service.not_installed",
  "service.not_running",
  "service.drifted",
  "dispatch.storage_not_ready",
  "service.gateway_chain_unhealthy",
  "agent_execution.route_missing",
  "agent_execution.route_offline",
  "agent_execution.route_unavailable",
  "route.offline",
  "route.not_registered",
  "route.unavailable",
] as const);

const PROFILE_CONNECTION_REASON_CODES: ReadonlySet<string> = new Set([
  "profile.unbound",
  "controller.binding.disabled",
  "agent_profile_binding.missing",
  "agent_profile_binding.command_eligible",
  "agent_profile_binding.owner_mismatch",
  "agent_profile_binding.runtime_mismatch",
  "agent_profile_binding.capability_mismatch",
  "claim_eligibility.binding_capability_mismatch",
  "claim_eligibility.binding_owner_mismatch",
  "claim_eligibility.binding_runtime_mismatch",
  "claim_eligibility.owner_mismatch",
  "claim_eligibility.openmeld_service_runtime_id_mismatch",
  "local_service.identity_mismatch",
] as const);

const AGENT_PREPARE_REASON_CODES: ReadonlySet<string> = new Set([
  "controller.registry.disabled",
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "workspace.missing",
  "workspace.invalid",
  "projection.missing",
  "runtime.adapter.unsupported",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
] as const);

export function planActionParticipation(input: {
  intent: ActionParticipationIntent;
  candidates: readonly ActionParticipationCandidate[];
}): ActionParticipationPlan {
  const assessments = input.candidates.map((candidate) =>
    assessActionParticipationCandidate(candidate)
  );

  return {
    intent: input.intent,
    assessments,
    shouldOfferServiceGate: assessments.some(
      (assessment) =>
        assessment.localParticipationState === "needs_openmeld_service"
    ),
    hasAgentPreparationWork: assessments.some(
      (assessment) =>
        assessment.localParticipationState === "needs_agent_prepare"
    ),
    hasReadyLocalAgentParticipation: assessments.some(
      (assessment) => assessment.localParticipationState === "ready"
    ),
    explicitLocalAgentCount: assessments.filter(
      (assessment) => assessment.profileKind === "agent"
    ).length,
  };
}

export function assessActionParticipationCandidate(
  candidate: ActionParticipationCandidate
): LocalParticipationAssessment {
  const reasonCodes = normalizeReasonCodes(
    candidate.localParticipationReasonCodes
  );

  if (candidate.profileKind !== "agent") {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "not_needed",
      rootCause: "human_only",
      reasonCodes,
    };
  }

  if (candidate.localTargetSelectable === false) {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "needs_agent_prepare",
      rootCause: "target_not_selectable",
      reasonCodes,
    };
  }

  if (candidate.localTargetLaunchStatus === "needs_repair") {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "needs_agent_prepare",
      rootCause: "target_needs_repair",
      reasonCodes,
    };
  }

  if (
    reasonCodes.some((reasonCode) => AGENT_PREPARE_REASON_CODES.has(reasonCode))
  ) {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "needs_agent_prepare",
      rootCause: resolveAgentPrepareRootCause(reasonCodes),
      reasonCodes,
    };
  }

  if (
    candidate.localParticipationReadiness === "not_installed" ||
    candidate.localParticipationReadiness === "not_running" ||
    reasonCodes.some((reasonCode) =>
      OPENMELD_SERVICE_REASON_CODES.has(reasonCode)
    )
  ) {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "needs_openmeld_service",
      rootCause: reasonCodes.includes("service.drifted")
        ? "daemon_service_drifted"
        : "daemon_service_not_ready",
      reasonCodes,
    };
  }

  if (
    reasonCodes.some((reasonCode) =>
      PROFILE_CONNECTION_REASON_CODES.has(reasonCode)
    )
  ) {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "membership_only",
      rootCause: resolveMembershipOnlyRootCause(reasonCodes),
      reasonCodes,
    };
  }

  if (candidate.localParticipationReadiness === "ready") {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "ready",
      rootCause: "unknown",
      reasonCodes,
    };
  }

  if (reasonCodes.length === 0) {
    return {
      profileId: candidate.profileId,
      profileName: candidate.profileName,
      profileKind: candidate.profileKind,
      membershipAllowed: true,
      localParticipationState: "membership_only",
      rootCause: "unknown",
      reasonCodes,
    };
  }

  return {
    profileId: candidate.profileId,
    profileName: candidate.profileName,
    profileKind: candidate.profileKind,
    membershipAllowed: true,
    localParticipationState: "membership_only",
    rootCause: "unknown",
    reasonCodes,
  };
}

function normalizeReasonCodes(
  reasonCodes: readonly string[] | null | undefined
): string[] {
  return [
    ...new Set((reasonCodes ?? []).map((code) => code.trim()).filter(Boolean)),
  ];
}

function resolveAgentPrepareRootCause(
  reasonCodes: readonly string[]
): LocalParticipationRootCause {
  if (reasonCodes.includes("profile.unbound")) {
    return "profile_unbound";
  }
  if (
    reasonCodes.includes("controller.binding.disabled") ||
    reasonCodes.includes("controller.registry.disabled")
  ) {
    return "controller_disabled";
  }
  if (
    reasonCodes.includes("controller.launch.choice_required") ||
    reasonCodes.includes("controller.launch.needs_repair")
  ) {
    return "target_needs_repair";
  }
  if (
    reasonCodes.includes("workspace.missing") ||
    reasonCodes.includes("workspace.invalid") ||
    reasonCodes.includes("projection.missing")
  ) {
    return "workspace_not_ready";
  }
  return "unknown";
}

function resolveMembershipOnlyRootCause(
  reasonCodes: readonly string[]
): LocalParticipationRootCause {
  if (reasonCodes.includes("profile.unbound")) {
    return "profile_unbound";
  }
  if (reasonCodes.includes("controller.binding.disabled")) {
    return "controller_disabled";
  }
  return "unknown";
}
