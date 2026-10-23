import { tracing, WorkerEntrypoint } from "cloudflare:workers";
import {
  getPostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import type {
  SignalEnvelope,
  SpaceCursor,
  SpaceMeta,
} from "@openmeld/protocol";
import type {
  GetMemberAgentPresenceResponse,
  ListMemberAgentDirectMessageSessionsResponse,
  RequestCredential,
  SpacePreferencesRpc,
  SyncMemberAgentsResponse,
} from "@openmeld/schemas";
import {
  type DeleteAgentDirectMessageSessionResponse,
  type ListAgentDirectMessageSessionsResponse,
  type ListCenterAgentSessionsResponse,
  type ModelCatalogReadOptions,
  modelCatalogReadOptionsSchema,
  peopleComputerTargetSchema,
  SPACE_FILES_ORIGIN_CAPABILITY_TOKEN,
  toLegacySpaceAddressingWireValue,
  toLegacySpaceFilesOriginWireValue,
  toLegacySpaceImageGeometryWireValue,
  toSpaceSignalReadWireValue,
  type UpdateAgentDirectMessageSessionResponse,
} from "@openmeld/schemas";
import type {
  AccountSpaceActiveWakeSummaryResponse,
  AccountSpaceIndexResponse,
  AgentProfileCreationRequestMutationResponse,
  AgentProfileExecutionModeResponse,
  ApproveOrganizationDocumentDraftResponse,
  ApproveOrganizationDocumentDraftRpcInput,
  BeginOrganizationSkillImportBatchResponse,
  BeginOrganizationSkillImportBatchRpcInput,
  CenterAgentAddAgentProfilesToSpaceResponse,
  CenterAgentAddMembersToSpaceResponse,
  CenterAgentAiUsageRpcInput,
  CenterAgentAttribution,
  CenterAgentAuthorizeAnonymousMemberToolResponse,
  CenterAgentAuthorizeAnonymousMemberToolRpcInput,
  CenterAgentCheckAgentProfileReadinessResponse,
  CenterAgentConnectAgentProfileToLocalAgentResponse,
  CenterAgentConnectorConnectionSelection,
  CenterAgentCreateAgentProfileResponse,
  CenterAgentCreateConfiguredAgentProfileResponse,
  CenterAgentCreateOrganizationInviteLinkResponse,
  CenterAgentCreateOrganizationInviteLinkToolRpcInput,
  CenterAgentCreateProjectToolResponse,
  CenterAgentCreateProjectToolRpcInput,
  CenterAgentCreateRoutineToolRpcInput,
  CenterAgentCreateSpaceResponse,
  CenterAgentDeleteRoutineToolRpcInput,
  CenterAgentDraftOrganizationDocumentResponse,
  CenterAgentDraftOrganizationDocumentRpcInput,
  CenterAgentEnableAgentProfileResponse,
  CenterAgentGetOrganizationInviteLinkResponse,
  CenterAgentGetOrganizationInviteLinkToolRpcInput,
  CenterAgentInboxSummaryResponse,
  CenterAgentInstallOrganizationSkillResponse,
  CenterAgentInstallOrganizationSkillRpcInput,
  CenterAgentInviteSlackTeammatesRpcInput,
  CenterAgentInviteSlackTeammatesRpcResponse,
  CenterAgentListAgentProfileCreationDefaultsResponse,
  CenterAgentListAgentTasksResponse,
  CenterAgentListComputersResponse,
  CenterAgentListLocalAgentConnectionCandidatesResponse,
  CenterAgentListLocalAgentInstallationsResponse,
  CenterAgentListOrganizationMembersResponse,
  CenterAgentListOrganizationMembersToolRpcInput,
  CenterAgentListProjectsToolResponse,
  CenterAgentListProjectsToolRpcInput,
  CenterAgentListRoutineRunsToolRpcInput,
  CenterAgentListRoutinesToolRpcInput,
  CenterAgentListSlackChannelsResponse,
  CenterAgentListSpaceFilesResponse,
  CenterAgentListSpaceFilesRpcInput,
  CenterAgentManageOrganizationDocumentsResponse,
  CenterAgentManageOrganizationDocumentsRpcInput,
  CenterAgentManageSpaceFilesResponse,
  CenterAgentManageSpaceFilesRpcInput,
  CenterAgentModelConfigurationResponse,
  CenterAgentOrganizationDocumentsComputerSnapshotResponse,
  CenterAgentOrganizationDocumentsComputerSnapshotRpcInput,
  CenterAgentOrganizationMemoryPolicyResponse,
  CenterAgentPauseRoutineToolRpcInput,
  CenterAgentPostSlackChannelMessageResponse,
  CenterAgentPostSlackFileResponse,
  CenterAgentPostSpaceMessageResponse,
  CenterAgentPrepareRemoveProjectToolResponse,
  CenterAgentPrepareRemoveProjectToolRpcInput,
  CenterAgentReadAuditJournalRpcInput,
  CenterAgentReadConnectorActionOperationResponse,
  CenterAgentReadDispatchHistoryResponse,
  CenterAgentReadMemberComputersResponse,
  CenterAgentReadMemberOpenMeldServiceStatusResponse,
  CenterAgentReadOrganizationDocumentsResponse,
  CenterAgentReadOrganizationDocumentsRpcInput,
  CenterAgentReadOrganizationSkillsResponse,
  CenterAgentReadOrganizationSkillsRpcInput,
  CenterAgentReadPeopleComputersResponse,
  CenterAgentReadRoutineRunDiagnosticsRpcInput,
  CenterAgentReadSlackChannelHistoryResponse,
  CenterAgentReadSlackChannelMembersResponse,
  CenterAgentReadSlackFileResponse,
  CenterAgentReadSlackWorkspaceDirectoryResponse,
  CenterAgentReadSpaceContextResponse,
  CenterAgentReadSpaceFileResponse,
  CenterAgentReadSpaceFileRpcInput,
  CenterAgentReadTurnDiagnosticsResponse,
  CenterAgentRecordConnectorActionAuditResponse,
  CenterAgentRecordConnectorActionOperationResponse,
  CenterAgentRememberForOrganizationResponse,
  CenterAgentRemoveAgentProfilesFromSpaceResponse,
  CenterAgentRemoveProjectToolResponse,
  CenterAgentRemoveProjectToolRpcInput,
  CenterAgentRequestMemberAttentionResponse,
  CenterAgentRequestMemberAttentionRpcInput,
  CenterAgentRequestOpenMeldToolsUpdateResponse,
  CenterAgentResumeRoutineToolRpcInput,
  CenterAgentSaveSpaceFileResponse,
  CenterAgentSaveSpaceFileRpcInput,
  CenterAgentSearchMemoryRpcInput,
  CenterAgentSearchSlackMessagesResponse,
  CenterAgentSelectLocalAgentInstallationResponse,
  CenterAgentSetAgentProfileDefaultProjectToolResponse,
  CenterAgentSetAgentProfileDefaultProjectToolRpcInput,
  CenterAgentSetOpenMeldToolsMaintenanceResponse,
  CenterAgentSetOrganizationWorkingLanguageToolResponse,
  CenterAgentSetOrganizationWorkingLanguageToolRpcInput,
  CenterAgentSlackWorkspaceConnectionResponse,
  CenterAgentSlackWorkspaceDisconnectResponse,
  CenterAgentSpaceAuthoringContractResponse,
  CenterAgentStartSelfMemberResearchToolRpcInput,
  CenterAgentUpdateAgentProfileRuntimeSettingsResponse,
  CenterAgentUpdateProfileResponse,
  CenterAgentUpdateProjectToolResponse,
  CenterAgentUpdateProjectToolRpcInput,
  CenterAgentUpdateRoutineToolRpcInput,
  CenterAgentUpdateSpaceSettingsResponse,
  CenterAgentWakeAgentProfilesInSpaceResponse,
  CenterAgentWakeAgentProfilesInSpacesResponse,
  CenterAgentWatchAgentTaskResponse,
  CenterAgentWipeMemberMemoryResponse,
  ChangelogQueryResponse,
  ConnectorAppRequestListResponse,
  ConnectorAppRequestResponse,
  ConnectorConnection,
  ConnectorConnectionListResponse,
  ConvertDirectMessageToSpaceResponse,
  CreateAgentProfileCreationRequestResponse,
  CreateCenterAgentContextLoadReceiptResponse,
  CreateCenterAgentContextManifestResponse,
  CreateCenterAgentRoutineResponse,
  CreateOrganizationDocumentFolderResponse,
  CreateOrganizationDocumentFolderRpcInput,
  CreateOrganizationDocumentResponse,
  CreateOrganizationDocumentRpcInput,
  CreateOrganizationSkillResponse,
  CreateOrganizationSkillRpcInput,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceFolderResponse,
  CurrentAgentProfileSessionLookupResponse,
  CurrentDeviceTargetResponse,
  CurrentLocalAgentInstallationsResponse,
  CurrentLocalRuntimeReplyReadinessResponse,
  DbFactSnapshot,
  DeleteCenterAgentRoutineResponse,
  DeleteOrganizationDocumentFolderResponse,
  DeleteOrganizationDocumentFolderRpcInput,
  DeleteOrganizationDocumentResponse,
  DeleteOrganizationDocumentRpcInput,
  DeleteOrganizationSkillResponse,
  DeleteOrganizationSkillRpcInput,
  DesignateCenterAgentResponse,
  DisableAgentProfilePrimaryBindingResponse,
  DiscardOrganizationDocumentDraftResponse,
  DiscardOrganizationDocumentDraftRpcInput,
  DismissInboxItemResponse,
  DismissInboxItemRpcInput,
  DispatchResult,
  DispatchStorageReadiness,
  EnsureAgentProfilePrimaryBindingResponse,
  ExecuteAgentProfileWorkRecoveryResponse,
  ExecuteExecutionRecoveryResponse,
  FeedbackIssueRecord,
  FeedbackIssueSubmitRpcRequest,
  FeedbackReportingPolicyResponse,
  ForgetComputerResponse,
  ForgetCurrentComputerResponse,
  GetActiveSpaceWakeProgressResponse,
  GetAgentExecutionReadinessBatchResponse,
  GetAgentExecutionReadinessResponse,
  GetAgentProfileControllerChangeEligibilityResponse,
  GetAgentProfileCreationApprovalPreferenceResponse,
  GetAgentProfileCreationDefaultsResponse,
  GetAgentProfilePrimaryBindingResponse,
  GetCenterAgentDesignationResponse,
  GetCenterAgentDirectMessageSpaceProjectionResponse,
  GetCenterAgentInboxSummaryRpcInput,
  GetCenterAgentMemberResearchStatusResponse,
  GetCenterAgentMemberResearchStatusRpcInput,
  GetCenterAgentOperatingStateResponse,
  GetInboxItemResponse,
  GetInboxItemRpcInput,
  GetInboxMessageNotificationPreferencesRpcInput,
  GetInboxNotificationPreferencesRpcInput,
  GetInboxSummaryRpcInput,
  GetLocalRuntimeExpectedRoutesResponse,
  GetModelCatalogResponse,
  GetOrganizationDocumentResponse,
  GetOrganizationDocumentRpcInput,
  GetOrganizationSkillImportBatchResponse,
  GetOrganizationSkillImportBatchRpcInput,
  GetOrganizationSkillResponse,
  GetOrganizationSkillRpcInput,
  GetPrepareReadinessResponse,
  GetSpaceConversationStateResponse,
  GetSpaceDispatchLookupResponse,
  GetSpaceEntryResolutionResponse,
  GetSpaceInboxSummaryRpcInput,
  GetSpaceInboxUnreadTargetsRpcInput,
  GetSpaceMessageDetailsResponse,
  GetSpaceStatusResponse,
  GetSpaceThreadResponse,
  GetSpaceUpdatesResponse,
  GetSpaceWakeProgressResponse,
  GetSpaceWakeTraceWaterfallResponse,
  GitHubAppInstallationStartResponse,
  GitHubAppInstallationVerificationResponse,
  GitHubAppWebhookVerificationInput,
  GitHubAppWebhookVerificationResponse,
  ImportOrganizationSkillFromFilesResponse,
  ImportOrganizationSkillFromFilesRpcInput,
  ImportOrganizationSkillFromGitHubResponse,
  ImportOrganizationSkillFromGitHubRpcInput,
  InboxFeedResponse,
  InboxNotificationPreferencesResponse,
  InboxSummaryResponse,
  InspectExecutionRecoveryResponse,
  LarkPlatformActiveRegistrationListResponse,
  LarkPlatformRegistrationResponse,
  LarkPlatformWebhookVerificationInput,
  LarkPlatformWebhookVerificationResponse,
  LeaveSpaceResponse,
  ListAgentProfileCreationRequestsResponse,
  ListCenterAgentAuditJournalResponse,
  ListCenterAgentRoutinesResponse,
  ListFeedbackIssuesForOrganizationRequest,
  ListFeedbackIssuesForOrganizationResponse,
  ListFileRootResponse,
  ListInboxFeedRpcInput,
  ListInboxItemsResponse,
  ListInboxItemsRpcInput,
  ListOrganizationDocumentsResponse,
  ListOrganizationDocumentsRpcInput,
  ListOrganizationSkillImportBatchesResponse,
  ListOrganizationSkillImportBatchesRpcInput,
  ListOrganizationSkillsResponse,
  ListOrganizationSkillsRpcInput,
  ListSpaceFileRevisionsResponse,
  ListSpaceFilesResponse,
  ListSpaceTasksResponse,
  ListSpaceThreadEventsResponse,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
  LocalAgentReasoningPreferencesRpc,
  LocalRuntimeEnrollmentResponse,
  LocalRuntimesResponse,
  MarkAllInboxItemsReadResponse,
  MarkAllInboxItemsReadRpcInput,
  MarkCenterAgentInboxReadThroughResponse,
  MarkCenterAgentInboxReadThroughRpcInput,
  MarkInboxItemReadResponse,
  MarkInboxItemReadRpcInput,
  MarkSpaceInboxReadThroughResponse,
  MarkSpaceInboxReadThroughRpcInput,
  MessageChannelConnectionListResponse,
  MessageChannelIdentityLinkConsumeResponse,
  MessageChannelIdentityLinkPreviewResponse,
  MessageChannelSetupRequestResponse,
  MutateInboxFeedResponse,
  MutateInboxFeedRpcInput,
  NotifyAgentProfileRouteCatalogChangedResponse,
  OpenCenterAgentDirectMessageSpaceResponse,
  OpenDirectMessageSpaceResponse,
  OrganizationAgentRuntimeOverviewResponse,
  OrganizationAiBillingRpcInput,
  OrganizationAiUsageRpcInput,
  OrganizationComputersResponse,
  OrganizationDirectoryResponse,
  OrganizationDocumentPromptContextResponse,
  OrganizationDocumentPromptContextRpcInput,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationMemberWebActivityResponse,
  OrganizationProfileDirectoryResponse,
  OrganizationSkillRuntimeCatalogResponse,
  OrganizationSkillRuntimeSnapshotResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  PauseCenterAgentRoutineResponse,
  PendingGitHubAppInstallation,
  PeopleComputersResponse,
  PluginAccessListRpcInput,
  PluginAccessUpdateRpcInput,
  PostSpaceMembersResponse,
  PostSpaceWakeStopResponse,
  PrepareDiagnosticResponse,
  PrepareSessionResponse,
  PrepareSessionWithTokenResponse,
  PrepareSpaceFileWriteResponse,
  PreviewOrganizationSkillFromFilesResponse,
  PreviewOrganizationSkillFromFilesRpcInput,
  PreviewOrganizationSkillFromGitHubResponse,
  PreviewOrganizationSkillFromGitHubRpcInput,
  PreviewOrganizationSkillRepositoryResponse,
  PreviewOrganizationSkillRepositoryRpcInput,
  ReadFeedbackReportingPolicyRequest,
  ReadOrganizationSkillRuntimeCatalogRpcInput,
  ReadOrganizationSkillRuntimeResourceResponse,
  ReadOrganizationSkillRuntimeResourceRpcInput,
  ReadOrganizationSkillRuntimeSnapshotRpcInput,
  ReconcileDeletedAgentProfileRequest,
  ReconcileDeletedAgentProfileResponse,
  RecordCenterAgentMemberResearchComputerFileResponse,
  RecordCenterAgentMemberResearchComputerFileRpcInput,
  RecordOrganizationSkillActivationResponse,
  RecordOrganizationSkillActivationRpcInput,
  RefreshCurrentLocalAgentCatalogResponse,
  RemoteAgentCoreCallbackEvent,
  RemoteAgentCoreCallbackResponse,
  RemoteAgentListTeamFilesRpcInput,
  RemoteAgentReadTeamFileResponse,
  RemoteAgentReadTeamFileRpcInput,
  RemoteAgentSaveTeamFileResponse,
  RemoteAgentSaveTeamFileRpcInput,
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamDeltaCallbackResponse,
  RemoteAgentStreamPartCallbackBody,
  RemoteAiUsageWrite,
  RemoveSpaceMembersResponse,
  RequestCurrentOpenMeldToolsUpdateResponse,
  ResolveSpaceFileContentResponse,
  RespondToSpaceAgentInteractionResponse,
  RestoreSpaceFileEntryResponse,
  ResumeCenterAgentRoutineResponse,
  SelectCurrentLocalAgentInstallationResponse,
  ServiceConnectionIncidentReportRpcInput,
  ServiceConnectionIncidentsReadRpcInput,
  SetAgentProfileCreationApprovalPreferenceResponse,
  SetAgentProfileCreationDefaultsResponse,
  SetCurrentAgentProfileWorkspaceResponse,
  SetCurrentLocalAgentEnabledResponse,
  SetCurrentOpenMeldToolsMaintenanceResponse,
  SetOrganizationSkillEnabledResponse,
  SetOrganizationSkillEnabledRpcInput,
  SetOrganizationSkillMaintainersResponse,
  SetOrganizationSkillMaintainersRpcInput,
  SlackIdentityLinkConsumeResponse,
  SlackIdentityLinkPreviewResponse,
  SlackOAuthIdentityLinkResult,
  SlackOAuthInstallationResult,
  SlackOAuthStateConsumeResponse,
  SlackOAuthStateCreateResponse,
  SlackWelcomeInteractionRpcInput,
  SlackWelcomeInteractionRpcResponse,
  SpaceAttachmentDescriptor,
  SpaceBoardResponse,
  SpaceBootstrapResponse,
  SpaceContract,
  SpaceDispatchTraceResponse,
  SpaceFileDescriptor,
  SpaceFilePinsResponse,
  SpaceHistoryNavigation,
  SpaceHistoryNavigationQuery,
  SpaceIdentityDirectory,
  SpaceInboxSummaryResponse,
  SpaceInboxUnreadTargetsResponse,
  SpaceInputQueueResponse,
  SpaceMemberDirectory,
  SpaceMembersSnapshot,
  SpaceMessagePinsResponse,
  SpaceTaskMutationReceipt,
  SpaceTaskResponse,
  SpaceViewerMembershipResponse,
  StartCenterAgentMemberResearchResponse,
  StartCenterAgentMemberResearchRpcInput,
  SubmitFeedbackIssueResponse,
  SubmitRuntimeAgentControllerReportsResponse,
  SubmitRuntimeProviderConversationProofsResponse,
  SubmitRuntimeRegistrationResponse,
  TrashSpaceFileEntryResponse,
  UpdateCenterAgentModelResponse,
  UpdateCenterAgentOperatingStateResponse,
  UpdateCenterAgentRoutineResponse,
  UpdateFeedbackIssueStatusForOrganizationRequest,
  UpdateInboxMessageNotificationPreferencesRpcInput,
  UpdateInboxNotificationPreferencesRpcInput,
  UpdateOrganizationAiBillingRpcInput,
  UpdateOrganizationDocumentFolderResponse,
  UpdateOrganizationDocumentFolderRpcInput,
  UpdateOrganizationDocumentResponse,
  UpdateOrganizationDocumentRpcInput,
  UpdateOrganizationSkillResponse,
  UpdateOrganizationSkillRpcInput,
  UpdateSpaceFileEntryResponse,
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";
import {
  rpcCreateAgentProfileAccessGrant,
  rpcCreateSpaceAgentRequest,
  rpcDecideAgentAccessRequest,
  rpcGetAgentAccessRequest,
  rpcListAgentAccessRequests,
  rpcListAgentProfileAccessGrants,
  rpcListViewerAgentAccessGrants,
  rpcRevokeAgentProfileAccessGrant,
  rpcWithdrawAgentAccessRequest,
} from "./agent-access/agent-access-rpc";
import { rpcCenterAgentReadAgentActivityOverview } from "./agent-activity/activity-center-agent-rpc";
import { acceptAgentActivitySessionInventoryMemberCleanup } from "./agent-activity/activity-session-inventory-member-cleanup-service";
import { reconcileDeletedAgentProfile } from "./agent-profile-binding/application/deleted-profile-reconcile-service";
import {
  type CenterAgentCreateAgentProfileCreationRequestRpcInput,
  type CenterAgentGetAgentProfileCreationApprovalPreferenceRpcInput,
  type CenterAgentListAgentProfileCreationRequestsRpcInput,
  type CenterAgentManageAgentProfileCreationRequestRpcInput,
  type CenterAgentSetAgentProfileCreationApprovalPreferenceRpcInput,
  type CreateAgentProfileCreationRequestRpcInput,
  type DecideAgentProfileCreationRequestRpcInput,
  type GetAgentProfileCreationApprovalPreferenceRpcInput,
  type ListAgentProfileCreationRequestsRpcInput,
  type MutateAgentProfileCreationRequestRpcInput,
  rpcCancelAgentProfileCreationRequest,
  rpcCenterAgentCreateAgentProfileCreationRequest,
  rpcCenterAgentCreateConfiguredAgentProfile,
  rpcCenterAgentGetAgentProfileCreationApprovalPreference,
  rpcCenterAgentListAgentProfileCreationRequests,
  rpcCenterAgentManageAgentProfileCreationRequest,
  rpcCenterAgentSetAgentProfileCreationApprovalPreference,
  rpcCreateAgentProfileCreationRequest,
  rpcDecideAgentProfileCreationRequest,
  rpcGetAgentProfileCreationApprovalPreference,
  rpcListAgentProfileCreationRequests,
  rpcRetryAgentProfileCreationRequest,
  rpcSetAgentProfileCreationApprovalPreference,
  type SetAgentProfileCreationApprovalPreferenceRpcInput,
} from "./agent-profile-creation-request/agent-profile-creation-request-rpc";
import { app } from "./app";
import { rpcCenterAgentAuthorizeAnonymousMemberTool } from "./center-agent/application/anonymous-member-request";
import { rpcCenterAgentRequestMemberAttention } from "./center-agent/application/center-agent-attention-rpc";
import {
  getCenterAgentMemberResearchStatus,
  runCenterAgentMemberResearchTick,
  startCenterAgentMemberResearch,
} from "./center-agent-member-research/member-research-service";
import {
  clearCoreCenterAgentMemberNativeDeliveryData,
  clearCoreCenterAgentOrganizationNativeDeliveryData,
  createCoreCenterAgentMemoryService,
} from "./center-agent-memory/core-memory-service";
import { rpcCenterAgentSearchMemory } from "./center-agent-memory/memory-search-rpc";
import { personalComputerRpc } from "./computer/computer-rpc";
import { rpcReportDesktopUpdateObservation } from "./computers/desktop-update-inbox";
import { readModelCatalog } from "./config/model-catalog";
import {
  rpcListPluginAccess,
  rpcUpdatePluginAccess,
} from "./connectors/plugin-access-rpc";
import {
  continuePluginChannelConnection,
  previewPluginChannelConnection,
} from "./connectors/plugin-channel-continuation";
import { continuePluginConnection } from "./connectors/plugin-connection-continuation";
import {
  inspectCoreDbState,
  inspectCoreDispatchStorageReadiness,
} from "./db/runtime-facts";
import {
  rpcListFeedbackIssuesForOrganization,
  rpcReadFeedbackReportingPolicy,
  rpcUpdateFeedbackIssueStatusForOrganization,
} from "./feedback/transport/rpc/feedback-management-rpc";
import { rpcSubmitFeedbackIssue } from "./feedback/transport/rpc/feedback-rpc";
import {
  rpcRemoteAgentListTeamFiles,
  rpcRemoteAgentReadTeamFile,
  rpcRemoteAgentSaveTeamFile,
} from "./files/remote-agent-team-files";
import {
  rpcDismissInboxItem,
  rpcGetCenterAgentInboxSummary,
  rpcGetInboxItem,
  rpcGetInboxMessageNotificationPreferences,
  rpcGetInboxNotificationPreferences,
  rpcGetInboxSummary,
  rpcGetSpaceInboxSummary,
  rpcGetSpaceInboxUnreadTargets,
  rpcListInboxFeed,
  rpcListInboxItems,
  rpcMarkAllInboxItemsRead,
  rpcMarkCenterAgentInboxReadThrough,
  rpcMarkInboxItemRead,
  rpcMarkSpaceInboxReadThrough,
  rpcMutateInboxFeed,
  rpcMutateSpaceInboxRead,
  rpcObserveInboxNotifications,
  rpcUpdateInboxMessageNotificationPreferences,
  rpcUpdateInboxNotificationPreferences,
} from "./inbox/transport/rpc/inbox-rpc";
import type { CoreBindings } from "./lib/bindings";
import {
  type ListMemberAgentDirectMessageSessionsRpcInput,
  type MemberAgentRpcInput,
  rpcGetMemberAgentPresence,
  rpcListMemberAgentDirectMessageSessions,
  rpcSubmitRuntimeAgentControllerReportsWithMemberAgents,
  rpcSyncMemberAgents,
  type SyncMemberAgentsRpcInput,
  setLocalAgentEnabledWithMemberAgents,
} from "./member-agent/member-agent-rpc";
import { rpcCenterAgentManageOrganizationDocuments } from "./organization-documents/center-agent-document-rpc";
import {
  rpcApproveOrganizationDocumentDraft,
  rpcCenterAgentDraftOrganizationDocument,
  rpcCenterAgentOrganizationDocumentsComputerSnapshot,
  rpcCenterAgentReadOrganizationDocuments,
  rpcCreateOrganizationDocument,
  rpcCreateOrganizationDocumentFolder,
  rpcDeleteOrganizationDocument,
  rpcDeleteOrganizationDocumentFolder,
  rpcDiscardOrganizationDocumentDraft,
  rpcGetOrganizationDocument,
  rpcListOrganizationDocuments,
  rpcReadOrganizationDocumentPromptContext,
  rpcRecordCenterAgentMemberResearchComputerFile,
  rpcUpdateOrganizationDocument,
  rpcUpdateOrganizationDocumentFolder,
} from "./organization-documents/organization-document-rpc";
import {
  rpcCenterAgentInstallOrganizationSkill,
  rpcCenterAgentReadOrganizationSkills,
} from "./organization-skills/center-agent-organization-skill-rpc";
import {
  rpcBeginOrganizationSkillImportBatch,
  rpcCreateOrganizationSkill,
  rpcDeleteOrganizationSkill,
  rpcGetOrganizationSkill,
  rpcGetOrganizationSkillCatalog,
  rpcGetOrganizationSkillImportBatch,
  rpcImportOrganizationSkillFromFiles,
  rpcImportOrganizationSkillFromGitHub,
  rpcListOrganizationSkillImportBatches,
  rpcListOrganizationSkills,
  rpcPreviewOrganizationSkillFromFiles,
  rpcPreviewOrganizationSkillFromGitHub,
  rpcPreviewOrganizationSkillRepository,
  rpcReadOrganizationSkillRuntimeCatalog,
  rpcReadOrganizationSkillRuntimeResource,
  rpcReadOrganizationSkillRuntimeSnapshot,
  rpcRecordOrganizationSkillActivation,
  rpcSetOrganizationSkillEnabled,
  rpcSetOrganizationSkillMaintainers,
  rpcUpdateOrganizationSkill,
} from "./organization-skills/organization-skill-rpc";
import {
  cleanupDeletedAccount,
  cleanupDeletedAccountConnection,
} from "./organizations/account-deletion";
import {
  rpcCenterAgentCreateOrganizationInviteLink,
  rpcCenterAgentGetOrganizationInviteLink,
} from "./organizations/center-agent-organization-invite-link-rpc";
import { rpcCenterAgentSetOrganizationWorkingLanguage } from "./organizations/center-agent-working-language-rpc";
import { resolveOrganizationMembershipById } from "./organizations/organization-context";
import { organizationJoinRequest } from "./organizations/organization-join-requests";
import { spaceInvitation } from "./organizations/space-invitations";
import { checkSpaceOwnerDeparture } from "./organizations/space-owner-departure";
import { PrepareSessionHub } from "./prepare-session/transport/do/prepare-session-hub";
import {
  type CreatePrepareSessionInput,
  type GetPrepareSessionInput,
  type MintPrepareSessionReconnectTokenInput,
  type ResolvePrepareSessionTokenInput,
  rpcCreatePrepareSession,
  rpcGetPrepareDiagnostic,
  rpcGetPrepareSession,
  rpcMintPrepareSessionReconnectToken,
  rpcResolvePrepareSessionToken,
  rpcWritePrepareAgentSelection,
  rpcWritePrepareSetupBootstrap,
  rpcWritePrepareTerminalStep,
  type WritePrepareAgentSelectionInput,
  type WritePrepareSetupBootstrapInput,
  type WritePrepareTerminalStepInput,
} from "./prepare-session/transport/rpc/prepare-session-rpc";
import {
  rpcCenterAgentCreateProject,
  rpcCenterAgentListProjects,
  rpcCenterAgentPrepareRemoveProject,
  rpcCenterAgentRemoveProject,
  rpcCenterAgentSetAgentProfileDefaultProject,
  rpcCenterAgentUpdateProject,
} from "./projects/project-center-agent-rpc";
import {
  rpcReadProjectCommonAgents,
  rpcReadProjectRecentTasks,
  rpcReadProjectRepositorySettings,
  rpcResolveProjectIssueAction,
  rpcUpdateProjectCommonAgents,
  rpcUpdateProjectRepositorySettings,
} from "./projects/project-rpc";
import { verifyLarkPlatformWebhook } from "./remote-agent/application/lark-platform-webhook-service";
import { createConfiguredMessageChannelProviderRegistry } from "./remote-agent/application/message-channel-provider-runtime";
import { acknowledgeRemoteAgentAdmission } from "./remote-agent/application/native-delivery-admission-acknowledgement";
import { completeRemoteAgentNativeDelivery } from "./remote-agent/application/native-delivery-service";
import { runPersonalRemoteAgentSpaceTool } from "./remote-agent/application/personal-remote-agent-space-tools";
import { authorizeRemoteAgentExecutionAccess } from "./remote-agent/application/remote-agent-execution-access";
import { processRemoteAgentSlackEvent } from "./remote-agent/application/slack-signal-service";
import {
  handleCenterAgentSlackTeammateInvitations,
  handleSlackWelcomeInteraction,
} from "./remote-agent/application/slack-welcome-interaction-service";
import { withRemoteAgentSpaceFileWire } from "./remote-agent/application/space-file-wire";
import { submitRemoteAgentStreamDelta } from "./remote-agent/application/stream-delta-service";
import { submitRemoteAgentStreamPart } from "./remote-agent/application/stream-part-service";
import {
  rpcCenterAgentCreateRoutine,
  rpcCenterAgentDeleteRoutine,
  rpcCenterAgentListRoutines,
  rpcCenterAgentPauseRoutine,
  rpcCenterAgentResumeRoutine,
  rpcCenterAgentUpdateRoutine,
} from "./routines/routine-center-agent-rpc";
import {
  rpcCenterAgentListRoutineRuns,
  rpcCenterAgentReadRoutineRunDiagnostics,
} from "./routines/routine-evidence-rpc";
import { RoutineRunWorkflow } from "./routines/routine-run-workflow";
import {
  type AddCenterAgentToSpaceInput,
  type AddOrganizationDirectoryProfilesToSpaceInput,
  type AddSpaceMembersInput,
  type AgentProfileExecutionModeInput,
  type ArchiveProjectInput,
  type AssertCurrentDesignatedCenterAgentInput,
  type AuthorizeConnectorDisconnectInput,
  type BeginCurrentMemberConnectorAuthorizationInput,
  type BeginCurrentOrganizationGitHubAppInstallationInput,
  type BeginCurrentOrganizationSharedConnectorAuthorizationInput,
  type BeginExistingGitHubAppInstallationVerificationInput,
  type BeginGitHubAppInstallationVerificationInput,
  type BeginLarkPlatformRegistrationInput,
  type CenterAgentAddAgentProfilesToSpaceInput,
  type CenterAgentAddMembersToSpaceInput,
  type CenterAgentCheckAgentProfileReadinessInput,
  type CenterAgentConnectAgentProfileToLocalAgentInput,
  type CenterAgentCreateAgentProfileInput,
  type CenterAgentCreateConfiguredAgentProfileInput,
  type CenterAgentCreateSpaceInput,
  type CenterAgentEnableAgentProfileInput,
  type CenterAgentListActiveSpaceWakesInput,
  type CenterAgentListAgentActivitySessionsInput,
  type CenterAgentListAgentProfileCreationDefaultsInput,
  type CenterAgentListAgentTasksInput,
  type CenterAgentListComputersInput,
  type CenterAgentListLocalAgentConnectionCandidatesInput,
  type CenterAgentListLocalAgentInstallationsInput,
  type CenterAgentListOpportunitiesInput,
  type CenterAgentListSlackChannelsInput,
  type CenterAgentPostSlackChannelMessageInput,
  type CenterAgentPostSlackFileInput,
  type CenterAgentPostSlackThreadMessageInput,
  type CenterAgentPostSpaceMessageInput,
  type CenterAgentReadAgentActivityInput,
  type CenterAgentReadChangelogInput,
  type CenterAgentReadConnectorActionOperationInput,
  type CenterAgentReadDispatchHistoryInput,
  type CenterAgentReadMemberComputersInput,
  type CenterAgentReadMemberOpenMeldServiceStatusInput,
  type CenterAgentReadOrganizationDirectoryInput,
  type CenterAgentReadOrganizationSpaceDirectoryInput,
  type CenterAgentReadPeopleComputersInput,
  type CenterAgentReadSlackChannelHistoryInput,
  type CenterAgentReadSlackChannelMembersInput,
  type CenterAgentReadSlackFileInput,
  type CenterAgentReadSlackWorkspaceDirectoryInput,
  type CenterAgentReadSpaceAuthoringContractInput,
  type CenterAgentReadSpaceContextInput,
  type CenterAgentReadSpaceWakeProgressInput,
  type CenterAgentReadTurnDiagnosticsInput,
  type CenterAgentRecommendOpportunityInput,
  type CenterAgentRecordConnectorActionAuditInput,
  type CenterAgentRecordConnectorActionOperationInput,
  type CenterAgentRememberForOrganizationInput,
  type CenterAgentRemoveAgentProfilesFromSpaceInput,
  type CenterAgentRequestOpenMeldToolsUpdateInput,
  type CenterAgentResolveConnectorConnectionInput,
  type CenterAgentRespondToOpportunityInput,
  type CenterAgentSearchSlackMessagesInput,
  type CenterAgentSelectLocalAgentInstallationInput,
  type CenterAgentSetOpenMeldToolsMaintenanceInput,
  type CenterAgentSpaceInputQueueInput,
  type CenterAgentStopSpaceWakeInput,
  type CenterAgentUpdateAgentProfileRuntimeSettingsInput,
  type CenterAgentUpdateSpaceSettingsInput,
  type CenterAgentWakeAgentProfilesInSpaceInput,
  type CenterAgentWakeAgentProfilesInSpacesInput,
  type CenterAgentWatchAgentTaskInput,
  type ClearSpacePasswordInput,
  type CompleteConnectorDisconnectInput,
  type CompleteGitHubAppInstallationInput,
  type ConnectCandidateInput,
  type ConnectCenterAgentSlackWorkspaceInput,
  type ConnectDeclaredPathInput,
  type ConsumeMessageChannelIdentityLinkInput,
  type ConsumeSlackIdentityLinkInput,
  type ConsumeSlackOAuthStateInput,
  type ConvertDirectMessageToSpaceInput,
  type CoreRpcContextInput,
  type CreateCenterAgentContextLoadReceiptInput,
  type CreateCenterAgentContextManifestInput,
  type CreateCurrentOrganizationConnectorAppRequestInput,
  type CreateProjectInput,
  type CreateRoutineInput,
  type CreateSlackOAuthStateInput,
  type CreateSpaceDiagnosticReportInput,
  type CreateSpaceFolderInput,
  type CreateSpaceInput,
  type CreateSpaceTaskInput,
  type DeleteAgentDirectMessageSessionInput,
  type DeleteRoutineInput,
  type DeleteSpaceAttachmentRecordInput,
  type DeleteSpaceAttachmentRecordResult,
  type DeleteSpaceInput,
  type DeleteSpaceResult,
  type DesignateCenterAgentInput,
  type DisableAgentProfilePrimaryBindingInput,
  type DiscardSpaceComposerUploadRpcInput,
  type DisconnectCenterAgentSlackWorkspaceInput,
  type DisconnectLarkPlatformRegistrationInput,
  type DisconnectMessageChannelIdentityLinkInput,
  type DiscoverProjectsInput,
  type EnrollLocalRuntimeInput,
  type EnsureAgentProfilePrimaryBindingInput,
  type ExecuteAgentProfileWorkRecoveryInput,
  type ExecuteExecutionRecoveryInput,
  type ForgetComputerInput,
  type GetActiveSpaceWakeProgressInput,
  type GetAgentExecutionReadinessBatchInput,
  type GetAgentExecutionReadinessInput,
  type GetAgentProfileControllerChangeEligibilityInput,
  type GetAgentProfileCreationDefaultsInput,
  type GetAgentProfileFoldersInput,
  type GetAgentProfilePrimaryBindingInput,
  type GetCenterAgentDesignationInput,
  type GetCenterAgentDirectMessageSpaceProjectionInput,
  type GetCenterAgentModelInput,
  type GetCenterAgentOperatingStateInput,
  type GetCurrentAgentProfileSessionInput,
  type GetCurrentAgentProfileWorkspaceInput,
  type GetCurrentDeviceTargetInput,
  type GetCurrentLocalAgentInstallationsInput,
  type GetCurrentLocalRuntimeReplyReadinessInput,
  type GetCurrentOrganizationAgentRuntimeOverviewInput,
  type GetCurrentOrganizationComputersInput,
  type GetCurrentOrganizationDirectoryInput,
  type GetCurrentOrganizationMemberOpenMeldServiceStatusesInput,
  type GetCurrentOrganizationProfileDirectoryInput,
  type GetCurrentOrganizationSpaceDirectoryInput,
  type GetLocalRuntimeExpectedRoutesInput,
  type GetLocalRuntimesInput,
  type GetPeopleComputerReplyReadinessInput,
  type GetPrepareReadinessInput,
  type GetSpaceBoardInput,
  type GetSpaceBootstrapInput,
  type GetSpaceContractInput,
  type GetSpaceConversationStateRpcInput,
  type GetSpaceCursorInput,
  type GetSpaceDispatchLookupInput,
  type GetSpaceDispatchResultInput,
  type GetSpaceDispatchTraceInput,
  type GetSpaceEntryResolutionRpcInput,
  type GetSpaceFileInput,
  type GetSpaceMembersInput,
  type GetSpaceMessageDetailsInput,
  type GetSpaceMessageReactionsInput,
  type GetSpaceMetaInput,
  type GetSpaceStatusInput,
  type GetSpaceTaskInput,
  type GetSpaceThreadInput,
  type GetSpaceUpdatesInput,
  type GetSpaceViewerMembershipInput,
  type GetSpaceWakeProgressInput,
  type GetSpaceWakeTraceWaterfallInput,
  type InspectExecutionRecoveryInput,
  type InstallSlackWorkspaceFromOAuthInput,
  type IssueSlackIdentityLinkFromOAuthInput,
  type JoinOrganizationPublicSpaceInput,
  type LeaveSpaceInput,
  type ListAccountSpaceActiveWakeSummaryInput,
  type ListAccountSpacesInput,
  type ListActiveLarkPlatformRegistrationsInput,
  type ListAgentDirectMessageSessionsInput,
  type ListCenterAgentAuditJournalInput,
  type ListCenterAgentSessionsInput,
  type ListCurrentOrganizationConnectorAppRequestsInput,
  type ListCurrentOrganizationConnectorConnectionsInput,
  type ListMessageChannelConnectionsInput,
  type ListProjectsInput,
  type ListRoutineRunsInput,
  type ListRoutinesInput,
  type ListRoutineTargetSpacesInput,
  type ListSignalsInput,
  type ListSignalsResult,
  type ListSpaceFilesInput,
  type ListSpaceTasksInput,
  type ListSpaceThreadEventsInput,
  type ListSpaceThreadSignalsInput,
  type ListSpaceThreadsInput,
  type ManageAgentProfileFoldersInput,
  type MutateSpaceTaskInput,
  type NotifyAgentProfileRouteCatalogChangedInput,
  type NotifyAgentProfilesRouteCatalogChangedInput,
  type OpenCenterAgentDirectMessageSpaceInput,
  type OpenDirectMessageSpaceInput,
  type PatchSpaceContractInput,
  type PauseRoutineInput,
  type PollLarkPlatformRegistrationInput,
  type PostSignalInput,
  type PostSpaceWakeStopInput,
  type PostTransientSignalInput,
  type PreviewMessageChannelIdentityLinkInput,
  type PreviewSlackIdentityLinkInput,
  type PublishSpaceComposerUploadRpcInput,
  type PutSpaceContractInput,
  type ReadAgentActivitySessionInventoryInput,
  type ReadAgentActivitySnapshotInput,
  type ReadAgentActivityStatsInput,
  type ReadCenterAgentOrganizationMemoryPolicyInput,
  type ReadChangelogInput,
  type ReadComputerFileAccessPolicyInput,
  type ReadCurrentOrganizationFeedbackReportingPolicyInput,
  type ReadOrganizationInformationProtectionPolicyInput,
  type ReadOrganizationUsageOverviewInput,
  type ReadPendingGitHubAppInstallationInput,
  type ReadSpaceFileContentRpcInput,
  type ReadSpaceFileContentRpcResponse,
  type ReconcileCurrentOrganizationConnectorConnectionsInput,
  type RecordCenterAgentAuditInput,
  type RecordCurrentOrganizationMemberPresenceInput,
  type RecordCurrentOrganizationWebActivityInput,
  type RecordSpaceAttachmentInput,
  type RefreshCurrentLocalAgentCatalogInput,
  type RemoveConnectionInput,
  type RemoveMissingConnectionsInput,
  type RemoveSpaceMembersInput,
  type RequestCurrentOpenMeldToolsUpdateInput,
  type RequestMessageChannelSetupInput,
  type ResolveSpaceAttachmentForDownloadInput,
  type ResolveSpaceFileContentRpcInput,
  type RespondToSpaceAgentInteractionInput,
  type RestoreSpaceFileEntryInput,
  type RestoreSpaceFileRevisionInput,
  type ResumeRoutineInput,
  resolveCenterAgentSpaceAddressingVersion,
  rpcAddCenterAgentToSpace,
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcAddSpaceMembers,
  rpcAgentProfileExecutionMode,
  rpcArchiveProject,
  rpcAssertCurrentDesignatedCenterAgent,
  rpcAuthorizeConnectorDisconnect,
  rpcBeginCurrentMemberConnectorAuthorization,
  rpcBeginCurrentOrganizationGitHubAppInstallation,
  rpcBeginCurrentOrganizationSharedConnectorAuthorization,
  rpcBeginExistingGitHubAppInstallationVerification,
  rpcBeginGitHubAppInstallationVerification,
  rpcBeginLarkPlatformRegistration,
  rpcCenterAgentAddAgentProfilesToSpace,
  rpcCenterAgentAddMembersToSpace,
  rpcCenterAgentCheckAgentProfileReadiness,
  rpcCenterAgentConnectAgentProfileToLocalAgent,
  rpcCenterAgentContinueTaskSummary,
  rpcCenterAgentCreateAgentProfile,
  rpcCenterAgentCreateSpace,
  rpcCenterAgentEnableAgentProfile,
  rpcCenterAgentGetOrganizationDirectory,
  rpcCenterAgentGetOrganizationSpaceDirectory,
  rpcCenterAgentListActiveSpaceWakes,
  rpcCenterAgentListAgentActivitySessions,
  rpcCenterAgentListAgentProfileCreationDefaults,
  rpcCenterAgentListAgentTasks,
  rpcCenterAgentListComputers,
  rpcCenterAgentListConnectorServices,
  rpcCenterAgentListLocalAgentConnectionCandidates,
  rpcCenterAgentListLocalAgentInstallations,
  rpcCenterAgentListOpportunities,
  rpcCenterAgentListOrganizationMembers,
  rpcCenterAgentListSlackChannels,
  rpcCenterAgentListSpaceFiles,
  rpcCenterAgentManageSpaceFiles,
  rpcCenterAgentPostSlackChannelMessage,
  rpcCenterAgentPostSlackFile,
  rpcCenterAgentPostSlackThreadMessage,
  rpcCenterAgentPostSpaceMessage,
  rpcCenterAgentReadAgentActivity,
  rpcCenterAgentReadAuditJournal,
  rpcCenterAgentReadChangelog,
  rpcCenterAgentReadConnectorActionOperation,
  rpcCenterAgentReadDispatchHistory,
  rpcCenterAgentReadMemberComputers,
  rpcCenterAgentReadMemberOpenMeldServiceStatus,
  rpcCenterAgentReadPeopleComputers,
  rpcCenterAgentReadSlackChannelHistory,
  rpcCenterAgentReadSlackChannelMembers,
  rpcCenterAgentReadSlackFile,
  rpcCenterAgentReadSlackWorkspaceDirectory,
  rpcCenterAgentReadSpaceAuthoringContract,
  rpcCenterAgentReadSpaceContext,
  rpcCenterAgentReadSpaceFile,
  rpcCenterAgentReadSpaceWakeProgress,
  rpcCenterAgentReadTurnDiagnostics,
  rpcCenterAgentRecommendOpportunity,
  rpcCenterAgentRecordConnectorActionAudit,
  rpcCenterAgentRecordConnectorActionOperation,
  rpcCenterAgentRememberForOrganization,
  rpcCenterAgentRemoveAgentProfilesFromSpace,
  rpcCenterAgentRequestOpenMeldToolsUpdate,
  rpcCenterAgentResolveConnectorConnection,
  rpcCenterAgentRespondToOpportunity,
  rpcCenterAgentSaveSpaceFile,
  rpcCenterAgentSearchSlackMessages,
  rpcCenterAgentSelectLocalAgentInstallation,
  rpcCenterAgentSetOpenMeldToolsMaintenance,
  rpcCenterAgentSpaceInputQueue,
  rpcCenterAgentStartSelfMemberResearch,
  rpcCenterAgentStopSpaceWake,
  rpcCenterAgentUpdateAgentProfileRuntimeSettings,
  rpcCenterAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace,
  rpcCenterAgentUpdateSpaceSettings,
  rpcCenterAgentWakeAgentProfilesInSpace,
  rpcCenterAgentWakeAgentProfilesInSpaces,
  rpcCenterAgentWatchAgentTask,
  rpcClearSpacePassword,
  rpcCommitSpaceFileWrite,
  rpcCompleteConnectorDisconnect,
  rpcCompleteGitHubAppInstallation,
  rpcComputerPowerSettings,
  rpcConnectCandidate,
  rpcConnectCenterAgentSlackWorkspace,
  rpcConnectDeclaredPath,
  rpcConnectPeopleComputerProjectCandidate,
  rpcConnectPeopleComputerProjectPath,
  rpcConsumeMessageChannelIdentityLink,
  rpcConsumeSlackIdentityLink,
  rpcConsumeSlackOAuthState,
  rpcConvertDirectMessageToSpace,
  rpcCreateCenterAgentContextLoadReceipt,
  rpcCreateCenterAgentContextManifest,
  rpcCreateCurrentOrganizationConnectorAppRequest,
  rpcCreateProject,
  rpcCreateRoutine,
  rpcCreateSlackOAuthState,
  rpcCreateSpace,
  rpcCreateSpaceDiagnosticReport,
  rpcCreateSpaceFolder,
  rpcCreateSpaceTask,
  rpcDeleteAgentDirectMessageSession,
  rpcDeleteConversationForMe,
  rpcDeleteRoutine,
  rpcDeleteSpace,
  rpcDeleteSpaceAttachmentRecord,
  rpcDesignateCenterAgent,
  rpcDisableAgentProfilePrimaryBinding,
  rpcDiscardSpaceComposerUpload,
  rpcDisconnectCenterAgentSlackWorkspace,
  rpcDisconnectLarkPlatformRegistration,
  rpcDisconnectMessageChannelIdentityLink,
  rpcDiscoverPeopleComputerProjects,
  rpcDiscoverProjects,
  rpcEnrollLocalRuntime,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcExecuteAgentProfileWorkRecovery,
  rpcExecuteExecutionRecovery,
  rpcFirstWork,
  rpcForgetComputer,
  rpcForgetCurrentComputer,
  rpcGetActiveSpaceWakeProgress,
  rpcGetAgentExecutionReadiness,
  rpcGetAgentExecutionReadinessBatch,
  rpcGetAgentProfileControllerChangeEligibility,
  rpcGetAgentProfileCreationDefaults,
  rpcGetAgentProfileFolders,
  rpcGetAgentProfilePrimaryBinding,
  rpcGetCenterAgentDesignation,
  rpcGetCenterAgentDirectMessageSpaceProjection,
  rpcGetCenterAgentModel,
  rpcGetCenterAgentOperatingState,
  rpcGetCurrentAgentProfileSession,
  rpcGetCurrentAgentProfileWorkspace,
  rpcGetCurrentDeviceTarget,
  rpcGetCurrentLocalAgentInstallations,
  rpcGetCurrentLocalRuntimeReplyReadiness,
  rpcGetCurrentOrganizationAgentRuntimeOverview,
  rpcGetCurrentOrganizationComputers,
  rpcGetCurrentOrganizationDirectory,
  rpcGetCurrentOrganizationMemberOpenMeldServiceStatuses,
  rpcGetCurrentOrganizationMemberPresence,
  rpcGetCurrentOrganizationProfileDirectory,
  rpcGetCurrentOrganizationSpaceDirectory,
  rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts,
  rpcGetLocalRuntimeExpectedRoutes,
  rpcGetPeopleComputerLocalAgentInstallations,
  rpcGetPeopleComputerReplyReadiness,
  rpcGetPrepareReadiness,
  rpcGetSpaceBoard,
  rpcGetSpaceBootstrap,
  rpcGetSpaceBootstrapWithTiming,
  rpcGetSpaceContract,
  rpcGetSpaceConversationState,
  rpcGetSpaceCursor,
  rpcGetSpaceDispatchLookup,
  rpcGetSpaceDispatchResult,
  rpcGetSpaceDispatchTrace,
  rpcGetSpaceEntryResolution,
  rpcGetSpaceFile,
  rpcGetSpaceHistoryNavigation,
  rpcGetSpaceIdentityDirectory,
  rpcGetSpaceLinkPreviews,
  rpcGetSpaceMemberDirectory,
  rpcGetSpaceMembers,
  rpcGetSpaceMessageDetails,
  rpcGetSpaceMessageReactions,
  rpcGetSpaceMeta,
  rpcGetSpaceStatus,
  rpcGetSpaceTask,
  rpcGetSpaceThread,
  rpcGetSpaceUpdates,
  rpcGetSpaceViewerMembership,
  rpcGetSpaceWakeProgress,
  rpcGetSpaceWakeTraceWaterfall,
  rpcInspectExecutionRecovery,
  rpcInstallSlackWorkspaceFromOAuth,
  rpcIssueSlackIdentityLinkFromOAuth,
  rpcJoinOrganizationPublicSpace,
  rpcLeaveSpace,
  rpcListAccountSpaceActiveWakeSummary,
  rpcListAccountSpaces,
  rpcListActiveLarkPlatformRegistrations,
  rpcListAgentDirectMessageSessions,
  rpcListCenterAgentAuditJournal,
  rpcListCenterAgentSessions,
  rpcListCurrentOrganizationConnectorAppRequests,
  rpcListCurrentOrganizationConnectorConnections,
  rpcListLocalRuntimes,
  rpcListMessageChannelConnections,
  rpcListPeopleComputers,
  rpcListProjects,
  rpcListRoutineRuns,
  rpcListRoutines,
  rpcListRoutineTargetSpaces,
  rpcListSignals,
  rpcListSpaceFileRevisions,
  rpcListSpaceFiles,
  rpcListSpaceTasks,
  rpcListSpaceThreadEvents,
  rpcListSpaceThreadSignals,
  rpcListSpaceThreads,
  rpcManageAgentProfileFolders,
  rpcManagePeopleComputerLocalAgentUpdate,
  rpcMutateSpaceMessage,
  rpcMutateSpaceTask,
  rpcNotifyAgentProfileRouteCatalogChanged,
  rpcNotifyAgentProfilesRouteCatalogChanged,
  rpcOpenCenterAgentDirectMessageSpace,
  rpcOpenDirectMessageSpace,
  rpcPatchSpaceContract,
  rpcPauseRoutine,
  rpcPollLarkPlatformRegistration,
  rpcPostSignal,
  rpcPostSpaceWakeStop,
  rpcPostTransientSignal,
  rpcPrepareSpaceFileWrite,
  rpcPreviewMessageChannelIdentityLink,
  rpcPreviewSlackIdentityLink,
  rpcPublishSpaceComposerUpload,
  rpcPutSpaceContract,
  rpcReadAgentActivitySessionInventory,
  rpcReadAgentActivitySnapshot,
  rpcReadAgentActivityStats,
  rpcReadCenterAgentOrganizationMemoryPolicy,
  rpcReadChangelog,
  rpcReadComputerFileAccessPolicy,
  rpcReadCurrentOrganizationFeedbackReportingPolicy,
  rpcReadOrganizationInformationProtectionPolicy,
  rpcReadOrganizationUsageOverview,
  rpcReadPendingGitHubAppInstallation,
  rpcReadPeopleComputerFileAccessPolicy,
  rpcReadProjectIssueRouting,
  rpcReadServiceConnectionIncidents,
  rpcReadSpaceFileContent,
  rpcReconcileCurrentOrganizationConnectorConnections,
  rpcRecordCenterAgentAudit,
  rpcRecordCurrentOrganizationMemberPresence,
  rpcRecordCurrentOrganizationWebActivity,
  rpcRecordSpaceAttachment,
  rpcRefreshCurrentLocalAgentCatalog,
  rpcRefreshPeopleComputerLocalAgentCatalog,
  rpcRemoteAgentGetOrganizationDirectory,
  rpcRemoteAgentOpenDirectMessageSpace,
  rpcRemoveConnection,
  rpcRemoveMissingConnections,
  rpcRemoveSpaceMembers,
  rpcReportServiceConnectionIncident,
  rpcRequestCurrentOpenMeldToolsUpdate,
  rpcRequestMessageChannelSetup,
  rpcRequestPeopleComputerOpenMeldToolsUpdate,
  rpcResolveSpaceAttachmentForDownload,
  rpcResolveSpaceFileContent,
  rpcRespondToSpaceAgentInteraction,
  rpcRestoreSpaceFileEntry,
  rpcRestoreSpaceFileRevision,
  rpcResumeRoutine,
  rpcSelectCurrentLocalAgentInstallation,
  rpcSelectLocalFolders,
  rpcSelectPeopleComputerFolders,
  rpcSelectPeopleComputerLocalAgentInstallation,
  rpcSetAgentProfileCreationDefaults,
  rpcSetBoundPeopleComputerAgentProfileWorkspace,
  rpcSetCenterAgentOrganizationMemoryPolicy,
  rpcSetCurrentAgentProfileWorkspace,
  rpcSetCurrentLocalAgentEnabled,
  rpcSetCurrentOpenMeldToolsMaintenance,
  rpcSetCurrentOrganizationFeedbackReportingPolicy,
  rpcSetDefaultConnection,
  rpcSetLocalRuntimeDisplayName,
  rpcSetOrganizationInformationProtectionPolicy,
  rpcSetPeopleComputerLocalAgentEnabled,
  rpcSetPeopleComputerOpenMeldToolsMaintenance,
  rpcSetPeopleComputerProjectDefaultConnection,
  rpcSetSpaceAccessMode,
  rpcSetSpaceMessageReaction,
  rpcSpaceFilePins,
  rpcSpaceFileUpdateSettings,
  rpcSpaceFileUpload,
  rpcSpaceInputQueue,
  rpcSpaceMessagePins,
  rpcStageSpaceComposerUpload,
  rpcStreamSpaceFileContent,
  rpcSubmitAgentActivityEvents,
  rpcSubmitAgentActivitySessionReconciliation,
  rpcSubmitAgentControllerTaskLifecycleEvents,
  rpcSubmitRuntimeProviderConversationProofs,
  rpcSubmitRuntimeRegistration,
  rpcTrashSpaceFileEntry,
  rpcUpdateAgentDirectMessageSession,
  rpcUpdateAgentProfileDefaultProject,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode,
  rpcUpdateAgentProfilePrimaryBindingModelSelection,
  rpcUpdateAgentProfilePrimaryBindingOpenCodePermission,
  rpcUpdateBoundAgentProfileDefaultProject,
  rpcUpdateCenterAgentModel,
  rpcUpdateCenterAgentOperatingState,
  rpcUpdateCenterAgentProfile,
  rpcUpdateComputerFileAccessPolicy,
  rpcUpdatePeopleComputerFileAccessPolicy,
  rpcUpdateProject,
  rpcUpdateProjectIssueRouting,
  rpcUpdateRoutine,
  rpcUpdateSpaceCursor,
  rpcUpdateSpaceFileEntry,
  rpcUpdateSpaceMeta,
  rpcUpsertSpacePassword,
  rpcWipeCurrentMemberCenterAgentMemory,
  rpcWriteCurrentDeviceObservedMetadata,
  rpcWriteSpaceFileContent,
  runSlackInstallationWelcomePreparationTick,
  type SelectCurrentLocalAgentInstallationInput,
  type SelectLocalFoldersInput,
  type SetAgentProfileCreationDefaultsInput,
  type SetCenterAgentOrganizationMemoryPolicyInput,
  type SetCurrentAgentProfileWorkspaceInput,
  type SetCurrentLocalAgentEnabledInput,
  type SetCurrentOpenMeldToolsMaintenanceInput,
  type SetCurrentOrganizationFeedbackReportingPolicyInput,
  type SetDefaultConnectionInput,
  type SetLocalRuntimeDisplayNameInput,
  type SetOrganizationInformationProtectionPolicyInput,
  type SetSpaceAccessModeInput,
  type SetSpaceMessageReactionInput,
  type SpaceAccessModeStateResult,
  type SpaceFilePinsInput,
  type SpaceFileWriteInput,
  type SpaceInputQueueInput,
  type SpaceMessagePinsInput,
  type SpacePasswordStateResult,
  type StageSpaceComposerUploadRpcInput,
  type SubmitAgentActivityEventsInput,
  type SubmitAgentActivitySessionReconciliationInput,
  type SubmitAgentControllerTaskLifecycleEventsInput,
  type SubmitRuntimeAgentControllerReportsInput,
  type SubmitRuntimeProviderConversationProofsInput,
  type SubmitRuntimeRegistrationInput,
  type TrashSpaceFileEntryInput,
  type UpdateAgentDirectMessageSessionInput,
  type UpdateAgentProfileDefaultProjectInput,
  type UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput,
  type UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput,
  type UpdateAgentProfilePrimaryBindingModelSelectionInput,
  type UpdateAgentProfilePrimaryBindingOpenCodePermissionInput,
  type UpdateCenterAgentModelInput,
  type UpdateCenterAgentOperatingStateInput,
  type UpdateCenterAgentProfileInput,
  type UpdateComputerFileAccessPolicyInput,
  type UpdateProjectInput,
  type UpdateRoutineInput,
  type UpdateSpaceCursorInput,
  type UpdateSpaceFileEntryInput,
  type UpdateSpaceMetaInput,
  type UpsertSpacePasswordInput,
  type WipeCurrentMemberCenterAgentMemoryInput,
  type WriteCurrentDeviceObservedMetadataInput,
  type WriteSpaceFileContentRpcInput,
} from "./rpc/methods";
import { reasoningPreferences } from "./runtime-transport/application/reasoning-preferences";
import { RuntimeTransportHub } from "./runtime-transport/transport/do/runtime-transport-hub";
import {
  ROUTINE_TICK_CRON,
  runCoreScheduledTasks,
} from "./scheduled/core-scheduled-tasks";
import {
  rpcReadMessages,
  rpcRemoteAgentReadMessages,
} from "./search/message-read";
import { rpcSearchMessages } from "./search/message-search";
import { runGatewaySensitiveOperation } from "./sensitive-operations/application/sensitive-operation-gate";
import {
  rpcAuthorizeSensitiveOperation,
  rpcDecideCredentialConfirmation,
  rpcGetCredentialConfirmation,
  rpcListMemberAgentSensitiveOperationAudit,
  rpcRecordSensitiveOperationOutcome,
} from "./sensitive-operations/sensitive-operation-rpc";
import { emitCoreCloudflareRuntimeEvidence } from "./shared/observability/cloudflare-runtime-evidence";
import { handleCoreQueueBatch } from "./shared/queue/core-queue-router";
import { verifyGitHubAppWebhook } from "./space/application/github-app-webhook-service";
import type { SpaceBootstrapWithTiming } from "./space/application/space-bootstrap-timing";
import { spacePreferences } from "./space/application/space-preferences";
import { Space } from "./space/transport/do/space";
import {
  type ProjectSpaceIndexMembershipOverlayRpcInput,
  type ProjectSpaceIndexMembershipOverlayRpcResult,
  rpcProjectSpaceIndexMembershipOverlay,
} from "./space-index/space-index-overlay-rpc";
import { listMembershipSpaceIdsForProfilesFromSpaceIndex } from "./space-index/space-index-repository";
import { rpcReadAiBilling, rpcUpdateAiBilling } from "./usage/ai-billing-rpc";
import {
  rpcCenterAgentReadAiUsage,
  rpcReadOrganizationAiUsage,
  rpcRecordRemoteAiUsage,
} from "./usage/ai-usage-rpc";
// Narrow first-party entrypoint for the auth worker's profile lifecycle
// fan-out. Kept separate from GatewayRpcEntrypoint so auth only gets the
// reconcile surface instead of the whole gateway RPC surface.
export class ProfileLifecycleEntrypoint extends WorkerEntrypoint<CoreBindings> {
  /** Auth's Agent Profile deletion asks the sensitive operation gate first. */
  authorizeSensitiveOperation(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAuthorizeSensitiveOperation(this.env, input)
    );
  }
  recordSensitiveOperationOutcome(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordSensitiveOperationOutcome(this.env, input)
    );
  }
  organizationJoinRequest(
    input: import("@openmeld/schemas").OrganizationJoinRequestRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      organizationJoinRequest(this.env, input)
    );
  }
  checkSpaceOwnerDeparture(
    input: import("@openmeld/schemas").SpaceOwnerDepartureInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      checkSpaceOwnerDeparture(this.env, input)
    );
  }
  cleanupDeletedAccount(
    input: import("@openmeld/schemas").AccountDeletionCleanupInput
  ) {
    return cleanupDeletedAccount(this.env, input);
  }
  cleanupDeletedAccountConnection(input: unknown) {
    return cleanupDeletedAccountConnection(this.env, input);
  }
  spaceInvitation(
    input: import("@openmeld/schemas").SpaceInvitationRpcInput
  ): Promise<import("@openmeld/schemas").SpaceInvitationRpcResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      spaceInvitation(this.env, input)
    );
  }
  reconcileDeletedAgentProfile(
    input: ReconcileDeletedAgentProfileRequest
  ): Promise<ReconcileDeletedAgentProfileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      reconcileDeletedAgentProfile(this.env, input)
    );
  }
  projectSpaceIndexMembershipOverlay(
    input: ProjectSpaceIndexMembershipOverlayRpcInput
  ): Promise<ProjectSpaceIndexMembershipOverlayRpcResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcProjectSpaceIndexMembershipOverlay(this.env, input)
    );
  }
  async requestAgentActivitySessionInventoryCleanupForOrganizationMember(input: {
    organizationId?: string | null;
    userId?: string | null;
  }): Promise<{
    accepted?: boolean;
    code?: string;
    deleted?: {
      candidateCount: number;
      inventoryCount: number;
      sourceCount: number;
    };
    ok: boolean;
    pending?: boolean;
  }> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const organizationId = normalizeOptionalRpcText(input.organizationId);
      const userId = normalizeOptionalRpcText(input.userId);
      if (!(organizationId && userId)) {
        return { code: "invalid_payload", ok: false };
      }
      const db = getPostgresDatabase(this.env);
      if (!db) {
        return { code: "agent_activity.store_unavailable", ok: false };
      }
      const result = await acceptAgentActivitySessionInventoryMemberCleanup({
        db,
        nowMs: Date.now(),
        organizationId,
        ownerUserId: userId,
        resolveMembershipState: async (subject) => {
          const membership = await resolveOrganizationMembershipById({
            env: this.env,
            organizationId: subject.organizationId,
            userId: subject.ownerUserId,
          });
          if (membership.ok) {
            return "active";
          }
          return membership.code === "organization.membership_required"
            ? "removed"
            : "unavailable";
        },
      });
      return {
        accepted: true,
        deleted: result.deleted,
        ok: true,
        pending: result.pending,
      };
    });
  }
  deleteAgentActivitySessionInventoryForOrganizationMember(input: {
    organizationId?: string | null;
    userId?: string | null;
  }) {
    return this.requestAgentActivitySessionInventoryCleanupForOrganizationMember(
      input
    );
  }
  async deleteCenterAgentMemberMemory(input: {
    organizationId?: string | null;
    userId?: string | null;
  }): Promise<{
    code?: string;
    ok: boolean;
    status?: "deleted" | "not_found";
  }> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const organizationId = normalizeOptionalRpcText(input.organizationId);
      const userId = normalizeOptionalRpcText(input.userId);
      if (!(organizationId && userId)) {
        return { code: "invalid_payload", ok: false };
      }
      const memoryService = createCoreCenterAgentMemoryService(this.env);
      if (!memoryService) {
        await clearCoreCenterAgentMemberNativeDeliveryData(
          this.env,
          organizationId,
          userId
        );
        return { code: "center_agent_memory.unavailable", ok: false };
      }
      const status = await memoryService.deleteMemberMemory({
        organizationId,
        userId,
      });
      return { ok: true, status };
    });
  }
  async deleteCenterAgentOrganizationMemory(input: {
    organizationId?: string | null;
  }): Promise<{
    code?: string;
    ok: boolean;
    status?: "deleted" | "not_found";
  }> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const organizationId = normalizeOptionalRpcText(input.organizationId);
      if (!organizationId) {
        return { code: "invalid_payload", ok: false };
      }
      const memoryService = createCoreCenterAgentMemoryService(this.env);
      if (!memoryService) {
        await clearCoreCenterAgentOrganizationNativeDeliveryData(
          this.env,
          organizationId
        );
        return { code: "center_agent_memory.unavailable", ok: false };
      }
      const status = await memoryService.deleteOrganizationMemory({
        organizationId,
      });
      return { ok: true, status };
    });
  }
  // Space authorization read for the auth worker (Knife 1 split-brain fix).
  // Auth reads the core-owned space_index_memberships projection through this
  // RPC instead of binding the DB directly, so the read always lands on whatever
  // DB core writes (openmeld-db pre-cutover, openmeld-projections after). Pure read; the
  // union-with-history / fall-back-to-history authorization decision stays in auth.
  listMembershipSpaceIdsForProfiles(input: {
    profileIds: readonly string[];
    spaceIds: readonly string[];
  }): Promise<string[]> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      // Fail closed: no membership evidence → auth falls back to history-only.
      return Promise.resolve([]);
    }
    return listMembershipSpaceIdsForProfilesFromSpaceIndex({
      db,
      profileIds: input.profileIds,
      spaceIds: input.spaceIds,
    });
  }
}
function normalizeOptionalRpcText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
class CoreRpcEntrypoint extends WorkerEntrypoint<CoreBindings> {
  firstWork(input: Parameters<typeof rpcFirstWork>[1]) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcFirstWork(this.env, input)
    );
  }
  // Keep fetch for WebSocket upgrade proxying and internal service calls.
  // In production, openmeld-core is not directly exposed; it should only be called
  // through Gateway service binding. dev localhost access is used for local tests.
  fetch(request: Request): Promise<Response> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      app.fetch(request, this.env, this.ctx)
    );
  }
  createSpace(input?: CreateSpaceInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateSpace(this.env, input)
    );
  }
  listAccountSpaces(
    input: ListAccountSpacesInput
  ): Promise<AccountSpaceIndexResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAccountSpaces(this.env, input)
    );
  }
  listAccountSpaceActiveWakeSummary(
    input: ListAccountSpaceActiveWakeSummaryInput
  ): Promise<AccountSpaceActiveWakeSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAccountSpaceActiveWakeSummary(this.env, input)
    );
  }
  listProjects(input: ListProjectsInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListProjects(this.env, input)
    );
  }

  readProjectIssueRouting(
    input: Parameters<typeof rpcReadProjectIssueRouting>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadProjectIssueRouting(this.env, input)
    );
  }

  readProjectRepositorySettings(
    input: Parameters<typeof rpcReadProjectRepositorySettings>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadProjectRepositorySettings(this.env, input)
    );
  }

  updateProjectRepositorySettings(
    input: Parameters<typeof rpcUpdateProjectRepositorySettings>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateProjectRepositorySettings(this.env, input)
    );
  }

  readProjectCommonAgents(
    input: Parameters<typeof rpcReadProjectCommonAgents>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadProjectCommonAgents(this.env, input)
    );
  }

  readProjectRecentTasks(
    input: Parameters<typeof rpcReadProjectRecentTasks>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadProjectRecentTasks(this.env, input)
    );
  }

  updateProjectCommonAgents(
    input: Parameters<typeof rpcUpdateProjectCommonAgents>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateProjectCommonAgents(this.env, input)
    );
  }

  resolveProjectIssueAction(
    input: Parameters<typeof rpcResolveProjectIssueAction>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcResolveProjectIssueAction(this.env, input)
    );
  }

  updateProjectIssueRouting(
    input: Parameters<typeof rpcUpdateProjectIssueRouting>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateProjectIssueRouting(this.env, input)
    );
  }
  createProject(input: CreateProjectInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateProject(this.env, input)
    );
  }
  updateProject(input: UpdateProjectInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateProject(this.env, input)
    );
  }
  updateAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentProfileDefaultProject(this.env, input)
    );
  }
  updateBoundAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateBoundAgentProfileDefaultProject(this.env, input)
    );
  }
  archiveProject(input: ArchiveProjectInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcArchiveProject(this.env, input)
    );
  }
  discoverProjects(input: DiscoverProjectsInput) {
    return rpcDiscoverProjects(this.env, input);
  }
  discoverPeopleComputerProjects(
    input: Parameters<typeof rpcDiscoverPeopleComputerProjects>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDiscoverPeopleComputerProjects(this.env, input)
    );
  }
  connectPeopleComputerProjectCandidate(
    input: Parameters<typeof rpcConnectPeopleComputerProjectCandidate>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConnectPeopleComputerProjectCandidate(this.env, input)
    );
  }
  getPeopleComputerAgentProfileWorkspace(
    input: GetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget
  ) {
    const { deviceId, runtimeLane, ...request } = input;
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentAgentProfileWorkspace(this.env, request, {
        deviceId,
        runtimeLane,
      })
    );
  }
  setPeopleComputerAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget
  ) {
    const { deviceId, runtimeLane, ...request } = input;
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetCurrentAgentProfileWorkspace(this.env, request, {
        deviceId,
        runtimeLane,
      })
    );
  }
  setBoundPeopleComputerAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetBoundPeopleComputerAgentProfileWorkspace(this.env, input)
    );
  }
  connectPeopleComputerProjectPath(
    input: Parameters<typeof rpcConnectPeopleComputerProjectPath>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConnectPeopleComputerProjectPath(this.env, input)
    );
  }
  setPeopleComputerProjectDefaultConnection(
    input: Parameters<typeof rpcSetPeopleComputerProjectDefaultConnection>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetPeopleComputerProjectDefaultConnection(this.env, input)
    );
  }
  readComputerFileAccessPolicy(input: ReadComputerFileAccessPolicyInput) {
    return rpcReadComputerFileAccessPolicy(this.env, input);
  }
  agentSessionHistory(input: Parameters<typeof rpcAgentSessionHistory>[1]) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAgentSessionHistory(this.env, input)
    );
  }
  computerSessionHistory(
    input: Parameters<typeof rpcComputerSessionHistory>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcComputerSessionHistory(this.env, input)
    );
  }
  computerPowerSettings(input: Parameters<typeof rpcComputerPowerSettings>[1]) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcComputerPowerSettings(this.env, input)
    );
  }
  readPeopleComputerFileAccessPolicy(
    input: Parameters<typeof rpcReadPeopleComputerFileAccessPolicy>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadPeopleComputerFileAccessPolicy(this.env, input)
    );
  }
  updatePeopleComputerFileAccessPolicy(
    input: Parameters<typeof rpcUpdatePeopleComputerFileAccessPolicy>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdatePeopleComputerFileAccessPolicy(this.env, input)
    );
  }
  selectLocalFolders(input: SelectLocalFoldersInput) {
    return rpcSelectLocalFolders(this.env, input);
  }
  selectPeopleComputerFolders(
    input: Parameters<typeof rpcSelectPeopleComputerFolders>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSelectPeopleComputerFolders(this.env, input)
    );
  }
  updateComputerFileAccessPolicy(input: UpdateComputerFileAccessPolicyInput) {
    return rpcUpdateComputerFileAccessPolicy(this.env, input);
  }
  connectCandidate(input: ConnectCandidateInput) {
    return rpcConnectCandidate(this.env, input);
  }
  connectDeclaredPath(input: ConnectDeclaredPathInput) {
    return rpcConnectDeclaredPath(this.env, input);
  }
  setDefaultConnection(input: SetDefaultConnectionInput) {
    return rpcSetDefaultConnection(this.env, input);
  }
  removeConnection(input: RemoveConnectionInput) {
    return rpcRemoveConnection(this.env, input);
  }
  removeMissingConnections(input: RemoveMissingConnectionsInput) {
    return rpcRemoveMissingConnections(this.env, input);
  }
  submitAgentActivityEvents(input: SubmitAgentActivityEventsInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitAgentActivityEvents(this.env, input)
    );
  }
  submitAgentActivitySessionReconciliation(
    input: SubmitAgentActivitySessionReconciliationInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitAgentActivitySessionReconciliation(this.env, input)
    );
  }
  submitAgentControllerTaskLifecycleEvents(
    input: SubmitAgentControllerTaskLifecycleEventsInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitAgentControllerTaskLifecycleEvents(this.env, input)
    );
  }
  readAgentActivitySnapshot(input: ReadAgentActivitySnapshotInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadAgentActivitySnapshot(this.env, input)
    );
  }
  readAgentActivitySessionInventory(
    input: ReadAgentActivitySessionInventoryInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadAgentActivitySessionInventory(this.env, input)
    );
  }
  readAgentActivityStats(input: ReadAgentActivityStatsInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadAgentActivityStats(this.env, input)
    );
  }
  readOrganizationUsageOverview(input: ReadOrganizationUsageOverviewInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationUsageOverview(this.env, input)
    );
  }
  readOrganizationAiUsage(input: OrganizationAiUsageRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationAiUsage(this.env, input)
    );
  }
  listRoutines(input: ListRoutinesInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListRoutines(this.env, input)
    );
  }
  listRoutineTargetSpaces(input: ListRoutineTargetSpacesInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListRoutineTargetSpaces(this.env, input)
    );
  }
  createRoutine(input: CreateRoutineInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateRoutine(this.env, input)
    );
  }
  updateRoutine(input: UpdateRoutineInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateRoutine(this.env, input)
    );
  }
  pauseRoutine(input: PauseRoutineInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPauseRoutine(this.env, input)
    );
  }
  resumeRoutine(input: ResumeRoutineInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcResumeRoutine(this.env, input)
    );
  }
  deleteRoutine(input: DeleteRoutineInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteRoutine(this.env, input)
    );
  }
  listRoutineRuns(input: ListRoutineRunsInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListRoutineRuns(this.env, input)
    );
  }
  listInboxFeed(input: ListInboxFeedRpcInput): Promise<InboxFeedResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListInboxFeed(this.env, input, (stage, work) =>
        tracing.enterSpan(stage, work)
      )
    );
  }
  searchMessages(
    input: import("@openmeld/schemas").MessageSearchRpcInput,
    spaceImageGeometryVersion?: string
  ) {
    return withSpaceImageGeometryRpcOutput(
      rpcSearchMessages(this.env, input),
      spaceImageGeometryVersion
    );
  }
  readMessages(input: import("@openmeld/schemas").MessageReadRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadMessages(this.env, input)
    );
  }
  remoteAgentReadMessages(
    input: import("@openmeld/schemas").MessageReadRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentReadMessages(this.env, input)
    );
  }
  mutateInboxFeed(
    input: MutateInboxFeedRpcInput
  ): Promise<MutateInboxFeedResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMutateInboxFeed(this.env, input)
    );
  }
  mutateSpaceInboxRead(
    input: import("@openmeld/schemas/types").MutateSpaceInboxReadRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMutateSpaceInboxRead(this.env, input)
    );
  }
  listInboxItems(
    input: ListInboxItemsRpcInput
  ): Promise<ListInboxItemsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListInboxItems(this.env, input)
    );
  }
  observeInboxNotifications(
    input: import("@openmeld/schemas/types").ObserveInboxNotificationsRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcObserveInboxNotifications(this.env, input)
    );
  }
  dismissInboxItem(
    input: DismissInboxItemRpcInput
  ): Promise<DismissInboxItemResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDismissInboxItem(this.env, input)
    );
  }
  getInboxItem(input: GetInboxItemRpcInput): Promise<GetInboxItemResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetInboxItem(this.env, input)
    );
  }
  getInboxSummary(
    input: GetInboxSummaryRpcInput
  ): Promise<InboxSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetInboxSummary(this.env, input)
    );
  }
  getCenterAgentInboxSummary(
    input: GetCenterAgentInboxSummaryRpcInput
  ): Promise<CenterAgentInboxSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCenterAgentInboxSummary(this.env, input)
    );
  }
  getSpaceInboxSummary(
    input: GetSpaceInboxSummaryRpcInput
  ): Promise<SpaceInboxSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceInboxSummary(this.env, input)
    );
  }
  getSpaceInboxUnreadTargets(
    input: GetSpaceInboxUnreadTargetsRpcInput
  ): Promise<SpaceInboxUnreadTargetsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceInboxUnreadTargets(this.env, input)
    );
  }
  markCenterAgentInboxReadThrough(
    input: MarkCenterAgentInboxReadThroughRpcInput
  ): Promise<MarkCenterAgentInboxReadThroughResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMarkCenterAgentInboxReadThrough(this.env, input)
    );
  }
  markSpaceInboxReadThrough(
    input: MarkSpaceInboxReadThroughRpcInput
  ): Promise<MarkSpaceInboxReadThroughResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMarkSpaceInboxReadThrough(this.env, input)
    );
  }
  markInboxItemRead(
    input: MarkInboxItemReadRpcInput
  ): Promise<MarkInboxItemReadResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMarkInboxItemRead(this.env, input)
    );
  }
  markAllInboxItemsRead(
    input: MarkAllInboxItemsReadRpcInput
  ): Promise<MarkAllInboxItemsReadResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMarkAllInboxItemsRead(this.env, input)
    );
  }
  getInboxNotificationPreferences(
    input: GetInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetInboxNotificationPreferences(this.env, input)
    );
  }
  getInboxMessageNotificationPreferences(
    input: GetInboxMessageNotificationPreferencesRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetInboxMessageNotificationPreferences(this.env, input)
    );
  }
  updateInboxMessageNotificationPreferences(
    input: UpdateInboxMessageNotificationPreferencesRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateInboxMessageNotificationPreferences(this.env, input)
    );
  }
  localAgentReasoningPreferences(input: LocalAgentReasoningPreferencesRpc) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      reasoningPreferences(this.env, input)
    );
  }
  accountSpacePreferences(input: SpacePreferencesRpc) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      spacePreferences(this.env, input)
    );
  }
  updateInboxNotificationPreferences(
    input: UpdateInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateInboxNotificationPreferences(this.env, input)
    );
  }
  listOrganizationDocuments(
    input: ListOrganizationDocumentsRpcInput
  ): Promise<ListOrganizationDocumentsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListOrganizationDocuments(this.env, input)
    );
  }
  centerAgentReadOrganizationSkills(
    input: CenterAgentReadOrganizationSkillsRpcInput
  ): Promise<CenterAgentReadOrganizationSkillsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadOrganizationSkills(this.env, input)
    );
  }
  centerAgentInstallOrganizationSkill(
    input: CenterAgentInstallOrganizationSkillRpcInput
  ): Promise<CenterAgentInstallOrganizationSkillResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentInstallOrganizationSkill(this.env, input)
    );
  }
  listOrganizationSkills(
    input: ListOrganizationSkillsRpcInput
  ): Promise<ListOrganizationSkillsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListOrganizationSkills(this.env, input)
    );
  }
  getOrganizationSkill(
    input: GetOrganizationSkillRpcInput
  ): Promise<GetOrganizationSkillResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetOrganizationSkill(this.env, input)
    );
  }
  getOrganizationSkillCatalog(
    input: GetOrganizationSkillRpcInput
  ): Promise<OrganizationSkillRuntimeCatalogResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetOrganizationSkillCatalog(this.env, input)
    );
  }
  createOrganizationSkill(
    input: CreateOrganizationSkillRpcInput
  ): Promise<CreateOrganizationSkillResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateOrganizationSkill(this.env, input)
    );
  }
  importOrganizationSkillFromGitHub(
    input: ImportOrganizationSkillFromGitHubRpcInput
  ): Promise<ImportOrganizationSkillFromGitHubResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcImportOrganizationSkillFromGitHub(this.env, input)
    );
  }
  importOrganizationSkillFromFiles(
    input: ImportOrganizationSkillFromFilesRpcInput
  ): Promise<ImportOrganizationSkillFromFilesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcImportOrganizationSkillFromFiles(this.env, input)
    );
  }
  previewOrganizationSkillFromGitHub(
    input: PreviewOrganizationSkillFromGitHubRpcInput
  ): Promise<PreviewOrganizationSkillFromGitHubResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPreviewOrganizationSkillFromGitHub(this.env, input)
    );
  }
  previewOrganizationSkillRepository(
    input: PreviewOrganizationSkillRepositoryRpcInput
  ): Promise<PreviewOrganizationSkillRepositoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPreviewOrganizationSkillRepository(this.env, input)
    );
  }
  beginOrganizationSkillImportBatch(
    input: BeginOrganizationSkillImportBatchRpcInput
  ): Promise<BeginOrganizationSkillImportBatchResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginOrganizationSkillImportBatch(this.env, input)
    );
  }
  getOrganizationSkillImportBatch(
    input: GetOrganizationSkillImportBatchRpcInput
  ): Promise<GetOrganizationSkillImportBatchResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetOrganizationSkillImportBatch(this.env, input)
    );
  }
  listOrganizationSkillImportBatches(
    input: ListOrganizationSkillImportBatchesRpcInput
  ): Promise<ListOrganizationSkillImportBatchesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListOrganizationSkillImportBatches(this.env, input)
    );
  }
  previewOrganizationSkillFromFiles(
    input: PreviewOrganizationSkillFromFilesRpcInput
  ): Promise<PreviewOrganizationSkillFromFilesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPreviewOrganizationSkillFromFiles(this.env, input)
    );
  }
  updateOrganizationSkill(
    input: UpdateOrganizationSkillRpcInput
  ): Promise<UpdateOrganizationSkillResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateOrganizationSkill(this.env, input)
    );
  }
  setOrganizationSkillEnabled(
    input: SetOrganizationSkillEnabledRpcInput
  ): Promise<SetOrganizationSkillEnabledResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetOrganizationSkillEnabled(this.env, input)
    );
  }
  setOrganizationSkillMaintainers(
    input: SetOrganizationSkillMaintainersRpcInput
  ): Promise<SetOrganizationSkillMaintainersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetOrganizationSkillMaintainers(this.env, input)
    );
  }
  deleteOrganizationSkill(
    input: DeleteOrganizationSkillRpcInput
  ): Promise<DeleteOrganizationSkillResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteOrganizationSkill(this.env, input)
    );
  }
  readOrganizationSkillRuntimeSnapshot(
    input: ReadOrganizationSkillRuntimeSnapshotRpcInput
  ): Promise<OrganizationSkillRuntimeSnapshotResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationSkillRuntimeSnapshot(this.env, input)
    );
  }
  readOrganizationSkillRuntimeCatalog(
    input: ReadOrganizationSkillRuntimeCatalogRpcInput
  ): Promise<OrganizationSkillRuntimeCatalogResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationSkillRuntimeCatalog(this.env, input)
    );
  }
  readOrganizationSkillRuntimeResource(
    input: ReadOrganizationSkillRuntimeResourceRpcInput
  ): Promise<ReadOrganizationSkillRuntimeResourceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationSkillRuntimeResource(this.env, input)
    );
  }
  recordOrganizationSkillActivation(
    input: RecordOrganizationSkillActivationRpcInput
  ): Promise<RecordOrganizationSkillActivationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordOrganizationSkillActivation(this.env, input)
    );
  }
  getOrganizationDocument(
    input: GetOrganizationDocumentRpcInput
  ): Promise<GetOrganizationDocumentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetOrganizationDocument(this.env, input)
    );
  }
  createOrganizationDocument(
    input: CreateOrganizationDocumentRpcInput
  ): Promise<CreateOrganizationDocumentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateOrganizationDocument(this.env, input)
    );
  }
  updateOrganizationDocument(
    input: UpdateOrganizationDocumentRpcInput
  ): Promise<UpdateOrganizationDocumentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateOrganizationDocument(this.env, input)
    );
  }
  deleteOrganizationDocument(
    input: DeleteOrganizationDocumentRpcInput
  ): Promise<DeleteOrganizationDocumentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteOrganizationDocument(this.env, input)
    );
  }
  createOrganizationDocumentFolder(
    input: CreateOrganizationDocumentFolderRpcInput
  ): Promise<CreateOrganizationDocumentFolderResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateOrganizationDocumentFolder(this.env, input)
    );
  }
  updateOrganizationDocumentFolder(
    input: UpdateOrganizationDocumentFolderRpcInput
  ): Promise<UpdateOrganizationDocumentFolderResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateOrganizationDocumentFolder(this.env, input)
    );
  }
  deleteOrganizationDocumentFolder(
    input: DeleteOrganizationDocumentFolderRpcInput
  ): Promise<DeleteOrganizationDocumentFolderResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteOrganizationDocumentFolder(this.env, input)
    );
  }
  approveOrganizationDocumentDraft(
    input: ApproveOrganizationDocumentDraftRpcInput
  ): Promise<ApproveOrganizationDocumentDraftResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcApproveOrganizationDocumentDraft(this.env, input)
    );
  }
  discardOrganizationDocumentDraft(
    input: DiscardOrganizationDocumentDraftRpcInput
  ): Promise<DiscardOrganizationDocumentDraftResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDiscardOrganizationDocumentDraft(this.env, input)
    );
  }
  async startCenterAgentMemberResearch(
    input: StartCenterAgentMemberResearchRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const directMessage = await rpcOpenCenterAgentDirectMessageSpace(
        this.env,
        input
      );
      const response = await startCenterAgentMemberResearch(
        this.env,
        input,
        directMessage.spaceId
      );
      const db = getPostgresDatabase(this.env);
      if (db) {
        this.ctx.waitUntil(
          runCenterAgentMemberResearchTick({ db, env: this.env })
        );
      }
      return response;
    });
  }
  getCenterAgentMemberResearchStatus(
    input: GetCenterAgentMemberResearchStatusRpcInput
  ): Promise<GetCenterAgentMemberResearchStatusResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      getCenterAgentMemberResearchStatus(this.env, input)
    );
  }
  ping() {
    return { ok: true, service: "openmeld-core" } as const;
  }
  getModelCatalog(options?: ModelCatalogReadOptions): GetModelCatalogResponse {
    return readModelCatalog(modelCatalogReadOptionsSchema.parse(options ?? {}));
  }
  readChangelog(input: ReadChangelogInput): Promise<ChangelogQueryResponse> {
    return rpcReadChangelog(this.env, input);
  }
  inspectDbState(): DbFactSnapshot {
    return inspectCoreDbState(this.env);
  }
  inspectDispatchStorageReadiness(): Promise<DispatchStorageReadiness> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      inspectCoreDispatchStorageReadiness(this.env)
    );
  }
  listSignals(
    input: ListSignalsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSignalsResult> {
    return withSpaceAddressingRpcOutput(
      rpcListSignals(this.env, input),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  async postDeviceWaitingSignal(
    input: PostSignalInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SignalEnvelope> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      if (!input.deviceWait) {
        throw new Error("A device waiting request is required.");
      }
      return await this.#postSignalWithEvidence(
        input,
        spaceAddressingVersion,
        spaceImageGeometryVersion
      );
    });
  }
  async mutateSpaceMessage(
    input: import("./rpc/methods").MutateSpaceMessageInput,
    spaceImageGeometryVersion?: string
  ) {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      return toSpaceImageGeometryRpcOutput(
        toSpaceSignalReadWireValue(
          await rpcMutateSpaceMessage(this.env, input)
        ),
        spaceImageGeometryVersion
      );
    });
  }
  async postSignal(
    input: PostSignalInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SignalEnvelope> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      if (input.deviceWait) {
        throw new Error(
          "Device waiting requests require postDeviceWaitingSignal."
        );
      }
      return await this.#postSignalWithEvidence(
        input,
        spaceAddressingVersion,
        spaceImageGeometryVersion
      );
    });
  }
  async #postSignalWithEvidence(
    input: PostSignalInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SignalEnvelope> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const startedAt = Date.now();
      const requestId = input.context?.actorContext.requestId ?? null;
      const clientMessageId = input.meta?.clientMessageId ?? null;
      const activationTargetCount =
        input.messageEnvelope?.activationTargets.length ?? 0;
      const targetProfileId =
        input.messageEnvelope?.activationTargets[0] ?? null;
      emitCoreCloudflareRuntimeEvidence(this.env, {
        event: "core.openmeld.space.signal_post_started",
        workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "rpc",
        status: "started",
        operation: "postSignal",
        durationMs: 0,
        requestId,
        spaceId: input.spaceId,
        clientMessageId,
        targetProfileId,
        activationTargetCount,
      });
      try {
        const signal = await rpcPostSignal(this.env, {
          ...input,
          ...(spaceAddressingVersion ? { spaceAddressingVersion } : {}),
        });
        emitCoreCloudflareRuntimeEvidence(this.env, {
          event: "core.openmeld.space.signal_posted",
          workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
          runtimeKind: "rpc",
          status: "succeeded",
          operation: "postSignal",
          durationMs: Date.now() - startedAt,
          requestId,
          spaceId: input.spaceId,
          clientMessageId,
          sourceSignalId: signal.id,
          targetProfileId,
          activationTargetCount,
        });
        return toSpaceAddressingRpcOutput(
          signal,
          spaceAddressingVersion,
          spaceImageGeometryVersion
        );
      } catch (error) {
        emitCoreCloudflareRuntimeEvidence(this.env, {
          event: "core.openmeld.space.signal_post_failed",
          workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
          runtimeKind: "rpc",
          status: "failed",
          operation: "postSignal",
          durationMs: Date.now() - startedAt,
          reasonCode: "signal_post_failed",
          errorName: error instanceof Error ? error.name : typeof error,
          requestId,
          spaceId: input.spaceId,
          clientMessageId,
          targetProfileId,
          activationTargetCount,
        });
        throw error;
      }
    });
  }
  postTransientSignal(input: PostTransientSignalInput): Promise<void> {
    return rpcPostTransientSignal(this.env, input);
  }
  getSpaceMembers(input: GetSpaceMembersInput): Promise<SpaceMembersSnapshot> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceMembers(this.env, input)
    );
  }
  getSpaceHistoryNavigation(
    input: GetSpaceMembersInput & SpaceHistoryNavigationQuery
  ): Promise<SpaceHistoryNavigation> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceHistoryNavigation(this.env, input)
    );
  }
  getSpaceIdentityDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceIdentityDirectory> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceIdentityDirectory(this.env, input)
    );
  }
  getSpaceMemberDirectory(
    input: GetSpaceMembersInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceMemberDirectory> {
    return withSpaceAddressingRpcOutput(
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
        rpcGetSpaceMemberDirectory(this.env, input)
      ),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceViewerMembership(
    input: GetSpaceViewerMembershipInput
  ): Promise<SpaceViewerMembershipResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceViewerMembership(this.env, input)
    );
  }
  recordSpaceAttachment(
    input: RecordSpaceAttachmentInput
  ): Promise<SpaceAttachmentDescriptor> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordSpaceAttachment(this.env, input)
    );
  }
  deleteSpaceAttachmentRecord(
    input: DeleteSpaceAttachmentRecordInput
  ): Promise<DeleteSpaceAttachmentRecordResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteSpaceAttachmentRecord(this.env, input)
    );
  }
  resolveSpaceAttachmentForDownload(
    input: ResolveSpaceAttachmentForDownloadInput
  ): Promise<SpaceAttachmentDescriptor> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcResolveSpaceAttachmentForDownload(this.env, input)
    );
  }
  listSpaceFiles(
    input: ListSpaceFilesInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceFilesResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcListSpaceFiles(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  getSpaceFile(
    input: GetSpaceFileInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return withSpaceFilesOriginRpcOutput(
      rpcGetSpaceFile(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  listSpaceFileRevisions(
    input: GetSpaceFileInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceFileRevisionsResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcListSpaceFileRevisions(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  createSpaceFolder(
    input: CreateSpaceFolderInput
  ): Promise<CreateSpaceFolderResponse> {
    return rpcCreateSpaceFolder(this.env, input);
  }
  updateSpaceFileEntry(
    input: UpdateSpaceFileEntryInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<UpdateSpaceFileEntryResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcUpdateSpaceFileEntry(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  trashSpaceFileEntry(
    input: TrashSpaceFileEntryInput
  ): Promise<TrashSpaceFileEntryResponse> {
    return rpcTrashSpaceFileEntry(this.env, input);
  }
  restoreSpaceFileEntry(
    input: RestoreSpaceFileEntryInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<RestoreSpaceFileEntryResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcRestoreSpaceFileEntry(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  restoreSpaceFileRevision(
    input: RestoreSpaceFileRevisionInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return withSpaceFilesOriginRpcOutput(
      rpcRestoreSpaceFileRevision(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  prepareSpaceFileWrite(
    input: SpaceFileWriteInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<PrepareSpaceFileWriteResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcPrepareSpaceFileWrite(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  commitSpaceFileWrite(
    input: SpaceFileWriteInput,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return withSpaceImageGeometryRpcOutput(
      rpcCommitSpaceFileWrite(this.env, input),
      spaceImageGeometryVersion
    );
  }
  resolveSpaceFileContent(
    input: ResolveSpaceFileContentRpcInput,
    spaceImageGeometryVersion?: string
  ): Promise<ResolveSpaceFileContentResponse> {
    return withSpaceImageGeometryRpcOutput(
      rpcResolveSpaceFileContent(this.env, input),
      spaceImageGeometryVersion
    );
  }
  streamSpaceFileContent(
    input: ReadSpaceFileContentRpcInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string,
    streamOptions?: import("@openmeld/schemas/types").SpaceFileStreamOptions
  ) {
    return withSpaceFilesOriginStreamRpcOutput(
      rpcStreamSpaceFileContent(this.env, input, streamOptions),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  readSpaceFileContent(
    input: ReadSpaceFileContentRpcInput,
    spaceImageGeometryVersion?: string
  ): Promise<ReadSpaceFileContentRpcResponse> {
    return withSpaceImageGeometryRpcOutput(
      rpcReadSpaceFileContent(this.env, input),
      spaceImageGeometryVersion
    );
  }
  writeSpaceFileContent(
    input: WriteSpaceFileContentRpcInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return withSpaceFilesOriginRpcOutput(
      rpcWriteSpaceFileContent(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  spaceFileUpload(
    input: Parameters<typeof rpcSpaceFileUpload>[1],
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ) {
    return withSpaceFilesOriginRpcOutput(
      rpcSpaceFileUpload(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  spaceFileUpdateSettings(
    input: Parameters<typeof rpcSpaceFileUpdateSettings>[1]
  ) {
    return rpcSpaceFileUpdateSettings(this.env, input);
  }
  stageSpaceComposerUpload(input: StageSpaceComposerUploadRpcInput) {
    return rpcStageSpaceComposerUpload(this.env, input);
  }
  publishSpaceComposerUpload(
    input: PublishSpaceComposerUploadRpcInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ) {
    return withSpaceFilesOriginRpcOutput(
      rpcPublishSpaceComposerUpload(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  discardSpaceComposerUpload(input: DiscardSpaceComposerUploadRpcInput) {
    return rpcDiscardSpaceComposerUpload(this.env, input);
  }
  listSpaceThreads(
    input: ListSpaceThreadsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceThreadsResponse> {
    return withSpaceAddressingRpcOutput(
      rpcListSpaceThreads(this.env, input),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceThread(
    input: GetSpaceThreadInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<GetSpaceThreadResponse> {
    return withSpaceAddressingRpcOutput(
      rpcGetSpaceThread(this.env, input),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  listSpaceThreadEvents(
    input: ListSpaceThreadEventsInput
  ): Promise<ListSpaceThreadEventsResponse> {
    return rpcListSpaceThreadEvents(this.env, input);
  }
  listSpaceThreadSignals(
    input: ListSpaceThreadSignalsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceThreadSignalsResponse> {
    return withSpaceAddressingRpcOutput(
      rpcListSpaceThreadSignals(this.env, input),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceDispatchTrace(
    input: GetSpaceDispatchTraceInput
  ): Promise<SpaceDispatchTraceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceDispatchTrace(this.env, input)
    );
  }
  inspectExecutionRecovery(
    input: InspectExecutionRecoveryInput
  ): Promise<InspectExecutionRecoveryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcInspectExecutionRecovery(this.env, input)
    );
  }
  executeExecutionRecovery(
    input: ExecuteExecutionRecoveryInput
  ): Promise<ExecuteExecutionRecoveryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcExecuteExecutionRecovery(this.env, input)
    );
  }
  getSpaceDispatchLookup(
    input: GetSpaceDispatchLookupInput
  ): Promise<GetSpaceDispatchLookupResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceDispatchLookup(this.env, input)
    );
  }
  getActiveSpaceWakeProgress(
    input: GetActiveSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetActiveSpaceWakeProgress(this.env, input)
    );
  }
  getSpaceWakeProgress(
    input: GetSpaceWakeProgressInput
  ): Promise<GetSpaceWakeProgressResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceWakeProgress(this.env, input)
    );
  }
  postSpaceWakeStop(
    input: PostSpaceWakeStopInput
  ): Promise<PostSpaceWakeStopResponse> {
    return rpcPostSpaceWakeStop(this.env, input);
  }
  respondToSpaceAgentInteraction(
    input: RespondToSpaceAgentInteractionInput
  ): Promise<RespondToSpaceAgentInteractionResponse> {
    return rpcRespondToSpaceAgentInteraction(this.env, input);
  }
  getSpaceWakeTraceWaterfall(
    input: GetSpaceWakeTraceWaterfallInput
  ): Promise<GetSpaceWakeTraceWaterfallResponse> {
    return rpcGetSpaceWakeTraceWaterfall(this.env, input);
  }
  getSpaceMessageReactions(input: GetSpaceMessageReactionsInput) {
    return rpcGetSpaceMessageReactions(this.env, input);
  }
  setSpaceMessageReaction(input: SetSpaceMessageReactionInput) {
    return rpcSetSpaceMessageReaction(this.env, input);
  }
  getSpaceMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse> {
    return rpcGetSpaceMessageDetails(this.env, input);
  }
  getSpaceLinkPreviews(input: GetSpaceMessageDetailsInput) {
    return rpcGetSpaceLinkPreviews(this.env, input);
  }
  async createSpaceDiagnosticReport(
    input: CreateSpaceDiagnosticReportInput
  ): Promise<CreateSpaceDiagnosticReportResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const startedAt = Date.now();
      const requestId = input.context?.actorContext.requestId ?? null;
      emitCoreCloudflareRuntimeEvidence(this.env, {
        event: "core.openmeld.space.diagnostic_report_create_started",
        workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "rpc",
        status: "started",
        operation: "createDiagnosticReport",
        durationMs: 0,
        requestId,
        spaceId: input.spaceId,
      });
      try {
        const report = await rpcCreateSpaceDiagnosticReport(this.env, input);
        const firstPointer = report.wakePointers[0] ?? null;
        const exactPointer =
          report.wakePointerDerivation.status === "exact" ? firstPointer : null;
        emitCoreCloudflareRuntimeEvidence(this.env, {
          event: "core.openmeld.space.diagnostic_report_created",
          workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
          runtimeKind: "rpc",
          status: "succeeded",
          operation: "createDiagnosticReport",
          durationMs: Date.now() - startedAt,
          reasonCode: report.wakePointerDerivation.status,
          requestId,
          spaceId: report.spaceId,
          clientMessageId: firstPointer?.clientMessageId ?? null,
          sourceSignalId: firstPointer?.sourceSignalId ?? null,
          targetProfileId: exactPointer?.targetProfileId ?? null,
          replySignalId: report.replyToSignalId
            ? report.reportedSignalId
            : null,
          activationTargetCount: report.wakePointers.length,
        });
        return report;
      } catch (error) {
        emitCoreCloudflareRuntimeEvidence(this.env, {
          event: "core.openmeld.space.diagnostic_report_create_failed",
          workerEnvironment: this.env.OPENMELD_WORKER_ENVIRONMENT,
          runtimeKind: "rpc",
          status: "failed",
          operation: "createDiagnosticReport",
          durationMs: Date.now() - startedAt,
          reasonCode: "diagnostic_report_create_failed",
          errorName: error instanceof Error ? error.name : typeof error,
          requestId,
          spaceId: input.spaceId,
        });
        throw error;
      }
    });
  }
  addSpaceMembers(
    input: AddSpaceMembersInput
  ): Promise<PostSpaceMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAddSpaceMembers(this.env, input)
    );
  }
  removeSpaceMembers(
    input: RemoveSpaceMembersInput
  ): Promise<RemoveSpaceMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoveSpaceMembers(this.env, input)
    );
  }
  leaveSpace(input: LeaveSpaceInput): Promise<LeaveSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcLeaveSpace(this.env, input)
    );
  }
  getSpaceMeta(input: GetSpaceMetaInput): Promise<SpaceMeta> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceMeta(this.env, input)
    );
  }
  spaceFilePins(
    input: SpaceFilePinsInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFilePinsResponse> {
    return withSpaceFilesOriginRpcOutput(
      rpcSpaceFilePins(this.env, input),
      spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      spaceImageGeometryVersion
    );
  }
  spaceMessagePins(
    input: SpaceMessagePinsInput
  ): Promise<SpaceMessagePinsResponse> {
    return rpcSpaceMessagePins(this.env, input);
  }

  spaceInputQueue(
    input: SpaceInputQueueInput
  ): Promise<SpaceInputQueueResponse> {
    return rpcSpaceInputQueue(this.env, input);
  }

  listSpaceTasks(input: ListSpaceTasksInput): Promise<ListSpaceTasksResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListSpaceTasks(this.env, input)
    );
  }
  getSpaceTask(input: GetSpaceTaskInput): Promise<SpaceTaskResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceTask(this.env, input)
    );
  }
  createSpaceTask(
    input: CreateSpaceTaskInput
  ): Promise<SpaceTaskMutationReceipt> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateSpaceTask(this.env, input)
    );
  }
  mutateSpaceTask(
    input: MutateSpaceTaskInput
  ): Promise<SpaceTaskMutationReceipt> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMutateSpaceTask(this.env, input)
    );
  }
  getSpaceContract(input: GetSpaceContractInput): Promise<SpaceContract> {
    return rpcGetSpaceContract(this.env, input);
  }
  getSpaceBoard(input: GetSpaceBoardInput): Promise<SpaceBoardResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceBoard(this.env, input)
    );
  }
  getSpaceStatus(input: GetSpaceStatusInput): Promise<GetSpaceStatusResponse> {
    return rpcGetSpaceStatus(this.env, input);
  }
  getSpaceEntryResolution(
    input: GetSpaceEntryResolutionRpcInput
  ): Promise<GetSpaceEntryResolutionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceEntryResolution(this.env, input)
    );
  }
  getSpaceConversationState(
    input: GetSpaceConversationStateRpcInput
  ): Promise<GetSpaceConversationStateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetSpaceConversationState(this.env, input)
    );
  }
  getSpaceBootstrap(
    input: GetSpaceBootstrapInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceBootstrapResponse> {
    return withSpaceAddressingRpcOutput(
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
        rpcGetSpaceBootstrap(this.env, input)
      ),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceBootstrapWithTiming(
    input: GetSpaceBootstrapInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceBootstrapWithTiming> {
    return withSpaceAddressingRpcOutput(
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
        rpcGetSpaceBootstrapWithTiming(this.env, input)
      ),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceUpdates(
    input: GetSpaceUpdatesInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<GetSpaceUpdatesResponse> {
    return withSpaceAddressingRpcOutput(
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
        rpcGetSpaceUpdates(this.env, input)
      ),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceDispatchResult(
    input: GetSpaceDispatchResultInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<DispatchResult> {
    return withSpaceAddressingRpcOutput(
      rpcGetSpaceDispatchResult(this.env, input),
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  deleteSpace(input: DeleteSpaceInput): Promise<DeleteSpaceResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteSpace(this.env, input)
    );
  }
  deleteConversationForMe(
    input: import("@openmeld/schemas").DeleteConversationForMeInput
  ): Promise<import("@openmeld/schemas").DeleteConversationForMeResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteConversationForMe(this.env, input)
    );
  }
  updateSpaceMeta(input: UpdateSpaceMetaInput): Promise<SpaceMeta> {
    return rpcUpdateSpaceMeta(this.env, input);
  }
  putSpaceContract(input: PutSpaceContractInput): Promise<SpaceContract> {
    return rpcPutSpaceContract(this.env, input);
  }
  patchSpaceContract(input: PatchSpaceContractInput): Promise<SpaceContract> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPatchSpaceContract(this.env, input)
    );
  }
  getSpaceCursor(input: GetSpaceCursorInput): Promise<SpaceCursor> {
    return rpcGetSpaceCursor(this.env, input);
  }
  updateSpaceCursor(input: UpdateSpaceCursorInput): Promise<SpaceCursor> {
    return rpcUpdateSpaceCursor(this.env, input);
  }
  upsertSpacePassword(
    input: UpsertSpacePasswordInput
  ): Promise<SpacePasswordStateResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpsertSpacePassword(this.env, input)
    );
  }
  clearSpacePassword(
    input: ClearSpacePasswordInput
  ): Promise<SpacePasswordStateResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcClearSpacePassword(this.env, input)
    );
  }
  setSpaceAccessMode(
    input: SetSpaceAccessModeInput
  ): Promise<SpaceAccessModeStateResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetSpaceAccessMode(this.env, input)
    );
  }
  getCurrentDeviceTarget(
    input: GetCurrentDeviceTargetInput
  ): Promise<CurrentDeviceTargetResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentDeviceTarget(this.env, input)
    );
  }
  forgetCurrentComputer(
    input: GetCurrentDeviceTargetInput
  ): Promise<ForgetCurrentComputerResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcForgetCurrentComputer(this.env, input)
    );
  }
  forgetComputer(input: ForgetComputerInput): Promise<ForgetComputerResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcForgetComputer(this.env, input)
    );
  }
  getPrepareReadiness(
    input: GetPrepareReadinessInput
  ): Promise<GetPrepareReadinessResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetPrepareReadiness(this.env, input)
    );
  }
  createPrepareSession(
    input: CreatePrepareSessionInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreatePrepareSession(this.env, input)
    );
  }
  getPrepareSession(
    input: GetPrepareSessionInput
  ): Promise<PrepareSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetPrepareSession(this.env, input)
    );
  }
  mintPrepareSessionReconnectToken(
    input: MintPrepareSessionReconnectTokenInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcMintPrepareSessionReconnectToken(this.env, input)
    );
  }
  resolvePrepareSessionToken(
    input: ResolvePrepareSessionTokenInput
  ): Promise<PrepareSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcResolvePrepareSessionToken(this.env, input)
    );
  }
  writePrepareAgentSelection(
    input: WritePrepareAgentSelectionInput
  ): Promise<PrepareSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWritePrepareAgentSelection(this.env, input)
    );
  }
  writePrepareSetupBootstrap(
    input: WritePrepareSetupBootstrapInput
  ): Promise<PrepareSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWritePrepareSetupBootstrap(this.env, input)
    );
  }
  writePrepareTerminalStep(
    input: WritePrepareTerminalStepInput
  ): Promise<PrepareSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWritePrepareTerminalStep(this.env, input)
    );
  }
  getPrepareDiagnostic(
    input: GetPrepareSessionInput
  ): Promise<PrepareDiagnosticResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetPrepareDiagnostic(this.env, input)
    );
  }
  getAgentProfilePrimaryBinding(
    input: GetAgentProfilePrimaryBindingInput
  ): Promise<GetAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentProfilePrimaryBinding(this.env, input)
    );
  }
  getCurrentAgentProfileSession(
    input: GetCurrentAgentProfileSessionInput
  ): Promise<CurrentAgentProfileSessionLookupResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentAgentProfileSession(this.env, input)
    );
  }
  executeAgentProfileWorkRecovery(
    input: ExecuteAgentProfileWorkRecoveryInput
  ): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcExecuteAgentProfileWorkRecovery(this.env, input)
    );
  }
  agentProfileExecutionMode(
    input: AgentProfileExecutionModeInput
  ): Promise<AgentProfileExecutionModeResponse> {
    return rpcAgentProfileExecutionMode(this.env, input);
  }
  getAgentProfileControllerChangeEligibility(
    input: GetAgentProfileControllerChangeEligibilityInput
  ): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentProfileControllerChangeEligibility(this.env, input)
    );
  }
  getLocalRuntimeExpectedRoutes(
    input: GetLocalRuntimeExpectedRoutesInput
  ): Promise<GetLocalRuntimeExpectedRoutesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetLocalRuntimeExpectedRoutes(this.env, input)
    );
  }
  getAgentExecutionReadiness(
    input: GetAgentExecutionReadinessInput
  ): Promise<GetAgentExecutionReadinessResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentExecutionReadiness(this.env, input)
    );
  }
  getAgentExecutionReadinessBatch(
    input: GetAgentExecutionReadinessBatchInput
  ): Promise<GetAgentExecutionReadinessBatchResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentExecutionReadinessBatch(this.env, input)
    );
  }
  ensureAgentProfilePrimaryBinding(
    input: EnsureAgentProfilePrimaryBindingInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcEnsureAgentProfilePrimaryBinding(this.env, input)
    );
  }
  updateAgentProfilePrimaryBindingModelSelection(
    input: UpdateAgentProfilePrimaryBindingModelSelectionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentProfilePrimaryBindingModelSelection(this.env, input)
    );
  }
  updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
        this.env,
        input
      )
    );
  }
  updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
        this.env,
        input
      )
    );
  }
  updateAgentProfilePrimaryBindingOpenCodePermission(
    input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(this.env, input)
    );
  }
  disableAgentProfilePrimaryBinding(
    input: DisableAgentProfilePrimaryBindingInput
  ): Promise<DisableAgentProfilePrimaryBindingResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDisableAgentProfilePrimaryBinding(this.env, input)
    );
  }
  getAgentProfileCreationDefaults(
    input: GetAgentProfileCreationDefaultsInput
  ): Promise<GetAgentProfileCreationDefaultsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentProfileCreationDefaults(this.env, input)
    );
  }
  setAgentProfileCreationDefaults(
    input: SetAgentProfileCreationDefaultsInput
  ): Promise<SetAgentProfileCreationDefaultsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetAgentProfileCreationDefaults(this.env, input)
    );
  }
  createAgentProfileCreationRequest(
    input: CreateAgentProfileCreationRequestRpcInput
  ): Promise<CreateAgentProfileCreationRequestResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateAgentProfileCreationRequest(this.env, input)
    );
  }
  listAgentProfileCreationRequests(
    input: ListAgentProfileCreationRequestsRpcInput
  ): Promise<ListAgentProfileCreationRequestsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAgentProfileCreationRequests(this.env, input)
    );
  }
  decideAgentProfileCreationRequest(
    input: DecideAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDecideAgentProfileCreationRequest(this.env, input)
    );
  }
  cancelAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCancelAgentProfileCreationRequest(this.env, input)
    );
  }
  retryAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRetryAgentProfileCreationRequest(this.env, input)
    );
  }
  getAgentProfileCreationApprovalPreference(
    input: GetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentProfileCreationApprovalPreference(this.env, input)
    );
  }
  setAgentProfileCreationApprovalPreference(
    input: SetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetAgentProfileCreationApprovalPreference(this.env, input)
    );
  }
  centerAgentCreateAgentProfileCreationRequest(
    input: CenterAgentCreateAgentProfileCreationRequestRpcInput
  ): Promise<CreateAgentProfileCreationRequestResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateAgentProfileCreationRequest(this.env, input)
    );
  }
  centerAgentListAgentProfileCreationRequests(
    input: CenterAgentListAgentProfileCreationRequestsRpcInput
  ): Promise<ListAgentProfileCreationRequestsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListAgentProfileCreationRequests(this.env, input)
    );
  }
  centerAgentManageAgentProfileCreationRequest(
    input: CenterAgentManageAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentManageAgentProfileCreationRequest(this.env, input)
    );
  }
  centerAgentGetAgentProfileCreationApprovalPreference(
    input: CenterAgentGetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentGetAgentProfileCreationApprovalPreference(this.env, input)
    );
  }
  centerAgentSetAgentProfileCreationApprovalPreference(
    input: CenterAgentSetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetAgentProfileCreationApprovalPreference(this.env, input)
    );
  }
  getCurrentOrganizationDirectory(
    input: GetCurrentOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationDirectory(this.env, input)
    );
  }
  getCurrentOrganizationProfileDirectory(
    input: GetCurrentOrganizationProfileDirectoryInput
  ): Promise<OrganizationProfileDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationProfileDirectory(this.env, input)
    );
  }
  getCurrentOrganizationAgentRuntimeOverview(
    input: GetCurrentOrganizationAgentRuntimeOverviewInput
  ): Promise<OrganizationAgentRuntimeOverviewResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationAgentRuntimeOverview(this.env, input)
    );
  }
  getCurrentOrganizationMemberPresence(input: {
    context?: CoreRpcContextInput;
  }) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationMemberPresence(this.env, input)
    );
  }
  recordCurrentOrganizationMemberPresence(
    input: RecordCurrentOrganizationMemberPresenceInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordCurrentOrganizationMemberPresence(this.env, input)
    );
  }
  recordCurrentOrganizationWebActivity(
    input: RecordCurrentOrganizationWebActivityInput
  ): Promise<OrganizationMemberWebActivityResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordCurrentOrganizationWebActivity(this.env, input)
    );
  }
  getCurrentOrganizationComputers(
    input: GetCurrentOrganizationComputersInput
  ): Promise<OrganizationComputersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationComputers(this.env, input)
    );
  }
  getCurrentOrganizationMemberOpenMeldServiceStatuses(
    input: GetCurrentOrganizationMemberOpenMeldServiceStatusesInput
  ): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationMemberOpenMeldServiceStatuses(this.env, input)
    );
  }
  getCurrentOrganizationSpaceDirectory(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationSpaceDirectory(this.env, input)
    );
  }
  getCurrentOrganizationSpaceDirectoryWithMemberCounts(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts(this.env, input)
    );
  }
  joinOrganizationPublicSpace(
    input: JoinOrganizationPublicSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcJoinOrganizationPublicSpace(this.env, input)
    );
  }
  addCenterAgentToSpace(
    input: AddCenterAgentToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAddCenterAgentToSpace(this.env, input)
    );
  }
  addOrganizationDirectoryProfilesToSpace(
    input: AddOrganizationDirectoryProfilesToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAddOrganizationDirectoryProfilesToSpace(this.env, input)
    );
  }
  beginCurrentMemberConnectorAuthorization(
    input: BeginCurrentMemberConnectorAuthorizationInput
  ): Promise<ConnectorConnection> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginCurrentMemberConnectorAuthorization(this.env, input)
    );
  }
  beginCurrentOrganizationSharedConnectorAuthorization(
    input: BeginCurrentOrganizationSharedConnectorAuthorizationInput
  ): Promise<ConnectorConnection> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginCurrentOrganizationSharedConnectorAuthorization(this.env, input)
    );
  }
  beginCurrentOrganizationGitHubAppInstallation(
    input: BeginCurrentOrganizationGitHubAppInstallationInput
  ): Promise<GitHubAppInstallationStartResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginCurrentOrganizationGitHubAppInstallation(this.env, input)
    );
  }
  beginGitHubAppInstallationVerification(
    input: BeginGitHubAppInstallationVerificationInput
  ): Promise<GitHubAppInstallationVerificationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginGitHubAppInstallationVerification(this.env, input)
    );
  }
  beginExistingGitHubAppInstallationVerification(
    input: BeginExistingGitHubAppInstallationVerificationInput
  ): Promise<boolean> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginExistingGitHubAppInstallationVerification(this.env, input)
    );
  }
  readPendingGitHubAppInstallation(
    input: ReadPendingGitHubAppInstallationInput
  ): Promise<PendingGitHubAppInstallation> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadPendingGitHubAppInstallation(this.env, input)
    );
  }
  completeGitHubAppInstallation(
    input: CompleteGitHubAppInstallationInput
  ): Promise<boolean> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCompleteGitHubAppInstallation(this.env, input)
    );
  }
  listCurrentOrganizationConnectorConnections(
    input: ListCurrentOrganizationConnectorConnectionsInput
  ): Promise<ConnectorConnectionListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListCurrentOrganizationConnectorConnections(this.env, input)
    );
  }
  listPluginAccess(input: PluginAccessListRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListPluginAccess(this.env, input)
    );
  }
  pluginAction(input: import("@openmeld/schemas/types").PluginActionRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPluginAction(this.env, input)
    );
  }
  authorizeLocalPluginConnection(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      authorizeLocalPluginConnection(this.env, input)
    );
  }

  pluginActionRequest(
    input: import("@openmeld/schemas/types").PluginActionRequestCommandRpc
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPluginActionRequest(this.env, input)
    );
  }
  listPluginActionRequests(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      listPluginActionRequests(this.env, input)
    );
  }
  suggestPermissionMode(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSuggestPermissionMode(this.env, input)
    );
  }
  listPermissionModeSuggestions(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListPermissionModeSuggestions(this.env, input)
    );
  }
  resolvePermissionModeSuggestion(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcResolvePermissionModeSuggestion(this.env, input)
    );
  }

  previewPluginChannelConnection(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      previewPluginChannelConnection(this.env, input)
    );
  }
  continuePluginChannelConnection(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      continuePluginChannelConnection(this.env, input)
    );
  }
  continuePluginConnection(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      continuePluginConnection(this.env, input)
    );
  }
  updatePluginAccess(input: PluginAccessUpdateRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdatePluginAccess(this.env, input)
    );
  }
  listCurrentOrganizationConnectorAppRequests(
    input: ListCurrentOrganizationConnectorAppRequestsInput
  ): Promise<ConnectorAppRequestListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListCurrentOrganizationConnectorAppRequests(this.env, input)
    );
  }
  createCurrentOrganizationConnectorAppRequest(
    input: CreateCurrentOrganizationConnectorAppRequestInput
  ): Promise<ConnectorAppRequestResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateCurrentOrganizationConnectorAppRequest(this.env, input)
    );
  }
  reconcileCurrentOrganizationConnectorConnections(
    input: ReconcileCurrentOrganizationConnectorConnectionsInput
  ): Promise<ConnectorConnectionListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReconcileCurrentOrganizationConnectorConnections(this.env, input)
    );
  }
  authorizeConnectorDisconnect(
    input: AuthorizeConnectorDisconnectInput
  ): Promise<ConnectorConnection> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAuthorizeConnectorDisconnect(this.env, input)
    );
  }
  completeConnectorDisconnect(
    input: CompleteConnectorDisconnectInput
  ): Promise<ConnectorConnection> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCompleteConnectorDisconnect(this.env, input)
    );
  }
  centerAgentResolveConnectorConnection(
    input: CenterAgentResolveConnectorConnectionInput
  ): Promise<CenterAgentConnectorConnectionSelection> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentResolveConnectorConnection(this.env, input)
    );
  }
  centerAgentListConnectorServices(
    input: Pick<
      CenterAgentResolveConnectorConnectionInput,
      "context" | "requesterUserId" | "includeDelegatedRequester"
    >
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListConnectorServices(this.env, input)
    );
  }
  authorizeRemoteAgentExecutionAccess(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      authorizeRemoteAgentExecutionAccess(this.env, input)
    );
  }
  personalComputer(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      personalComputerRpc(this.env, input)
    );
  }
  acknowledgeRemoteAgentAdmission(input: unknown) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      acknowledgeRemoteAgentAdmission(this.env, input)
    );
  }
  getCenterAgentDesignation(
    input: GetCenterAgentDesignationInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCenterAgentDesignation(this.env, input)
    );
  }
  getCenterAgentModel(
    input: GetCenterAgentModelInput
  ): Promise<CenterAgentModelConfigurationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCenterAgentModel(this.env, input)
    );
  }
  updateCenterAgentModel(
    input: UpdateCenterAgentModelInput
  ): Promise<UpdateCenterAgentModelResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateCenterAgentModel(this.env, input)
    );
  }
  listMessageChannelConnections(
    input: ListMessageChannelConnectionsInput
  ): Promise<MessageChannelConnectionListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListMessageChannelConnections(this.env, input)
    );
  }
  requestMessageChannelSetup(
    input: RequestMessageChannelSetupInput
  ): Promise<MessageChannelSetupRequestResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRequestMessageChannelSetup(this.env, input)
    );
  }
  listActiveLarkPlatformRegistrations(
    input: ListActiveLarkPlatformRegistrationsInput
  ): Promise<LarkPlatformActiveRegistrationListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListActiveLarkPlatformRegistrations(this.env, input)
    );
  }
  previewMessageChannelIdentityLink(
    input: PreviewMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkPreviewResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPreviewMessageChannelIdentityLink(this.env, input)
    );
  }
  consumeMessageChannelIdentityLink(
    input: ConsumeMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkConsumeResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConsumeMessageChannelIdentityLink(this.env, input)
    );
  }
  beginLarkPlatformRegistration(
    input: BeginLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcBeginLarkPlatformRegistration(this.env, input)
    );
  }
  pollLarkPlatformRegistration(
    input: PollLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPollLarkPlatformRegistration(this.env, input)
    );
  }
  disconnectLarkPlatformRegistration(
    input: DisconnectLarkPlatformRegistrationInput
  ): Promise<MessageChannelConnectionListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDisconnectLarkPlatformRegistration(this.env, input)
    );
  }
  disconnectMessageChannelIdentityLink(
    input: DisconnectMessageChannelIdentityLinkInput
  ): Promise<MessageChannelConnectionListResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDisconnectMessageChannelIdentityLink(this.env, input)
    );
  }
  getCenterAgentDirectMessageSpaceProjection(
    input: GetCenterAgentDirectMessageSpaceProjectionInput
  ): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCenterAgentDirectMessageSpaceProjection(this.env, input)
    );
  }
  listCenterAgentSessions(
    input: ListCenterAgentSessionsInput
  ): Promise<ListCenterAgentSessionsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListCenterAgentSessions(this.env, input)
    );
  }
  listAgentDirectMessageSessions(
    input: ListAgentDirectMessageSessionsInput
  ): Promise<ListAgentDirectMessageSessionsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAgentDirectMessageSessions(this.env, input)
    );
  }
  updateAgentDirectMessageSession(
    input: UpdateAgentDirectMessageSessionInput
  ): Promise<UpdateAgentDirectMessageSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAgentDirectMessageSession(this.env, input)
    );
  }
  deleteAgentDirectMessageSession(
    input: DeleteAgentDirectMessageSessionInput
  ): Promise<DeleteAgentDirectMessageSessionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDeleteAgentDirectMessageSession(this.env, input)
    );
  }
  createCenterAgentContextManifest(
    input: CreateCenterAgentContextManifestInput
  ): Promise<CreateCenterAgentContextManifestResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateCenterAgentContextManifest(this.env, input)
    );
  }
  createCenterAgentContextLoadReceipt(
    input: CreateCenterAgentContextLoadReceiptInput
  ): Promise<CreateCenterAgentContextLoadReceiptResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateCenterAgentContextLoadReceipt(this.env, input)
    );
  }
  getCenterAgentOperatingState(
    input: GetCenterAgentOperatingStateInput
  ): Promise<GetCenterAgentOperatingStateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCenterAgentOperatingState(this.env, input)
    );
  }
  designateCenterAgent(
    input: DesignateCenterAgentInput
  ): Promise<DesignateCenterAgentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDesignateCenterAgent(this.env, input)
    );
  }
  updateCenterAgentProfile(
    input: UpdateCenterAgentProfileInput
  ): Promise<CenterAgentUpdateProfileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateCenterAgentProfile(this.env, input)
    );
  }
  updateCenterAgentOperatingState(
    input: UpdateCenterAgentOperatingStateInput
  ): Promise<UpdateCenterAgentOperatingStateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateCenterAgentOperatingState(this.env, input)
    );
  }
  connectCenterAgentSlackWorkspace(
    input: ConnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceConnectionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConnectCenterAgentSlackWorkspace(this.env, input)
    );
  }
  createSlackOAuthState(
    input: CreateSlackOAuthStateInput
  ): Promise<SlackOAuthStateCreateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateSlackOAuthState(this.env, input)
    );
  }
  consumeSlackOAuthState(
    input: ConsumeSlackOAuthStateInput
  ): Promise<SlackOAuthStateConsumeResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConsumeSlackOAuthState(this.env, input)
    );
  }
  installSlackWorkspaceFromOAuth(
    input: InstallSlackWorkspaceFromOAuthInput
  ): Promise<SlackOAuthInstallationResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcInstallSlackWorkspaceFromOAuth(this.env, input)
    );
  }
  issueSlackIdentityLinkFromOAuth(
    input: IssueSlackIdentityLinkFromOAuthInput
  ): Promise<SlackOAuthIdentityLinkResult> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcIssueSlackIdentityLinkFromOAuth(this.env, input)
    );
  }
  disconnectCenterAgentSlackWorkspace(
    input: DisconnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceDisconnectResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDisconnectCenterAgentSlackWorkspace(this.env, input)
    );
  }
  previewSlackIdentityLink(
    input: PreviewSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkPreviewResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcPreviewSlackIdentityLink(this.env, input)
    );
  }
  consumeSlackIdentityLink(
    input: ConsumeSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkConsumeResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConsumeSlackIdentityLink(this.env, input)
    );
  }
  assertCurrentDesignatedCenterAgent(
    input: AssertCurrentDesignatedCenterAgentInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcAssertCurrentDesignatedCenterAgent(this.env, input)
    );
  }
  recordCenterAgentAudit(
    input: RecordCenterAgentAuditInput
  ): Promise<CenterAgentAttribution> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordCenterAgentAudit(this.env, input)
    );
  }
  listCenterAgentAuditJournal(
    input: ListCenterAgentAuditJournalInput
  ): Promise<ListCenterAgentAuditJournalResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListCenterAgentAuditJournal(this.env, input)
    );
  }
  readCenterAgentOrganizationMemoryPolicy(
    input: ReadCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadCenterAgentOrganizationMemoryPolicy(this.env, input)
    );
  }
  setCenterAgentOrganizationMemoryPolicy(
    input: SetCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetCenterAgentOrganizationMemoryPolicy(this.env, input)
    );
  }
  readOrganizationInformationProtectionPolicy(
    input: ReadOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationInformationProtectionPolicy(this.env, input)
    );
  }
  setOrganizationInformationProtectionPolicy(
    input: SetOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetOrganizationInformationProtectionPolicy(this.env, input)
    );
  }
  readCurrentOrganizationFeedbackReportingPolicy(
    input: ReadCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadCurrentOrganizationFeedbackReportingPolicy(this.env, input)
    );
  }
  setCurrentOrganizationFeedbackReportingPolicy(
    input: SetCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetCurrentOrganizationFeedbackReportingPolicy(this.env, input)
    );
  }
  wipeCurrentMemberCenterAgentMemory(
    input: WipeCurrentMemberCenterAgentMemoryInput
  ): Promise<CenterAgentWipeMemberMemoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWipeCurrentMemberCenterAgentMemory(this.env, input)
    );
  }
  centerAgentRememberForOrganization(
    input: CenterAgentRememberForOrganizationInput
  ): Promise<CenterAgentRememberForOrganizationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRememberForOrganization(this.env, input)
    );
  }
  centerAgentRequestMemberAttention(
    input: CenterAgentRequestMemberAttentionRpcInput
  ): Promise<CenterAgentRequestMemberAttentionResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRequestMemberAttention(this.env, input)
    );
  }
  centerAgentListLocalAgentConnectionCandidates(
    input: CenterAgentListLocalAgentConnectionCandidatesInput
  ): Promise<CenterAgentListLocalAgentConnectionCandidatesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListLocalAgentConnectionCandidates(this.env, input)
    );
  }
  centerAgentListAgentProfileCreationDefaults(
    input: CenterAgentListAgentProfileCreationDefaultsInput
  ): Promise<CenterAgentListAgentProfileCreationDefaultsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListAgentProfileCreationDefaults(this.env, input)
    );
  }
  centerAgentListComputers(
    input: CenterAgentListComputersInput
  ): Promise<CenterAgentListComputersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListComputers(this.env, input)
    );
  }
  centerAgentReadPeopleComputers(
    input: CenterAgentReadPeopleComputersInput
  ): Promise<CenterAgentReadPeopleComputersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadPeopleComputers(this.env, input)
    );
  }
  centerAgentRequestOpenMeldToolsUpdate(
    input: CenterAgentRequestOpenMeldToolsUpdateInput
  ): Promise<CenterAgentRequestOpenMeldToolsUpdateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRequestOpenMeldToolsUpdate(this.env, input)
    );
  }
  // Separate RPC names prevent an old Core from silently ignoring a target.
  centerAgentRequestPeopleComputerToolsUpdate(
    input: CenterAgentRequestOpenMeldToolsUpdateInput
  ): Promise<CenterAgentRequestOpenMeldToolsUpdateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRequestOpenMeldToolsUpdate(this.env, {
        ...input,
        target: peopleComputerTargetSchema.parse(input.target),
      })
    );
  }
  centerAgentSetPeopleComputerToolsMaintenance(
    input: CenterAgentSetOpenMeldToolsMaintenanceInput
  ): Promise<CenterAgentSetOpenMeldToolsMaintenanceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetOpenMeldToolsMaintenance(this.env, {
        ...input,
        target: peopleComputerTargetSchema.parse(input.target),
      })
    );
  }
  centerAgentListPeopleComputerLocalAgentInstallations(
    input: CenterAgentListLocalAgentInstallationsInput
  ): Promise<CenterAgentListLocalAgentInstallationsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListLocalAgentInstallations(this.env, {
        ...input,
        target: peopleComputerTargetSchema.parse(input.target),
      })
    );
  }
  centerAgentSelectPeopleComputerLocalAgentInstallation(
    input: CenterAgentSelectLocalAgentInstallationInput
  ): Promise<CenterAgentSelectLocalAgentInstallationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSelectLocalAgentInstallation(this.env, {
        ...input,
        target: peopleComputerTargetSchema.parse(input.target),
      })
    );
  }
  centerAgentSetOpenMeldToolsMaintenance(
    input: CenterAgentSetOpenMeldToolsMaintenanceInput
  ): Promise<CenterAgentSetOpenMeldToolsMaintenanceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetOpenMeldToolsMaintenance(this.env, input)
    );
  }
  centerAgentListLocalAgentInstallations(
    input: CenterAgentListLocalAgentInstallationsInput
  ): Promise<CenterAgentListLocalAgentInstallationsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListLocalAgentInstallations(this.env, input)
    );
  }
  centerAgentSelectLocalAgentInstallation(
    input: CenterAgentSelectLocalAgentInstallationInput
  ): Promise<CenterAgentSelectLocalAgentInstallationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSelectLocalAgentInstallation(this.env, input)
    );
  }
  centerAgentConnectAgentProfileToLocalAgent(
    input: CenterAgentConnectAgentProfileToLocalAgentInput
  ): Promise<CenterAgentConnectAgentProfileToLocalAgentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentConnectAgentProfileToLocalAgent(this.env, input)
    );
  }
  centerAgentUpdateAgentProfileRuntimeSettings(
    input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
  ): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentUpdateAgentProfileRuntimeSettings(this.env, input)
    );
  }
  centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace(
    input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
  ): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace(
        this.env,
        input
      )
    );
  }
  centerAgentCheckAgentProfileReadiness(
    input: CenterAgentCheckAgentProfileReadinessInput
  ): Promise<CenterAgentCheckAgentProfileReadinessResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCheckAgentProfileReadiness(this.env, input)
    );
  }
  centerAgentCreateConfiguredAgentProfile(
    input: CenterAgentCreateConfiguredAgentProfileInput
  ): Promise<CenterAgentCreateConfiguredAgentProfileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateConfiguredAgentProfile(this.env, input)
    );
  }
  completeRemoteAgentSubmission(
    input: RemoteAgentCoreCallbackEvent
  ): Promise<RemoteAgentCoreCallbackResponse> {
    const db = getPostgresDatabase(this.env);
    return completeRemoteAgentNativeDelivery(this.env, input, {
      messageChannelProviderRegistry: db
        ? createConfiguredMessageChannelProviderRegistry({
            db,
            env: this.env,
          })
        : undefined,
      reconcileMemberResearch: async () => {
        if (db) {
          await runCenterAgentMemberResearchTick({ db, env: this.env });
          await runSlackInstallationWelcomePreparationTick({
            db,
            env: this.env,
            nowMs: Date.now(),
          });
        }
      },
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    });
  }
  verifyLarkPlatformWebhook(
    input: LarkPlatformWebhookVerificationInput
  ): Promise<LarkPlatformWebhookVerificationResponse> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return Promise.resolve({
        reasonCode: "message_channel.db_unavailable",
        status: "rejected",
      });
    }
    return verifyLarkPlatformWebhook({
      db,
      env: this.env,
      input,
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    });
  }
  verifyGitHubAppWebhook(
    input: GitHubAppWebhookVerificationInput
  ): Promise<GitHubAppWebhookVerificationResponse> {
    return verifyGitHubAppWebhook({
      env: this.env,
      input,
    });
  }
  submitRemoteAgentStreamDelta(
    input: RemoteAgentStreamDeltaCallbackBody
  ): Promise<RemoteAgentStreamDeltaCallbackResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      submitRemoteAgentStreamDelta(this.env, input)
    );
  }
  submitRemoteAgentStreamPart(
    input: RemoteAgentStreamPartCallbackBody
  ): Promise<RemoteAgentStreamDeltaCallbackResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      submitRemoteAgentStreamPart(this.env, input)
    );
  }
  handleRemoteAgentSlackEvent(input: unknown): Promise<{
    status:
      | "duplicate"
      | "failed"
      | "ignored"
      | "processed"
      | "recovery_pending"
      | "replied";
  }> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      processRemoteAgentSlackEvent(this.env, input)
    );
  }
  submitFeedbackIssue(
    input: FeedbackIssueSubmitRpcRequest
  ): Promise<SubmitFeedbackIssueResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitFeedbackIssue(this.env, input)
    );
  }
  listFeedbackIssuesForOrganization(
    input: ListFeedbackIssuesForOrganizationRequest
  ): Promise<ListFeedbackIssuesForOrganizationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListFeedbackIssuesForOrganization(this.env, input)
    );
  }
  updateFeedbackIssueStatusForOrganization(
    input: UpdateFeedbackIssueStatusForOrganizationRequest
  ): Promise<FeedbackIssueRecord> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateFeedbackIssueStatusForOrganization(this.env, input)
    );
  }
  readFeedbackReportingPolicy(
    input: ReadFeedbackReportingPolicyRequest
  ): Promise<FeedbackReportingPolicyResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadFeedbackReportingPolicy(this.env, input)
    );
  }
  centerAgentCreateSpace(
    input: CenterAgentCreateSpaceInput
  ): Promise<CenterAgentCreateSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateSpace(this.env, input)
    );
  }
  centerAgentCreateAgentProfile(
    input: CenterAgentCreateAgentProfileInput
  ): Promise<CenterAgentCreateAgentProfileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateAgentProfile(this.env, input)
    );
  }
  centerAgentEnableAgentProfile(
    input: CenterAgentEnableAgentProfileInput
  ): Promise<CenterAgentEnableAgentProfileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentEnableAgentProfile(this.env, input)
    );
  }
  centerAgentAddAgentProfilesToSpace(
    input: CenterAgentAddAgentProfilesToSpaceInput
  ): Promise<CenterAgentAddAgentProfilesToSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentAddAgentProfilesToSpace(this.env, input)
    );
  }
  centerAgentAddMembersToSpace(
    input: CenterAgentAddMembersToSpaceInput
  ): Promise<CenterAgentAddMembersToSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentAddMembersToSpace(this.env, input)
    );
  }
  centerAgentRemoveAgentProfilesFromSpace(
    input: CenterAgentRemoveAgentProfilesFromSpaceInput
  ): Promise<CenterAgentRemoveAgentProfilesFromSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRemoveAgentProfilesFromSpace(this.env, input)
    );
  }
  centerAgentGetOrganizationDirectory(
    input: CenterAgentReadOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentGetOrganizationDirectory(this.env, input)
    );
  }
  centerAgentReadMemberComputers(
    input: CenterAgentReadMemberComputersInput
  ): Promise<CenterAgentReadMemberComputersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadMemberComputers(this.env, input)
    );
  }
  centerAgentReadMemberOpenMeldServiceStatus(
    input: CenterAgentReadMemberOpenMeldServiceStatusInput
  ): Promise<CenterAgentReadMemberOpenMeldServiceStatusResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadMemberOpenMeldServiceStatus(this.env, input)
    );
  }
  centerAgentReadSlackWorkspaceDirectory(
    input: CenterAgentReadSlackWorkspaceDirectoryInput
  ): Promise<CenterAgentReadSlackWorkspaceDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSlackWorkspaceDirectory(this.env, input)
    );
  }
  centerAgentListSlackChannels(
    input: CenterAgentListSlackChannelsInput
  ): Promise<CenterAgentListSlackChannelsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListSlackChannels(this.env, input)
    );
  }
  centerAgentReadSlackChannelMembers(
    input: CenterAgentReadSlackChannelMembersInput
  ): Promise<CenterAgentReadSlackChannelMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSlackChannelMembers(this.env, input)
    );
  }
  centerAgentReadSlackChannelHistory(
    input: CenterAgentReadSlackChannelHistoryInput
  ): Promise<CenterAgentReadSlackChannelHistoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSlackChannelHistory(this.env, input)
    );
  }
  centerAgentReadSlackFile(
    input: CenterAgentReadSlackFileInput
  ): Promise<CenterAgentReadSlackFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSlackFile(this.env, input)
    );
  }
  centerAgentReadChannelFile(
    input: CenterAgentReadChannelFileInput
  ): Promise<CenterAgentReadChannelFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadChannelFile(this.env, input)
    );
  }
  centerAgentPostChannelFile(
    input: CenterAgentPostChannelFileInput
  ): Promise<CenterAgentPostChannelFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPostChannelFile(this.env, input)
    );
  }
  centerAgentSearchSlackMessages(
    input: CenterAgentSearchSlackMessagesInput
  ): Promise<CenterAgentSearchSlackMessagesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSearchSlackMessages(this.env, input)
    );
  }
  centerAgentGetOrganizationSpaceDirectory(
    input: CenterAgentReadOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentGetOrganizationSpaceDirectory(this.env, input)
    );
  }
  centerAgentListActiveSpaceWakes(
    input: CenterAgentListActiveSpaceWakesInput
  ): Promise<AccountSpaceActiveWakeSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListActiveSpaceWakes(this.env, input)
    );
  }
  centerAgentReadSpaceWakeProgress(
    input: CenterAgentReadSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSpaceWakeProgress(this.env, input)
    );
  }
  centerAgentStopSpaceWake(
    input: CenterAgentStopSpaceWakeInput
  ): Promise<PostSpaceWakeStopResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentStopSpaceWake(this.env, input)
    );
  }

  centerAgentSpaceInputQueue(
    input: CenterAgentSpaceInputQueueInput
  ): Promise<SpaceInputQueueResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSpaceInputQueue(this.env, input)
    );
  }

  centerAgentReadSpaceContext(
    input: CenterAgentReadSpaceContextInput
  ): Promise<CenterAgentReadSpaceContextResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceAddressingRpcOutput(
        rpcCenterAgentReadSpaceContext(this.env, input),
        resolveCenterAgentSpaceAddressingVersion(input)
      )
    );
  }
  centerAgentListSpaceFiles(
    input: CenterAgentListSpaceFilesRpcInput
  ): Promise<CenterAgentListSpaceFilesResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceFilesOriginRpcOutput(
        rpcCenterAgentListSpaceFiles(this.env, input),
        input.requestedOriginModel === SPACE_FILES_ORIGIN_CAPABILITY_TOKEN
      )
    );
  }
  remoteAgentListTeamFiles(
    input: RemoteAgentListTeamFilesRpcInput
  ): Promise<ListFileRootResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentListTeamFiles(this.env, input)
    );
  }
  remoteAgentReadTeamFile(
    input: RemoteAgentReadTeamFileRpcInput
  ): Promise<RemoteAgentReadTeamFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentReadTeamFile(this.env, input)
    );
  }
  remoteAgentSaveTeamFile(
    input: RemoteAgentSaveTeamFileRpcInput
  ): Promise<RemoteAgentSaveTeamFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentSaveTeamFile(this.env, input)
    );
  }
  centerAgentReadSpaceFile(
    input: CenterAgentReadSpaceFileRpcInput
  ): Promise<CenterAgentReadSpaceFileResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceFilesOriginRpcOutput(
        rpcCenterAgentReadSpaceFile(this.env, input),
        input.requestedOriginModel === SPACE_FILES_ORIGIN_CAPABILITY_TOKEN
      )
    );
  }
  centerAgentSaveSpaceFile(
    input: CenterAgentSaveSpaceFileRpcInput
  ): Promise<CenterAgentSaveSpaceFileResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceFilesOriginRpcOutput(
        rpcCenterAgentSaveSpaceFile(this.env, input),
        input.requestedOriginModel === SPACE_FILES_ORIGIN_CAPABILITY_TOKEN
      )
    );
  }
  centerAgentManageSpaceFiles(
    input: CenterAgentManageSpaceFilesRpcInput
  ): Promise<CenterAgentManageSpaceFilesResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceFilesOriginRpcOutput(
        rpcCenterAgentManageSpaceFiles(this.env, input),
        input.requestedOriginModel === SPACE_FILES_ORIGIN_CAPABILITY_TOKEN
      )
    );
  }
  centerAgentReadDispatchHistory(
    input: CenterAgentReadDispatchHistoryInput
  ): Promise<CenterAgentReadDispatchHistoryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadDispatchHistory(this.env, input)
    );
  }
  centerAgentPostSpaceMessage(
    input: CenterAgentPostSpaceMessageInput
  ): Promise<CenterAgentPostSpaceMessageResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceAddressingRpcOutput(
        rpcCenterAgentPostSpaceMessage(this.env, input),
        resolveCenterAgentSpaceAddressingVersion(input)
      )
    );
  }
  centerAgentReadSpaceAuthoringContract(
    input: CenterAgentReadSpaceAuthoringContractInput
  ): Promise<CenterAgentSpaceAuthoringContractResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSpaceAuthoringContract(this.env, input)
    );
  }
  centerAgentPostSlackChannelMessage(
    input: CenterAgentPostSlackChannelMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPostSlackChannelMessage(this.env, input)
    );
  }
  centerAgentPostSlackFile(
    input: CenterAgentPostSlackFileInput
  ): Promise<CenterAgentPostSlackFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPostSlackFile(this.env, input)
    );
  }
  centerAgentPostSlackThreadMessage(
    input: CenterAgentPostSlackThreadMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPostSlackThreadMessage(this.env, input)
    );
  }
  centerAgentRecordConnectorActionAudit(
    input: CenterAgentRecordConnectorActionAuditInput
  ): Promise<CenterAgentRecordConnectorActionAuditResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRecordConnectorActionAudit(this.env, input)
    );
  }
  centerAgentReadConnectorActionOperation(
    input: CenterAgentReadConnectorActionOperationInput
  ): Promise<CenterAgentReadConnectorActionOperationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadConnectorActionOperation(this.env, input)
    );
  }
  centerAgentRecordConnectorActionOperation(
    input: CenterAgentRecordConnectorActionOperationInput
  ): Promise<CenterAgentRecordConnectorActionOperationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRecordConnectorActionOperation(this.env, input)
    );
  }

  centerAgentWakeAgentProfilesInSpaces(
    input: CenterAgentWakeAgentProfilesInSpacesInput
  ): Promise<CenterAgentWakeAgentProfilesInSpacesResponse> {
    return rpcCenterAgentWakeAgentProfilesInSpaces(this.env, input, (work) =>
      this.ctx.waitUntil(work)
    );
  }

  centerAgentWakeAgentProfilesInSpace(
    input: CenterAgentWakeAgentProfilesInSpaceInput
  ): Promise<CenterAgentWakeAgentProfilesInSpaceResponse> {
    return withRemoteAgentSpaceFileWire(
      withSpaceAddressingRpcOutput(
        rpcCenterAgentWakeAgentProfilesInSpace(this.env, input),
        resolveCenterAgentSpaceAddressingVersion(input)
      )
    );
  }
  personalRemoteAgentSpaceTool(input: unknown) {
    return withRemoteAgentSpaceFileWire(
      runPersonalRemoteAgentSpaceTool(this.env, input)
    );
  }
  centerAgentListAgentTasks(
    input: CenterAgentListAgentTasksInput
  ): Promise<CenterAgentListAgentTasksResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListAgentTasks(this.env, input)
    );
  }
  centerAgentWatchAgentTask(
    input: CenterAgentWatchAgentTaskInput
  ): Promise<CenterAgentWatchAgentTaskResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentWatchAgentTask(this.env, input)
    );
  }
  centerAgentContinueTaskSummary(
    input: Parameters<typeof rpcCenterAgentContinueTaskSummary>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentContinueTaskSummary(this.env, input)
    );
  }
  centerAgentUpdateSpaceSettings(
    input: CenterAgentUpdateSpaceSettingsInput
  ): Promise<CenterAgentUpdateSpaceSettingsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentUpdateSpaceSettings(this.env, input)
    );
  }
  openCenterAgentDirectMessageSpace(
    input: OpenCenterAgentDirectMessageSpaceInput
  ): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcOpenCenterAgentDirectMessageSpace(this.env, input)
    );
  }
  openDirectMessageSpace(
    input: OpenDirectMessageSpaceInput
  ): Promise<OpenDirectMessageSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcOpenDirectMessageSpace(this.env, input)
    );
  }
  convertDirectMessageToSpace(
    input: ConvertDirectMessageToSpaceInput
  ): Promise<ConvertDirectMessageToSpaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcConvertDirectMessageToSpace(this.env, input)
    );
  }
  notifyAgentProfileRouteCatalogChanged(
    input: NotifyAgentProfileRouteCatalogChangedInput
  ): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
    return rpcNotifyAgentProfileRouteCatalogChanged(this.env, input);
  }
  notifyAgentProfilesRouteCatalogChanged(
    input: NotifyAgentProfilesRouteCatalogChangedInput
  ): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
    return rpcNotifyAgentProfilesRouteCatalogChanged(this.env, input);
  }
  submitRuntimeRegistration(
    input: SubmitRuntimeRegistrationInput
  ): Promise<SubmitRuntimeRegistrationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitRuntimeRegistration(this.env, input)
    );
  }
  submitRuntimeAgentControllerReports(
    input: SubmitRuntimeAgentControllerReportsInput
  ): Promise<SubmitRuntimeAgentControllerReportsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitRuntimeAgentControllerReportsWithMemberAgents(this.env, input)
    );
  }
  syncMemberAgents(
    input: SyncMemberAgentsRpcInput
  ): Promise<SyncMemberAgentsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSyncMemberAgents(this.env, input)
    );
  }
  getMemberAgentPresence(
    input: MemberAgentRpcInput
  ): Promise<GetMemberAgentPresenceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetMemberAgentPresence(this.env, input)
    );
  }
  listMemberAgentDirectMessageSessions(
    input: ListMemberAgentDirectMessageSessionsRpcInput
  ): Promise<ListMemberAgentDirectMessageSessionsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListMemberAgentDirectMessageSessions(this.env, input)
    );
  }
  listAgentAccessRequests(
    input: Parameters<typeof rpcListAgentAccessRequests>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAgentAccessRequests(this.env, input)
    );
  }
  getAgentAccessRequest(input: Parameters<typeof rpcGetAgentAccessRequest>[1]) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentAccessRequest(this.env, input)
    );
  }
  decideAgentAccessRequest(
    input: Parameters<typeof rpcDecideAgentAccessRequest>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDecideAgentAccessRequest(this.env, input)
    );
  }
  withdrawAgentAccessRequest(
    input: Parameters<typeof rpcWithdrawAgentAccessRequest>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWithdrawAgentAccessRequest(this.env, input)
    );
  }
  createSpaceAgentRequest(
    input: Parameters<typeof rpcCreateSpaceAgentRequest>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateSpaceAgentRequest(this.env, input)
    );
  }
  listAgentProfileAccessGrants(
    input: Parameters<typeof rpcListAgentProfileAccessGrants>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListAgentProfileAccessGrants(this.env, input)
    );
  }
  listViewerAgentAccessGrants(
    input: Parameters<typeof rpcListViewerAgentAccessGrants>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListViewerAgentAccessGrants(this.env, input)
    );
  }
  createAgentProfileAccessGrant(
    input: Parameters<typeof rpcCreateAgentProfileAccessGrant>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCreateAgentProfileAccessGrant(this.env, input)
    );
  }
  revokeAgentProfileAccessGrant(
    input: Parameters<typeof rpcRevokeAgentProfileAccessGrant>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRevokeAgentProfileAccessGrant(this.env, input)
    );
  }
  submitRuntimeProviderConversationProofs(
    input: SubmitRuntimeProviderConversationProofsInput
  ): Promise<SubmitRuntimeProviderConversationProofsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSubmitRuntimeProviderConversationProofs(this.env, input)
    );
  }
  listLocalRuntimes(
    input: GetLocalRuntimesInput
  ): Promise<LocalRuntimesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListLocalRuntimes(this.env, input)
    );
  }
  listPeopleComputers(
    input: GetLocalRuntimesInput
  ): Promise<PeopleComputersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListPeopleComputers(this.env, input)
    );
  }
  readServiceConnectionIncidents(
    input: ServiceConnectionIncidentsReadRpcInput
  ) {
    return rpcReadServiceConnectionIncidents(this.env, input);
  }
  reportServiceConnectionIncident(
    input: ServiceConnectionIncidentReportRpcInput
  ) {
    return rpcReportServiceConnectionIncident(this.env, input);
  }
  setPeopleComputerLocalAgentEnabled(
    input: Parameters<typeof rpcSetPeopleComputerLocalAgentEnabled>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      setLocalAgentEnabledWithMemberAgents(this.env, input, (current) =>
        rpcSetPeopleComputerLocalAgentEnabled(this.env, current)
      )
    );
  }
  getPeopleComputerLocalAgentInstallations(
    input: Parameters<typeof rpcGetPeopleComputerLocalAgentInstallations>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetPeopleComputerLocalAgentInstallations(this.env, input)
    );
  }
  selectPeopleComputerLocalAgentInstallation(
    input: Parameters<typeof rpcSelectPeopleComputerLocalAgentInstallation>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSelectPeopleComputerLocalAgentInstallation(this.env, input)
    );
  }
  managePeopleComputerLocalAgentUpdate(
    input: Parameters<typeof rpcManagePeopleComputerLocalAgentUpdate>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcManagePeopleComputerLocalAgentUpdate(this.env, input)
    );
  }
  managePeopleComputerLocalAgentSetup(
    input: Parameters<typeof rpcManagePeopleComputerLocalAgentSetup>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcManagePeopleComputerLocalAgentSetup(this.env, input)
    );
  }
  refreshPeopleComputerLocalAgentCatalog(
    input: Parameters<typeof rpcRefreshPeopleComputerLocalAgentCatalog>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRefreshPeopleComputerLocalAgentCatalog(this.env, input)
    );
  }
  requestPeopleComputerOpenMeldToolsUpdate(
    input: Parameters<typeof rpcRequestPeopleComputerOpenMeldToolsUpdate>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRequestPeopleComputerOpenMeldToolsUpdate(this.env, input)
    );
  }
  setPeopleComputerOpenMeldToolsMaintenance(
    input: Parameters<typeof rpcSetPeopleComputerOpenMeldToolsMaintenance>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetPeopleComputerOpenMeldToolsMaintenance(this.env, input)
    );
  }
  getPeopleComputerReplyReadiness(
    input: GetPeopleComputerReplyReadinessInput
  ): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetPeopleComputerReplyReadiness(this.env, input)
    );
  }
  getCurrentLocalRuntimeReplyReadiness(
    input: GetCurrentLocalRuntimeReplyReadinessInput
  ): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentLocalRuntimeReplyReadiness(this.env, input)
    );
  }
  setCurrentLocalAgentEnabled(
    input: SetCurrentLocalAgentEnabledInput
  ): Promise<SetCurrentLocalAgentEnabledResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      setLocalAgentEnabledWithMemberAgents(this.env, input, (current) =>
        rpcSetCurrentLocalAgentEnabled(this.env, current)
      )
    );
  }
  getCurrentLocalAgentInstallations(
    input: GetCurrentLocalAgentInstallationsInput
  ): Promise<CurrentLocalAgentInstallationsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentLocalAgentInstallations(this.env, input)
    );
  }
  selectCurrentLocalAgentInstallation(
    input: SelectCurrentLocalAgentInstallationInput
  ): Promise<SelectCurrentLocalAgentInstallationResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSelectCurrentLocalAgentInstallation(this.env, input)
    );
  }
  requestCurrentOpenMeldToolsUpdate(
    input: RequestCurrentOpenMeldToolsUpdateInput
  ): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRequestCurrentOpenMeldToolsUpdate(this.env, input)
    );
  }
  setCurrentOpenMeldToolsMaintenance(
    input: SetCurrentOpenMeldToolsMaintenanceInput
  ): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetCurrentOpenMeldToolsMaintenance(this.env, input)
    );
  }
  getCurrentAgentProfileWorkspace(input: GetCurrentAgentProfileWorkspaceInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCurrentAgentProfileWorkspace(this.env, input)
    );
  }
  getAgentProfileFolders(input: GetAgentProfileFoldersInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetAgentProfileFolders(this.env, input)
    );
  }
  manageAgentProfileFolders(input: ManageAgentProfileFoldersInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcManageAgentProfileFolders(this.env, input)
    );
  }
  setCurrentAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput
  ): Promise<SetCurrentAgentProfileWorkspaceResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetCurrentAgentProfileWorkspace(this.env, input)
    );
  }
  refreshCurrentLocalAgentCatalog(
    input: RefreshCurrentLocalAgentCatalogInput
  ): Promise<RefreshCurrentLocalAgentCatalogResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRefreshCurrentLocalAgentCatalog(this.env, input)
    );
  }
  setLocalRuntimeDisplayName(
    input: SetLocalRuntimeDisplayNameInput
  ): Promise<LocalRuntimesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcSetLocalRuntimeDisplayName(this.env, input)
    );
  }
  writeCurrentDeviceObservedMetadata(
    input: WriteCurrentDeviceObservedMetadataInput
  ): Promise<WriteCurrentDeviceObservedMetadataResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcWriteCurrentDeviceObservedMetadata(this.env, input)
    );
  }
  enrollLocalRuntime(
    input: EnrollLocalRuntimeInput
  ): Promise<LocalRuntimeEnrollmentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcEnrollLocalRuntime(this.env, input)
    );
  }
}
// Gateway-specific RPC entrypoint. Kept as a dedicated subclass to preserve an
// extension point for future gateway-aware overrides.
/** Credential facts the Gateway adds to a sensitive operation's input only. */
type GatewaySensitiveCredential = { requestCredential?: RequestCredential };

export class GatewayRpcEntrypoint extends CoreRpcEntrypoint {
  getCredentialConfirmation(
    input: Parameters<typeof rpcGetCredentialConfirmation>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcGetCredentialConfirmation(this.env, input)
    );
  }
  decideCredentialConfirmation(
    input: Parameters<typeof rpcDecideCredentialConfirmation>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcDecideCredentialConfirmation(this.env, input)
    );
  }
  listMemberAgentSensitiveOperationAudit(
    input: Parameters<typeof rpcListMemberAgentSensitiveOperationAudit>[1]
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcListMemberAgentSensitiveOperationAudit(this.env, input)
    );
  }
  readOrganizationAiBilling(input: OrganizationAiBillingRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadAiBilling(this.env, input)
    );
  }
  updateOrganizationAiBilling(input: UpdateOrganizationAiBillingRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcUpdateAiBilling(this.env, input)
    );
  }
  firstWork(input: Parameters<typeof rpcFirstWork>[1]) {
    return super.firstWork(input);
  }
  handleSlackWelcomeInteraction(
    input: SlackWelcomeInteractionRpcInput
  ): Promise<SlackWelcomeInteractionRpcResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      handleSlackWelcomeInteraction(this.env, input)
    );
  }
  async runLocalRoutineSchedulerTick(): Promise<{
    ok: true;
    ranAtMs: number;
  }> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      if (this.env.OPENMELD_WORKER_ENVIRONMENT !== "local") {
        throw new Error(
          "Local Routine scheduler ticks are unavailable outside local development."
        );
      }
      const ranAtMs = Date.now();
      await runCoreScheduledTasks({
        env: this.env,
        cron: ROUTINE_TICK_CRON,
        nowMs: ranAtMs,
      });
      return { ok: true, ranAtMs };
    });
  }
  createSpace(input?: CreateSpaceInput) {
    return super.createSpace(input);
  }
  getModelCatalog(options?: ModelCatalogReadOptions): GetModelCatalogResponse {
    return super.getModelCatalog(options);
  }
  readChangelog(input: ReadChangelogInput): Promise<ChangelogQueryResponse> {
    return super.readChangelog(input);
  }
  listAccountSpaces(
    input: ListAccountSpacesInput
  ): Promise<AccountSpaceIndexResponse> {
    return super.listAccountSpaces(input);
  }
  listAccountSpaceActiveWakeSummary(
    input: ListAccountSpaceActiveWakeSummaryInput
  ): Promise<AccountSpaceActiveWakeSummaryResponse> {
    return super.listAccountSpaceActiveWakeSummary(input);
  }
  listProjects(input: ListProjectsInput) {
    return super.listProjects(input);
  }

  readProjectIssueRouting(
    input: Parameters<typeof rpcReadProjectIssueRouting>[1]
  ) {
    return super.readProjectIssueRouting(input);
  }

  readProjectRepositorySettings(
    input: Parameters<typeof rpcReadProjectRepositorySettings>[1]
  ) {
    return super.readProjectRepositorySettings(input);
  }

  updateProjectRepositorySettings(
    input: Parameters<typeof rpcUpdateProjectRepositorySettings>[1]
  ) {
    return super.updateProjectRepositorySettings(input);
  }

  readProjectCommonAgents(
    input: Parameters<typeof rpcReadProjectCommonAgents>[1]
  ) {
    return super.readProjectCommonAgents(input);
  }

  readProjectRecentTasks(
    input: Parameters<typeof rpcReadProjectRecentTasks>[1]
  ) {
    return super.readProjectRecentTasks(input);
  }

  updateProjectCommonAgents(
    input: Parameters<typeof rpcUpdateProjectCommonAgents>[1]
  ) {
    return super.updateProjectCommonAgents(input);
  }

  resolveProjectIssueAction(
    input: Parameters<typeof rpcResolveProjectIssueAction>[1]
  ) {
    return super.resolveProjectIssueAction(input);
  }

  updateProjectIssueRouting(
    input: Parameters<typeof rpcUpdateProjectIssueRouting>[1]
  ) {
    return super.updateProjectIssueRouting(input);
  }
  createProject(input: CreateProjectInput) {
    return super.createProject(input);
  }
  updateProject(input: UpdateProjectInput) {
    return super.updateProject(input);
  }
  updateAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput & GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "default_project_write",
      },
      (operationInput) => super.updateAgentProfileDefaultProject(operationInput)
    );
  }
  updateBoundAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput & GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "default_project_write",
      },
      (operationInput) =>
        super.updateBoundAgentProfileDefaultProject(operationInput)
    );
  }
  archiveProject(input: ArchiveProjectInput) {
    return super.archiveProject(input);
  }
  discoverProjects(input: DiscoverProjectsInput) {
    return super.discoverProjects(input);
  }
  discoverPeopleComputerProjects(
    input: Parameters<typeof rpcDiscoverPeopleComputerProjects>[1]
  ) {
    return super.discoverPeopleComputerProjects(input);
  }
  connectPeopleComputerProjectCandidate(
    input: Parameters<typeof rpcConnectPeopleComputerProjectCandidate>[1]
  ) {
    return super.connectPeopleComputerProjectCandidate(input);
  }
  getPeopleComputerAgentProfileWorkspace(
    input: GetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget
  ) {
    return super.getPeopleComputerAgentProfileWorkspace(input);
  }
  setPeopleComputerAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget &
      GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "working_folder_write",
      },
      (operationInput) =>
        super.setPeopleComputerAgentProfileWorkspace(operationInput)
    );
  }
  setBoundPeopleComputerAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput &
      import("@openmeld/schemas/types").PeopleComputerTarget &
      GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "working_folder_write",
      },
      (operationInput) =>
        super.setBoundPeopleComputerAgentProfileWorkspace(operationInput)
    );
  }
  connectPeopleComputerProjectPath(
    input: Parameters<typeof rpcConnectPeopleComputerProjectPath>[1]
  ) {
    return super.connectPeopleComputerProjectPath(input);
  }
  setPeopleComputerProjectDefaultConnection(
    input: Parameters<typeof rpcSetPeopleComputerProjectDefaultConnection>[1]
  ) {
    return super.setPeopleComputerProjectDefaultConnection(input);
  }
  readComputerFileAccessPolicy(input: ReadComputerFileAccessPolicyInput) {
    return super.readComputerFileAccessPolicy(input);
  }
  agentSessionHistory(input: Parameters<typeof rpcAgentSessionHistory>[1]) {
    return super.agentSessionHistory(input);
  }
  computerSessionHistory(
    input: Parameters<typeof rpcComputerSessionHistory>[1]
  ) {
    return super.computerSessionHistory(input);
  }
  computerPowerSettings(input: Parameters<typeof rpcComputerPowerSettings>[1]) {
    return super.computerPowerSettings(input);
  }
  readPeopleComputerFileAccessPolicy(
    input: Parameters<typeof rpcReadPeopleComputerFileAccessPolicy>[1]
  ) {
    return super.readPeopleComputerFileAccessPolicy(input);
  }
  updatePeopleComputerFileAccessPolicy(
    input: Parameters<typeof rpcUpdatePeopleComputerFileAccessPolicy>[1]
  ) {
    return super.updatePeopleComputerFileAccessPolicy(input);
  }
  selectLocalFolders(input: SelectLocalFoldersInput) {
    return super.selectLocalFolders(input);
  }
  selectPeopleComputerFolders(
    input: Parameters<typeof rpcSelectPeopleComputerFolders>[1]
  ) {
    return super.selectPeopleComputerFolders(input);
  }
  updateComputerFileAccessPolicy(input: UpdateComputerFileAccessPolicyInput) {
    return super.updateComputerFileAccessPolicy(input);
  }
  connectCandidate(input: ConnectCandidateInput) {
    return super.connectCandidate(input);
  }
  connectDeclaredPath(input: ConnectDeclaredPathInput) {
    return super.connectDeclaredPath(input);
  }
  setDefaultConnection(input: SetDefaultConnectionInput) {
    return super.setDefaultConnection(input);
  }
  removeConnection(input: RemoveConnectionInput) {
    return super.removeConnection(input);
  }
  removeMissingConnections(input: RemoveMissingConnectionsInput) {
    return super.removeMissingConnections(input);
  }
  submitAgentActivityEvents(input: SubmitAgentActivityEventsInput) {
    return super.submitAgentActivityEvents(input);
  }
  submitAgentActivitySessionReconciliation(
    input: SubmitAgentActivitySessionReconciliationInput
  ) {
    return super.submitAgentActivitySessionReconciliation(input);
  }
  readAgentActivitySnapshot(input: ReadAgentActivitySnapshotInput) {
    return super.readAgentActivitySnapshot(input);
  }
  readAgentActivitySessionInventory(
    input: ReadAgentActivitySessionInventoryInput
  ) {
    return super.readAgentActivitySessionInventory(input);
  }
  readAgentActivityStats(input: ReadAgentActivityStatsInput) {
    return super.readAgentActivityStats(input);
  }
  readOrganizationUsageOverview(input: ReadOrganizationUsageOverviewInput) {
    return super.readOrganizationUsageOverview(input);
  }
  readOrganizationAiUsage(input: OrganizationAiUsageRpcInput) {
    return super.readOrganizationAiUsage(input);
  }
  listRoutines(input: ListRoutinesInput) {
    return super.listRoutines(input);
  }
  listRoutineTargetSpaces(input: ListRoutineTargetSpacesInput) {
    return super.listRoutineTargetSpaces(input);
  }
  createRoutine(input: CreateRoutineInput) {
    return super.createRoutine(input);
  }
  updateRoutine(input: UpdateRoutineInput) {
    return super.updateRoutine(input);
  }
  pauseRoutine(input: PauseRoutineInput) {
    return super.pauseRoutine(input);
  }
  resumeRoutine(input: ResumeRoutineInput) {
    return super.resumeRoutine(input);
  }
  deleteRoutine(input: DeleteRoutineInput) {
    return super.deleteRoutine(input);
  }
  listRoutineRuns(input: ListRoutineRunsInput) {
    return super.listRoutineRuns(input);
  }
  reportDesktopUpdateObservation(
    input: import("@openmeld/schemas/types").DesktopUpdateObservationRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReportDesktopUpdateObservation(this.env, input)
    );
  }
  listInboxFeed(input: ListInboxFeedRpcInput): Promise<InboxFeedResponse> {
    return super.listInboxFeed(input);
  }
  searchMessages(
    input: import("@openmeld/schemas").MessageSearchRpcInput,
    spaceImageGeometryVersion?: string
  ) {
    return super.searchMessages(input, spaceImageGeometryVersion);
  }
  mutateInboxFeed(
    input: MutateInboxFeedRpcInput
  ): Promise<MutateInboxFeedResponse> {
    return super.mutateInboxFeed(input);
  }
  listInboxItems(
    input: ListInboxItemsRpcInput
  ): Promise<ListInboxItemsResponse> {
    return super.listInboxItems(input);
  }
  observeInboxNotifications(
    input: import("@openmeld/schemas/types").ObserveInboxNotificationsRpcInput
  ) {
    return super.observeInboxNotifications(input);
  }
  dismissInboxItem(
    input: DismissInboxItemRpcInput
  ): Promise<DismissInboxItemResponse> {
    return super.dismissInboxItem(input);
  }
  getInboxItem(input: GetInboxItemRpcInput): Promise<GetInboxItemResponse> {
    return super.getInboxItem(input);
  }
  getInboxSummary(
    input: GetInboxSummaryRpcInput
  ): Promise<InboxSummaryResponse> {
    return super.getInboxSummary(input);
  }
  getCenterAgentInboxSummary(
    input: GetCenterAgentInboxSummaryRpcInput
  ): Promise<CenterAgentInboxSummaryResponse> {
    return super.getCenterAgentInboxSummary(input);
  }
  getSpaceInboxSummary(
    input: GetSpaceInboxSummaryRpcInput
  ): Promise<SpaceInboxSummaryResponse> {
    return super.getSpaceInboxSummary(input);
  }
  getSpaceInboxUnreadTargets(
    input: GetSpaceInboxUnreadTargetsRpcInput
  ): Promise<SpaceInboxUnreadTargetsResponse> {
    return super.getSpaceInboxUnreadTargets(input);
  }
  mutateSpaceInboxRead(
    input: import("@openmeld/schemas/types").MutateSpaceInboxReadRpcInput
  ) {
    return super.mutateSpaceInboxRead(input);
  }
  markCenterAgentInboxReadThrough(
    input: MarkCenterAgentInboxReadThroughRpcInput
  ): Promise<MarkCenterAgentInboxReadThroughResponse> {
    return super.markCenterAgentInboxReadThrough(input);
  }
  markSpaceInboxReadThrough(
    input: MarkSpaceInboxReadThroughRpcInput
  ): Promise<MarkSpaceInboxReadThroughResponse> {
    return super.markSpaceInboxReadThrough(input);
  }
  markInboxItemRead(
    input: MarkInboxItemReadRpcInput
  ): Promise<MarkInboxItemReadResponse> {
    return super.markInboxItemRead(input);
  }
  markAllInboxItemsRead(
    input: MarkAllInboxItemsReadRpcInput
  ): Promise<MarkAllInboxItemsReadResponse> {
    return super.markAllInboxItemsRead(input);
  }
  getInboxNotificationPreferences(
    input: GetInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return super.getInboxNotificationPreferences(input);
  }
  getInboxMessageNotificationPreferences(
    input: GetInboxMessageNotificationPreferencesRpcInput
  ) {
    return super.getInboxMessageNotificationPreferences(input);
  }
  updateInboxMessageNotificationPreferences(
    input: UpdateInboxMessageNotificationPreferencesRpcInput
  ) {
    return super.updateInboxMessageNotificationPreferences(input);
  }
  updateInboxNotificationPreferences(
    input: UpdateInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return super.updateInboxNotificationPreferences(input);
  }
  listOrganizationDocuments(
    input: ListOrganizationDocumentsRpcInput
  ): Promise<ListOrganizationDocumentsResponse> {
    return super.listOrganizationDocuments(input);
  }
  centerAgentReadOrganizationSkills(
    input: CenterAgentReadOrganizationSkillsRpcInput
  ): Promise<CenterAgentReadOrganizationSkillsResponse> {
    return super.centerAgentReadOrganizationSkills(input);
  }
  centerAgentInstallOrganizationSkill(
    input: CenterAgentInstallOrganizationSkillRpcInput
  ): Promise<CenterAgentInstallOrganizationSkillResponse> {
    return super.centerAgentInstallOrganizationSkill(input);
  }
  listOrganizationSkills(
    input: ListOrganizationSkillsRpcInput
  ): Promise<ListOrganizationSkillsResponse> {
    return super.listOrganizationSkills(input);
  }
  getOrganizationSkill(
    input: GetOrganizationSkillRpcInput
  ): Promise<GetOrganizationSkillResponse> {
    return super.getOrganizationSkill(input);
  }
  getOrganizationSkillCatalog(
    input: GetOrganizationSkillRpcInput
  ): Promise<OrganizationSkillRuntimeCatalogResponse> {
    return super.getOrganizationSkillCatalog(input);
  }
  createOrganizationSkill(
    input: CreateOrganizationSkillRpcInput
  ): Promise<CreateOrganizationSkillResponse> {
    return super.createOrganizationSkill(input);
  }
  importOrganizationSkillFromGitHub(
    input: ImportOrganizationSkillFromGitHubRpcInput
  ): Promise<ImportOrganizationSkillFromGitHubResponse> {
    return super.importOrganizationSkillFromGitHub(input);
  }
  importOrganizationSkillFromFiles(
    input: ImportOrganizationSkillFromFilesRpcInput
  ): Promise<ImportOrganizationSkillFromFilesResponse> {
    return super.importOrganizationSkillFromFiles(input);
  }
  previewOrganizationSkillFromGitHub(
    input: PreviewOrganizationSkillFromGitHubRpcInput
  ): Promise<PreviewOrganizationSkillFromGitHubResponse> {
    return super.previewOrganizationSkillFromGitHub(input);
  }
  previewOrganizationSkillRepository(
    input: PreviewOrganizationSkillRepositoryRpcInput
  ): Promise<PreviewOrganizationSkillRepositoryResponse> {
    return super.previewOrganizationSkillRepository(input);
  }
  beginOrganizationSkillImportBatch(
    input: BeginOrganizationSkillImportBatchRpcInput
  ): Promise<BeginOrganizationSkillImportBatchResponse> {
    return super.beginOrganizationSkillImportBatch(input);
  }
  getOrganizationSkillImportBatch(
    input: GetOrganizationSkillImportBatchRpcInput
  ): Promise<GetOrganizationSkillImportBatchResponse> {
    return super.getOrganizationSkillImportBatch(input);
  }
  listOrganizationSkillImportBatches(
    input: ListOrganizationSkillImportBatchesRpcInput
  ): Promise<ListOrganizationSkillImportBatchesResponse> {
    return super.listOrganizationSkillImportBatches(input);
  }
  previewOrganizationSkillFromFiles(
    input: PreviewOrganizationSkillFromFilesRpcInput
  ): Promise<PreviewOrganizationSkillFromFilesResponse> {
    return super.previewOrganizationSkillFromFiles(input);
  }
  updateOrganizationSkill(
    input: UpdateOrganizationSkillRpcInput
  ): Promise<UpdateOrganizationSkillResponse> {
    return super.updateOrganizationSkill(input);
  }
  setOrganizationSkillEnabled(
    input: SetOrganizationSkillEnabledRpcInput
  ): Promise<SetOrganizationSkillEnabledResponse> {
    return super.setOrganizationSkillEnabled(input);
  }
  setOrganizationSkillMaintainers(
    input: SetOrganizationSkillMaintainersRpcInput
  ): Promise<SetOrganizationSkillMaintainersResponse> {
    return super.setOrganizationSkillMaintainers(input);
  }
  deleteOrganizationSkill(
    input: DeleteOrganizationSkillRpcInput
  ): Promise<DeleteOrganizationSkillResponse> {
    return super.deleteOrganizationSkill(input);
  }
  readOrganizationSkillRuntimeSnapshot(
    input: ReadOrganizationSkillRuntimeSnapshotRpcInput
  ): Promise<OrganizationSkillRuntimeSnapshotResponse> {
    return super.readOrganizationSkillRuntimeSnapshot(input);
  }
  readOrganizationSkillRuntimeCatalog(
    input: ReadOrganizationSkillRuntimeCatalogRpcInput
  ): Promise<OrganizationSkillRuntimeCatalogResponse> {
    return super.readOrganizationSkillRuntimeCatalog(input);
  }
  readOrganizationSkillRuntimeResource(
    input: ReadOrganizationSkillRuntimeResourceRpcInput
  ): Promise<ReadOrganizationSkillRuntimeResourceResponse> {
    return super.readOrganizationSkillRuntimeResource(input);
  }
  recordOrganizationSkillActivation(
    input: RecordOrganizationSkillActivationRpcInput
  ): Promise<RecordOrganizationSkillActivationResponse> {
    return super.recordOrganizationSkillActivation(input);
  }
  getOrganizationDocument(
    input: GetOrganizationDocumentRpcInput
  ): Promise<GetOrganizationDocumentResponse> {
    return super.getOrganizationDocument(input);
  }
  createOrganizationDocument(
    input: CreateOrganizationDocumentRpcInput
  ): Promise<CreateOrganizationDocumentResponse> {
    return super.createOrganizationDocument(input);
  }
  updateOrganizationDocument(
    input: UpdateOrganizationDocumentRpcInput
  ): Promise<UpdateOrganizationDocumentResponse> {
    return super.updateOrganizationDocument(input);
  }
  deleteOrganizationDocument(
    input: DeleteOrganizationDocumentRpcInput
  ): Promise<DeleteOrganizationDocumentResponse> {
    return super.deleteOrganizationDocument(input);
  }
  createOrganizationDocumentFolder(
    input: CreateOrganizationDocumentFolderRpcInput
  ): Promise<CreateOrganizationDocumentFolderResponse> {
    return super.createOrganizationDocumentFolder(input);
  }
  updateOrganizationDocumentFolder(
    input: UpdateOrganizationDocumentFolderRpcInput
  ): Promise<UpdateOrganizationDocumentFolderResponse> {
    return super.updateOrganizationDocumentFolder(input);
  }
  deleteOrganizationDocumentFolder(
    input: DeleteOrganizationDocumentFolderRpcInput
  ): Promise<DeleteOrganizationDocumentFolderResponse> {
    return super.deleteOrganizationDocumentFolder(input);
  }
  approveOrganizationDocumentDraft(
    input: ApproveOrganizationDocumentDraftRpcInput
  ): Promise<ApproveOrganizationDocumentDraftResponse> {
    return super.approveOrganizationDocumentDraft(input);
  }
  discardOrganizationDocumentDraft(
    input: DiscardOrganizationDocumentDraftRpcInput
  ): Promise<DiscardOrganizationDocumentDraftResponse> {
    return super.discardOrganizationDocumentDraft(input);
  }
  startCenterAgentMemberResearch(
    input: StartCenterAgentMemberResearchRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse> {
    return super.startCenterAgentMemberResearch(input);
  }
  getCenterAgentMemberResearchStatus(
    input: GetCenterAgentMemberResearchStatusRpcInput
  ): Promise<GetCenterAgentMemberResearchStatusResponse> {
    return super.getCenterAgentMemberResearchStatus(input);
  }
  listSignals(
    input: ListSignalsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSignalsResult> {
    return super.listSignals(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  postDeviceWaitingSignal(
    input: PostSignalInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SignalEnvelope> {
    return super.postDeviceWaitingSignal(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  postSignal(
    input: PostSignalInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SignalEnvelope> {
    return super.postSignal(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  mutateSpaceMessage(
    input: import("./rpc/methods").MutateSpaceMessageInput,
    spaceImageGeometryVersion?: string
  ) {
    return super.mutateSpaceMessage(input, spaceImageGeometryVersion);
  }
  postTransientSignal(input: PostTransientSignalInput): Promise<void> {
    return super.postTransientSignal(input);
  }
  getSpaceMembers(input: GetSpaceMembersInput): Promise<SpaceMembersSnapshot> {
    return super.getSpaceMembers(input);
  }
  getSpaceHistoryNavigation(
    input: GetSpaceMembersInput & SpaceHistoryNavigationQuery
  ): Promise<SpaceHistoryNavigation> {
    return super.getSpaceHistoryNavigation(input);
  }
  getSpaceIdentityDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceIdentityDirectory> {
    return super.getSpaceIdentityDirectory(input);
  }
  getSpaceMemberDirectory(
    input: GetSpaceMembersInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceMemberDirectory> {
    return super.getSpaceMemberDirectory(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceViewerMembership(
    input: GetSpaceViewerMembershipInput
  ): Promise<SpaceViewerMembershipResponse> {
    return super.getSpaceViewerMembership(input);
  }
  recordSpaceAttachment(
    input: RecordSpaceAttachmentInput
  ): Promise<SpaceAttachmentDescriptor> {
    return super.recordSpaceAttachment(input);
  }
  deleteSpaceAttachmentRecord(
    input: DeleteSpaceAttachmentRecordInput
  ): Promise<DeleteSpaceAttachmentRecordResult> {
    return super.deleteSpaceAttachmentRecord(input);
  }
  resolveSpaceAttachmentForDownload(
    input: ResolveSpaceAttachmentForDownloadInput
  ): Promise<SpaceAttachmentDescriptor> {
    return super.resolveSpaceAttachmentForDownload(input);
  }
  listSpaceFiles(
    input: ListSpaceFilesInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceFilesResponse> {
    return super.listSpaceFiles(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceFile(
    input: GetSpaceFileInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return super.getSpaceFile(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  listSpaceFileRevisions(
    input: GetSpaceFileInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceFileRevisionsResponse> {
    return super.listSpaceFileRevisions(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  createSpaceFolder(
    input: CreateSpaceFolderInput
  ): Promise<CreateSpaceFolderResponse> {
    return super.createSpaceFolder(input);
  }
  updateSpaceFileEntry(
    input: UpdateSpaceFileEntryInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<UpdateSpaceFileEntryResponse> {
    return super.updateSpaceFileEntry(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  trashSpaceFileEntry(
    input: TrashSpaceFileEntryInput
  ): Promise<TrashSpaceFileEntryResponse> {
    return super.trashSpaceFileEntry(input);
  }
  restoreSpaceFileEntry(
    input: RestoreSpaceFileEntryInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<RestoreSpaceFileEntryResponse> {
    return super.restoreSpaceFileEntry(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  restoreSpaceFileRevision(
    input: RestoreSpaceFileRevisionInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return super.restoreSpaceFileRevision(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  prepareSpaceFileWrite(
    input: SpaceFileWriteInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<PrepareSpaceFileWriteResponse> {
    return super.prepareSpaceFileWrite(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  commitSpaceFileWrite(
    input: SpaceFileWriteInput,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return super.commitSpaceFileWrite(input, spaceImageGeometryVersion);
  }
  resolveSpaceFileContent(
    input: ResolveSpaceFileContentRpcInput,
    spaceImageGeometryVersion?: string
  ): Promise<ResolveSpaceFileContentResponse> {
    return super.resolveSpaceFileContent(input, spaceImageGeometryVersion);
  }
  listSpaceThreads(
    input: ListSpaceThreadsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceThreadsResponse> {
    return super.listSpaceThreads(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceThread(
    input: GetSpaceThreadInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<GetSpaceThreadResponse> {
    return super.getSpaceThread(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  listSpaceThreadEvents(
    input: ListSpaceThreadEventsInput
  ): Promise<ListSpaceThreadEventsResponse> {
    return super.listSpaceThreadEvents(input);
  }
  listSpaceThreadSignals(
    input: ListSpaceThreadSignalsInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<ListSpaceThreadSignalsResponse> {
    return super.listSpaceThreadSignals(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceDispatchTrace(
    input: GetSpaceDispatchTraceInput
  ): Promise<SpaceDispatchTraceResponse> {
    return super.getSpaceDispatchTrace(input);
  }
  inspectExecutionRecovery(
    input: InspectExecutionRecoveryInput
  ): Promise<InspectExecutionRecoveryResponse> {
    return super.inspectExecutionRecovery(input);
  }
  executeExecutionRecovery(
    input: ExecuteExecutionRecoveryInput
  ): Promise<ExecuteExecutionRecoveryResponse> {
    return super.executeExecutionRecovery(input);
  }
  getSpaceDispatchLookup(
    input: GetSpaceDispatchLookupInput
  ): Promise<GetSpaceDispatchLookupResponse> {
    return super.getSpaceDispatchLookup(input);
  }
  getActiveSpaceWakeProgress(
    input: GetActiveSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse> {
    return super.getActiveSpaceWakeProgress(input);
  }
  getSpaceWakeProgress(
    input: GetSpaceWakeProgressInput
  ): Promise<GetSpaceWakeProgressResponse> {
    return super.getSpaceWakeProgress(input);
  }
  postSpaceWakeStop(
    input: PostSpaceWakeStopInput
  ): Promise<PostSpaceWakeStopResponse> {
    return super.postSpaceWakeStop(input);
  }
  respondToSpaceAgentInteraction(
    input: RespondToSpaceAgentInteractionInput & GatewaySensitiveCredential
  ): Promise<RespondToSpaceAgentInteractionResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: null, operation: "agent_interaction_answer" },
      (operationInput) => super.respondToSpaceAgentInteraction(operationInput)
    );
  }
  getSpaceWakeTraceWaterfall(
    input: GetSpaceWakeTraceWaterfallInput
  ): Promise<GetSpaceWakeTraceWaterfallResponse> {
    return super.getSpaceWakeTraceWaterfall(input);
  }
  getSpaceMessageReactions(input: GetSpaceMessageReactionsInput) {
    return super.getSpaceMessageReactions(input);
  }
  setSpaceMessageReaction(input: SetSpaceMessageReactionInput) {
    return super.setSpaceMessageReaction(input);
  }
  getSpaceMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse> {
    return super.getSpaceMessageDetails(input);
  }
  getSpaceLinkPreviews(input: GetSpaceMessageDetailsInput) {
    return super.getSpaceLinkPreviews(input);
  }
  createSpaceDiagnosticReport(
    input: CreateSpaceDiagnosticReportInput
  ): Promise<CreateSpaceDiagnosticReportResponse> {
    return super.createSpaceDiagnosticReport(input);
  }
  addSpaceMembers(
    input: AddSpaceMembersInput & GatewaySensitiveCredential
  ): Promise<PostSpaceMembersResponse> {
    const { requestCredential: _credential, ...members } = input;
    // Adding the caller's own Agent is sensitive (§4.6); another owner's
    // Agent goes through that owner's request instead.
    const ownAgent = input.members.find(
      (member) =>
        member.profileKind === "agent" &&
        member.ownerUserId !== null &&
        member.ownerUserId === input.context?.actorContext.callerPrincipalId
    );
    return ownAgent
      ? runGatewaySensitiveOperation(
          this.env,
          input,
          {
            agentProfileId: ownAgent.profileId,
            operation: "space_members_add_agent",
          },
          (operationInput) => super.addSpaceMembers(operationInput)
        )
      : super.addSpaceMembers(members);
  }
  removeSpaceMembers(
    input: RemoveSpaceMembersInput
  ): Promise<RemoveSpaceMembersResponse> {
    return super.removeSpaceMembers(input);
  }
  leaveSpace(input: LeaveSpaceInput): Promise<LeaveSpaceResponse> {
    return super.leaveSpace(input);
  }
  getSpaceMeta(input: GetSpaceMetaInput): Promise<SpaceMeta> {
    return super.getSpaceMeta(input);
  }
  spaceFilePins(
    input: SpaceFilePinsInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFilePinsResponse> {
    return super.spaceFilePins(
      input,
      spaceFilesOriginVersion,
      spaceImageGeometryVersion
    );
  }
  spaceMessagePins(
    input: SpaceMessagePinsInput
  ): Promise<SpaceMessagePinsResponse> {
    return super.spaceMessagePins(input);
  }

  spaceInputQueue(
    input: SpaceInputQueueInput
  ): Promise<SpaceInputQueueResponse> {
    return super.spaceInputQueue(input);
  }

  listSpaceTasks(input: ListSpaceTasksInput): Promise<ListSpaceTasksResponse> {
    return super.listSpaceTasks(input);
  }
  getSpaceTask(input: GetSpaceTaskInput): Promise<SpaceTaskResponse> {
    return super.getSpaceTask(input);
  }
  createSpaceTask(
    input: CreateSpaceTaskInput
  ): Promise<SpaceTaskMutationReceipt> {
    return super.createSpaceTask(input);
  }
  mutateSpaceTask(
    input: MutateSpaceTaskInput
  ): Promise<SpaceTaskMutationReceipt> {
    return super.mutateSpaceTask(input);
  }
  getSpaceContract(input: GetSpaceContractInput): Promise<SpaceContract> {
    return super.getSpaceContract(input);
  }
  getSpaceBoard(input: GetSpaceBoardInput): Promise<SpaceBoardResponse> {
    return super.getSpaceBoard(input);
  }
  getSpaceStatus(input: GetSpaceStatusInput): Promise<GetSpaceStatusResponse> {
    return super.getSpaceStatus(input);
  }
  getSpaceEntryResolution(
    input: GetSpaceEntryResolutionRpcInput
  ): Promise<GetSpaceEntryResolutionResponse> {
    return super.getSpaceEntryResolution(input);
  }
  getSpaceConversationState(
    input: GetSpaceConversationStateRpcInput
  ): Promise<GetSpaceConversationStateResponse> {
    return super.getSpaceConversationState(input);
  }
  getSpaceBootstrap(
    input: GetSpaceBootstrapInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceBootstrapResponse> {
    return super.getSpaceBootstrap(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceBootstrapWithTiming(
    input: GetSpaceBootstrapInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceBootstrapWithTiming> {
    return super.getSpaceBootstrapWithTiming(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  inspectDispatchStorageReadiness(): Promise<DispatchStorageReadiness> {
    return super.inspectDispatchStorageReadiness();
  }
  getSpaceUpdates(
    input: GetSpaceUpdatesInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<GetSpaceUpdatesResponse> {
    return super.getSpaceUpdates(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  getSpaceDispatchResult(
    input: GetSpaceDispatchResultInput,
    spaceAddressingVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<DispatchResult> {
    return super.getSpaceDispatchResult(
      input,
      spaceAddressingVersion,
      spaceImageGeometryVersion
    );
  }
  deleteSpace(
    input: DeleteSpaceInput & GatewaySensitiveCredential
  ): Promise<DeleteSpaceResult> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: null, operation: "space_delete" },
      (operationInput) => super.deleteSpace(operationInput)
    );
  }
  deleteConversationForMe(
    input: import("@openmeld/schemas").DeleteConversationForMeInput
  ): Promise<import("@openmeld/schemas").DeleteConversationForMeResponse> {
    return super.deleteConversationForMe(input);
  }
  updateSpaceMeta(input: UpdateSpaceMetaInput): Promise<SpaceMeta> {
    return super.updateSpaceMeta(input);
  }
  putSpaceContract(input: PutSpaceContractInput): Promise<SpaceContract> {
    return super.putSpaceContract(input);
  }
  patchSpaceContract(input: PatchSpaceContractInput): Promise<SpaceContract> {
    return super.patchSpaceContract(input);
  }
  getSpaceCursor(input: GetSpaceCursorInput): Promise<SpaceCursor> {
    return super.getSpaceCursor(input);
  }
  updateSpaceCursor(input: UpdateSpaceCursorInput): Promise<SpaceCursor> {
    return super.updateSpaceCursor(input);
  }
  upsertSpacePassword(
    input: UpsertSpacePasswordInput
  ): Promise<SpacePasswordStateResult> {
    return super.upsertSpacePassword(input);
  }
  clearSpacePassword(
    input: ClearSpacePasswordInput
  ): Promise<SpacePasswordStateResult> {
    return super.clearSpacePassword(input);
  }
  setSpaceAccessMode(
    input: SetSpaceAccessModeInput
  ): Promise<SpaceAccessModeStateResult> {
    return super.setSpaceAccessMode(input);
  }
  getCurrentDeviceTarget(
    input: GetCurrentDeviceTargetInput
  ): Promise<CurrentDeviceTargetResponse> {
    return super.getCurrentDeviceTarget(input);
  }
  personalComputer(input: unknown) {
    return super.personalComputer(input);
  }
  listLocalRuntimes(
    input: GetLocalRuntimesInput
  ): Promise<LocalRuntimesResponse> {
    return super.listLocalRuntimes(input);
  }
  listPeopleComputers(
    input: GetLocalRuntimesInput
  ): Promise<PeopleComputersResponse> {
    return super.listPeopleComputers(input);
  }
  readServiceConnectionIncidents(
    input: ServiceConnectionIncidentsReadRpcInput
  ) {
    return super.readServiceConnectionIncidents(input);
  }
  reportServiceConnectionIncident(
    input: ServiceConnectionIncidentReportRpcInput
  ) {
    return super.reportServiceConnectionIncident(input);
  }
  setPeopleComputerLocalAgentEnabled(
    input: Parameters<typeof rpcSetPeopleComputerLocalAgentEnabled>[1]
  ) {
    return super.setPeopleComputerLocalAgentEnabled(input);
  }
  getPeopleComputerLocalAgentInstallations(
    input: Parameters<typeof rpcGetPeopleComputerLocalAgentInstallations>[1]
  ) {
    return super.getPeopleComputerLocalAgentInstallations(input);
  }
  selectPeopleComputerLocalAgentInstallation(
    input: Parameters<typeof rpcSelectPeopleComputerLocalAgentInstallation>[1]
  ) {
    return super.selectPeopleComputerLocalAgentInstallation(input);
  }
  managePeopleComputerLocalAgentUpdate(
    input: Parameters<typeof rpcManagePeopleComputerLocalAgentUpdate>[1]
  ) {
    return super.managePeopleComputerLocalAgentUpdate(input);
  }
  managePeopleComputerLocalAgentSetup(
    input: Parameters<typeof rpcManagePeopleComputerLocalAgentSetup>[1]
  ) {
    return super.managePeopleComputerLocalAgentSetup(input);
  }
  refreshPeopleComputerLocalAgentCatalog(
    input: Parameters<typeof rpcRefreshPeopleComputerLocalAgentCatalog>[1]
  ) {
    return super.refreshPeopleComputerLocalAgentCatalog(input);
  }
  requestPeopleComputerOpenMeldToolsUpdate(
    input: Parameters<typeof rpcRequestPeopleComputerOpenMeldToolsUpdate>[1]
  ) {
    return super.requestPeopleComputerOpenMeldToolsUpdate(input);
  }
  setPeopleComputerOpenMeldToolsMaintenance(
    input: Parameters<typeof rpcSetPeopleComputerOpenMeldToolsMaintenance>[1]
  ) {
    return super.setPeopleComputerOpenMeldToolsMaintenance(input);
  }
  getPeopleComputerReplyReadiness(
    input: GetPeopleComputerReplyReadinessInput
  ): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
    return super.getPeopleComputerReplyReadiness(input);
  }
  getCurrentLocalRuntimeReplyReadiness(
    input: GetCurrentLocalRuntimeReplyReadinessInput
  ): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
    return super.getCurrentLocalRuntimeReplyReadiness(input);
  }
  setCurrentLocalAgentEnabled(
    input: SetCurrentLocalAgentEnabledInput
  ): Promise<SetCurrentLocalAgentEnabledResponse> {
    return super.setCurrentLocalAgentEnabled(input);
  }
  getCurrentLocalAgentInstallations(
    input: GetCurrentLocalAgentInstallationsInput
  ): Promise<CurrentLocalAgentInstallationsResponse> {
    return super.getCurrentLocalAgentInstallations(input);
  }
  selectCurrentLocalAgentInstallation(
    input: SelectCurrentLocalAgentInstallationInput
  ): Promise<SelectCurrentLocalAgentInstallationResponse> {
    return super.selectCurrentLocalAgentInstallation(input);
  }
  requestCurrentOpenMeldToolsUpdate(
    input: RequestCurrentOpenMeldToolsUpdateInput
  ): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
    return super.requestCurrentOpenMeldToolsUpdate(input);
  }
  setCurrentOpenMeldToolsMaintenance(
    input: SetCurrentOpenMeldToolsMaintenanceInput
  ): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
    return super.setCurrentOpenMeldToolsMaintenance(input);
  }
  getCurrentAgentProfileWorkspace(input: GetCurrentAgentProfileWorkspaceInput) {
    return super.getCurrentAgentProfileWorkspace(input);
  }
  getAgentProfileFolders(input: GetAgentProfileFoldersInput) {
    return super.getAgentProfileFolders(input);
  }
  manageAgentProfileFolders(
    input: ManageAgentProfileFoldersInput & GatewaySensitiveCredential
  ) {
    // Adding, removing, renaming or choosing the default folder is a
    // working-folder write: same gate, confirmation and audit.
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "working_folder_write",
      },
      (operationInput) => super.manageAgentProfileFolders(operationInput)
    );
  }
  setCurrentAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput & GatewaySensitiveCredential
  ): Promise<SetCurrentAgentProfileWorkspaceResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "working_folder_write",
      },
      (operationInput) => super.setCurrentAgentProfileWorkspace(operationInput)
    );
  }
  refreshCurrentLocalAgentCatalog(
    input: RefreshCurrentLocalAgentCatalogInput
  ): Promise<RefreshCurrentLocalAgentCatalogResponse> {
    return super.refreshCurrentLocalAgentCatalog(input);
  }
  forgetCurrentComputer(
    input: GetCurrentDeviceTargetInput
  ): Promise<ForgetCurrentComputerResponse> {
    return super.forgetCurrentComputer(input);
  }
  forgetComputer(input: ForgetComputerInput): Promise<ForgetComputerResponse> {
    return super.forgetComputer(input);
  }
  getPrepareReadiness(
    input: GetPrepareReadinessInput
  ): Promise<GetPrepareReadinessResponse> {
    return super.getPrepareReadiness(input);
  }
  createPrepareSession(
    input: CreatePrepareSessionInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return super.createPrepareSession(input);
  }
  getPrepareSession(
    input: GetPrepareSessionInput
  ): Promise<PrepareSessionResponse> {
    return super.getPrepareSession(input);
  }
  mintPrepareSessionReconnectToken(
    input: MintPrepareSessionReconnectTokenInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return super.mintPrepareSessionReconnectToken(input);
  }
  resolvePrepareSessionToken(
    input: ResolvePrepareSessionTokenInput
  ): Promise<PrepareSessionResponse> {
    return super.resolvePrepareSessionToken(input);
  }
  writePrepareAgentSelection(
    input: WritePrepareAgentSelectionInput
  ): Promise<PrepareSessionResponse> {
    return super.writePrepareAgentSelection(input);
  }
  writePrepareSetupBootstrap(
    input: WritePrepareSetupBootstrapInput
  ): Promise<PrepareSessionResponse> {
    return super.writePrepareSetupBootstrap(input);
  }
  writePrepareTerminalStep(
    input: WritePrepareTerminalStepInput
  ): Promise<PrepareSessionResponse> {
    return super.writePrepareTerminalStep(input);
  }
  getPrepareDiagnostic(
    input: GetPrepareSessionInput
  ): Promise<PrepareDiagnosticResponse> {
    return super.getPrepareDiagnostic(input);
  }
  getAgentProfilePrimaryBinding(
    input: GetAgentProfilePrimaryBindingInput
  ): Promise<GetAgentProfilePrimaryBindingResponse> {
    return super.getAgentProfilePrimaryBinding(input);
  }
  getCurrentAgentProfileSession(
    input: GetCurrentAgentProfileSessionInput
  ): Promise<CurrentAgentProfileSessionLookupResponse> {
    return super.getCurrentAgentProfileSession(input);
  }
  executeAgentProfileWorkRecovery(
    input: ExecuteAgentProfileWorkRecoveryInput & GatewaySensitiveCredential
  ): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: input.agentProfileId, operation: "work_recovery" },
      (operationInput) => super.executeAgentProfileWorkRecovery(operationInput)
    );
  }
  agentProfileExecutionMode(
    input: AgentProfileExecutionModeInput & GatewaySensitiveCredential
  ): Promise<AgentProfileExecutionModeResponse> {
    const { requestCredential: _credential, ...read } = input;
    // Reading the mode is not sensitive; changing it is (concurrency, §4.6).
    return input.body
      ? runGatewaySensitiveOperation(
          this.env,
          input,
          {
            agentProfileId: input.agentProfileId,
            operation: "execution_mode_write",
          },
          (operationInput) => super.agentProfileExecutionMode(operationInput)
        )
      : super.agentProfileExecutionMode(read);
  }
  getAgentProfileControllerChangeEligibility(
    input: GetAgentProfileControllerChangeEligibilityInput
  ): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
    return super.getAgentProfileControllerChangeEligibility(input);
  }
  getLocalRuntimeExpectedRoutes(
    input: GetLocalRuntimeExpectedRoutesInput
  ): Promise<GetLocalRuntimeExpectedRoutesResponse> {
    return super.getLocalRuntimeExpectedRoutes(input);
  }
  getAgentExecutionReadiness(
    input: GetAgentExecutionReadinessInput
  ): Promise<GetAgentExecutionReadinessResponse> {
    return super.getAgentExecutionReadiness(input);
  }
  getAgentExecutionReadinessBatch(
    input: GetAgentExecutionReadinessBatchInput
  ): Promise<GetAgentExecutionReadinessBatchResponse> {
    return super.getAgentExecutionReadinessBatch(input);
  }
  ensureAgentProfilePrimaryBinding(
    input: EnsureAgentProfilePrimaryBindingInput & GatewaySensitiveCredential
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: input.agentProfileId, operation: "binding_ensure" },
      (operationInput) => super.ensureAgentProfilePrimaryBinding(operationInput)
    );
  }
  updateAgentProfilePrimaryBindingModelSelection(
    input: UpdateAgentProfilePrimaryBindingModelSelectionInput &
      GatewaySensitiveCredential
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "binding_model_selection",
      },
      (operationInput) =>
        super.updateAgentProfilePrimaryBindingModelSelection(operationInput)
    );
  }
  updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput &
      GatewaySensitiveCredential
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "binding_collaboration_mode",
      },
      (operationInput) =>
        super.updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
          operationInput
        )
    );
  }
  updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput &
      GatewaySensitiveCredential
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "binding_permission_mode",
      },
      (operationInput) =>
        super.updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
          operationInput
        )
    );
  }
  updateAgentProfilePrimaryBindingOpenCodePermission(
    input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput &
      GatewaySensitiveCredential
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "binding_opencode_permission",
      },
      (operationInput) =>
        super.updateAgentProfilePrimaryBindingOpenCodePermission(operationInput)
    );
  }
  disableAgentProfilePrimaryBinding(
    input: DisableAgentProfilePrimaryBindingInput & GatewaySensitiveCredential
  ): Promise<DisableAgentProfilePrimaryBindingResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: input.agentProfileId, operation: "binding_disable" },
      (operationInput) =>
        super.disableAgentProfilePrimaryBinding(operationInput)
    );
  }
  getAgentProfileCreationDefaults(
    input: GetAgentProfileCreationDefaultsInput
  ): Promise<GetAgentProfileCreationDefaultsResponse> {
    return super.getAgentProfileCreationDefaults(input);
  }
  setAgentProfileCreationDefaults(
    input: SetAgentProfileCreationDefaultsInput & GatewaySensitiveCredential
  ): Promise<SetAgentProfileCreationDefaultsResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: null, operation: "creation_defaults_write" },
      (operationInput) => super.setAgentProfileCreationDefaults(operationInput)
    );
  }
  createAgentProfileCreationRequest(
    input: CreateAgentProfileCreationRequestRpcInput
  ): Promise<CreateAgentProfileCreationRequestResponse> {
    return super.createAgentProfileCreationRequest(input);
  }
  listAgentProfileCreationRequests(
    input: ListAgentProfileCreationRequestsRpcInput
  ): Promise<ListAgentProfileCreationRequestsResponse> {
    return super.listAgentProfileCreationRequests(input);
  }
  decideAgentProfileCreationRequest(
    input: DecideAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return super.decideAgentProfileCreationRequest(input);
  }
  cancelAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return super.cancelAgentProfileCreationRequest(input);
  }
  retryAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return super.retryAgentProfileCreationRequest(input);
  }
  getAgentProfileCreationApprovalPreference(
    input: GetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
    return super.getAgentProfileCreationApprovalPreference(input);
  }
  setAgentProfileCreationApprovalPreference(
    input: SetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
    return super.setAgentProfileCreationApprovalPreference(input);
  }
  getCurrentOrganizationDirectory(
    input: GetCurrentOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return super.getCurrentOrganizationDirectory(input);
  }
  getCurrentOrganizationProfileDirectory(
    input: GetCurrentOrganizationProfileDirectoryInput
  ): Promise<OrganizationProfileDirectoryResponse> {
    return super.getCurrentOrganizationProfileDirectory(input);
  }
  getCurrentOrganizationAgentRuntimeOverview(
    input: GetCurrentOrganizationAgentRuntimeOverviewInput
  ): Promise<OrganizationAgentRuntimeOverviewResponse> {
    return super.getCurrentOrganizationAgentRuntimeOverview(input);
  }
  recordCurrentOrganizationWebActivity(
    input: RecordCurrentOrganizationWebActivityInput
  ): Promise<OrganizationMemberWebActivityResponse> {
    return super.recordCurrentOrganizationWebActivity(input);
  }
  getCurrentOrganizationMemberPresence(input: {
    context?: CoreRpcContextInput;
  }) {
    return super.getCurrentOrganizationMemberPresence(input);
  }
  recordCurrentOrganizationMemberPresence(
    input: RecordCurrentOrganizationMemberPresenceInput
  ) {
    return super.recordCurrentOrganizationMemberPresence(input);
  }
  getCurrentOrganizationComputers(
    input: GetCurrentOrganizationComputersInput
  ): Promise<OrganizationComputersResponse> {
    return super.getCurrentOrganizationComputers(input);
  }
  getCurrentOrganizationMemberOpenMeldServiceStatuses(
    input: GetCurrentOrganizationMemberOpenMeldServiceStatusesInput
  ): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
    return super.getCurrentOrganizationMemberOpenMeldServiceStatuses(input);
  }
  getCurrentOrganizationSpaceDirectory(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return super.getCurrentOrganizationSpaceDirectory(input);
  }
  getCurrentOrganizationSpaceDirectoryWithMemberCounts(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
    return super.getCurrentOrganizationSpaceDirectoryWithMemberCounts(input);
  }
  joinOrganizationPublicSpace(
    input: JoinOrganizationPublicSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return super.joinOrganizationPublicSpace(input);
  }
  addCenterAgentToSpace(
    input: AddCenterAgentToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return super.addCenterAgentToSpace(input);
  }
  addOrganizationDirectoryProfilesToSpace(
    input: AddOrganizationDirectoryProfilesToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return super.addOrganizationDirectoryProfilesToSpace(input);
  }
  getCenterAgentDesignation(
    input: GetCenterAgentDesignationInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return super.getCenterAgentDesignation(input);
  }
  getCenterAgentModel(
    input: GetCenterAgentModelInput
  ): Promise<CenterAgentModelConfigurationResponse> {
    return super.getCenterAgentModel(input);
  }
  updateCenterAgentModel(
    input: UpdateCenterAgentModelInput
  ): Promise<UpdateCenterAgentModelResponse> {
    return super.updateCenterAgentModel(input);
  }
  listMessageChannelConnections(
    input: ListMessageChannelConnectionsInput
  ): Promise<MessageChannelConnectionListResponse> {
    return super.listMessageChannelConnections(input);
  }
  requestMessageChannelSetup(
    input: RequestMessageChannelSetupInput
  ): Promise<MessageChannelSetupRequestResponse> {
    return super.requestMessageChannelSetup(input);
  }
  listActiveLarkPlatformRegistrations(
    input: ListActiveLarkPlatformRegistrationsInput
  ): Promise<LarkPlatformActiveRegistrationListResponse> {
    return super.listActiveLarkPlatformRegistrations(input);
  }
  previewMessageChannelIdentityLink(
    input: PreviewMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkPreviewResponse> {
    return super.previewMessageChannelIdentityLink(input);
  }
  consumeMessageChannelIdentityLink(
    input: ConsumeMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkConsumeResponse> {
    return super.consumeMessageChannelIdentityLink(input);
  }
  beginLarkPlatformRegistration(
    input: BeginLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return super.beginLarkPlatformRegistration(input);
  }
  pollLarkPlatformRegistration(
    input: PollLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return super.pollLarkPlatformRegistration(input);
  }
  disconnectLarkPlatformRegistration(
    input: DisconnectLarkPlatformRegistrationInput
  ): Promise<MessageChannelConnectionListResponse> {
    return super.disconnectLarkPlatformRegistration(input);
  }
  disconnectMessageChannelIdentityLink(
    input: DisconnectMessageChannelIdentityLinkInput
  ): Promise<MessageChannelConnectionListResponse> {
    return super.disconnectMessageChannelIdentityLink(input);
  }
  getCenterAgentDirectMessageSpaceProjection(
    input: GetCenterAgentDirectMessageSpaceProjectionInput
  ): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
    return super.getCenterAgentDirectMessageSpaceProjection(input);
  }
  listCenterAgentSessions(
    input: ListCenterAgentSessionsInput
  ): Promise<ListCenterAgentSessionsResponse> {
    return super.listCenterAgentSessions(input);
  }
  listAgentDirectMessageSessions(
    input: ListAgentDirectMessageSessionsInput
  ): Promise<ListAgentDirectMessageSessionsResponse> {
    return super.listAgentDirectMessageSessions(input);
  }
  updateAgentDirectMessageSession(
    input: UpdateAgentDirectMessageSessionInput & GatewaySensitiveCredential
  ): Promise<UpdateAgentDirectMessageSessionResponse> {
    const { requestCredential: _credential, ...update } = input;
    // Archiving removes a Session from view (§4.6); renaming does not.
    return input.update.operation === "archive"
      ? runGatewaySensitiveOperation(
          this.env,
          input,
          { agentProfileId: null, operation: "session_archive" },
          (operationInput) =>
            super.updateAgentDirectMessageSession(operationInput)
        )
      : super.updateAgentDirectMessageSession(update);
  }
  deleteAgentDirectMessageSession(
    input: DeleteAgentDirectMessageSessionInput & GatewaySensitiveCredential
  ): Promise<DeleteAgentDirectMessageSessionResponse> {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: null, operation: "session_delete" },
      (operationInput) => super.deleteAgentDirectMessageSession(operationInput)
    );
  }
  createCenterAgentContextManifest(
    input: CreateCenterAgentContextManifestInput
  ): Promise<CreateCenterAgentContextManifestResponse> {
    return super.createCenterAgentContextManifest(input);
  }
  createCenterAgentContextLoadReceipt(
    input: CreateCenterAgentContextLoadReceiptInput
  ): Promise<CreateCenterAgentContextLoadReceiptResponse> {
    return super.createCenterAgentContextLoadReceipt(input);
  }
  getCenterAgentOperatingState(
    input: GetCenterAgentOperatingStateInput
  ): Promise<GetCenterAgentOperatingStateResponse> {
    return super.getCenterAgentOperatingState(input);
  }
  designateCenterAgent(
    input: DesignateCenterAgentInput
  ): Promise<DesignateCenterAgentResponse> {
    return super.designateCenterAgent(input);
  }
  updateCenterAgentProfile(
    input: UpdateCenterAgentProfileInput
  ): Promise<CenterAgentUpdateProfileResponse> {
    return super.updateCenterAgentProfile(input);
  }
  updateCenterAgentOperatingState(
    input: UpdateCenterAgentOperatingStateInput
  ): Promise<UpdateCenterAgentOperatingStateResponse> {
    return super.updateCenterAgentOperatingState(input);
  }
  connectCenterAgentSlackWorkspace(
    input: ConnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceConnectionResponse> {
    return super.connectCenterAgentSlackWorkspace(input);
  }
  createSlackOAuthState(
    input: CreateSlackOAuthStateInput
  ): Promise<SlackOAuthStateCreateResponse> {
    return super.createSlackOAuthState(input);
  }
  consumeSlackOAuthState(
    input: ConsumeSlackOAuthStateInput
  ): Promise<SlackOAuthStateConsumeResponse> {
    return super.consumeSlackOAuthState(input);
  }
  installSlackWorkspaceFromOAuth(
    input: InstallSlackWorkspaceFromOAuthInput
  ): Promise<SlackOAuthInstallationResult> {
    return super.installSlackWorkspaceFromOAuth(input);
  }
  issueSlackIdentityLinkFromOAuth(
    input: IssueSlackIdentityLinkFromOAuthInput
  ): Promise<SlackOAuthIdentityLinkResult> {
    return super.issueSlackIdentityLinkFromOAuth(input);
  }
  disconnectCenterAgentSlackWorkspace(
    input: DisconnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceDisconnectResponse> {
    return super.disconnectCenterAgentSlackWorkspace(input);
  }
  previewSlackIdentityLink(
    input: PreviewSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkPreviewResponse> {
    return super.previewSlackIdentityLink(input);
  }
  consumeSlackIdentityLink(
    input: ConsumeSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkConsumeResponse> {
    return super.consumeSlackIdentityLink(input);
  }
  assertCurrentDesignatedCenterAgent(
    input: AssertCurrentDesignatedCenterAgentInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return super.assertCurrentDesignatedCenterAgent(input);
  }
  recordCenterAgentAudit(
    input: RecordCenterAgentAuditInput
  ): Promise<CenterAgentAttribution> {
    return super.recordCenterAgentAudit(input);
  }
  listCenterAgentAuditJournal(
    input: ListCenterAgentAuditJournalInput
  ): Promise<ListCenterAgentAuditJournalResponse> {
    return super.listCenterAgentAuditJournal(input);
  }
  readCenterAgentOrganizationMemoryPolicy(
    input: ReadCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return super.readCenterAgentOrganizationMemoryPolicy(input);
  }
  setCenterAgentOrganizationMemoryPolicy(
    input: SetCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return super.setCenterAgentOrganizationMemoryPolicy(input);
  }
  readOrganizationInformationProtectionPolicy(
    input: ReadOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return super.readOrganizationInformationProtectionPolicy(input);
  }
  setOrganizationInformationProtectionPolicy(
    input: SetOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return super.setOrganizationInformationProtectionPolicy(input);
  }
  readCurrentOrganizationFeedbackReportingPolicy(
    input: ReadCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return super.readCurrentOrganizationFeedbackReportingPolicy(input);
  }
  setCurrentOrganizationFeedbackReportingPolicy(
    input: SetCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return super.setCurrentOrganizationFeedbackReportingPolicy(input);
  }
  wipeCurrentMemberCenterAgentMemory(
    input: WipeCurrentMemberCenterAgentMemoryInput
  ): Promise<CenterAgentWipeMemberMemoryResponse> {
    return super.wipeCurrentMemberCenterAgentMemory(input);
  }
  centerAgentRememberForOrganization(
    input: CenterAgentRememberForOrganizationInput
  ): Promise<CenterAgentRememberForOrganizationResponse> {
    return super.centerAgentRememberForOrganization(input);
  }
  completeRemoteAgentSubmission(
    input: RemoteAgentCoreCallbackEvent
  ): Promise<RemoteAgentCoreCallbackResponse> {
    return super.completeRemoteAgentSubmission(input);
  }
  handleRemoteAgentSlackEvent(input: unknown): Promise<{
    status:
      | "duplicate"
      | "failed"
      | "ignored"
      | "processed"
      | "recovery_pending"
      | "replied";
  }> {
    return super.handleRemoteAgentSlackEvent(input);
  }
  submitFeedbackIssue(
    input: FeedbackIssueSubmitRpcRequest
  ): Promise<SubmitFeedbackIssueResponse> {
    return super.submitFeedbackIssue(input);
  }
  centerAgentCreateSpace(
    input: CenterAgentCreateSpaceInput
  ): Promise<CenterAgentCreateSpaceResponse> {
    return super.centerAgentCreateSpace(input);
  }
  centerAgentEnableAgentProfile(
    input: CenterAgentEnableAgentProfileInput
  ): Promise<CenterAgentEnableAgentProfileResponse> {
    return super.centerAgentEnableAgentProfile(input);
  }
  centerAgentAddAgentProfilesToSpace(
    input: CenterAgentAddAgentProfilesToSpaceInput
  ): Promise<CenterAgentAddAgentProfilesToSpaceResponse> {
    return super.centerAgentAddAgentProfilesToSpace(input);
  }
  centerAgentAddMembersToSpace(
    input: CenterAgentAddMembersToSpaceInput
  ): Promise<CenterAgentAddMembersToSpaceResponse> {
    return super.centerAgentAddMembersToSpace(input);
  }
  centerAgentRemoveAgentProfilesFromSpace(
    input: CenterAgentRemoveAgentProfilesFromSpaceInput
  ): Promise<CenterAgentRemoveAgentProfilesFromSpaceResponse> {
    return super.centerAgentRemoveAgentProfilesFromSpace(input);
  }
  centerAgentGetOrganizationDirectory(
    input: CenterAgentReadOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return super.centerAgentGetOrganizationDirectory(input);
  }
  centerAgentReadMemberComputers(
    input: CenterAgentReadMemberComputersInput
  ): Promise<CenterAgentReadMemberComputersResponse> {
    return super.centerAgentReadMemberComputers(input);
  }
  centerAgentReadMemberOpenMeldServiceStatus(
    input: CenterAgentReadMemberOpenMeldServiceStatusInput
  ): Promise<CenterAgentReadMemberOpenMeldServiceStatusResponse> {
    return super.centerAgentReadMemberOpenMeldServiceStatus(input);
  }
  centerAgentReadSlackWorkspaceDirectory(
    input: CenterAgentReadSlackWorkspaceDirectoryInput
  ): Promise<CenterAgentReadSlackWorkspaceDirectoryResponse> {
    return super.centerAgentReadSlackWorkspaceDirectory(input);
  }
  centerAgentListSlackChannels(
    input: CenterAgentListSlackChannelsInput
  ): Promise<CenterAgentListSlackChannelsResponse> {
    return super.centerAgentListSlackChannels(input);
  }
  centerAgentReadSlackChannelMembers(
    input: CenterAgentReadSlackChannelMembersInput
  ): Promise<CenterAgentReadSlackChannelMembersResponse> {
    return super.centerAgentReadSlackChannelMembers(input);
  }
  centerAgentReadSlackChannelHistory(
    input: CenterAgentReadSlackChannelHistoryInput
  ): Promise<CenterAgentReadSlackChannelHistoryResponse> {
    return super.centerAgentReadSlackChannelHistory(input);
  }
  centerAgentReadSlackFile(
    input: CenterAgentReadSlackFileInput
  ): Promise<CenterAgentReadSlackFileResponse> {
    return super.centerAgentReadSlackFile(input);
  }
  centerAgentReadChannelFile(
    input: CenterAgentReadChannelFileInput
  ): Promise<CenterAgentReadChannelFileResponse> {
    return super.centerAgentReadChannelFile(input);
  }
  centerAgentPostChannelFile(
    input: CenterAgentPostChannelFileInput
  ): Promise<CenterAgentPostChannelFileResponse> {
    return super.centerAgentPostChannelFile(input);
  }
  centerAgentSearchSlackMessages(
    input: CenterAgentSearchSlackMessagesInput
  ): Promise<CenterAgentSearchSlackMessagesResponse> {
    return super.centerAgentSearchSlackMessages(input);
  }
  centerAgentGetOrganizationSpaceDirectory(
    input: CenterAgentReadOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return super.centerAgentGetOrganizationSpaceDirectory(input);
  }
  centerAgentReadSpaceContext(
    input: CenterAgentReadSpaceContextInput
  ): Promise<CenterAgentReadSpaceContextResponse> {
    return super.centerAgentReadSpaceContext(input);
  }
  centerAgentPostSpaceMessage(
    input: CenterAgentPostSpaceMessageInput
  ): Promise<CenterAgentPostSpaceMessageResponse> {
    return super.centerAgentPostSpaceMessage(input);
  }
  centerAgentReadSpaceAuthoringContract(
    input: CenterAgentReadSpaceAuthoringContractInput
  ): Promise<CenterAgentSpaceAuthoringContractResponse> {
    return super.centerAgentReadSpaceAuthoringContract(input);
  }
  centerAgentPostSlackChannelMessage(
    input: CenterAgentPostSlackChannelMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return super.centerAgentPostSlackChannelMessage(input);
  }
  centerAgentPostSlackFile(
    input: CenterAgentPostSlackFileInput
  ): Promise<CenterAgentPostSlackFileResponse> {
    return super.centerAgentPostSlackFile(input);
  }
  centerAgentPostSlackThreadMessage(
    input: CenterAgentPostSlackThreadMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return super.centerAgentPostSlackThreadMessage(input);
  }
  centerAgentRecordConnectorActionAudit(
    input: CenterAgentRecordConnectorActionAuditInput
  ): Promise<CenterAgentRecordConnectorActionAuditResponse> {
    return super.centerAgentRecordConnectorActionAudit(input);
  }
  centerAgentReadConnectorActionOperation(
    input: CenterAgentReadConnectorActionOperationInput
  ): Promise<CenterAgentReadConnectorActionOperationResponse> {
    return super.centerAgentReadConnectorActionOperation(input);
  }
  centerAgentRecordConnectorActionOperation(
    input: CenterAgentRecordConnectorActionOperationInput
  ): Promise<CenterAgentRecordConnectorActionOperationResponse> {
    return super.centerAgentRecordConnectorActionOperation(input);
  }
  centerAgentWakeAgentProfilesInSpace(
    input: CenterAgentWakeAgentProfilesInSpaceInput
  ): Promise<CenterAgentWakeAgentProfilesInSpaceResponse> {
    return super.centerAgentWakeAgentProfilesInSpace(input);
  }

  centerAgentWakeAgentProfilesInSpaces(
    input: CenterAgentWakeAgentProfilesInSpacesInput
  ): Promise<CenterAgentWakeAgentProfilesInSpacesResponse> {
    return super.centerAgentWakeAgentProfilesInSpaces(input);
  }

  personalRemoteAgentSpaceTool(input: unknown) {
    return super.personalRemoteAgentSpaceTool(input);
  }
  centerAgentListAgentTasks(
    input: CenterAgentListAgentTasksInput
  ): Promise<CenterAgentListAgentTasksResponse> {
    return super.centerAgentListAgentTasks(input);
  }
  centerAgentWatchAgentTask(
    input: CenterAgentWatchAgentTaskInput
  ): Promise<CenterAgentWatchAgentTaskResponse> {
    return super.centerAgentWatchAgentTask(input);
  }
  centerAgentContinueTaskSummary(
    input: Parameters<typeof rpcCenterAgentContinueTaskSummary>[1]
  ) {
    return super.centerAgentContinueTaskSummary(input);
  }
  centerAgentUpdateSpaceSettings(
    input: CenterAgentUpdateSpaceSettingsInput
  ): Promise<CenterAgentUpdateSpaceSettingsResponse> {
    return super.centerAgentUpdateSpaceSettings(input);
  }
  openCenterAgentDirectMessageSpace(
    input: OpenCenterAgentDirectMessageSpaceInput
  ): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
    return super.openCenterAgentDirectMessageSpace(input);
  }
  openDirectMessageSpace(
    input: OpenDirectMessageSpaceInput
  ): Promise<OpenDirectMessageSpaceResponse> {
    return super.openDirectMessageSpace(input);
  }
  convertDirectMessageToSpace(
    input: ConvertDirectMessageToSpaceInput
  ): Promise<ConvertDirectMessageToSpaceResponse> {
    return super.convertDirectMessageToSpace(input);
  }
  notifyAgentProfileRouteCatalogChanged(
    input: NotifyAgentProfileRouteCatalogChangedInput
  ): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
    return super.notifyAgentProfileRouteCatalogChanged(input);
  }
  notifyAgentProfilesRouteCatalogChanged(
    input: NotifyAgentProfilesRouteCatalogChangedInput
  ): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
    return super.notifyAgentProfilesRouteCatalogChanged(input);
  }
  submitRuntimeRegistration(
    input: SubmitRuntimeRegistrationInput
  ): Promise<SubmitRuntimeRegistrationResponse> {
    return super.submitRuntimeRegistration(input);
  }
  submitRuntimeAgentControllerReports(
    input: SubmitRuntimeAgentControllerReportsInput
  ): Promise<SubmitRuntimeAgentControllerReportsResponse> {
    return super.submitRuntimeAgentControllerReports(input);
  }
  syncMemberAgents(
    input: SyncMemberAgentsRpcInput
  ): Promise<SyncMemberAgentsResponse> {
    return super.syncMemberAgents(input);
  }
  getMemberAgentPresence(
    input: MemberAgentRpcInput
  ): Promise<GetMemberAgentPresenceResponse> {
    return super.getMemberAgentPresence(input);
  }
  listMemberAgentDirectMessageSessions(
    input: ListMemberAgentDirectMessageSessionsRpcInput
  ): Promise<ListMemberAgentDirectMessageSessionsResponse> {
    return super.listMemberAgentDirectMessageSessions(input);
  }
  listAgentAccessRequests(
    input: Parameters<typeof rpcListAgentAccessRequests>[1]
  ) {
    return super.listAgentAccessRequests(input);
  }
  getAgentAccessRequest(input: Parameters<typeof rpcGetAgentAccessRequest>[1]) {
    return super.getAgentAccessRequest(input);
  }
  decideAgentAccessRequest(
    input: Parameters<typeof rpcDecideAgentAccessRequest>[1] &
      GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      { agentProfileId: null, operation: "agent_access_decision" },
      (operationInput) => super.decideAgentAccessRequest(operationInput)
    );
  }
  withdrawAgentAccessRequest(
    input: Parameters<typeof rpcWithdrawAgentAccessRequest>[1]
  ) {
    return super.withdrawAgentAccessRequest(input);
  }
  createSpaceAgentRequest(
    input: Parameters<typeof rpcCreateSpaceAgentRequest>[1]
  ) {
    return super.createSpaceAgentRequest(input);
  }
  listAgentProfileAccessGrants(
    input: Parameters<typeof rpcListAgentProfileAccessGrants>[1]
  ) {
    return super.listAgentProfileAccessGrants(input);
  }
  listViewerAgentAccessGrants(
    input: Parameters<typeof rpcListViewerAgentAccessGrants>[1]
  ) {
    return super.listViewerAgentAccessGrants(input);
  }
  createAgentProfileAccessGrant(
    input: Parameters<typeof rpcCreateAgentProfileAccessGrant>[1] &
      GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "agent_access_decision",
      },
      (operationInput) => super.createAgentProfileAccessGrant(operationInput)
    );
  }
  revokeAgentProfileAccessGrant(
    input: Parameters<typeof rpcRevokeAgentProfileAccessGrant>[1] &
      GatewaySensitiveCredential
  ) {
    return runGatewaySensitiveOperation(
      this.env,
      input,
      {
        agentProfileId: input.agentProfileId,
        operation: "agent_access_grant_revoke",
      },
      (operationInput) => super.revokeAgentProfileAccessGrant(operationInput)
    );
  }
  submitAgentControllerTaskLifecycleEvents(
    input: SubmitAgentControllerTaskLifecycleEventsInput
  ) {
    return super.submitAgentControllerTaskLifecycleEvents(input);
  }
  submitRuntimeProviderConversationProofs(
    input: SubmitRuntimeProviderConversationProofsInput
  ): Promise<SubmitRuntimeProviderConversationProofsResponse> {
    return super.submitRuntimeProviderConversationProofs(input);
  }
  setLocalRuntimeDisplayName(
    input: SetLocalRuntimeDisplayNameInput
  ): Promise<LocalRuntimesResponse> {
    return super.setLocalRuntimeDisplayName(input);
  }
  writeCurrentDeviceObservedMetadata(
    input: WriteCurrentDeviceObservedMetadataInput
  ): Promise<WriteCurrentDeviceObservedMetadataResponse> {
    return super.writeCurrentDeviceObservedMetadata(input);
  }
  enrollLocalRuntime(
    input: EnrollLocalRuntimeInput
  ): Promise<LocalRuntimeEnrollmentResponse> {
    return super.enrollLocalRuntime(input);
  }
}
export class CenterAgentRpcEntrypoint extends CoreRpcEntrypoint {
  remoteAgentOpenDirectMessageSpace(input: OpenDirectMessageSpaceInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentOpenDirectMessageSpace(this.env, input)
    );
  }

  remoteAgentGetOrganizationDirectory(input: {
    context?: CoreRpcContextInput;
  }) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRemoteAgentGetOrganizationDirectory(this.env, input)
    );
  }

  writeSpaceFileContent(
    input: WriteSpaceFileContentRpcInput,
    spaceFilesOriginVersion?: string,
    spaceImageGeometryVersion?: string
  ): Promise<SpaceFileDescriptor> {
    return withRemoteAgentSpaceFileWire(
      super.writeSpaceFileContent(
        input,
        spaceFilesOriginVersion,
        spaceImageGeometryVersion
      )
    );
  }
  centerAgentInviteSlackTeammates(
    input: CenterAgentInviteSlackTeammatesRpcInput
  ): Promise<CenterAgentInviteSlackTeammatesRpcResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      handleCenterAgentSlackTeammateInvitations(this.env, input)
    );
  }
  centerAgentListOrganizationMembers(
    input: CenterAgentListOrganizationMembersToolRpcInput
  ): Promise<CenterAgentListOrganizationMembersResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListOrganizationMembers(this.env, input)
    );
  }
  centerAgentAuthorizeAnonymousMemberTool(
    input: CenterAgentAuthorizeAnonymousMemberToolRpcInput
  ): Promise<CenterAgentAuthorizeAnonymousMemberToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentAuthorizeAnonymousMemberTool(this.env, input)
    );
  }
  centerAgentListProjects(
    input: CenterAgentListProjectsToolRpcInput
  ): Promise<CenterAgentListProjectsToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListProjects(this.env, input)
    );
  }
  centerAgentCreateProject(
    input: CenterAgentCreateProjectToolRpcInput
  ): Promise<CenterAgentCreateProjectToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateProject(this.env, input)
    );
  }
  centerAgentUpdateProject(
    input: CenterAgentUpdateProjectToolRpcInput
  ): Promise<CenterAgentUpdateProjectToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentUpdateProject(this.env, input)
    );
  }
  centerAgentSetAgentProfileDefaultProject(
    input: CenterAgentSetAgentProfileDefaultProjectToolRpcInput
  ): Promise<CenterAgentSetAgentProfileDefaultProjectToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetAgentProfileDefaultProject(this.env, input)
    );
  }
  centerAgentPrepareRemoveProject(
    input: CenterAgentPrepareRemoveProjectToolRpcInput
  ): Promise<CenterAgentPrepareRemoveProjectToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPrepareRemoveProject(this.env, input)
    );
  }
  centerAgentRemoveProject(
    input: CenterAgentRemoveProjectToolRpcInput
  ): Promise<CenterAgentRemoveProjectToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRemoveProject(this.env, input)
    );
  }
  centerAgentReadOrganizationDocuments(
    input: CenterAgentReadOrganizationDocumentsRpcInput
  ): Promise<CenterAgentReadOrganizationDocumentsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadOrganizationDocuments(this.env, input)
    );
  }
  centerAgentOrganizationDocumentsComputerSnapshot(
    input: CenterAgentOrganizationDocumentsComputerSnapshotRpcInput
  ): Promise<CenterAgentOrganizationDocumentsComputerSnapshotResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentOrganizationDocumentsComputerSnapshot(this.env, input)
    );
  }
  centerAgentDraftOrganizationDocument(
    input: CenterAgentDraftOrganizationDocumentRpcInput
  ): Promise<CenterAgentDraftOrganizationDocumentResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentDraftOrganizationDocument(this.env, input)
    );
  }
  async centerAgentStartSelfMemberResearch(
    input: CenterAgentStartSelfMemberResearchToolRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const response = await rpcCenterAgentStartSelfMemberResearch(
        this.env,
        input
      );
      const db = getPostgresDatabase(this.env);
      if (db) {
        this.ctx.waitUntil(
          runCenterAgentMemberResearchTick({ db, env: this.env })
        );
      }
      return response;
    });
  }
  recordCenterAgentMemberResearchComputerFile(
    input: RecordCenterAgentMemberResearchComputerFileRpcInput
  ): Promise<RecordCenterAgentMemberResearchComputerFileResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordCenterAgentMemberResearchComputerFile(this.env, input)
    );
  }
  centerAgentManageOrganizationDocuments(
    input: CenterAgentManageOrganizationDocumentsRpcInput
  ): Promise<CenterAgentManageOrganizationDocumentsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentManageOrganizationDocuments(this.env, input)
    );
  }
  readOrganizationDocumentPromptContext(
    input: OrganizationDocumentPromptContextRpcInput
  ): Promise<OrganizationDocumentPromptContextResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcReadOrganizationDocumentPromptContext(this.env, input)
    );
  }
  centerAgentCreateOrganizationInviteLink(
    input: CenterAgentCreateOrganizationInviteLinkToolRpcInput
  ): Promise<CenterAgentCreateOrganizationInviteLinkResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateOrganizationInviteLink(this.env, input)
    );
  }
  centerAgentGetOrganizationInviteLink(
    input: CenterAgentGetOrganizationInviteLinkToolRpcInput
  ): Promise<CenterAgentGetOrganizationInviteLinkResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentGetOrganizationInviteLink(this.env, input)
    );
  }
  centerAgentReadAgentActivityOverview(
    input: CenterAgentReadAgentActivityInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadAgentActivityOverview(this.env, input)
    );
  }
  centerAgentReadAiUsage(input: CenterAgentAiUsageRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadAiUsage(this.env, input)
    );
  }
  recordRemoteAiUsage(input: RemoteAiUsageWrite) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcRecordRemoteAiUsage(this.env, input)
    );
  }
  centerAgentReadAgentActivity(input: CenterAgentReadAgentActivityInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadAgentActivity(this.env, input)
    );
  }
  centerAgentListAgentActivitySessions(
    input: CenterAgentListAgentActivitySessionsInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListAgentActivitySessions(this.env, input)
    );
  }
  centerAgentListActiveSpaceWakes(
    input: CenterAgentListActiveSpaceWakesInput
  ): Promise<AccountSpaceActiveWakeSummaryResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListActiveSpaceWakes(this.env, input)
    );
  }
  centerAgentReadSpaceWakeProgress(
    input: CenterAgentReadSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadSpaceWakeProgress(this.env, input)
    );
  }
  centerAgentStopSpaceWake(
    input: CenterAgentStopSpaceWakeInput
  ): Promise<PostSpaceWakeStopResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentStopSpaceWake(this.env, input)
    );
  }
  centerAgentReadChangelog(input: CenterAgentReadChangelogInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadChangelog(this.env, input)
    );
  }

  centerAgentSpaceInputQueue(
    input: CenterAgentSpaceInputQueueInput
  ): Promise<SpaceInputQueueResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSpaceInputQueue(this.env, input)
    );
  }

  centerAgentSearchMemory(input: CenterAgentSearchMemoryRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSearchMemory(this.env, input)
    );
  }
  centerAgentReadAuditJournal(input: CenterAgentReadAuditJournalRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadAuditJournal(this.env, input)
    );
  }
  centerAgentReadTurnDiagnostics(
    input: CenterAgentReadTurnDiagnosticsInput
  ): Promise<CenterAgentReadTurnDiagnosticsResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadTurnDiagnostics(this.env, input)
    );
  }
  centerAgentSetReplyPlacement(input: CenterAgentSetReplyPlacementInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetReplyPlacement(this.env, input)
    );
  }
  centerAgentListOpportunities(input: CenterAgentListOpportunitiesInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListOpportunities(this.env, input)
    );
  }
  centerAgentRecommendOpportunity(input: CenterAgentRecommendOpportunityInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRecommendOpportunity(this.env, input)
    );
  }
  centerAgentRespondToOpportunity(input: CenterAgentRespondToOpportunityInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentRespondToOpportunity(this.env, input)
    );
  }
  centerAgentSetOrganizationWorkingLanguage(
    input: CenterAgentSetOrganizationWorkingLanguageToolRpcInput
  ): Promise<CenterAgentSetOrganizationWorkingLanguageToolResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentSetOrganizationWorkingLanguage(this.env, input)
    );
  }
  centerAgentListRoutineRuns(input: CenterAgentListRoutineRunsToolRpcInput) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListRoutineRuns(this.env, input)
    );
  }
  centerAgentReadRoutineRunDiagnostics(
    input: CenterAgentReadRoutineRunDiagnosticsRpcInput
  ) {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentReadRoutineRunDiagnostics(this.env, input)
    );
  }
  centerAgentListRoutines(
    input: CenterAgentListRoutinesToolRpcInput
  ): Promise<ListCenterAgentRoutinesResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentListRoutines(this.env, input)
    );
  }
  centerAgentCreateRoutine(
    input: CenterAgentCreateRoutineToolRpcInput
  ): Promise<CreateCenterAgentRoutineResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentCreateRoutine(this.env, input)
    );
  }
  centerAgentUpdateRoutine(
    input: CenterAgentUpdateRoutineToolRpcInput
  ): Promise<UpdateCenterAgentRoutineResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentUpdateRoutine(this.env, input)
    );
  }
  centerAgentDeleteRoutine(
    input: CenterAgentDeleteRoutineToolRpcInput
  ): Promise<DeleteCenterAgentRoutineResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentDeleteRoutine(this.env, input)
    );
  }
  centerAgentPauseRoutine(
    input: CenterAgentPauseRoutineToolRpcInput
  ): Promise<PauseCenterAgentRoutineResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentPauseRoutine(this.env, input)
    );
  }
  centerAgentResumeRoutine(
    input: CenterAgentResumeRoutineToolRpcInput
  ): Promise<ResumeCenterAgentRoutineResponse> {
    return withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      rpcCenterAgentResumeRoutine(this.env, input)
    );
  }
}
/**
 * Compatibility entrypoint for already-deployed Remote Agent bindings.
 * New bindings use CenterAgentRpcEntrypoint because this private surface now
 * carries multiple Center Agent product-tool families, not only Routines.
 */
export class CenterAgentRoutineRpcEntrypoint extends CenterAgentRpcEntrypoint {}
function toSpaceImageGeometryRpcOutput<T>(value: T, version?: string): T {
  return version === OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    ? value
    : toLegacySpaceImageGeometryWireValue(value);
}
async function withSpaceImageGeometryRpcOutput<T>(
  value: Promise<T>,
  version?: string
): Promise<T> {
  return toSpaceImageGeometryRpcOutput(await value, version);
}
function toLegacySpaceAddressingRpcOutput<T>(value: T): T {
  return toLegacySpaceAddressingWireValue(value) as T;
}
function toSpaceAddressingRpcOutput<T>(
  value: T,
  spaceAddressingVersion: string | undefined,
  spaceImageGeometryVersion?: string
): T {
  const readValue = toSpaceSignalReadWireValue(
    toSpaceImageGeometryRpcOutput(value, spaceImageGeometryVersion)
  );
  return spaceAddressingVersion === OPENMELD_SPACE_ADDRESSING_VERSION
    ? readValue
    : toLegacySpaceAddressingRpcOutput(readValue);
}
async function withSpaceAddressingRpcOutput<T>(
  value: Promise<T>,
  spaceAddressingVersion: string | undefined,
  spaceImageGeometryVersion?: string
): Promise<T> {
  return toSpaceAddressingRpcOutput(
    await value,
    spaceAddressingVersion,
    spaceImageGeometryVersion
  );
}
/**
 * The RPC boundary analog of `withSpaceAddressingRpcOutput`, shared by both
 * Space Files RPC boundaries this Core exposes:
 * - Core/Remote Agent (Center Agent tools): the caller declares
 *   `requestedOriginModel === SPACE_FILES_ORIGIN_CAPABILITY_TOKEN`.
 * - Gateway/Core (every ordinary Gateway-facing Space Files method): the
 *   caller declares `spaceFilesOriginVersion === OPENMELD_SPACE_FILES_ORIGIN_VERSION`.
 * An already-published caller on either boundary has no such field/argument
 * and never sends it, so its response is downgraded to the pre-origin shape
 * it already knows how to parse. Only a caller that explicitly declares the
 * capability receives `origin` on file descriptors.
 */
async function withSpaceFilesOriginRpcOutput<T>(
  value: Promise<T>,
  originCapable: boolean,
  spaceImageGeometryVersion?: string
): Promise<T> {
  const resolved = toSpaceImageGeometryRpcOutput(
    await value,
    spaceImageGeometryVersion
  );
  return originCapable
    ? resolved
    : (toLegacySpaceFilesOriginWireValue(resolved) as T);
}
/**
 * `streamSpaceFileContent`'s resolved value embeds a live `bytes:
 * ReadableStream` alongside its file-descriptor metadata.
 * `toLegacySpaceFilesOriginWireValue`'s generic recursive JSON walk treats
 * any object as a plain record and reconstructs it from
 * `Object.entries()`/`Object.fromEntries()`; a `ReadableStream` has no
 * enumerable own properties, so that walk would silently replace the stream
 * with `{}` and corrupt every downgraded file download. Exclude `bytes` from
 * the walk and reattach it untouched.
 */
async function withSpaceFilesOriginStreamRpcOutput<
  T extends {
    bytes: unknown;
  },
>(
  value: Promise<T>,
  originCapable: boolean,
  spaceImageGeometryVersion?: string
): Promise<T> {
  const resolved = toSpaceImageGeometryRpcOutput(
    await value,
    spaceImageGeometryVersion
  );
  if (originCapable) {
    return resolved;
  }
  const { bytes, ...metadata } = resolved;
  return {
    ...(toLegacySpaceFilesOriginWireValue(metadata) as object),
    bytes,
  } as T;
}
class CoreEntrypoint extends CenterAgentRpcEntrypoint {
  ping() {
    return super.ping();
  }
  async queue(batch: MessageBatch<unknown>): Promise<void> {
    await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      handleCoreQueueBatch({
        batch,
        ctx: this.ctx,
        env: this.env,
      })
    );
  }
  async scheduled(controller: ScheduledController): Promise<void> {
    await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      runCoreScheduledTasks({
        env: this.env,
        cron: controller.cron,
        nowMs: Date.now(),
      })
    );
  }
}

// biome-ignore lint/performance/noBarrelFile: Wrangler requires the Durable Object class export.
export { AccountInvalidationHub } from "./account-invalidation/account-invalidation-hub";
export { OrganizationFileRoot } from "./files/organization-file-root";
export { LarkChannelConnector } from "./remote-agent/transport/lark/lark-channel-connector";
export {
  app,
  PrepareSessionHub,
  RoutineRunWorkflow,
  RuntimeTransportHub,
  Space,
};
export default CoreEntrypoint;

import type {
  CenterAgentPostChannelFileResponse,
  CenterAgentReadChannelFileResponse,
  CenterAgentSetReplyPlacementInput,
} from "@openmeld/schemas/types";
import {
  rpcListPermissionModeSuggestions,
  rpcResolvePermissionModeSuggestion,
  rpcSuggestPermissionMode,
} from "./agent-profile/application/permission-mode-suggestion-card";
import {
  listPluginActionRequests,
  rpcPluginActionRequest,
} from "./connectors/plugin-action-requests";
import {
  authorizeLocalPluginConnection,
  rpcPluginAction,
} from "./connectors/plugin-actions";
import {
  type CenterAgentPostChannelFileInput,
  rpcCenterAgentPostChannelFile,
} from "./remote-agent/application/message-channel-file-publication-service";
import {
  type CenterAgentReadChannelFileInput,
  rpcCenterAgentReadChannelFile,
} from "./remote-agent/application/message-channel-file-service";
import {
  rpcAgentSessionHistory,
  rpcCenterAgentSetReplyPlacement,
  rpcComputerSessionHistory,
  rpcManagePeopleComputerLocalAgentSetup,
} from "./rpc/methods";
