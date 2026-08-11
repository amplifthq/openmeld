export const SPACE_ADD_MEMBERS_PROGRESS_HEARTBEAT_MS = 5000;

export type SpaceAddMembersProgressStage =
  | "resolve_candidates"
  | "check_local_wake_readiness"
  | "plan_local_wake_participation"
  | "confirm_local_wake_bindings"
  | "add_members"
  | "record_join_notices";

export type SpaceAddMembersProgressOwner =
  | "cli"
  | "local_runtime"
  | "local_participation"
  | "core"
  | "space";

export type SpaceAddMembersProgressFactSource =
  | "profile_store"
  | "space_membership_api"
  | "local_agent_registry"
  | "agent_controller_report_projection"
  | "local_readiness_diagnostics"
  | "local_participation_plan"
  | "agent_profile_binding_api"
  | "space_membership_api_write"
  | "space_membership_projection"
  | "space_signal_api_write";

export type SpaceAddMembersProgressPhaseContract = {
  stage: SpaceAddMembersProgressStage;
  phase: string;
  owner: SpaceAddMembersProgressOwner;
  waitingFor: string;
  factSource: SpaceAddMembersProgressFactSource;
  summary: string;
};

export const SPACE_ADD_MEMBERS_PROGRESS_PHASES = [
  {
    stage: "resolve_candidates",
    phase: "read_profiles",
    owner: "cli",
    waitingFor: "active profile identities eligible for this Space operation",
    factSource: "profile_store",
    summary:
      "Reading active local profile identities for this Space operation.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_space_members",
    owner: "space",
    waitingFor: "current Space membership snapshot",
    factSource: "space_membership_api",
    summary: "Reading current Space membership before selecting profiles.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_local_targets",
    owner: "local_runtime",
    waitingFor: "local agent controller state on this computer",
    factSource: "local_agent_registry",
    summary: "Reading local agent controller state for candidate profiles.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_local_targets_wait",
    owner: "local_runtime",
    waitingFor: "local agent controller state on this computer",
    factSource: "local_agent_registry",
    summary:
      "Still reading local agent controller state for candidate profiles.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_agent_controller_report",
    owner: "core",
    waitingFor: "Agent Profile execution target projection",
    factSource: "agent_controller_report_projection",
    summary: "Reading the Agent Profile execution target projection.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_agent_controller_report_wait",
    owner: "core",
    waitingFor: "Agent Profile execution target projection",
    factSource: "agent_controller_report_projection",
    summary: "Still reading the Agent Profile execution target projection.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_profile_readiness",
    owner: "local_participation",
    waitingFor: "local Wake participation diagnostics for candidate profiles",
    factSource: "local_readiness_diagnostics",
    summary:
      "Reading local Wake participation diagnostics for candidate profiles.",
  },
  {
    stage: "resolve_candidates",
    phase: "read_profile_readiness_wait",
    owner: "local_participation",
    waitingFor: "local Wake participation diagnostics for candidate profiles",
    factSource: "local_readiness_diagnostics",
    summary:
      "Still reading local Wake participation diagnostics for candidate profiles.",
  },
  {
    stage: "check_local_wake_readiness",
    phase: "start",
    owner: "local_participation",
    waitingFor: "selected profiles local Wake participation check",
    factSource: "local_readiness_diagnostics",
    summary:
      "Checking whether selected agent profiles can wake from this computer.",
  },
  {
    stage: "check_local_wake_readiness",
    phase: "read_local_targets",
    owner: "local_runtime",
    waitingFor: "local agent controller state on this computer",
    factSource: "local_agent_registry",
    summary:
      "Reading local agent controller state before checking selected profiles.",
  },
  {
    stage: "check_local_wake_readiness",
    phase: "read_local_targets_wait",
    owner: "local_runtime",
    waitingFor: "local agent controller state on this computer",
    factSource: "local_agent_registry",
    summary:
      "Still reading local agent controller state before checking selected profiles.",
  },
  {
    stage: "check_local_wake_readiness",
    phase: "read_profile_readiness",
    owner: "local_participation",
    waitingFor: "local Wake participation diagnostics for selected profiles",
    factSource: "local_readiness_diagnostics",
    summary:
      "Reading local Wake participation diagnostics for selected profiles.",
  },
  {
    stage: "check_local_wake_readiness",
    phase: "read_profile_readiness_wait",
    owner: "local_participation",
    waitingFor: "local Wake participation diagnostics for selected profiles",
    factSource: "local_readiness_diagnostics",
    summary:
      "Still reading local Wake participation diagnostics for selected profiles.",
  },
  {
    stage: "plan_local_wake_participation",
    phase: "plan",
    owner: "local_participation",
    waitingFor: "local participation plan for selected profiles",
    factSource: "local_participation_plan",
    summary: "Planning local Wake participation work for selected profiles.",
  },
  {
    stage: "confirm_local_wake_bindings",
    phase: "start",
    owner: "local_participation",
    waitingFor: "formal Binding confirmation for ready local profiles",
    factSource: "agent_profile_binding_api",
    summary:
      "Confirming available local agent profiles have Wake bindings before adding them.",
  },
  {
    stage: "confirm_local_wake_bindings",
    phase: "profile_binding_sync",
    owner: "local_participation",
    waitingFor:
      "local runtime evidence submission and Agent Profile Binding write",
    factSource: "agent_profile_binding_api",
    summary:
      "Submitting local runtime evidence and writing the Agent Profile Binding.",
  },
  {
    stage: "confirm_local_wake_bindings",
    phase: "profile_binding_sync_wait",
    owner: "local_participation",
    waitingFor:
      "local runtime evidence submission and Agent Profile Binding write",
    factSource: "agent_profile_binding_api",
    summary:
      "Still submitting local runtime evidence and writing the Agent Profile Binding.",
  },
  {
    stage: "confirm_local_wake_bindings",
    phase: "profile_binding_confirmed",
    owner: "core",
    waitingFor:
      "Core execution readiness projection after Binding confirmation",
    factSource: "agent_profile_binding_api",
    summary:
      "Local participation Binding is confirmed; this is not a final Wake outcome.",
  },
  {
    stage: "confirm_local_wake_bindings",
    phase: "profile_binding_not_confirmed",
    owner: "core",
    waitingFor:
      "Core execution readiness projection after Binding confirmation",
    factSource: "agent_profile_binding_api",
    summary:
      "Local participation Binding was not confirmed; membership can continue with diagnostics.",
  },
  {
    stage: "add_members",
    phase: "write_membership",
    owner: "space",
    waitingFor: "Space membership write",
    factSource: "space_membership_api_write",
    summary: "Adding selected profiles to the Space.",
  },
  {
    stage: "add_members",
    phase: "confirm_membership_projection",
    owner: "space",
    waitingFor: "Space membership and Wake availability projection",
    factSource: "space_membership_projection",
    summary:
      "Confirming the Space can see newly added wakeable members before returning.",
  },
  {
    stage: "record_join_notices",
    phase: "write_join_notices",
    owner: "space",
    waitingFor: "visible Space join notice signals",
    factSource: "space_signal_api_write",
    summary: "Recording visible join notices for newly added members.",
  },
] as const satisfies readonly SpaceAddMembersProgressPhaseContract[];

export const SPACE_ADD_MEMBERS_PROGRESS_OVERVIEW_STAGES =
  SPACE_ADD_MEMBERS_PROGRESS_PHASES.map(
    (phase) => `${phase.stage}/${phase.phase}`
  );

export const SPACE_ADD_MEMBERS_AGENT_OVERVIEW_STAGES = [
  "check_arguments",
  "authenticate",
  "check_profile",
  "resolve_target",
  "add_members/write_membership",
  "record_join_notices/write_join_notices",
] as const;

export function resolveSpaceAddMembersProgressPhase(input: {
  stage: SpaceAddMembersProgressStage;
  phase: string;
}): SpaceAddMembersProgressPhaseContract {
  const contract = SPACE_ADD_MEMBERS_PROGRESS_PHASES.find(
    (phase) => phase.stage === input.stage && phase.phase === input.phase
  );
  if (!contract) {
    throw new Error(
      `unknown space add-members progress phase: ${input.stage}/${input.phase}`
    );
  }
  return contract;
}
