export function buildAgentProfilePrimaryBindingRoute(
  agentProfileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(agentProfileId)}/primary-binding`;
}

export function buildCurrentAgentProfileSessionRoute(input: {
  agentControllerConversationId: string;
  agentControllerRef: string;
}): string {
  const query = new URLSearchParams({
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerRef: input.agentControllerRef,
  });
  return `/v1/agent-profiles/current-session?${query.toString()}`;
}

export function buildAgentProfileControllerChangeEligibilityRoute(
  agentProfileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(agentProfileId)}/controller-change-eligibility`;
}

export function buildAgentProfilePrimaryBindingModelSelectionRoute(
  agentProfileId: string
): string {
  return `${buildAgentProfilePrimaryBindingRoute(agentProfileId)}/model-selection`;
}

export function buildAgentProfilePrimaryBindingAgentControllerPermissionModeRoute(
  agentProfileId: string
): string {
  return `${buildAgentProfilePrimaryBindingRoute(agentProfileId)}/agent-controller-permission-mode`;
}

export function buildAgentProfilePrimaryBindingAgentControllerCollaborationModeRoute(
  agentProfileId: string
): string {
  return `${buildAgentProfilePrimaryBindingRoute(agentProfileId)}/agent-controller-collaboration-mode`;
}

export function buildAgentProfilePrimaryBindingOpenCodePermissionRoute(
  agentProfileId: string
): string {
  return `${buildAgentProfilePrimaryBindingRoute(agentProfileId)}/opencode-permission`;
}

export function buildAgentProfilePrimaryBindingOrganizationAuthorizationRoute(
  agentProfileId: string
): string {
  return `${buildAgentProfilePrimaryBindingRoute(agentProfileId)}/organization-authorization`;
}

export function buildAgentProfileBindingOrganizationAuthorizationsRoute(): string {
  return "/v1/agent-profiles/primary-bindings/organization-authorizations";
}

export function buildCurrentUserAgentProfileOrganizationWakeAccessRoute(): string {
  return "/v1/agent-profiles/primary-bindings/organization-wake-access";
}

export function buildAgentProfileRouteCatalogSyncRoute(
  agentProfileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(agentProfileId)}/route-catalog-sync`;
}

export function buildAgentProfilesRouteCatalogSyncRoute(): string {
  return "/v1/agent-profiles/route-catalog-sync";
}

export function buildAgentExecutionReadinessRoute(
  agentProfileId: string
): string {
  return `/v1/agent-profiles/${encodeURIComponent(agentProfileId)}/execution-readiness`;
}

export function buildAgentExecutionReadinessBatchRoute(): string {
  return "/v1/agent-profiles/execution-readiness/batch";
}
