import {
  ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
} from "@openmeld/gateway-contract";
import type { AgentProfileCreationRequestSelector } from "@openmeld/schemas/types";

export function buildCurrentOrganizationDirectoryPath(input?: {
  agentProfileWorkRecoveryVersion?: 2;
  includeMemberLastActiveAt?: boolean;
}): string {
  const path = "/v1/organizations/current/directory";
  const query = new URLSearchParams();
  if (input?.agentProfileWorkRecoveryVersion === 2) {
    query.set(
      ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER,
      "2"
    );
  }
  if (input?.includeMemberLastActiveAt === true) {
    query.set(
      ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
      "true"
    );
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function buildCurrentOrganizationComputersPath(input?: {
  includeUsageLimits?: "true";
}): string {
  const path = "/v1/organizations/current/computers";
  return input?.includeUsageLimits === "true"
    ? `${path}?includeUsageLimits=true`
    : path;
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

export function buildCurrentOrganizationMessageChannelSetupRequestsPath(): string {
  return `${buildCurrentOrganizationMessageChannelsPath()}/setup-requests`;
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

export function buildAgentProfileCreationDefaultsPath(
  organizationId: string,
  agentControllerRef: string
): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/agent-profile-creation-defaults/${encodeURIComponent(agentControllerRef)}`;
}

export function buildAgentProfileCreationRequestsPath(
  organizationId: string,
  selector?: AgentProfileCreationRequestSelector
): string {
  const path = `/v1/organizations/${encodeURIComponent(organizationId)}/agent-profile-creation-requests`;
  const query = new URLSearchParams();
  if (selector?.requestId) {
    query.set("requestId", selector.requestId);
  }
  if (selector?.idempotencyKey) {
    query.set("idempotencyKey", selector.idempotencyKey);
  }
  return query.size ? `${path}?${query}` : path;
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
