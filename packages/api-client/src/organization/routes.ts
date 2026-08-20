export function buildCurrentOrganizationDirectoryPath(): string {
  return "/v1/organizations/current/directory";
}

export function buildCurrentOrganizationComputersPath(): string {
  return "/v1/organizations/current/computers";
}

export function buildCurrentOrganizationMemberOpenMeldServiceStatusesPath(): string {
  return "/v1/organizations/current/member-openmeld-service-statuses";
}

export function buildCurrentOrganizationSpacesPath(): string {
  return "/v1/organizations/current/spaces";
}

export function buildCurrentOrganizationSpacesWithMemberCountsPath(): string {
  return "/v1/organizations/current/spaces-with-member-counts";
}

export function buildCurrentOrganizationMessageChannelsPath(): string {
  return "/v1/organizations/current/message-channels";
}

export function buildCurrentOrganizationMessageChannelIdentityLinkPath(
  identityLinkId: string
): string {
  return `${buildCurrentOrganizationMessageChannelsPath()}/identity-links/${encodeURIComponent(identityLinkId)}`;
}

export function buildCurrentOrganizationMessageChannelRegistrationsPath(): string {
  return `${buildCurrentOrganizationMessageChannelsPath()}/registrations`;
}

export function buildMessageChannelIdentityLinkPreviewPath(): string {
  return "/v1/message-channels/identity-link/preview";
}

export function buildMessageChannelIdentityLinkConsumePath(): string {
  return "/v1/message-channels/identity-link/consume";
}

export function buildCurrentOrganizationMessageChannelPath(
  provider: string
): string {
  return `${buildCurrentOrganizationMessageChannelsPath()}/${encodeURIComponent(provider)}`;
}

export function buildCurrentOrganizationMessageChannelRegistrationPath(
  provider: string
): string {
  return `${buildCurrentOrganizationMessageChannelPath(provider)}/registration-attempts`;
}

export function buildCurrentOrganizationMessageChannelRegistrationPollPath(
  provider: string,
  attemptId: string
): string {
  return `${buildCurrentOrganizationMessageChannelRegistrationPath(provider)}/${encodeURIComponent(attemptId)}/poll`;
}

export function buildCurrentOrganizationLogoPath(): string {
  return "/v1/organizations/current/logo";
}

export function buildCurrentOrganizationCenterAgentMemoryWipeSelfPath(): string {
  return "/v1/organizations/current/center-agent-memory/wipe-self";
}

export function buildCurrentOrganizationCenterAgentMemoryPolicyPath(): string {
  return "/v1/organizations/current/center-agent-memory/organization-policy";
}

export function buildCurrentOrganizationInformationProtectionPath(): string {
  return "/v1/organizations/current/information-protection";
}

export function buildOrganizationBindingAuthorizationsBulkPath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/binding-authorizations/bulk`;
}

export function buildOrganizationBindingAuthorizationProfilesPath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/binding-authorizations/profiles`;
}

export function buildOrganizationBindingAuthorizationPreferencePath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/binding-authorization-preference`;
}

export function buildAgentProfileCreationDefaultsPath(
  organizationId: string,
  agentControllerRef: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/agent-profile-creation-defaults/${encodeURIComponent(agentControllerRef)}`;
}

export function buildAgentProfileCreationRequestsPath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/agent-profile-creation-requests`;
}

export function buildAgentProfileCreationRequestPath(
  organizationId: string,
  requestId: string
): string {
  return `${buildAgentProfileCreationRequestsPath(organizationId)}/${encodeURIComponent(requestId)}`;
}

export function buildAgentProfileCreationRequestDecisionPath(
  organizationId: string,
  requestId: string
): string {
  return `${buildAgentProfileCreationRequestPath(organizationId, requestId)}/decision`;
}

export function buildAgentProfileCreationRequestCancelPath(
  organizationId: string,
  requestId: string
): string {
  return `${buildAgentProfileCreationRequestPath(organizationId, requestId)}/cancel`;
}

export function buildAgentProfileCreationRequestRetryPath(
  organizationId: string,
  requestId: string
): string {
  return `${buildAgentProfileCreationRequestPath(organizationId, requestId)}/retry`;
}

export function buildAgentProfileCreationApprovalPreferencePath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/agent-profile-creation-approval-preference`;
}

export function buildOrganizationWakeAccessChoicePath(
  organizationId: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/wake-access-choice`;
}
