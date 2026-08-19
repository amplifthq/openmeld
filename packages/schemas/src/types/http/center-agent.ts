import type { z } from "zod/v4";

type CenterAgentActionSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentActionSchema"];
type CenterAgentRecordConnectorActionAuditBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRecordConnectorActionAuditBodySchema"];
type CenterAgentRecordConnectorActionAuditResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRecordConnectorActionAuditResponseSchema"];
type CenterAgentRecordConnectorActionOperationBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRecordConnectorActionOperationBodySchema"];
type CenterAgentRecordConnectorActionOperationResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRecordConnectorActionOperationResponseSchema"];
type CenterAgentReadConnectorActionOperationBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadConnectorActionOperationBodySchema"];
type CenterAgentReadConnectorActionOperationResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadConnectorActionOperationResponseSchema"];
type CenterAgentConnectorActionOperationStatusSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentConnectorActionOperationStatusSchema"];
type CenterAgentConnectorActionExecutionConnectionSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentConnectorActionExecutionConnectionSchema"];
type CenterAgentCheckAgentProfileReadinessBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCheckAgentProfileReadinessBodySchema"];
type CenterAgentCheckAgentProfileReadinessResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCheckAgentProfileReadinessResponseSchema"];
type CenterAgentConnectAgentProfileToLocalAgentBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentConnectAgentProfileToLocalAgentBodySchema"];
type CenterAgentConnectAgentProfileToLocalAgentResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentConnectAgentProfileToLocalAgentResponseSchema"];
type CenterAgentAddAgentProfilesToSpaceBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAddAgentProfilesToSpaceBodySchema"];
type CenterAgentAddAgentProfilesToSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAddAgentProfilesToSpaceResponseSchema"];
type CenterAgentAddMembersToSpaceBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAddMembersToSpaceBodySchema"];
type CenterAgentAddMembersToSpaceResultSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAddMembersToSpaceResultSchema"];
type CenterAgentAddMembersToSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAddMembersToSpaceResponseSchema"];
type CenterAgentRemoveAgentProfilesFromSpaceBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRemoveAgentProfilesFromSpaceBodySchema"];
type CenterAgentRemoveAgentProfilesFromSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRemoveAgentProfilesFromSpaceResponseSchema"];
type CenterAgentAttributionSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentAttributionSchema"];
type CenterAgentCreateAgentProfileBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateAgentProfileBodySchema"];
type CenterAgentCreateAgentProfileResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateAgentProfileResponseSchema"];
type CenterAgentCreateConfiguredAgentProfileBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateConfiguredAgentProfileBodySchema"];
type CenterAgentCreateConfiguredAgentProfileResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateConfiguredAgentProfileResponseSchema"];
type CenterAgentCreateSpaceBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateSpaceBodySchema"];
type CenterAgentCreateSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentCreateSpaceResponseSchema"];
type CenterAgentDelegationCompletionModeSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentDelegationCompletionModeSchema"];
type CenterAgentDesignationSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentDesignationSchema"];
type CenterAgentModelConfigurationResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentModelConfigurationResponseSchema"];
type CenterAgentDispatchHistoryEntrySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentDispatchHistoryEntrySchema"];
type CenterAgentDispatchHistoryLatestAttemptSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentDispatchHistoryLatestAttemptSchema"];
type CenterAgentEnableAgentProfileBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentEnableAgentProfileBodySchema"];
type CenterAgentEnableAgentProfileResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentEnableAgentProfileResponseSchema"];
type CenterAgentInviteMemberBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentInviteMemberBodySchema"];
type CenterAgentInviteMemberResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentInviteMemberResponseSchema"];
type CenterAgentComputerSetupOptionSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentComputerSetupOptionSchema"];
type CenterAgentListComputersBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListComputersBodySchema"];
type CenterAgentListComputersResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListComputersResponseSchema"];
type CenterAgentReadMemberComputersBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadMemberComputersBodySchema"];
type CenterAgentReadMemberComputersResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadMemberComputersResponseSchema"];
type CenterAgentListLocalAgentConnectionCandidatesBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListLocalAgentConnectionCandidatesBodySchema"];
type CenterAgentListLocalAgentConnectionCandidatesResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListLocalAgentConnectionCandidatesResponseSchema"];
type CenterAgentLocalAgentConnectionCandidateSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentLocalAgentConnectionCandidateSchema"];
type CenterAgentOnBehalfOfInputSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentOnBehalfOfInputSchema"];
type CenterAgentOperatingStateSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentOperatingStateSchema"];
type CenterAgentPostSlackChannelMessageBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentPostSlackChannelMessageBodySchema"];
type CenterAgentPostSlackThreadMessageBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentPostSlackThreadMessageBodySchema"];
type CenterAgentPostSlackChannelMessageResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentPostSlackChannelMessageResponseSchema"];
type CenterAgentSearchSlackMessagesBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSearchSlackMessagesBodySchema"];
type CenterAgentSearchSlackMessagesResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSearchSlackMessagesResponseSchema"];
type CenterAgentPostSpaceMessageBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentPostSpaceMessageBodySchema"];
type CenterAgentPostSpaceMessageResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentPostSpaceMessageResponseSchema"];
type CenterAgentSpaceAuthoringContractResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSpaceAuthoringContractResponseSchema"];
type CenterAgentProductOperationStepSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentProductOperationStepSchema"];
type CenterAgentReadDispatchHistoryBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadDispatchHistoryBodySchema"];
type CenterAgentReadDispatchHistoryResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadDispatchHistoryResponseSchema"];
type CenterAgentReadSpaceContextBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadSpaceContextBodySchema"];
type CenterAgentReadSpaceContextResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentReadSpaceContextResponseSchema"];
type CenterAgentRemoteRuntimeAvailabilityReasonCodeSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRemoteRuntimeAvailabilityReasonCodeSchema"];
type CenterAgentRemoteRuntimeAvailabilitySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentRemoteRuntimeAvailabilitySchema"];
type CenterAgentSlackWorkspaceConnectBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSlackWorkspaceConnectBodySchema"];
type CenterAgentSlackWorkspaceConnectionResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSlackWorkspaceConnectionResponseSchema"];
type CenterAgentSlackWorkspaceConnectionSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSlackWorkspaceConnectionSchema"];
type CenterAgentSlackWorkspaceDisconnectResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentSlackWorkspaceDisconnectResponseSchema"];
type CenterAgentUpdateSpaceSettingsBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateSpaceSettingsBodySchema"];
type CenterAgentUpdateSpaceSettingsResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateSpaceSettingsResponseSchema"];
type CenterAgentUpdateProfileBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateProfileBodySchema"];
type CenterAgentUpdateProfileResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateProfileResponseSchema"];
type CenterAgentUpdateAgentProfileRuntimeSettingsBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateAgentProfileRuntimeSettingsBodySchema"];
type CenterAgentUpdateAgentProfileRuntimeSettingsResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentUpdateAgentProfileRuntimeSettingsResponseSchema"];
type CenterAgentWakeAgentProfilesInSpaceBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentWakeAgentProfilesInSpaceBodySchema"];
type CenterAgentWakeAgentProfilesInSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentWakeAgentProfilesInSpaceResponseSchema"];
type CenterAgentWakePublicationCommandSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentWakePublicationCommandSchema"];
type CenterAgentWatchAgentTaskBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentWatchAgentTaskBodySchema"];
type CenterAgentWatchAgentTaskResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentWatchAgentTaskResponseSchema"];
type CenterAgentListAgentTasksBodySchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListAgentTasksBodySchema"];
type CenterAgentListAgentTasksResponseSchema =
  typeof import("../../schemas/http/center-agent")["centerAgentListAgentTasksResponseSchema"];
type DesignateCenterAgentBodySchema =
  typeof import("../../schemas/http/center-agent")["designateCenterAgentBodySchema"];
type DesignateCenterAgentResponseSchema =
  typeof import("../../schemas/http/center-agent")["designateCenterAgentResponseSchema"];
type GetCenterAgentDesignationResponseSchema =
  typeof import("../../schemas/http/center-agent")["getCenterAgentDesignationResponseSchema"];
type GetCenterAgentOperatingStateResponseSchema =
  typeof import("../../schemas/http/center-agent")["getCenterAgentOperatingStateResponseSchema"];
type ListCenterAgentAuditJournalQuerySchema =
  typeof import("../../schemas/http/center-agent")["listCenterAgentAuditJournalQuerySchema"];
type ListCenterAgentAuditJournalResponseSchema =
  typeof import("../../schemas/http/center-agent")["listCenterAgentAuditJournalResponseSchema"];
type OpenCenterAgentDirectMessageSpaceResponseSchema =
  typeof import("../../schemas/http/center-agent")["openCenterAgentDirectMessageSpaceResponseSchema"];
type SlackIdentityLinkConsumeBodySchema =
  typeof import("../../schemas/http/center-agent")["slackIdentityLinkConsumeBodySchema"];
type SlackIdentityLinkConsumeResponseSchema =
  typeof import("../../schemas/http/center-agent")["slackIdentityLinkConsumeResponseSchema"];
type SlackIdentityLinkPreviewBodySchema =
  typeof import("../../schemas/http/center-agent")["slackIdentityLinkPreviewBodySchema"];
type SlackIdentityLinkPreviewResponseSchema =
  typeof import("../../schemas/http/center-agent")["slackIdentityLinkPreviewResponseSchema"];
type SlackIdentityLinkTokenSchema =
  typeof import("../../schemas/http/center-agent")["slackIdentityLinkTokenSchema"];
type EnsureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema =
  typeof import("../../schemas/http/center-agent")["ensureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema"];
type EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema =
  typeof import("../../schemas/http/center-agent")["ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema"];
type EnsureMessageChannelMemberOrganizationMembershipRpcInputSchema =
  typeof import("../../schemas/http/center-agent")["ensureMessageChannelMemberOrganizationMembershipRpcInputSchema"];
type EnsureMessageChannelMemberOrganizationMembershipRpcResponseSchema =
  typeof import("../../schemas/http/center-agent")["ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema"];
type UpdateCenterAgentOperatingStateBodySchema =
  typeof import("../../schemas/http/center-agent")["updateCenterAgentOperatingStateBodySchema"];
type UpdateCenterAgentOperatingStateResponseSchema =
  typeof import("../../schemas/http/center-agent")["updateCenterAgentOperatingStateResponseSchema"];
type UpdateCenterAgentModelBodySchema =
  typeof import("../../schemas/http/center-agent")["updateCenterAgentModelBodySchema"];
type UpdateCenterAgentModelResponseSchema =
  typeof import("../../schemas/http/center-agent")["updateCenterAgentModelResponseSchema"];

export type CenterAgentAction = z.infer<CenterAgentActionSchema>;
export type CenterAgentRecordConnectorActionAuditBody =
  z.infer<CenterAgentRecordConnectorActionAuditBodySchema>;
export type CenterAgentRecordConnectorActionAuditResponse =
  z.infer<CenterAgentRecordConnectorActionAuditResponseSchema>;
export type CenterAgentRecordConnectorActionOperationBody =
  z.infer<CenterAgentRecordConnectorActionOperationBodySchema>;
export type CenterAgentRecordConnectorActionOperationResponse =
  z.infer<CenterAgentRecordConnectorActionOperationResponseSchema>;
export type CenterAgentReadConnectorActionOperationBody =
  z.infer<CenterAgentReadConnectorActionOperationBodySchema>;
export type CenterAgentReadConnectorActionOperationResponse =
  z.infer<CenterAgentReadConnectorActionOperationResponseSchema>;
export type CenterAgentConnectorActionOperationStatus =
  z.infer<CenterAgentConnectorActionOperationStatusSchema>;
export type CenterAgentConnectorActionExecutionConnection =
  z.infer<CenterAgentConnectorActionExecutionConnectionSchema>;
export type CenterAgentCheckAgentProfileReadinessBody =
  z.infer<CenterAgentCheckAgentProfileReadinessBodySchema>;
export type CenterAgentCheckAgentProfileReadinessResponse =
  z.infer<CenterAgentCheckAgentProfileReadinessResponseSchema>;
export type CenterAgentConnectAgentProfileToLocalAgentBody =
  z.infer<CenterAgentConnectAgentProfileToLocalAgentBodySchema>;
export type CenterAgentConnectAgentProfileToLocalAgentResponse =
  z.infer<CenterAgentConnectAgentProfileToLocalAgentResponseSchema>;
export type CenterAgentAddAgentProfilesToSpaceBody =
  z.infer<CenterAgentAddAgentProfilesToSpaceBodySchema>;
export type CenterAgentAddAgentProfilesToSpaceResponse =
  z.infer<CenterAgentAddAgentProfilesToSpaceResponseSchema>;
export type CenterAgentAddMembersToSpaceBody =
  z.infer<CenterAgentAddMembersToSpaceBodySchema>;
export type CenterAgentAddMembersToSpaceResult =
  z.infer<CenterAgentAddMembersToSpaceResultSchema>;
export type CenterAgentAddMembersToSpaceResponse =
  z.infer<CenterAgentAddMembersToSpaceResponseSchema>;
export type CenterAgentRemoveAgentProfilesFromSpaceBody =
  z.infer<CenterAgentRemoveAgentProfilesFromSpaceBodySchema>;
export type CenterAgentRemoveAgentProfilesFromSpaceResponse =
  z.infer<CenterAgentRemoveAgentProfilesFromSpaceResponseSchema>;
export type CenterAgentAttribution = z.infer<CenterAgentAttributionSchema>;
export type CenterAgentCreateAgentProfileBody =
  z.infer<CenterAgentCreateAgentProfileBodySchema>;
export type CenterAgentCreateAgentProfileResponse =
  z.infer<CenterAgentCreateAgentProfileResponseSchema>;
export type CenterAgentCreateConfiguredAgentProfileBody =
  z.infer<CenterAgentCreateConfiguredAgentProfileBodySchema>;
export type CenterAgentCreateConfiguredAgentProfileResponse =
  z.infer<CenterAgentCreateConfiguredAgentProfileResponseSchema>;
export type CenterAgentCreateSpaceBody =
  z.infer<CenterAgentCreateSpaceBodySchema>;
export type CenterAgentCreateSpaceResponse =
  z.infer<CenterAgentCreateSpaceResponseSchema>;
export type CenterAgentDelegationCompletionMode =
  z.infer<CenterAgentDelegationCompletionModeSchema>;
export type CenterAgentDesignation = z.infer<CenterAgentDesignationSchema>;
export type CenterAgentModelConfigurationResponse =
  z.infer<CenterAgentModelConfigurationResponseSchema>;
export type CenterAgentDispatchHistoryEntry =
  z.infer<CenterAgentDispatchHistoryEntrySchema>;
export type CenterAgentDispatchHistoryLatestAttempt =
  z.infer<CenterAgentDispatchHistoryLatestAttemptSchema>;
export type CenterAgentEnableAgentProfileBody =
  z.infer<CenterAgentEnableAgentProfileBodySchema>;
export type CenterAgentEnableAgentProfileResponse =
  z.infer<CenterAgentEnableAgentProfileResponseSchema>;
export type CenterAgentInviteMemberBody =
  z.infer<CenterAgentInviteMemberBodySchema>;
export type CenterAgentInviteMemberResponse =
  z.infer<CenterAgentInviteMemberResponseSchema>;
export type CenterAgentComputerSetupOption =
  z.infer<CenterAgentComputerSetupOptionSchema>;
export type CenterAgentListComputersBody =
  z.infer<CenterAgentListComputersBodySchema>;
export type CenterAgentListComputersResponse =
  z.infer<CenterAgentListComputersResponseSchema>;
export type CenterAgentReadMemberComputersBody =
  z.infer<CenterAgentReadMemberComputersBodySchema>;
export type CenterAgentReadMemberComputersResponse =
  z.infer<CenterAgentReadMemberComputersResponseSchema>;
export type CenterAgentListLocalAgentConnectionCandidatesBody =
  z.infer<CenterAgentListLocalAgentConnectionCandidatesBodySchema>;
export type CenterAgentListLocalAgentConnectionCandidatesResponse =
  z.infer<CenterAgentListLocalAgentConnectionCandidatesResponseSchema>;
export type CenterAgentLocalAgentConnectionCandidate =
  z.infer<CenterAgentLocalAgentConnectionCandidateSchema>;
export type CenterAgentOnBehalfOfInput =
  z.infer<CenterAgentOnBehalfOfInputSchema>;
export type CenterAgentOperatingState =
  z.infer<CenterAgentOperatingStateSchema>;
export type CenterAgentPostSlackChannelMessageBody =
  z.infer<CenterAgentPostSlackChannelMessageBodySchema>;
export type CenterAgentPostSlackThreadMessageBody =
  z.infer<CenterAgentPostSlackThreadMessageBodySchema>;
export type CenterAgentPostSlackChannelMessageResponse =
  z.infer<CenterAgentPostSlackChannelMessageResponseSchema>;
export type CenterAgentSearchSlackMessagesBody =
  z.infer<CenterAgentSearchSlackMessagesBodySchema>;
export type CenterAgentSearchSlackMessagesResponse =
  z.infer<CenterAgentSearchSlackMessagesResponseSchema>;
export type CenterAgentPostSpaceMessageBody =
  z.infer<CenterAgentPostSpaceMessageBodySchema>;
export type CenterAgentPostSpaceMessageResponse =
  z.infer<CenterAgentPostSpaceMessageResponseSchema>;
export type CenterAgentSpaceAuthoringContractResponse =
  z.infer<CenterAgentSpaceAuthoringContractResponseSchema>;
export type CenterAgentProductOperationStep =
  z.infer<CenterAgentProductOperationStepSchema>;
export type CenterAgentReadDispatchHistoryBody =
  z.infer<CenterAgentReadDispatchHistoryBodySchema>;
export type CenterAgentReadDispatchHistoryResponse =
  z.infer<CenterAgentReadDispatchHistoryResponseSchema>;
export type CenterAgentReadSpaceContextBody =
  z.infer<CenterAgentReadSpaceContextBodySchema>;
export type CenterAgentReadSpaceContextResponse =
  z.infer<CenterAgentReadSpaceContextResponseSchema>;
export type CenterAgentRemoteRuntimeAvailability =
  z.infer<CenterAgentRemoteRuntimeAvailabilitySchema>;
export type CenterAgentRemoteRuntimeAvailabilityReasonCode =
  z.infer<CenterAgentRemoteRuntimeAvailabilityReasonCodeSchema>;
export type CenterAgentSlackWorkspaceConnectBody =
  z.infer<CenterAgentSlackWorkspaceConnectBodySchema>;
export type CenterAgentSlackWorkspaceConnection =
  z.infer<CenterAgentSlackWorkspaceConnectionSchema>;
export type CenterAgentSlackWorkspaceConnectionResponse =
  z.infer<CenterAgentSlackWorkspaceConnectionResponseSchema>;
export type CenterAgentSlackWorkspaceDisconnectResponse =
  z.infer<CenterAgentSlackWorkspaceDisconnectResponseSchema>;
export type CenterAgentUpdateSpaceSettingsBody =
  z.infer<CenterAgentUpdateSpaceSettingsBodySchema>;
export type CenterAgentUpdateSpaceSettingsResponse =
  z.infer<CenterAgentUpdateSpaceSettingsResponseSchema>;
export type CenterAgentUpdateProfileBody =
  z.infer<CenterAgentUpdateProfileBodySchema>;
export type CenterAgentUpdateProfileResponse =
  z.infer<CenterAgentUpdateProfileResponseSchema>;
export type CenterAgentUpdateAgentProfileRuntimeSettingsBody =
  z.infer<CenterAgentUpdateAgentProfileRuntimeSettingsBodySchema>;
export type CenterAgentUpdateAgentProfileRuntimeSettingsResponse =
  z.infer<CenterAgentUpdateAgentProfileRuntimeSettingsResponseSchema>;
export type CenterAgentWakeAgentProfilesInSpaceBody =
  z.infer<CenterAgentWakeAgentProfilesInSpaceBodySchema>;
export type CenterAgentWakeAgentProfilesInSpaceResponse =
  z.infer<CenterAgentWakeAgentProfilesInSpaceResponseSchema>;
export type CenterAgentWakePublicationCommand =
  z.infer<CenterAgentWakePublicationCommandSchema>;
export type CenterAgentWatchAgentTaskBody =
  z.infer<CenterAgentWatchAgentTaskBodySchema>;
export type CenterAgentWatchAgentTaskResponse =
  z.infer<CenterAgentWatchAgentTaskResponseSchema>;
export type CenterAgentListAgentTasksBody =
  z.infer<CenterAgentListAgentTasksBodySchema>;
export type CenterAgentListAgentTasksResponse =
  z.infer<CenterAgentListAgentTasksResponseSchema>;
export type DesignateCenterAgentBody = z.input<DesignateCenterAgentBodySchema>;
export type DesignateCenterAgentResponse =
  z.infer<DesignateCenterAgentResponseSchema>;
export type GetCenterAgentDesignationResponse =
  z.infer<GetCenterAgentDesignationResponseSchema>;
export type GetCenterAgentOperatingStateResponse =
  z.infer<GetCenterAgentOperatingStateResponseSchema>;
export type ListCenterAgentAuditJournalQuery =
  z.infer<ListCenterAgentAuditJournalQuerySchema>;
export type ListCenterAgentAuditJournalResponse =
  z.infer<ListCenterAgentAuditJournalResponseSchema>;
export type OpenCenterAgentDirectMessageSpaceResponse =
  z.infer<OpenCenterAgentDirectMessageSpaceResponseSchema>;
export type SlackIdentityLinkConsumeBody =
  z.infer<SlackIdentityLinkConsumeBodySchema>;
export type SlackIdentityLinkConsumeResponse =
  z.infer<SlackIdentityLinkConsumeResponseSchema>;
export type SlackIdentityLinkPreviewBody =
  z.infer<SlackIdentityLinkPreviewBodySchema>;
export type SlackIdentityLinkPreviewResponse =
  z.infer<SlackIdentityLinkPreviewResponseSchema>;
export type SlackIdentityLinkToken = z.infer<SlackIdentityLinkTokenSchema>;
export type EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput =
  z.infer<EnsureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema>;
export type EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse =
  z.infer<EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema>;
export type EnsureMessageChannelMemberOrganizationMembershipRpcInput =
  z.infer<EnsureMessageChannelMemberOrganizationMembershipRpcInputSchema>;
export type EnsureMessageChannelMemberOrganizationMembershipRpcResponse =
  z.infer<EnsureMessageChannelMemberOrganizationMembershipRpcResponseSchema>;
export type UpdateCenterAgentOperatingStateBody =
  z.infer<UpdateCenterAgentOperatingStateBodySchema>;
export type UpdateCenterAgentOperatingStateResponse =
  z.infer<UpdateCenterAgentOperatingStateResponseSchema>;
export type UpdateCenterAgentModelBody =
  z.infer<UpdateCenterAgentModelBodySchema>;
export type UpdateCenterAgentModelResponse =
  z.infer<UpdateCenterAgentModelResponseSchema>;
