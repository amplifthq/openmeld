import {
  type AgentRecoveryActionId,
  canonicalizeAgentControllerRef,
  formatAgentRecoveryActionLabel,
  resolveMappedPublicAgentFailureReason,
  resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";
import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";

export type AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState =
  | "ready"
  | "checking"
  | "not_ready"
  | "unknown";

export type AgentProfileReplyReadinessEvidence = {
  level: string;
  reasonCodes: readonly string[];
};

export type SelectableLocalAgentTarget = {
  agentId: string;
  agentControllerRef: string;
  displayName: string;
};

type AgentProfileReplyRecoveryReasonCode = string;
type AgentProfileReplyRecoveryReadiness = NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
>;
type AgentExecutionReadinessPrimaryAction =
  NonNullable<AgentProfileReplyRecoveryReadiness>["primaryAction"];

const PRIMARY_RECOVERY_REASON_CODES = [
  "agent_profile_binding.controller_conversation_conflict",
  "agent_profile_binding.missing",
  "profile.unbound",
  "controller.binding.disabled",
  "workspace.invalid",
  "workspace.missing",
  "controller.client.upgrade_required",
  "controller.runtime.missing",
  "controller.registry.disabled",
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
  "service.drifted",
  "service.update_required",
  "service.not_installed",
  "service.not_running",
  "local_service.identity_mismatch",
  "local_service.not_connected_for_account",
  "local_service.unavailable",
  "agent_profile_binding.agent_controller_report_missing",
  "agent_profile_binding.agent_controller_report_stale",
  "runtime.projection_missing",
  "runtime.agent_controller_report_missing",
  "runtime.agent_controller_report_stale",
  "claim_eligibility.agent_controller_report_missing",
  "claim_eligibility.agent_controller_report_stale",
  "agent_execution.route_missing",
  "agent_execution.route_offline",
  "agent_execution.route_unavailable",
  "route.not_registered",
  "route.offline",
  "route.unavailable",
  "provider_account.organization_access_disabled",
  "provider_account.subscription_access_unavailable",
  "provider_account.capacity_exhausted",
] satisfies readonly AgentProfileReplyRecoveryReasonCode[];

const AGENT_PROFILE_PREPARATION_REASON_CODES = new Set<string>([
  "workspace.invalid",
  "workspace.missing",
  "controller.client.upgrade_required",
  "controller.runtime.missing",
  "controller.registry.disabled",
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
  "agent_profile_binding.agent_controller_report_missing",
  "agent_profile_binding.agent_controller_report_stale",
  "runtime.projection_missing",
  "runtime.agent_controller_report_missing",
  "runtime.agent_controller_report_stale",
  "claim_eligibility.agent_controller_report_missing",
  "claim_eligibility.agent_controller_report_stale",
]);

const SERVICE_OR_CONNECTION_REASON_CODES = new Set<string>([
  "service.drifted",
  "service.update_required",
  "service.not_installed",
  "service.not_running",
  "local_service.identity_mismatch",
  "local_service.not_connected_for_account",
  "local_service.unavailable",
  "agent_execution.route_missing",
  "agent_execution.route_offline",
  "agent_execution.route_unavailable",
  "route.not_registered",
  "route.offline",
  "route.unavailable",
]);

const STALE_WHEN_COMPUTER_READY_REASON_CODES = new Set<string>([
  "service.drifted",
  "service.not_installed",
  "service.not_running",
]);

const UNBOUND_AGENT_REASON_CODES = new Set<string>([
  "agent_profile_binding.missing",
  "profile.unbound",
]);

const ROUTE_RECONNECT_REASON_CODES = new Set<string>([
  "agent_execution.route_missing",
  "agent_execution.route_offline",
  "agent_execution.route_unavailable",
  "route.not_registered",
  "route.offline",
  "route.unavailable",
]);

const LOCAL_READINESS_REFRESH_REASON_CODES = new Set<string>([
  "agent_profile_binding.agent_controller_report_missing",
  "agent_profile_binding.agent_controller_report_stale",
  "runtime.projection_missing",
  "runtime.agent_controller_report_missing",
  "runtime.agent_controller_report_stale",
  "claim_eligibility.agent_controller_report_missing",
  "claim_eligibility.agent_controller_report_stale",
]);

export function isAgentProfileLocalReadinessRefreshReasonCode(
  reasonCode: string | null | undefined
): reasonCode is AgentProfileReplyRecoveryReasonCode {
  return Boolean(
    reasonCode && LOCAL_READINESS_REFRESH_REASON_CODES.has(reasonCode)
  );
}

export type AgentProfileReplyRecoveryPlan =
  | {
      kind: "none";
    }
  | {
      agentDisplayName: string;
      agentId: string;
      body: string;
      agentControllerRef: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "connect_controller";
    }
  | {
      body: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "choose_controller";
    }
  | {
      body: string;
      agentControllerRef: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "turn_on_controller";
    }
  | {
      body: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "prepare_agent_profile";
    }
  | {
      body: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "review_provider_account";
    }
  | {
      body: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "review_agent_profile";
    }
  | {
      body: string;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      profileId: string;
      profileName: string;
      recoveryReasonCode: string;
      secondaryLabel: string;
      title: string;
      kind: "review_computer";
    };

function createPrimaryAction(actionId: AgentRecoveryActionId): {
  primaryActionId: AgentRecoveryActionId;
  primaryActionLabel: string;
} {
  return {
    primaryActionId: actionId,
    primaryActionLabel: formatAgentRecoveryActionLabel(actionId),
  };
}

function resolveSharedRecoveryCopy(input: {
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): {
  body: string;
  secondaryLabel: string;
  title: string;
} {
  const recovery = resolvePublicAgentFailureRecovery({
    errorCode: input.reasonCode,
    targetLabel: input.profileName,
  });
  if (recovery === null) {
    throw new Error(
      `Shared recovery copy is missing for reason code: ${input.reasonCode}`
    );
  }

  const mappedReason =
    resolveMappedPublicAgentFailureReason(
      input.reasonCode,
      input.profileName
    ) ?? recovery.body;
  return {
    body: recovery.body,
    secondaryLabel: mappedReason,
    title: mappedReason,
  };
}

export function planAgentProfileReplyRecovery(input: {
  autoRefreshExhausted?: boolean;
  currentLocalRuntimeReplyState?: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  member: SpaceMemberAgentSnapshot;
  profileReplyReadinessEvidence?: AgentProfileReplyReadinessEvidence | null;
  selectableLocalAgentTargets?: readonly SelectableLocalAgentTarget[] | null;
}): AgentProfileReplyRecoveryPlan {
  if (input.member.status !== "active" || input.member.removedAt !== null) {
    return { kind: "none" };
  }

  // The auth owner authoritatively reports this profile row as deleted.
  // There is nothing to repair locally, so never offer a connect/setup
  // recovery for it. Transient identity lookup failures do not take this
  // branch — they surface as "unavailable" profile evidence instead.
  if (memberReadinessHasAuthoritativeProfileNotFound(input.member)) {
    return { kind: "none" };
  }

  const profileName = normalizeRequiredLabel(input.member.profileName, "agent");

  if (!memberAllowsOwnerWakeDiagnosticsAction(input.member)) {
    return { kind: "none" };
  }

  if (isWakeableMemberReady(input.member)) {
    return { kind: "none" };
  }

  const reasonCode = resolvePrimaryRecoveryReasonCode({
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState ?? null,
    member: input.member,
    profileReplyReadinessEvidence: input.profileReplyReadinessEvidence ?? null,
  });
  if (
    reasonCode === null &&
    hasOnlyStaleComputerReasonsWhenCurrentLocalRuntimeReady({
      currentLocalRuntimeReplyState:
        input.currentLocalRuntimeReplyState ?? null,
      member: input.member,
      profileReplyReadinessEvidence:
        input.profileReplyReadinessEvidence ?? null,
    })
  ) {
    return { kind: "none" };
  }

  const executionReadinessPlan = planCurrentAgentExecutionRecovery({
    autoRefreshExhausted: input.autoRefreshExhausted === true,
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState ?? null,
    selectableLocalAgentTargets: input.selectableLocalAgentTargets ?? null,
    member: input.member,
    profileName,
    profileReplyReadinessEvidence: input.profileReplyReadinessEvidence ?? null,
    reasonCode,
  });
  if (executionReadinessPlan) {
    return executionReadinessPlan;
  }

  if (!resolveMemberLocalRecoveryReadiness(input.member)) {
    return { kind: "none" };
  }

  return planAgentProfileReplyRecoveryForReason({
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState ?? null,
    selectableLocalAgentTargets: input.selectableLocalAgentTargets ?? null,
    member: input.member,
    profileReplyReadinessEvidence: input.profileReplyReadinessEvidence ?? null,
    profileName,
    reasonCode,
  });
}

function planCurrentAgentExecutionRecovery(input: {
  autoRefreshExhausted: boolean;
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  selectableLocalAgentTargets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan | null {
  const readiness = resolveMemberLocalRecoveryReadiness(input.member);
  if (!readiness) {
    return null;
  }

  if (isRefreshableLocalReadinessEvidence(readiness, input.reasonCode)) {
    return { kind: "none" };
  }

  if (isAutoRefreshAgentExecution(readiness)) {
    return { kind: "none" };
  }

  return planAgentRecoveryFromExecutionPrimaryAction({
    autoRefreshExhausted: input.autoRefreshExhausted,
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
    selectableLocalAgentTargets: input.selectableLocalAgentTargets,
    member: input.member,
    primaryAction: readiness.primaryAction,
    profileName: input.profileName,
    profileReplyReadinessEvidence: input.profileReplyReadinessEvidence,
    reasonCode: input.reasonCode,
  });
}

function planAgentProfileReplyRecoveryForReason(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  selectableLocalAgentTargets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan {
  const { member, profileName, reasonCode } = input;
  const primaryActionPlan = planAgentRecoveryFromExecutionPrimaryAction({
    autoRefreshExhausted: false,
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
    selectableLocalAgentTargets: input.selectableLocalAgentTargets,
    member,
    primaryAction:
      resolveMemberLocalRecoveryReadiness(member)?.primaryAction ?? null,
    profileName,
    profileReplyReadinessEvidence: input.profileReplyReadinessEvidence,
    reasonCode,
  });
  if (primaryActionPlan) {
    return primaryActionPlan;
  }

  if (isUnboundAgentReasonCode(reasonCode)) {
    return planUnboundProfileRecovery({
      selectableLocalAgentTargets: input.selectableLocalAgentTargets,
      member,
      profileName,
      reasonCode,
    });
  }

  if (reasonCode === "controller.binding.disabled") {
    const disabledBindingPlan = planDisabledBindingRecovery({
      member,
      profileName,
      reasonCode,
    });
    if (disabledBindingPlan) {
      return disabledBindingPlan;
    }
  }

  if (isWakeableMemberReady(member) && reasonCode === null) {
    return { kind: "none" };
  }

  if (
    reasonCode !== null &&
    isPreparedAgentRouteReconnect({
      currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
      member,
      profileReplyReadinessEvidence: input.profileReplyReadinessEvidence,
      reasonCode,
    })
  ) {
    return planPreparedAgentRouteReconnectRecovery({
      member,
      profileName,
      reasonCode,
    });
  }

  if (isAgentProfilePreparationReasonCode(reasonCode)) {
    return planAgentProfilePreparationRecovery({
      member,
      profileName,
      reasonCode,
    });
  }

  if (reasonCode === null) {
    return { kind: "none" };
  }

  return planReviewComputerRecovery({ member, profileName, reasonCode });
}

function planAgentRecoveryFromExecutionPrimaryAction(input: {
  autoRefreshExhausted: boolean;
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  selectableLocalAgentTargets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
  primaryAction: AgentExecutionReadinessPrimaryAction | null;
  profileName: string;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan | null {
  if (input.reasonCode === "controller.binding.disabled") {
    const disabledBindingPlan = planDisabledBindingRecovery({
      member: input.member,
      profileName: input.profileName,
      reasonCode: input.reasonCode,
    });
    if (disabledBindingPlan) {
      return disabledBindingPlan;
    }
  }

  if (isControllerConversationConflictReasonCode(input.reasonCode)) {
    return planControllerConversationConflictRecovery({
      member: input.member,
      profileName: input.profileName,
      reasonCode: input.reasonCode,
    });
  }

  switch (input.primaryAction) {
    case "none":
      return { kind: "none" };
    case "connect_service":
      return planReviewComputerRecovery({
        member: input.member,
        profileName: input.profileName,
        reasonCode: "local_service.not_connected_for_account",
      });
    case "reconnect_binding":
      return planBindingRecoveryFromPrimaryAction(input);
    case "run_prepare":
      if (input.reasonCode === null) {
        return null;
      }
      if (isServiceOrConnectionReasonCode(input.reasonCode)) {
        return planReviewComputerRecovery({
          member: input.member,
          profileName: input.profileName,
          reasonCode: input.reasonCode,
        });
      }
      return planAgentProfilePreparationRecovery({
        member: input.member,
        profileName: input.profileName,
        reasonCode: input.reasonCode,
      });
    case "update_service":
      return planReviewComputerRecovery({
        member: input.member,
        profileName: input.profileName,
        reasonCode: "service.update_required",
      });
    case "fix_provider_account":
      if (input.reasonCode === null) {
        return null;
      }
      return planProviderAccountRecovery({
        member: input.member,
        profileName: input.profileName,
        reasonCode: input.reasonCode,
      });
    case "check_status":
      return planStatusRecoveryFromPrimaryAction(input);
    case null:
      return null;
    default:
      return null;
  }
}

function isControllerConversationConflictReasonCode(
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): reasonCode is AgentProfileReplyRecoveryReasonCode {
  return (
    reasonCode === "agent_profile_binding.controller_conversation_conflict"
  );
}

function planControllerConversationConflictRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan {
  const copy = resolveSharedRecoveryCopy(input);
  return {
    body: copy.body,
    kind: "review_agent_profile",
    ...createPrimaryAction("review_agent_settings"),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function planBindingRecoveryFromPrimaryAction(input: {
  selectableLocalAgentTargets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan {
  if (input.reasonCode === "controller.binding.disabled") {
    const disabledBindingPlan = planDisabledBindingRecovery({
      member: input.member,
      profileName: input.profileName,
      reasonCode: input.reasonCode,
    });
    if (disabledBindingPlan) {
      return disabledBindingPlan;
    }
  }

  return planUnboundProfileRecovery({
    selectableLocalAgentTargets: input.selectableLocalAgentTargets,
    member: input.member,
    profileName: input.profileName,
    reasonCode: input.reasonCode ?? "agent_profile_binding.missing",
  });
}

function planStatusRecoveryFromPrimaryAction(input: {
  autoRefreshExhausted: boolean;
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan {
  if (
    isAutoRefreshAgentExecution(
      resolveMemberLocalRecoveryReadiness(input.member)
    )
  ) {
    return { kind: "none" };
  }

  if (input.reasonCode === null) {
    return { kind: "none" };
  }

  if (isAgentProfileLocalReadinessRefreshReasonCode(input.reasonCode)) {
    return planAgentProfilePreparationRecovery({
      member: input.member,
      profileName: input.profileName,
      reasonCode: input.reasonCode,
    });
  }

  if (
    input.reasonCode !== null &&
    isPreparedAgentRouteReconnect({
      currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
      member: input.member,
      profileReplyReadinessEvidence: input.profileReplyReadinessEvidence,
      reasonCode: input.reasonCode,
    })
  ) {
    return planPreparedAgentRouteReconnectRecovery({
      member: input.member,
      profileName: input.profileName,
      reasonCode: input.reasonCode,
    });
  }

  return planReviewComputerRecovery({
    member: input.member,
    profileName: input.profileName,
    reasonCode: input.reasonCode,
  });
}

function isAutoRefreshAgentExecution(
  readiness: AgentProfileReplyRecoveryReadiness | null | undefined
): boolean {
  return Boolean(
    readiness?.primaryAction === "check_status" &&
      readiness.facts.localService.refreshable
  );
}

function isRefreshableLocalReadinessEvidence(
  readiness: AgentProfileReplyRecoveryReadiness,
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): boolean {
  if (!readiness.facts.localService.refreshable) {
    return false;
  }

  const reasonCodes = getAgentExecutionReadinessReasonCodes(
    readiness,
    reasonCode
  );
  if (reasonCodes.some(isAgentControllerReportRefreshReasonCode)) {
    return true;
  }

  return (
    readiness.primaryAction === "check_status" &&
    reasonCodes.includes("runtime.projection_missing")
  );
}

function getAgentExecutionReadinessReasonCodes(
  readiness: AgentProfileReplyRecoveryReadiness,
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): readonly string[] {
  return [
    ...(reasonCode ? [reasonCode] : []),
    ...readiness.reasonCodes,
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.localService.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.route.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ];
}

function isAgentControllerReportRefreshReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "agent_profile_binding.agent_controller_report_missing" ||
    reasonCode === "agent_profile_binding.agent_controller_report_stale" ||
    reasonCode === "runtime.agent_controller_report_missing" ||
    reasonCode === "runtime.agent_controller_report_stale" ||
    reasonCode === "claim_eligibility.agent_controller_report_missing" ||
    reasonCode === "claim_eligibility.agent_controller_report_stale"
  );
}

function resolveMemberLocalRecoveryReadiness(
  member: SpaceMemberAgentSnapshot
): AgentProfileReplyRecoveryReadiness | null {
  return member.ownerWakeDiagnostics?.agentExecutionReadiness ?? null;
}

function memberReadinessHasAuthoritativeProfileNotFound(
  member: SpaceMemberAgentSnapshot
): boolean {
  const readiness = resolveMemberLocalRecoveryReadiness(member);
  if (!readiness) {
    return false;
  }
  const profileFacts = readiness.facts.profile;
  return (
    profileFacts.source === "profile_identity" &&
    !profileFacts.active &&
    profileFacts.reasonCodes.some(
      (reasonCode) => reasonCode === "agent_profile.not_found"
    )
  );
}

function memberAllowsOwnerWakeDiagnosticsAction(
  member: SpaceMemberAgentSnapshot
): boolean {
  const state = member.ownerWakeDiagnostics?.state ?? null;
  return state === null || state === "action_required";
}

function isWakeableMemberReady(member: SpaceMemberAgentSnapshot): boolean {
  if (member.agentWakeAvailability?.status === "available_for_wake") {
    return true;
  }

  const readiness = resolveMemberLocalRecoveryReadiness(member);
  if (readiness) {
    return readiness.displayState === "ready";
  }

  return false;
}

function planUnboundProfileRecovery(input: {
  selectableLocalAgentTargets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan {
  const reconnectReasonCode = resolveExistingLocalSetupReconnectReasonCode(
    input.member
  );
  const isReconnect =
    reconnectReasonCode !== null &&
    resolveExistingLocalAgentConnection(input.member) !== null;
  const localAgent = findMatchingSelectableLocalAgentTarget({
    targets: input.selectableLocalAgentTargets,
    member: input.member,
  });
  const recoveryReasonCode = reconnectReasonCode ?? input.reasonCode;
  const copy = resolveSharedRecoveryCopy({
    profileName: input.profileName,
    reasonCode: recoveryReasonCode,
  });

  if (localAgent) {
    return {
      agentDisplayName: localAgent.displayName,
      agentId: localAgent.agentId,
      body: copy.body,
      agentControllerRef: localAgent.agentControllerRef,
      kind: "connect_controller",
      ...createPrimaryAction(
        isReconnect ? "reconnect_local_agent" : "connect_local_agent"
      ),
      profileId: input.member.profileId,
      profileName: input.profileName,
      recoveryReasonCode,
      secondaryLabel: copy.secondaryLabel,
      title: copy.title,
    };
  }

  return {
    body: copy.body,
    kind: "choose_controller",
    ...createPrimaryAction("choose_local_agent"),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function resolveExistingLocalSetupReconnectReasonCode(
  member: SpaceMemberAgentSnapshot
): AgentProfileReplyRecoveryReasonCode | null {
  const readiness = resolveMemberLocalRecoveryReadiness(member);
  if (readiness?.primaryAction !== "reconnect_binding") {
    return null;
  }
  const claimReasonCode = readiness.facts.claim.reasonCodes.find(
    isExistingLocalSetupReconnectReason
  );
  if (claimReasonCode) {
    return claimReasonCode;
  }
  return (
    resolveMemberReadinessReasonCodes(member).find(
      isExistingLocalSetupReconnectReason
    ) ?? null
  );
}

function isExistingLocalSetupReconnectReason(reasonCode: string): boolean {
  return (
    reasonCode === "claim_eligibility.binding_capability_mismatch" ||
    reasonCode === "claim_eligibility.binding_owner_mismatch" ||
    reasonCode === "claim_eligibility.binding_runtime_mismatch" ||
    reasonCode === "claim_eligibility.owner_mismatch" ||
    reasonCode === "claim_eligibility.openmeld_service_runtime_id_mismatch" ||
    reasonCode === "local_service.identity_mismatch"
  );
}

function planDisabledBindingRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan | null {
  const localAgentConnection = resolveExistingLocalAgentConnection(
    input.member
  );
  if (!localAgentConnection) {
    return null;
  }
  const copy = resolveSharedRecoveryCopy(input);

  return {
    body: copy.body,
    agentControllerRef: localAgentConnection.agentControllerRef,
    kind: "turn_on_controller",
    ...createPrimaryAction("turn_on_local_agent"),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function planAgentProfilePreparationRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan {
  if (isServiceOrConnectionReasonCode(input.reasonCode)) {
    return planReviewComputerRecovery(input);
  }
  const copy = resolveSharedRecoveryCopy(input);

  return {
    body: copy.body,
    kind: "prepare_agent_profile",
    ...createPrimaryAction(
      input.reasonCode === "controller.client.upgrade_required"
        ? "manage_local_agent"
        : "connect_local_agent"
    ),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function planPreparedAgentRouteReconnectRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan {
  const copy = resolveSharedRecoveryCopy(input);
  return {
    body: copy.body,
    kind: "review_computer",
    ...createPrimaryAction("check_status"),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function planProviderAccountRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): AgentProfileReplyRecoveryPlan {
  const copy = resolveSharedRecoveryCopy({
    profileName: input.profileName,
    reasonCode: input.reasonCode,
  });

  return {
    body: copy.body,
    kind: "review_provider_account",
    ...createPrimaryAction("review_agent_settings"),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: input.reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function planReviewComputerRecovery(input: {
  member: SpaceMemberAgentSnapshot;
  profileName: string;
  reasonCode: AgentProfileReplyRecoveryReasonCode | null;
}): AgentProfileReplyRecoveryPlan {
  const reasonCode = input.reasonCode ?? "unknown";
  const copy = resolveSharedRecoveryCopy({
    profileName: input.profileName,
    reasonCode,
  });
  return {
    body: copy.body,
    kind: "review_computer",
    ...createPrimaryAction(resolveReviewComputerActionId(input.reasonCode)),
    profileId: input.member.profileId,
    profileName: input.profileName,
    recoveryReasonCode: reasonCode,
    secondaryLabel: copy.secondaryLabel,
    title: copy.title,
  };
}

function resolveReviewComputerActionId(
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): AgentRecoveryActionId {
  switch (reasonCode) {
    case "service.not_installed":
      return "connect_openmeld_service";
    case "service.update_required":
    case "service.drifted":
      return "update_openmeld_service";
    case "service.not_running":
    case "local_service.identity_mismatch":
    case "local_service.not_connected_for_account":
    case "local_service.unavailable":
      return "reconnect_openmeld_service";
    case "agent_execution.route_missing":
    case "agent_execution.route_offline":
    case "agent_execution.route_unavailable":
    case "route.not_registered":
    case "route.offline":
    case "route.unavailable":
      return "check_status";
    default:
      return "reconnect_openmeld_service";
  }
}

function isAgentProfilePreparationReasonCode(
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): reasonCode is AgentProfileReplyRecoveryReasonCode {
  return (
    reasonCode !== null &&
    AGENT_PROFILE_PREPARATION_REASON_CODES.has(reasonCode)
  );
}

function isServiceOrConnectionReasonCode(
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): reasonCode is AgentProfileReplyRecoveryReasonCode {
  return (
    reasonCode !== null && SERVICE_OR_CONNECTION_REASON_CODES.has(reasonCode)
  );
}

function isPreparedAgentRouteReconnect(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  member: SpaceMemberAgentSnapshot;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): boolean {
  const currentLocalRuntimeIsReady =
    input.currentLocalRuntimeReplyState === "ready";
  const profileIsReady =
    input.profileReplyReadinessEvidence?.level === "ready" ||
    hasReadyAgentExecutionEvidenceExceptRoute(input.member);

  return (
    (currentLocalRuntimeIsReady || profileIsReady) &&
    ROUTE_RECONNECT_REASON_CODES.has(input.reasonCode)
  );
}

function hasReadyAgentExecutionEvidenceExceptRoute(
  member: SpaceMemberAgentSnapshot
): boolean {
  const readiness = resolveMemberLocalRecoveryReadiness(member);
  return Boolean(
    readiness?.facts.binding.routable &&
      readiness.facts.runtime.ready &&
      !readiness.facts.claim.executionBlocked
  );
}

function resolveMemberReadinessReasonCodes(
  member: SpaceMemberAgentSnapshot
): readonly AgentProfileReplyRecoveryReasonCode[] {
  const readiness = resolveMemberLocalRecoveryReadiness(member);
  if (!readiness) {
    return [];
  }

  return [
    ...readiness.facts.profile.reasonCodes,
    ...readiness.facts.binding.reasonCodes,
    ...readiness.facts.claim.reasonCodes,
    ...readiness.facts.localService.reasonCodes,
    ...readiness.facts.service.reasonCodes,
    ...readiness.facts.route.reasonCodes,
    ...readiness.facts.runtime.reasonCodes,
  ];
}

function isUnboundAgentReasonCode(
  reasonCode: AgentProfileReplyRecoveryReasonCode | null
): reasonCode is AgentProfileReplyRecoveryReasonCode {
  return reasonCode !== null && UNBOUND_AGENT_REASON_CODES.has(reasonCode);
}

function resolvePrimaryRecoveryReasonCode(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  member: SpaceMemberAgentSnapshot;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
}): AgentProfileReplyRecoveryReasonCode | null {
  const memberReasonCodes = resolveMemberReadinessReasonCodes(input.member);
  const readinessReasonCodes = input.profileReplyReadinessEvidence?.reasonCodes;
  const memberReasonCode = resolvePrimaryReasonCodeFromList({
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
    reasonCodes: memberReasonCodes,
  });
  if (memberReasonCode) {
    return memberReasonCode;
  }

  return resolvePrimaryReasonCodeFromList({
    currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
    reasonCodes: readinessReasonCodes ?? [],
  });
}

function resolvePrimaryReasonCodeFromList(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  reasonCodes: readonly AgentProfileReplyRecoveryReasonCode[];
}): AgentProfileReplyRecoveryReasonCode | null {
  for (const reasonCode of PRIMARY_RECOVERY_REASON_CODES) {
    if (
      input.reasonCodes.includes(reasonCode) &&
      !isStaleComputerReasonWhenCurrentLocalRuntimeReady({
        currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
        reasonCode,
      })
    ) {
      return reasonCode;
    }
  }
  return (
    input.reasonCodes.find(
      (reasonCode) =>
        reasonCode.trim().length > 0 &&
        !isStaleComputerReasonWhenCurrentLocalRuntimeReady({
          currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
          reasonCode,
        })
    ) ?? null
  );
}

function isStaleComputerReasonWhenCurrentLocalRuntimeReady(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  reasonCode: AgentProfileReplyRecoveryReasonCode;
}): boolean {
  return (
    input.currentLocalRuntimeReplyState === "ready" &&
    STALE_WHEN_COMPUTER_READY_REASON_CODES.has(input.reasonCode)
  );
}

function hasOnlyStaleComputerReasonsWhenCurrentLocalRuntimeReady(input: {
  currentLocalRuntimeReplyState: AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null;
  member: SpaceMemberAgentSnapshot;
  profileReplyReadinessEvidence: AgentProfileReplyReadinessEvidence | null;
}): boolean {
  const reasonCodes = [
    ...resolveMemberReadinessReasonCodes(input.member),
    ...(input.profileReplyReadinessEvidence?.reasonCodes ?? []),
  ];
  return (
    reasonCodes.length > 0 &&
    reasonCodes.every((reasonCode) =>
      isStaleComputerReasonWhenCurrentLocalRuntimeReady({
        currentLocalRuntimeReplyState: input.currentLocalRuntimeReplyState,
        reasonCode,
      })
    )
  );
}

function findMatchingSelectableLocalAgentTarget(input: {
  targets: readonly SelectableLocalAgentTarget[] | null;
  member: SpaceMemberAgentSnapshot;
}): SelectableLocalAgentTarget | null {
  if (!input.targets) {
    return null;
  }

  const existingConnection = resolveExistingLocalAgentConnection(input.member);
  if (existingConnection) {
    const matchingBoundTarget = input.targets.find((target) =>
      isSameController({
        target,
        agentControllerRef: existingConnection.agentControllerRef,
      })
    );
    return normalizeSelectableLocalAgentTarget(matchingBoundTarget ?? null);
  }

  return null;
}

function normalizeSelectableLocalAgentTarget(
  target: SelectableLocalAgentTarget | null
): SelectableLocalAgentTarget | null {
  if (!target) {
    return null;
  }

  const agentControllerRef = canonicalizeAgentControllerRef(
    target.agentControllerRef
  );
  if (!agentControllerRef) {
    return null;
  }

  return {
    ...target,
    agentControllerRef,
  };
}

function resolveExistingLocalAgentConnection(
  member: SpaceMemberAgentSnapshot
): {
  agentControllerRef: string;
} | null {
  const agentControllerRef = canonicalizeAgentControllerRef(
    member.agentControllerRef ?? ""
  );
  if (!agentControllerRef) {
    return null;
  }

  return {
    agentControllerRef,
  };
}

function isSameController(input: {
  agentControllerRef: string;
  target: SelectableLocalAgentTarget;
}): boolean {
  const targetAgentControllerRef = canonicalizeAgentControllerRef(
    input.target.agentControllerRef
  );
  return targetAgentControllerRef === input.agentControllerRef;
}

function normalizeRequiredLabel(
  value: string | null | undefined,
  fallback: string
) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}
