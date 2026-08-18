import type {
  BulkAuthorizeAgentProfileBindingsForOrganizationBody,
  BulkAuthorizeAgentProfileBindingsForOrganizationResponse,
  CenterAgentOrganizationMemoryPolicyResponse,
  CenterAgentWipeMemberMemoryResponse,
  GetAgentProfileCreationDefaultsResponse,
  GetOrganizationBindingAuthorizationPreferenceResponse,
  LarkPlatformActiveRegistrationListResponse,
  LarkPlatformProvider,
  LarkPlatformRegistrationBeginMode,
  LarkPlatformRegistrationResponse,
  ListOrganizationBindingAuthorizationProfilesResponse,
  MessageChannelConnectionListResponse,
  MessageChannelIdentityLinkConsumeBody,
  MessageChannelIdentityLinkConsumeResponse,
  MessageChannelIdentityLinkPreviewBody,
  MessageChannelIdentityLinkPreviewResponse,
  OpenMeldRequestContext,
  OrganizationComputersResponse,
  OrganizationDirectoryResponse,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationLogoMimeType,
  OrganizationLogoResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  SaveOrganizationWakeAccessChoiceBody,
  SaveOrganizationWakeAccessChoiceResponse,
  SetAgentProfileCreationDefaultsBody,
  SetAgentProfileCreationDefaultsResponse,
  SetOrganizationBindingAuthorizationPreferenceBody,
  SetOrganizationBindingAuthorizationPreferenceResponse,
  UpdateCenterAgentOrganizationMemoryPolicyBody,
  UpdateOrganizationInformationProtectionPolicyBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OrganizationRouteInput = OrganizationRequestInput & {
  organizationId: string;
};

export type UpdateCurrentOrganizationLogoInput = OrganizationRequestInput & {
  bytes: ArrayBuffer | Blob | Uint8Array;
  mimeType: OrganizationLogoMimeType;
};

export type BulkAuthorizeAgentProfileBindingsForOrganizationInput =
  OrganizationRouteInput & BulkAuthorizeAgentProfileBindingsForOrganizationBody;

export type SetOrganizationBindingAuthorizationPreferenceInput =
  OrganizationRouteInput & SetOrganizationBindingAuthorizationPreferenceBody;

export type AgentProfileCreationDefaultsRouteInput = OrganizationRouteInput & {
  agentControllerRef: string;
};

export type SetAgentProfileCreationDefaultsInput =
  AgentProfileCreationDefaultsRouteInput & SetAgentProfileCreationDefaultsBody;

export type SaveOrganizationWakeAccessChoiceInput = OrganizationRouteInput &
  SaveOrganizationWakeAccessChoiceBody;

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

export type OrganizationApi = {
  getAgentProfileCreationDefaults: (
    input: AgentProfileCreationDefaultsRouteInput
  ) => Promise<GetAgentProfileCreationDefaultsResponse>;
  updateCurrentLogo: (
    input: UpdateCurrentOrganizationLogoInput
  ) => Promise<OrganizationLogoResponse>;
  removeCurrentLogo: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationLogoResponse>;
  bulkAuthorizeAgentProfileBindings: (
    input: BulkAuthorizeAgentProfileBindingsForOrganizationInput
  ) => Promise<BulkAuthorizeAgentProfileBindingsForOrganizationResponse>;
  getBindingAuthorizationPreference: (
    input: OrganizationRouteInput
  ) => Promise<GetOrganizationBindingAuthorizationPreferenceResponse>;
  listBindingAuthorizationProfiles: (
    input: OrganizationRouteInput
  ) => Promise<ListOrganizationBindingAuthorizationProfilesResponse>;
  getCurrentDirectory: (
    input?: OrganizationRequestInput
  ) => Promise<OrganizationDirectoryResponse>;
  getCurrentComputers: (
    input?: OrganizationRequestInput
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
  setBindingAuthorizationPreference: (
    input: SetOrganizationBindingAuthorizationPreferenceInput
  ) => Promise<SetOrganizationBindingAuthorizationPreferenceResponse>;
  setAgentProfileCreationDefaults: (
    input: SetAgentProfileCreationDefaultsInput
  ) => Promise<SetAgentProfileCreationDefaultsResponse>;
  saveWakeAccessChoice: (
    input: SaveOrganizationWakeAccessChoiceInput
  ) => Promise<SaveOrganizationWakeAccessChoiceResponse>;
};

export type CreateOrganizationApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationApi;
