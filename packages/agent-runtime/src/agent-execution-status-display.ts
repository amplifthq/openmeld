import { DUPLICATE_REPLY_CONVERSATION_REASON } from "./agent-execution-reason-copy";
import type { AgentExecutionStatusProjection } from "./agent-execution-status";

export type AgentExecutionStatusDisplayRow = {
  label: string;
  value: string;
};

export function createAgentExecutionStatusDisplayRows(
  projection: AgentExecutionStatusProjection
): AgentExecutionStatusDisplayRow[] {
  const isNativeRuntime = isNativeRuntimeProjection(projection);
  const rows: AgentExecutionStatusDisplayRow[] = [
    {
      label: "Reply status",
      value: formatAgentExecutionStatus(projection),
    },
    {
      label: "Connection",
      value: formatBindingEvidence(projection, isNativeRuntime),
    },
    {
      label: isNativeRuntime ? "Hosted runtime" : "Local agent capability",
      value: formatRuntimeEvidence(projection),
    },
    {
      label: "OpenMeld Service",
      value: formatLocalServiceEvidence(projection),
    },
    {
      label: isNativeRuntime ? "Hosted reply route" : "Reply route",
      value: formatRouteEvidence(projection),
    },
    {
      label: "Wake",
      value: formatClaimEvidence(projection),
    },
  ];

  return rows;
}

function formatAgentExecutionStatus(
  projection: AgentExecutionStatusProjection
): string {
  switch (projection.displayState) {
    case "ready":
      return isNativeRuntimeProjection(projection)
        ? "Available for Wake · This Agent can answer now."
        : "Available for Wake · This agent can reply from this computer.";
    case "blocked":
      return `Blocked · ${formatBlockingReason(projection)}`;
    case "not_ready":
      return `Unavailable · ${formatNotReadyReason(projection)}`;
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}

function formatBlockingReason(
  projection: AgentExecutionStatusProjection
): string {
  if (!projection.facts.profile.active) {
    return formatPrimaryReason(projection.facts.profile.reasonCodes);
  }
  if (projection.facts.binding.source === "blocked") {
    return formatPrimaryReason(projection.facts.binding.reasonCodes);
  }
  if (!projection.facts.service.executionCompatible) {
    return formatPrimaryReason(projection.facts.service.reasonCodes);
  }
  if (projection.facts.claim.executionBlocked) {
    return formatPrimaryReason(projection.facts.claim.reasonCodes);
  }
  if (projection.facts.providerAccount.blocked) {
    return formatPrimaryReason(projection.facts.providerAccount.reasonCodes);
  }
  if (projection.facts.readinessImpact.blocked) {
    return formatPrimaryReason(projection.facts.readinessImpact.reasonCodes);
  }
  return formatPrimaryReason(projection.reasonCodes);
}

function formatBindingEvidence(
  projection: AgentExecutionStatusProjection,
  isNativeRuntime: boolean
): string {
  if (projection.facts.binding.routable) {
    return isNativeRuntime
      ? "Hosted agent connection is set."
      : "Local agent connection is set.";
  }
  if (projection.facts.binding.source === "missing") {
    return "Choose a local agent for this profile.";
  }
  if (projection.facts.binding.source === "not_checked") {
    return "Local agent connection has not been checked for this profile.";
  }
  if (projection.facts.binding.source === "unavailable") {
    return formatPrimaryReason(projection.facts.binding.reasonCodes);
  }
  return formatPrimaryReason(projection.facts.binding.reasonCodes);
}

function formatLocalServiceEvidence(
  projection: AgentExecutionStatusProjection
): string {
  if (!projection.facts.service.executionCompatible) {
    return formatPrimaryReason(projection.facts.service.reasonCodes);
  }
  if (projection.facts.localService.reachable) {
    return projection.facts.localService.refreshable
      ? "OpenMeld Service can check this agent again on this computer."
      : "OpenMeld Service is connected for this account.";
  }
  if (projection.facts.localService.source === "not_checked") {
    return "OpenMeld Service has not been checked for this agent yet.";
  }
  return formatPrimaryReason(projection.facts.localService.reasonCodes);
}

function formatRuntimeEvidence(
  projection: AgentExecutionStatusProjection
): string {
  if (projection.facts.runtime.source === "native_runtime") {
    return projection.facts.runtime.ready
      ? "Hosted runtime is available."
      : formatPrimaryReason(projection.facts.runtime.reasonCodes);
  }
  if (projection.facts.runtime.source === "not_checked") {
    return "Hosted runtime has not been checked yet.";
  }
  if (projection.facts.runtime.ready) {
    return "Local agent capability is current.";
  }
  if (projection.facts.runtime.source === "missing") {
    return "OpenMeld needs a current setup check from this computer.";
  }
  if (
    projection.facts.runtime.reasonCodes.includes(
      "prepare_readiness.read_failed"
    )
  ) {
    return formatPrimaryReason(projection.facts.runtime.reasonCodes);
  }
  return formatPrimaryReason(projection.facts.runtime.reasonCodes);
}

function formatRouteEvidence(
  projection: AgentExecutionStatusProjection
): string {
  if (projection.facts.route.source === "hosted_route") {
    return projection.facts.route.online
      ? "Hosted reply route is available."
      : formatPrimaryReason(projection.facts.route.reasonCodes);
  }
  if (projection.facts.route.source === "not_checked") {
    return "Hosted reply route has not been checked yet.";
  }
  if (!projection.facts.service.executionCompatible) {
    return "Update OpenMeld Service before checking this agent's local reply route.";
  }
  if (projection.facts.route.online) {
    return "OpenMeld Service is online for replies.";
  }
  if (projection.facts.route.source === "missing") {
    return REPLY_ROUTE_RECONNECTING_REASON;
  }
  return formatPrimaryReason(projection.facts.route.reasonCodes);
}

function isNativeRuntimeProjection(
  projection: AgentExecutionStatusProjection
): boolean {
  return (
    projection.facts.runtime.source === "native_runtime" ||
    projection.facts.runtime.source === "not_checked" ||
    projection.facts.route.source === "hosted_route" ||
    projection.facts.route.source === "not_checked"
  );
}

function formatClaimEvidence(
  projection: AgentExecutionStatusProjection
): string {
  if (projection.facts.claim.source === "not_checked") {
    return "Wake has not been checked yet.";
  }
  if (projection.facts.claim.executionBlocked) {
    return formatPrimaryReason(projection.facts.claim.reasonCodes);
  }
  if (projection.displayState === "ready") {
    return "Wake is available from this computer.";
  }
  if (!projection.facts.runtime.ready) {
    return "Wake is waiting for this computer to check local agent support again.";
  }
  if (!projection.facts.binding.routable) {
    return "Wake needs a local agent connection first.";
  }
  if (!projection.facts.localService.reachable) {
    return "Wake needs OpenMeld Service connected for this account.";
  }
  if (!projection.facts.service.executionCompatible) {
    return "Wake needs OpenMeld Service updated before this agent can reply.";
  }
  if (!projection.facts.route.online) {
    return "Wake is waiting for this agent's local reply route to reconnect.";
  }
  return "Wake is waiting for setup to finish.";
}

function formatPrimaryReason(reasonCodes: readonly string[]): string {
  const reasonCode = selectPrimaryReasonCode(reasonCodes);
  if (!reasonCode) {
    return "no supporting evidence";
  }
  return REASON_TEXT[reasonCode] ?? formatReasonCodeFamily(reasonCode);
}

function selectPrimaryReasonCode(
  reasonCodes: readonly string[]
): string | null {
  return (
    reasonCodes.find(
      (reasonCode) => !PRIMARY_REASON_UMBRELLA_CODES.has(reasonCode)
    ) ??
    reasonCodes[0] ??
    null
  );
}

function formatReasonCodeFamily(reasonCode: string): string {
  if (reasonCode.startsWith("agent_profile.")) {
    return "OpenMeld could not confirm this agent profile.";
  }
  if (
    reasonCode.startsWith("service.") ||
    reasonCode.startsWith("background_helper.") ||
    reasonCode.startsWith("daemon.runtime_contract.")
  ) {
    return "This computer is not connected to OpenMeld.";
  }
  if (
    reasonCode.startsWith("claim_eligibility.") ||
    reasonCode.startsWith("dispatch.claim_eligibility.")
  ) {
    return "Wake cannot use this local connection for this agent yet.";
  }
  if (
    reasonCode.startsWith("runtime.agent_controller_report_") ||
    reasonCode.startsWith("runtime.agent_controller_report.")
  ) {
    return "This computer has not reported current local agent support yet.";
  }
  if (reasonCode.startsWith("provider_conversation.")) {
    return "OpenMeld needs a current provider conversation check for this agent.";
  }
  if (reasonCode.startsWith("runtime.")) {
    return "This computer needs a fresh check for this agent.";
  }
  if (reasonCode.startsWith("agent_profile_binding.")) {
    return "This agent's local connection needs setup.";
  }
  if (reasonCode.startsWith("local_service.")) {
    return "This computer is not connected to the current OpenMeld account.";
  }
  if (reasonCode.startsWith("agent_execution.route_")) {
    return REPLY_ROUTE_RECONNECTING_REASON;
  }
  return "OpenMeld needs a more current setup check from this computer.";
}

function formatNotReadyReason(
  projection: AgentExecutionStatusProjection
): string {
  if (
    !projection.facts.profile.active ||
    projection.facts.profile.source === "unavailable"
  ) {
    return formatPrimaryReason(projection.facts.profile.reasonCodes);
  }
  if (!projection.facts.binding.routable) {
    return formatPrimaryReason(projection.facts.binding.reasonCodes);
  }
  if (!projection.facts.localService.reachable) {
    return formatPrimaryReason(projection.facts.localService.reasonCodes);
  }
  if (!projection.facts.service.executionCompatible) {
    return formatPrimaryReason(projection.facts.service.reasonCodes);
  }
  if (!projection.facts.runtime.ready) {
    return formatPrimaryReason(projection.facts.runtime.reasonCodes);
  }
  if (
    projection.facts.providerConversation.required &&
    !projection.facts.providerConversation.ready
  ) {
    return formatPrimaryReason(
      projection.facts.providerConversation.reasonCodes
    );
  }
  if (!projection.facts.route.online) {
    return formatPrimaryReason(projection.facts.route.reasonCodes);
  }
  return formatPrimaryReason(projection.reasonCodes);
}

const PRIMARY_REASON_UMBRELLA_CODES = new Set([
  "claim_eligibility.eligible",
  "dispatch.claim_eligibility.blocked",
  "dispatch.claim_eligibility.candidate",
]);

const SERVICE_UPDATE_REQUIRED_REASON =
  "OpenMeld Service needs an update before this agent can reply from this computer.";
const SERVICE_CONTRACT_NOT_REPORTED_REASON =
  "OpenMeld Service has not reported execution compatibility yet.";
const OLDER_COMPUTER_SETUP_REASON =
  "This agent is connected to an older computer setup.";
const DIFFERENT_LOCAL_AGENT_SETUP_REASON =
  "This agent is connected to a different local agent setup.";
const DIFFERENT_ACCOUNT_REASON =
  "This agent is connected to a different OpenMeld account.";
const CONFLICTING_REPLY_CONNECTION_REASON =
  "This agent has a conflicting reply connection.";
const WAKE_REQUEST_NOT_ACTIVE_REASON = "This Wake request is no longer active.";
const AGENT_NOT_IN_SPACE_REASON =
  "This agent is no longer available in this space.";
const LOCAL_AGENT_READINESS_STALE_REASON =
  "This computer's setup check is out of date.";
const REPLY_ROUTE_RECONNECTING_REASON =
  "OpenMeld is checking this agent's local reply route.";

const REASON_TEXT: Record<string, string> = {
  "agent_profile.identity_lookup_failed":
    "OpenMeld could not confirm this agent profile.",
  "agent_profile.identity_lookup_unavailable":
    "OpenMeld could not check this agent profile right now.",
  "agent_profile.inactive": "This agent profile is not active.",
  "agent_profile.not_agent": "This profile is not an agent profile.",
  "agent_profile.not_found": "This agent profile no longer exists.",
  "agent_profile.owner_unavailable":
    "OpenMeld could not confirm this agent profile's owner.",
  "agent_execution.binding_agent_profile_mismatch":
    "This local connection belongs to a different agent profile.",
  "agent_execution.route_missing": REPLY_ROUTE_RECONNECTING_REASON,
  "agent_execution.route_offline": REPLY_ROUTE_RECONNECTING_REASON,
  "agent_execution.route_unavailable":
    "OpenMeld could not confirm this agent's local reply route yet.",
  "agent_profile_binding.missing":
    "This agent is not connected to a local agent yet.",
  "agent_profile_binding.controller_conversation_conflict":
    DUPLICATE_REPLY_CONVERSATION_REASON,
  "agent_profile_binding.profile_owner_invalid":
    "OpenMeld could not confirm this agent profile.",
  "agent_profile_binding.profile_owner_unavailable":
    "OpenMeld could not confirm this agent profile's owner.",
  "agent_profile_binding.read_unavailable":
    "OpenMeld could not check this agent's local connection.",
  "controller.launch.choice_required":
    "Choose which local install this agent should use.",
  "controller.launch.needs_repair":
    "Repair this local agent before it can reply.",
  "controller.client.upgrade_required":
    "Update this local agent before it can reply.",
  "controller.runtime.missing":
    "This local agent is not available on this computer.",
  "runtime_coordinator.delivery_expired":
    "This agent did not receive the last Wake from this computer.",
  "workspace.invalid": "Repair this agent's local workspace on this computer.",
  "workspace.missing": "Set up this agent's local workspace on this computer.",
  "local_service.identity_mismatch":
    "This computer’s OpenMeld connection does not match this account.",
  "local_service.not_connected_for_account":
    "This computer is not connected to the current OpenMeld account.",
  "local_service.refresh_in_progress":
    "OpenMeld is checking this agent again on this computer.",
  "local_service.unavailable":
    "OpenMeld could not check this computer’s connection.",
  "execution_authority.missing": "Wake execution authority is missing.",
  "execution_authority.mismatch":
    "Wake execution authority does not match this agent.",
  "execution_authority.unavailable": "Wake execution authority is unavailable.",
  "claim_eligibility.binding_capability_mismatch":
    DIFFERENT_LOCAL_AGENT_SETUP_REASON,
  "claim_eligibility.binding_conflict": CONFLICTING_REPLY_CONNECTION_REASON,
  "claim_eligibility.binding_disabled":
    "This agent's local connection is turned off.",
  "claim_eligibility.binding_missing":
    "This agent is not connected to a local agent yet.",
  "claim_eligibility.binding_not_routable":
    "This agent's local connection is not available for Wake.",
  "claim_eligibility.binding_owner_mismatch": DIFFERENT_ACCOUNT_REASON,
  "claim_eligibility.binding_runtime_mismatch": OLDER_COMPUTER_SETUP_REASON,
  "claim_eligibility.caller_not_allowed":
    "OpenMeld could not verify permission to run this agent.",
  "claim_eligibility.capability_missing":
    "This computer does not currently report support for this local agent.",
  "claim_eligibility.capability_unavailable":
    "This local agent is not available on this computer right now.",
  "claim_eligibility.dispatch_evidence_missing": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.dispatch_evidence_stale": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.dispatch_missing": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.dispatch_terminal": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.lease_conflict": CONFLICTING_REPLY_CONNECTION_REASON,
  "claim_eligibility.non_wake_relation_not_dispatchable":
    WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.not_read_after_caller_authorization_failed":
    "OpenMeld could not verify permission to run this agent.",
  "claim_eligibility.owner_mismatch": DIFFERENT_ACCOUNT_REASON,
  "claim_eligibility.policy_version_mismatch": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.agent_controller_report_disabled":
    "This local agent is turned off on this computer.",
  "claim_eligibility.agent_controller_report_missing":
    "This computer has not reported this local agent capability yet.",
  "claim_eligibility.agent_controller_report_stale":
    LOCAL_AGENT_READINESS_STALE_REASON,
  "claim_eligibility.agent_controller_report_unavailable":
    "This local agent is not available on this computer right now.",
  "claim_eligibility.agent_controller_report_unknown":
    "OpenMeld cannot confirm this local agent capability yet.",
  "claim_eligibility.runtime_conflict": CONFLICTING_REPLY_CONNECTION_REASON,
  "claim_eligibility.openmeld_service_runtime_id_mismatch":
    OLDER_COMPUTER_SETUP_REASON,
  "claim_eligibility.openmeld_service_runtime_id_missing":
    OLDER_COMPUTER_SETUP_REASON,
  "claim_eligibility.openmeld_service_runtime_id_not_opaque":
    OLDER_COMPUTER_SETUP_REASON,
  "claim_eligibility.openmeld_service_runtime_identity_invalid":
    OLDER_COMPUTER_SETUP_REASON,
  "claim_eligibility.runtime_missing":
    "OpenMeld cannot find the local runtime for this agent.",
  "claim_eligibility.runtime_unavailable":
    "This local runtime is not available right now.",
  "claim_eligibility.space_liveness_missing": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.space_liveness_stale": WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.target_no_longer_member": AGENT_NOT_IN_SPACE_REASON,
  "claim_eligibility.target_not_claimable_agent_member":
    AGENT_NOT_IN_SPACE_REASON,
  "claim_eligibility.wake_no_longer_allowed_by_policy":
    WAKE_REQUEST_NOT_ACTIVE_REASON,
  "claim_eligibility.wake_not_allowed_at_creation":
    WAKE_REQUEST_NOT_ACTIVE_REASON,
  "daemon.runtime_contract.missing": SERVICE_CONTRACT_NOT_REPORTED_REASON,
  "daemon.runtime_contract.mismatch": SERVICE_UPDATE_REQUIRED_REASON,
  "dispatch.claim_eligibility.binding.conflict":
    CONFLICTING_REPLY_CONNECTION_REASON,
  "dispatch.claim_eligibility.binding.disabled_historical":
    "This agent's previous local connection is no longer active.",
  "dispatch.claim_eligibility.binding.enabled_primary":
    "This agent's local connection is not available for Wake.",
  "dispatch.claim_eligibility.binding.missing":
    "This agent is not connected to a local agent yet.",
  "dispatch.claim_eligibility.binding.owner_mismatch": DIFFERENT_ACCOUNT_REASON,
  "prepare_readiness.read_failed":
    "OpenMeld could not check this computer for local agent support.",
  "background_helper.update_required": SERVICE_UPDATE_REQUIRED_REASON,
  "runtime.agent_controller_ref_invalid":
    "OpenMeld could not identify this local agent capability.",
  "runtime.agent_controller_report_disabled":
    "This local agent is turned off on this computer.",
  "runtime.agent_controller_report_missing":
    "This computer has not reported this local agent capability yet.",
  "runtime.agent_controller_report_stale": LOCAL_AGENT_READINESS_STALE_REASON,
  "runtime.agent_controller_report_unavailable":
    "This local agent is not available on this computer right now.",
  "runtime.agent_controller_report_unknown":
    "OpenMeld cannot confirm this local agent capability yet.",
  "runtime.agent_controller_report.disabled":
    "This local agent is turned off on this computer.",
  "runtime.agent_controller_report.missing":
    "This computer has not reported this local agent capability yet.",
  "runtime.agent_controller_report.stale": LOCAL_AGENT_READINESS_STALE_REASON,
  "runtime.agent_controller_report.unavailable":
    "This local agent is not available on this computer right now.",
  "runtime.agent_controller_report.unknown":
    "OpenMeld cannot confirm this local agent capability yet.",
  "runtime.projection_missing":
    "OpenMeld needs a current setup check from this computer.",
  "provider_conversation.proof_failed":
    "OpenMeld could not resume this agent's provider conversation on this computer.",
  "provider_conversation.proof_missing":
    "OpenMeld is checking this agent's provider conversation on this computer.",
  "provider_conversation.proof_unavailable":
    "OpenMeld could not check this agent's provider conversation.",
  "service.update_required": SERVICE_UPDATE_REQUIRED_REASON,
};
