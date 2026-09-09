import type {
  AgentProfileCreationRequestMutationResponse,
  AgentProfileCreationRequestSelector,
  CenterAgentOrganizationMemoryPolicyResponse,
  CenterAgentWipeMemberMemoryResponse,
  CreateAgentProfileCreationRequestBody,
  CreateAgentProfileCreationRequestResponse,
  DecideAgentProfileCreationRequestBody,
  GetAgentProfileCreationApprovalPreferenceResponse,
  GetAgentProfileCreationDefaultsResponse,
  LarkPlatformActiveRegistrationListResponse,
  LarkPlatformProvider,
  LarkPlatformRegistrationBeginMode,
  LarkPlatformRegistrationResponse,
  ListAgentProfileCreationRequestsResponse,
  MessageChannelConnectionListResponse,
  MessageChannelIdentityLinkConsumeBody,
  MessageChannelIdentityLinkConsumeResponse,
  MessageChannelIdentityLinkPreviewBody,
  MessageChannelIdentityLinkPreviewResponse,
  MessageChannelSetupRequestBody,
  MessageChannelSetupRequestResponse,
  OpenMeldRequestContext,
  OrganizationComputersResponse,
  OrganizationDirectoryResponse,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationLogoMimeType,
  OrganizationLogoResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  SetAgentProfileCreationApprovalPreferenceBody,
  SetAgentProfileCreationApprovalPreferenceResponse,
  SetAgentProfileCreationDefaultsBody,
  SetAgentProfileCreationDefaultsResponse,
  UpdateCenterAgentOrganizationMemoryPolicyBody,
  UpdateOrganizationInformationProtectionPolicyBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OrganizationComputersRequestInput = OrganizationRequestInput & {
  includeUsageLimits?: "true";
};

export type OrganizationRouteInput = OrganizationRequestInput & {
  organizationId: string;
};

export type GetCurrentOrganizationDirectoryInput = OrganizationRequestInput & {
  agentProfileWorkRecoveryVersion?: 2;
  includeMemberLastActiveAt?: boolean;
};

export type UpdateCurrentOrganizationLogoInput = OrganizationRequestInput & {
  bytes: ArrayBuffer | Blob | Uint8Array;
  mimeType: OrganizationLogoMimeType;
};

export type AgentProfileCreationDefaultsRouteInput = OrganizationRouteInput & {
  agentControllerRef: string;
};

export type SetAgentProfileCreationDefaultsInput =
  AgentProfileCreationDefaultsRouteInput & SetAgentProfileCreationDefaultsBody;

export type CreateAgentProfileCreationRequestInput = OrganizationRouteInput &
  CreateAgentProfileCreationRequestBody;

export type AgentProfileCreationRequestRouteInput = OrganizationRouteInput & {
  requestId: string;
};

export type DecideAgentProfileCreationRequestInput =
  AgentProfileCreationRequestRouteInput & DecideAgentProfileCreationRequestBody;

export type SetAgentProfileCreationApprovalPreferenceInput =
  OrganizationRouteInput & SetAgentProfileCreationApprovalPreferenceBody;

export type SetCenterAgentOrganizationMemoryPolicyInput =
  OrganizationRequestInput & UpdateCenterAgentOrganizationMemoryPolicyBody;

export type SetOrganizationInformationProtectionInput =
  OrganizationRequestInput & UpdateOrganizationInformationProtectionPolicyBody;

export type BeginLarkPlatformRegistrationInput = OrganizationRequestInput & {
  mode?: LarkPlatformRegistrationBeginMode;
  provider: LarkPlatformProvider;
};

export type PollLarkPlatformRegistrationInput =
  BeginLarkPlatformRegistrationInput & {
    attemptId: string;
  };

export type MessageChannelIdentityLinkPreviewInput = OrganizationRequestInput &
  MessageChannelIdentityLinkPreviewBody;

export type MessageChannelIdentityLinkConsumeInput = OrganizationRequestInput &
  MessageChannelIdentityLinkConsumeBody;

export type DisconnectMessageChannelIdentityLinkInput =
  OrganizationRequestInput & {
    identityLinkId: string;
  };

export type RequestMessageChannelSetupInput = OrganizationRequestInput &
  MessageChannelSetupRequestBody;

export type OrganizationApi = {
  createAgentProfileCreationRequest: (
    input: CreateAgentProfileCreationRequestInput
  ) => Promise<CreateAgentProfileCreationRequestResponse>;
  listAgentProfileCreationRequests: (
    input: OrganizationRouteInput & AgentProfileCreationRequestSelector
  ) => Promise<ListAgentProfileCreationRequestsResponse>;
  decideAgentProfileCreationRequest: (
    input: DecideAgentProfileCreationRequestInput
  ) => Promise<AgentProfileCreationRequestMutationResponse>;
  cancelAgentProfileCreationRequest: (
    input: AgentProfileCreationRequestRouteInput
  ) => Promise<AgentProfileCreationRequestMutationResponse>;
  retryAgentProfileCreationRequest: (
    input: AgentProfileCreationRequestRouteInput
  ) => Promise<AgentProfileCreationRequestMutationResponse>;
  getAgentProfileCreationApprovalPreference: (
    input: OrganizationRouteInput
  ) => Promise<GetAgentProfileCreationApprovalPreferenceResponse>;
  setAgentProfileCreationApprovalPreference: (
    input: SetAgentProfileCreationApprovalPreferenceInput
  ) => Promise<SetAgentProfileCreationApprovalPreferenceResponse>;
  getAgentProfileCreationDefaults: (
    input: AgentProfileCreationDefaultsRouteInput
  ) => Promise<GetAgentProfileCreationDefaultsResponse>;
  updateCurrentLogo: (
    input: UpdateCurrentOrganizationLogoInput
  ) => Promise<OrganizationLogoResponse>;
  removeCurrentLogo: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationLogoResponse>;
  getCurrentDirectory: (
    input?: GetCurrentOrganizationDirectoryInput
  ) => Promise<OrganizationDirectoryResponse>;
  getCurrentComputers: (
    input?: OrganizationComputersRequestInput
  ) => Promise<OrganizationComputersResponse>;
  getCurrentMemberOpenMeldServiceStatuses: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationMemberOpenMeldServiceStatusesResponse>;
  listCurrentSpaces: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationSpaceDirectoryResponse>;
  listCurrentSpacesWithMemberCounts: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationSpaceDirectoryWithMemberCountsResponse>;
  listCurrentMessageChannels: (
    input?: OrganizationRequestInput
  ) => Promise<MessageChannelConnectionListResponse>;
  requestMessageChannelSetup: (
    input: RequestMessageChannelSetupInput
  ) => Promise<MessageChannelSetupRequestResponse>;
  listCurrentLarkPlatformRegistrations: (
    input?: OrganizationRequestInput
  ) => Promise<LarkPlatformActiveRegistrationListResponse>;
  previewMessageChannelIdentityLink: (
    input: MessageChannelIdentityLinkPreviewInput
  ) => Promise<MessageChannelIdentityLinkPreviewResponse>;
  consumeMessageChannelIdentityLink: (
    input: MessageChannelIdentityLinkConsumeInput
  ) => Promise<MessageChannelIdentityLinkConsumeResponse>;
  beginLarkPlatformRegistration: (
    input: BeginLarkPlatformRegistrationInput
  ) => Promise<LarkPlatformRegistrationResponse>;
  pollLarkPlatformRegistration: (
    input: PollLarkPlatformRegistrationInput
  ) => Promise<LarkPlatformRegistrationResponse>;
  disconnectLarkPlatform: (
    input: BeginLarkPlatformRegistrationInput
  ) => Promise<MessageChannelConnectionListResponse>;
  disconnectMessageChannelIdentityLink: (
    input: DisconnectMessageChannelIdentityLinkInput
  ) => Promise<MessageChannelConnectionListResponse>;
  wipeCurrentMemberCenterAgentMemory: (
    input?: OrganizationRequestInput
  ) => Promise<CenterAgentWipeMemberMemoryResponse>;
  readCurrentOrganizationCenterAgentMemoryPolicy: (
    input?: OrganizationRequestInput
  ) => Promise<CenterAgentOrganizationMemoryPolicyResponse>;
  setCurrentOrganizationCenterAgentMemoryPolicy: (
    input: SetCenterAgentOrganizationMemoryPolicyInput
  ) => Promise<CenterAgentOrganizationMemoryPolicyResponse>;
  readCurrentInformationProtection: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationInformationProtectionPolicyResponse>;
  setCurrentInformationProtection: (
    input: SetOrganizationInformationProtectionInput
  ) => Promise<OrganizationInformationProtectionPolicyResponse>;
  setAgentProfileCreationDefaults: (
    input: SetAgentProfileCreationDefaultsInput
  ) => Promise<SetAgentProfileCreationDefaultsResponse>;
};

export type CreateOrganizationApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationApi;
