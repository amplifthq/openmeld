import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  SignalEnvelope,
  SpaceCursor,
  SpaceMeta,
} from "@openmeld/protocol";
import { toLegacySpaceAddressingWireValue } from "@openmeld/schemas";
import type {
  AccountSpaceActiveWakeSummaryResponse,
  AccountSpaceIndexResponse,
  AgentProfileCreationRequestMutationResponse,
  ApproveOrganizationDocumentDraftResponse,
  ApproveOrganizationDocumentDraftRpcInput,
  AuthorizeAgentProfileBindingForOrganizationResponse,
  BulkAuthorizeAgentProfileBindingsForOrganizationResponse,
  CenterAgentAddAgentProfilesToSpaceResponse,
  CenterAgentAddMembersToSpaceResponse,
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
  CenterAgentCreateTaskToolRpcInput,
  CenterAgentDeleteRoutineToolRpcInput,
  CenterAgentDraftOrganizationDocumentResponse,
  CenterAgentDraftOrganizationDocumentRpcInput,
  CenterAgentEnableAgentProfileResponse,
  CenterAgentGetOrganizationInviteLinkResponse,
  CenterAgentGetOrganizationInviteLinkToolRpcInput,
  CenterAgentGetTaskToolRpcInput,
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
  CenterAgentListRoutinesToolRpcInput,
  CenterAgentListSlackChannelsResponse,
  CenterAgentListSpaceFilesResponse,
  CenterAgentListSpaceFilesRpcInput,
  CenterAgentListTasksToolRpcInput,
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
  CenterAgentReadConnectorActionOperationResponse,
  CenterAgentReadDispatchHistoryResponse,
  CenterAgentReadMemberComputersResponse,
  CenterAgentReadMemberOpenMeldServiceStatusResponse,
  CenterAgentReadOrganizationDocumentsResponse,
  CenterAgentReadOrganizationDocumentsRpcInput,
  CenterAgentReadOrganizationSkillsResponse,
  CenterAgentReadOrganizationSkillsRpcInput,
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
  CenterAgentTaskDetail,
  CenterAgentTaskDetailRpcResponse,
  CenterAgentUpdateAgentProfileRuntimeSettingsResponse,
  CenterAgentUpdateProfileResponse,
  CenterAgentUpdateProjectToolResponse,
  CenterAgentUpdateProjectToolRpcInput,
  CenterAgentUpdateRoutineToolRpcInput,
  CenterAgentUpdateSpaceSettingsResponse,
  CenterAgentWakeAgentProfilesInSpaceResponse,
  CenterAgentWatchAgentTaskResponse,
  CenterAgentWipeMemberMemoryResponse,
  ChangelogQueryResponse,
  ConnectorAppRequestListResponse,
  ConnectorAppRequestResponse,
  ConnectorConnection,
  ConnectorConnectionListResponse,
  ContinueCenterAgentTaskRpcInput,
  ConvertDirectMessageToSpaceResponse,
  CreateAgentProfileCreationRequestResponse,
  CreateCenterAgentContextLoadReceiptResponse,
  CreateCenterAgentContextManifestResponse,
  CreateCenterAgentRoutineResponse,
  CreateCenterAgentTaskResponse,
  CreateOrganizationDocumentFolderResponse,
  CreateOrganizationDocumentFolderRpcInput,
  CreateOrganizationDocumentResponse,
  CreateOrganizationDocumentRpcInput,
  CreateOrganizationSkillResponse,
  CreateOrganizationSkillRpcInput,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceFolderResponse,
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
  GetCenterAgentTaskRpcInput,
  GetInboxItemResponse,
  GetInboxItemRpcInput,
  GetInboxNotificationPreferencesRpcInput,
  GetInboxSummaryRpcInput,
  GetLocalRuntimeExpectedRoutesResponse,
  GetModelCatalogResponse,
  GetOrganizationBindingAuthorizationPreferenceResponse,
  GetOrganizationDocumentResponse,
  GetOrganizationDocumentRpcInput,
  GetOrganizationSkillResponse,
  GetOrganizationSkillRpcInput,
  GetPrepareReadinessResponse,
  GetSpaceConversationStateResponse,
  GetSpaceDispatchLookupResponse,
  GetSpaceInboxSummaryRpcInput,
  GetSpaceMessageDetailsResponse,
  GetSpaceStatusResponse,
  GetSpaceThreadResponse,
  GetSpaceUpdatesResponse,
  GetSpaceWakeProgressResponse,
  GetSpaceWakeTraceWaterfallResponse,
  GitHubAppInstallationStartResponse,
  GitHubAppInstallationVerificationResponse,
  ImportOrganizationSkillFromGitHubResponse,
  ImportOrganizationSkillFromGitHubRpcInput,
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
  ListCenterAgentTasksResponse,
  ListCenterAgentTasksRpcInput,
  ListCenterAgentTasksRpcResponse,
  ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
  ListFeedbackIssuesForOrganizationRequest,
  ListFeedbackIssuesForOrganizationResponse,
  ListInboxItemsResponse,
  ListInboxItemsRpcInput,
  ListOrganizationBindingAuthorizationProfilesResponse,
  ListOrganizationBindingAuthorizationsResponse,
  ListOrganizationDocumentsResponse,
  ListOrganizationDocumentsRpcInput,
  ListOrganizationSkillsResponse,
  ListOrganizationSkillsRpcInput,
  ListSpaceFileRevisionsResponse,
  ListSpaceFilesResponse,
  ListSpaceThreadEventsResponse,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
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
  NotifyAgentProfileRouteCatalogChangedResponse,
  OpenCenterAgentDirectMessageSpaceResponse,
  OpenDirectMessageSpaceResponse,
  OrganizationComputersResponse,
  OrganizationDirectoryResponse,
  OrganizationDocumentPromptContextResponse,
  OrganizationDocumentPromptContextRpcInput,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationMemberWebActivityResponse,
  OrganizationSkillRuntimeSnapshotResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  PauseCenterAgentRoutineResponse,
  PendingGitHubAppInstallation,
  PostSpaceMembersResponse,
  PostSpaceWakeStopResponse,
  PrepareDiagnosticResponse,
  PrepareSessionResponse,
  PrepareSessionWithTokenResponse,
  PrepareSpaceFileWriteResponse,
  PreviewOrganizationSkillFromGitHubResponse,
  PreviewOrganizationSkillFromGitHubRpcInput,
  ReadFeedbackReportingPolicyRequest,
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
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamDeltaCallbackResponse,
  RemoteAgentStreamPartCallbackBody,
  RemoveSpaceMembersResponse,
  RequestCurrentOpenMeldToolsUpdateResponse,
  ResolveSpaceFileContentResponse,
  RespondToSpaceAgentInteractionResponse,
  RestoreSpaceFileEntryResponse,
  ResumeCenterAgentRoutineResponse,
  RetryCenterAgentTaskRpcInput,
  RevokeAgentProfileBindingForOrganizationResponse,
  SaveOrganizationWakeAccessChoiceResponse,
  SelectCurrentLocalAgentInstallationResponse,
  SetAgentProfileCreationApprovalPreferenceResponse,
  SetAgentProfileCreationDefaultsResponse,
  SetCurrentAgentProfileWorkspaceResponse,
  SetCurrentLocalAgentEnabledResponse,
  SetCurrentOpenMeldToolsMaintenanceResponse,
  SetOrganizationBindingAuthorizationPreferenceResponse,
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
  SpaceIdentityDirectory,
  SpaceInboxSummaryResponse,
  SpaceMemberDirectory,
  SpaceMembersSnapshot,
  SpaceViewerMembershipResponse,
  StartCenterAgentMemberResearchResponse,
  StartCenterAgentMemberResearchRpcInput,
  StopCenterAgentTaskRpcInput,
  SubmitFeedbackIssueResponse,
  SubmitRuntimeAgentControllerReportsResponse,
  SubmitRuntimeProviderConversationProofsResponse,
  SubmitRuntimeRegistrationResponse,
  TrashSpaceFileEntryResponse,
  UpdateCenterAgentModelResponse,
  UpdateCenterAgentOperatingStateResponse,
  UpdateCenterAgentRoutineResponse,
  UpdateFeedbackIssueStatusForOrganizationRequest,
  UpdateInboxNotificationPreferencesRpcInput,
  UpdateOrganizationDocumentFolderResponse,
  UpdateOrganizationDocumentFolderRpcInput,
  UpdateOrganizationDocumentResponse,
  UpdateOrganizationDocumentRpcInput,
  UpdateOrganizationSkillResponse,
  UpdateOrganizationSkillRpcInput,
  UpdateSpaceFileEntryResponse,
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";
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
import {
  rpcCenterAgentCreateTask,
  rpcCenterAgentGetTaskTool,
  rpcCenterAgentListTasksTool,
  rpcContinueCenterAgentTask,
  rpcGetCenterAgentTask,
  rpcListCenterAgentTasks,
  rpcRetryCenterAgentTask,
  rpcStopCenterAgentTask,
} from "./center-agent-tasks/transport/rpc/center-agent-task-rpc";
import { readModelCatalog } from "./config/model-catalog";
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
  rpcDismissInboxItem,
  rpcGetCenterAgentInboxSummary,
  rpcGetInboxItem,
  rpcGetInboxNotificationPreferences,
  rpcGetInboxSummary,
  rpcGetSpaceInboxSummary,
  rpcListInboxItems,
  rpcMarkAllInboxItemsRead,
  rpcMarkCenterAgentInboxReadThrough,
  rpcMarkInboxItemRead,
  rpcMarkSpaceInboxReadThrough,
  rpcUpdateInboxNotificationPreferences,
} from "./inbox/transport/rpc/inbox-rpc";
import {
  agentActivityDb,
  type CoreBindings,
  localStateDb,
  projectionsDb,
} from "./lib/bindings";
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
  rpcCreateOrganizationSkill,
  rpcDeleteOrganizationSkill,
  rpcGetOrganizationSkill,
  rpcImportOrganizationSkillFromGitHub,
  rpcListOrganizationSkills,
  rpcPreviewOrganizationSkillFromGitHub,
  rpcReadOrganizationSkillRuntimeSnapshot,
  rpcRecordOrganizationSkillActivation,
  rpcSetOrganizationSkillEnabled,
  rpcSetOrganizationSkillMaintainers,
  rpcUpdateOrganizationSkill,
} from "./organization-skills/organization-skill-rpc";
import {
  rpcCenterAgentCreateOrganizationInviteLink,
  rpcCenterAgentGetOrganizationInviteLink,
} from "./organizations/center-agent-organization-invite-link-rpc";
import { rpcCenterAgentSetOrganizationWorkingLanguage } from "./organizations/center-agent-working-language-rpc";
import { resolveOrganizationMembershipById } from "./organizations/organization-context";
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
import { verifyLarkPlatformWebhook } from "./remote-agent/application/lark-platform-webhook-service";
import { createConfiguredMessageChannelProviderRegistry } from "./remote-agent/application/message-channel-provider-runtime";
import { completeRemoteAgentNativeDelivery } from "./remote-agent/application/native-delivery-service";
import { processRemoteAgentSlackEvent } from "./remote-agent/application/slack-signal-service";
import {
  handleCenterAgentSlackTeammateInvitations,
  handleSlackWelcomeInteraction,
} from "./remote-agent/application/slack-welcome-interaction-service";
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
import { RoutineRunWorkflow } from "./routines/routine-run-workflow";
import {
  type AddCenterAgentToSpaceInput,
  type AddOrganizationDirectoryProfilesToSpaceInput,
  type AddSpaceMembersInput,
  type ArchiveProjectInput,
  type AssertCurrentDesignatedCenterAgentInput,
  type AuthorizeAgentProfileBindingForOrganizationInput,
  type AuthorizeConnectorDisconnectInput,
  type BeginCurrentMemberConnectorAuthorizationInput,
  type BeginCurrentOrganizationGitHubAppInstallationInput,
  type BeginCurrentOrganizationSharedConnectorAuthorizationInput,
  type BeginGitHubAppInstallationVerificationInput,
  type BeginLarkPlatformRegistrationInput,
  type BulkAuthorizeAgentProfileBindingsForOrganizationInput,
  type CenterAgentAddAgentProfilesToSpaceInput,
  type CenterAgentAddMembersToSpaceInput,
  type CenterAgentCheckAgentProfileReadinessInput,
  type CenterAgentConnectAgentProfileToLocalAgentInput,
  type CenterAgentCreateAgentProfileInput,
  type CenterAgentCreateConfiguredAgentProfileInput,
  type CenterAgentCreateSpaceInput,
  type CenterAgentEnableAgentProfileInput,
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
  type CenterAgentReadSlackChannelHistoryInput,
  type CenterAgentReadSlackChannelMembersInput,
  type CenterAgentReadSlackFileInput,
  type CenterAgentReadSlackWorkspaceDirectoryInput,
  type CenterAgentReadSpaceAuthoringContractInput,
  type CenterAgentReadSpaceContextInput,
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
  type CenterAgentUpdateAgentProfileRuntimeSettingsInput,
  type CenterAgentUpdateSpaceSettingsInput,
  type CenterAgentWakeAgentProfilesInSpaceInput,
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
  type CreateCenterAgentContextLoadReceiptInput,
  type CreateCenterAgentContextManifestInput,
  type CreateCurrentOrganizationConnectorAppRequestInput,
  type CreateProjectInput,
  type CreateRoutineInput,
  type CreateSlackOAuthStateInput,
  type CreateSpaceDiagnosticReportInput,
  type CreateSpaceFolderInput,
  type CreateSpaceInput,
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
  type GetAgentProfilePrimaryBindingInput,
  type GetCenterAgentDesignationInput,
  type GetCenterAgentDirectMessageSpaceProjectionInput,
  type GetCenterAgentModelInput,
  type GetCenterAgentOperatingStateInput,
  type GetCurrentDeviceTargetInput,
  type GetCurrentLocalAgentInstallationsInput,
  type GetCurrentLocalRuntimeReplyReadinessInput,
  type GetCurrentOrganizationComputersInput,
  type GetCurrentOrganizationDirectoryInput,
  type GetCurrentOrganizationMemberOpenMeldServiceStatusesInput,
  type GetCurrentOrganizationSpaceDirectoryInput,
  type GetLocalRuntimeExpectedRoutesInput,
  type GetLocalRuntimesInput,
  type GetOrganizationBindingAuthorizationPreferenceInput,
  type GetPrepareReadinessInput,
  type GetSpaceBoardInput,
  type GetSpaceBootstrapInput,
  type GetSpaceContractInput,
  type GetSpaceConversationStateRpcInput,
  type GetSpaceCursorInput,
  type GetSpaceDispatchLookupInput,
  type GetSpaceDispatchResultInput,
  type GetSpaceDispatchTraceInput,
  type GetSpaceFileInput,
  type GetSpaceMembersInput,
  type GetSpaceMessageDetailsInput,
  type GetSpaceMetaInput,
  type GetSpaceStatusInput,
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
  type ListCenterAgentAuditJournalInput,
  type ListCurrentOrganizationConnectorAppRequestsInput,
  type ListCurrentOrganizationConnectorConnectionsInput,
  type ListCurrentUserAgentProfileOrganizationWakeAccessInput,
  type ListMessageChannelConnectionsInput,
  type ListOrganizationBindingAuthorizationProfilesInput,
  type ListOrganizationBindingAuthorizationsInput,
  type ListProjectsInput,
  type ListRoutineRunsInput,
  type ListRoutinesInput,
  type ListRoutineTargetSpacesInput,
  type ListSignalsInput,
  type ListSignalsResult,
  type ListSpaceFilesInput,
  type ListSpaceThreadEventsInput,
  type ListSpaceThreadSignalsInput,
  type ListSpaceThreadsInput,
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
  type RevokeAgentProfileBindingForOrganizationInput,
  rpcAddCenterAgentToSpace,
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcAddSpaceMembers,
  rpcArchiveProject,
  rpcAssertCurrentDesignatedCenterAgent,
  rpcAuthorizeAgentProfileBindingForOrganization,
  rpcAuthorizeConnectorDisconnect,
  rpcBeginCurrentMemberConnectorAuthorization,
  rpcBeginCurrentOrganizationGitHubAppInstallation,
  rpcBeginCurrentOrganizationSharedConnectorAuthorization,
  rpcBeginGitHubAppInstallationVerification,
  rpcBeginLarkPlatformRegistration,
  rpcBulkAuthorizeAgentProfileBindingsForOrganization,
  rpcCenterAgentAddAgentProfilesToSpace,
  rpcCenterAgentAddMembersToSpace,
  rpcCenterAgentCheckAgentProfileReadiness,
  rpcCenterAgentConnectAgentProfileToLocalAgent,
  rpcCenterAgentCreateAgentProfile,
  rpcCenterAgentCreateSpace,
  rpcCenterAgentEnableAgentProfile,
  rpcCenterAgentGetOrganizationDirectory,
  rpcCenterAgentGetOrganizationSpaceDirectory,
  rpcCenterAgentListAgentActivitySessions,
  rpcCenterAgentListAgentProfileCreationDefaults,
  rpcCenterAgentListAgentTasks,
  rpcCenterAgentListComputers,
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
  rpcCenterAgentReadChangelog,
  rpcCenterAgentReadConnectorActionOperation,
  rpcCenterAgentReadDispatchHistory,
  rpcCenterAgentReadMemberComputers,
  rpcCenterAgentReadMemberOpenMeldServiceStatus,
  rpcCenterAgentReadSlackChannelHistory,
  rpcCenterAgentReadSlackChannelMembers,
  rpcCenterAgentReadSlackFile,
  rpcCenterAgentReadSlackWorkspaceDirectory,
  rpcCenterAgentReadSpaceAuthoringContract,
  rpcCenterAgentReadSpaceContext,
  rpcCenterAgentReadSpaceFile,
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
  rpcCenterAgentStartSelfMemberResearch,
  rpcCenterAgentUpdateAgentProfileRuntimeSettings,
  rpcCenterAgentUpdateSpaceSettings,
  rpcCenterAgentWakeAgentProfilesInSpace,
  rpcCenterAgentWatchAgentTask,
  rpcClearSpacePassword,
  rpcCommitSpaceFileWrite,
  rpcCompleteConnectorDisconnect,
  rpcCompleteGitHubAppInstallation,
  rpcConnectCandidate,
  rpcConnectCenterAgentSlackWorkspace,
  rpcConnectDeclaredPath,
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
  rpcDeleteRoutine,
  rpcDeleteSpace,
  rpcDeleteSpaceAttachmentRecord,
  rpcDesignateCenterAgent,
  rpcDisableAgentProfilePrimaryBinding,
  rpcDiscardSpaceComposerUpload,
  rpcDisconnectCenterAgentSlackWorkspace,
  rpcDisconnectLarkPlatformRegistration,
  rpcDisconnectMessageChannelIdentityLink,
  rpcDiscoverProjects,
  rpcEnrollLocalRuntime,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcExecuteAgentProfileWorkRecovery,
  rpcExecuteExecutionRecovery,
  rpcForgetComputer,
  rpcForgetCurrentComputer,
  rpcGetActiveSpaceWakeProgress,
  rpcGetAgentExecutionReadiness,
  rpcGetAgentExecutionReadinessBatch,
  rpcGetAgentProfileControllerChangeEligibility,
  rpcGetAgentProfileCreationDefaults,
  rpcGetAgentProfilePrimaryBinding,
  rpcGetCenterAgentDesignation,
  rpcGetCenterAgentDirectMessageSpaceProjection,
  rpcGetCenterAgentModel,
  rpcGetCenterAgentOperatingState,
  rpcGetCurrentDeviceTarget,
  rpcGetCurrentLocalAgentInstallations,
  rpcGetCurrentLocalRuntimeReplyReadiness,
  rpcGetCurrentOrganizationComputers,
  rpcGetCurrentOrganizationDirectory,
  rpcGetCurrentOrganizationMemberOpenMeldServiceStatuses,
  rpcGetCurrentOrganizationSpaceDirectory,
  rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts,
  rpcGetLocalRuntimeExpectedRoutes,
  rpcGetOrganizationBindingAuthorizationPreference,
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
  rpcGetSpaceFile,
  rpcGetSpaceIdentityDirectory,
  rpcGetSpaceMemberDirectory,
  rpcGetSpaceMembers,
  rpcGetSpaceMessageDetails,
  rpcGetSpaceMeta,
  rpcGetSpaceStatus,
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
  rpcListCenterAgentAuditJournal,
  rpcListCurrentOrganizationConnectorAppRequests,
  rpcListCurrentOrganizationConnectorConnections,
  rpcListCurrentUserAgentProfileOrganizationWakeAccess,
  rpcListLocalRuntimes,
  rpcListMessageChannelConnections,
  rpcListOrganizationBindingAuthorizationProfiles,
  rpcListOrganizationBindingAuthorizations,
  rpcListProjects,
  rpcListRoutineRuns,
  rpcListRoutines,
  rpcListRoutineTargetSpaces,
  rpcListSignals,
  rpcListSpaceFileRevisions,
  rpcListSpaceFiles,
  rpcListSpaceThreadEvents,
  rpcListSpaceThreadSignals,
  rpcListSpaceThreads,
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
  rpcReadSpaceFileContent,
  rpcReconcileCurrentOrganizationConnectorConnections,
  rpcRecordCenterAgentAudit,
  rpcRecordCurrentOrganizationWebActivity,
  rpcRecordSpaceAttachment,
  rpcRefreshCurrentLocalAgentCatalog,
  rpcRemoveConnection,
  rpcRemoveMissingConnections,
  rpcRemoveSpaceMembers,
  rpcRequestCurrentOpenMeldToolsUpdate,
  rpcRequestMessageChannelSetup,
  rpcResolveSpaceAttachmentForDownload,
  rpcResolveSpaceFileContent,
  rpcRespondToSpaceAgentInteraction,
  rpcRestoreSpaceFileEntry,
  rpcRestoreSpaceFileRevision,
  rpcResumeRoutine,
  rpcRevokeAgentProfileBindingForOrganization,
  rpcSaveOrganizationWakeAccessChoice,
  rpcSelectCurrentLocalAgentInstallation,
  rpcSelectLocalFolders,
  rpcSetAgentProfileCreationDefaults,
  rpcSetCenterAgentOrganizationMemoryPolicy,
  rpcSetCurrentAgentProfileWorkspace,
  rpcSetCurrentLocalAgentEnabled,
  rpcSetCurrentOpenMeldToolsMaintenance,
  rpcSetCurrentOrganizationFeedbackReportingPolicy,
  rpcSetDefaultConnection,
  rpcSetLocalRuntimeDisplayName,
  rpcSetOrganizationBindingAuthorizationPreference,
  rpcSetOrganizationInformationProtectionPolicy,
  rpcSetSpaceAccessMode,
  rpcStageSpaceComposerUpload,
  rpcSubmitAgentActivityEvents,
  rpcSubmitAgentActivitySessionReconciliation,
  rpcSubmitAgentControllerTaskLifecycleEvents,
  rpcSubmitRuntimeAgentControllerReports,
  rpcSubmitRuntimeProviderConversationProofs,
  rpcSubmitRuntimeRegistration,
  rpcTrashSpaceFileEntry,
  rpcUpdateAgentProfileDefaultProject,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode,
  rpcUpdateAgentProfilePrimaryBindingModelSelection,
  rpcUpdateAgentProfilePrimaryBindingOpenCodePermission,
  rpcUpdateCenterAgentModel,
  rpcUpdateCenterAgentOperatingState,
  rpcUpdateCenterAgentProfile,
  rpcUpdateComputerFileAccessPolicy,
  rpcUpdateProject,
  rpcUpdateRoutine,
  rpcUpdateSpaceCursor,
  rpcUpdateSpaceFileEntry,
  rpcUpdateSpaceMeta,
  rpcUpsertSpacePassword,
  rpcWipeCurrentMemberCenterAgentMemory,
  rpcWriteCurrentDeviceObservedMetadata,
  rpcWriteSpaceFileContent,
  runSlackInstallationWelcomePreparationTick,
  type SaveOrganizationWakeAccessChoiceInput,
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
  type SetOrganizationBindingAuthorizationPreferenceInput,
  type SetOrganizationInformationProtectionPolicyInput,
  type SetSpaceAccessModeInput,
  type SpaceAccessModeStateResult,
  type SpaceFileWriteInput,
  type SpacePasswordStateResult,
  type StageSpaceComposerUploadRpcInput,
  type SubmitAgentActivityEventsInput,
  type SubmitAgentActivitySessionReconciliationInput,
  type SubmitAgentControllerTaskLifecycleEventsInput,
  type SubmitRuntimeAgentControllerReportsInput,
  type SubmitRuntimeProviderConversationProofsInput,
  type SubmitRuntimeRegistrationInput,
  type TrashSpaceFileEntryInput,
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
import { RuntimeTransportHub } from "./runtime-transport/transport/do/runtime-transport-hub";
import {
  ROUTINE_TICK_CRON,
  runCoreScheduledTasks,
} from "./scheduled/core-scheduled-tasks";
import { emitCoreCloudflareRuntimeEvidence } from "./shared/observability/cloudflare-runtime-evidence";
import { handleCoreQueueBatch } from "./shared/queue/core-queue-router";
import type { SpaceBootstrapWithTiming } from "./space/application/space-bootstrap-timing";
import { Space } from "./space/transport/do/space";
import {
  type ProjectSpaceIndexMembershipOverlayRpcInput,
  type ProjectSpaceIndexMembershipOverlayRpcResult,
  rpcProjectSpaceIndexMembershipOverlay,
} from "./space-index/space-index-overlay-rpc";
import { listMembershipSpaceIdsForProfilesFromSpaceIndex } from "./space-index/space-index-repository";

// Narrow first-party entrypoint for the auth worker's profile lifecycle
// fan-out. Kept separate from GatewayRpcEntrypoint so auth only gets the
// reconcile surface instead of the whole gateway RPC surface.
export class ProfileLifecycleEntrypoint extends WorkerEntrypoint<CoreBindings> {
  reconcileDeletedAgentProfile(
    input: ReconcileDeletedAgentProfileRequest
  ): Promise<ReconcileDeletedAgentProfileResponse> {
    return reconcileDeletedAgentProfile(this.env, input);
  }

  projectSpaceIndexMembershipOverlay(
    input: ProjectSpaceIndexMembershipOverlayRpcInput
  ): Promise<ProjectSpaceIndexMembershipOverlayRpcResult> {
    return rpcProjectSpaceIndexMembershipOverlay(this.env, input);
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
    const organizationId = normalizeOptionalRpcText(input.organizationId);
    const userId = normalizeOptionalRpcText(input.userId);
    if (!(organizationId && userId)) {
      return { code: "invalid_payload", ok: false };
    }
    const db = agentActivityDb(this.env);
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
  }

  async deleteCenterAgentOrganizationMemory(input: {
    organizationId?: string | null;
  }): Promise<{
    code?: string;
    ok: boolean;
    status?: "deleted" | "not_found";
  }> {
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
    const db = projectionsDb(this.env);
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
  // Keep fetch for WebSocket upgrade proxying and internal service calls.
  // In production, openmeld-core is not directly exposed; it should only be called
  // through Gateway service binding. dev localhost access is used for local tests.
  fetch(request: Request): Promise<Response> {
    return Promise.resolve(app.fetch(request, this.env, this.ctx));
  }

  createSpace(input?: CreateSpaceInput) {
    return rpcCreateSpace(this.env, input);
  }

  listAccountSpaces(
    input: ListAccountSpacesInput
  ): Promise<AccountSpaceIndexResponse> {
    return rpcListAccountSpaces(this.env, input);
  }

  listAccountSpaceActiveWakeSummary(
    input: ListAccountSpaceActiveWakeSummaryInput
  ): Promise<AccountSpaceActiveWakeSummaryResponse> {
    return rpcListAccountSpaceActiveWakeSummary(this.env, input);
  }

  listProjects(input: ListProjectsInput) {
    return rpcListProjects(this.env, input);
  }

  createProject(input: CreateProjectInput) {
    return rpcCreateProject(this.env, input);
  }

  updateProject(input: UpdateProjectInput) {
    return rpcUpdateProject(this.env, input);
  }

  updateAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput
  ) {
    return rpcUpdateAgentProfileDefaultProject(this.env, input);
  }

  archiveProject(input: ArchiveProjectInput) {
    return rpcArchiveProject(this.env, input);
  }

  discoverProjects(input: DiscoverProjectsInput) {
    return rpcDiscoverProjects(this.env, input);
  }

  readComputerFileAccessPolicy(input: ReadComputerFileAccessPolicyInput) {
    return rpcReadComputerFileAccessPolicy(this.env, input);
  }

  selectLocalFolders(input: SelectLocalFoldersInput) {
    return rpcSelectLocalFolders(this.env, input);
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
    return rpcSubmitAgentActivityEvents(this.env, input);
  }

  submitAgentActivitySessionReconciliation(
    input: SubmitAgentActivitySessionReconciliationInput
  ) {
    return rpcSubmitAgentActivitySessionReconciliation(this.env, input);
  }

  submitAgentControllerTaskLifecycleEvents(
    input: SubmitAgentControllerTaskLifecycleEventsInput
  ) {
    return rpcSubmitAgentControllerTaskLifecycleEvents(this.env, input);
  }

  readAgentActivitySnapshot(input: ReadAgentActivitySnapshotInput) {
    return rpcReadAgentActivitySnapshot(this.env, input);
  }

  readAgentActivitySessionInventory(
    input: ReadAgentActivitySessionInventoryInput
  ) {
    return rpcReadAgentActivitySessionInventory(this.env, input);
  }

  readAgentActivityStats(input: ReadAgentActivityStatsInput) {
    return rpcReadAgentActivityStats(this.env, input);
  }

  readOrganizationUsageOverview(input: ReadOrganizationUsageOverviewInput) {
    return rpcReadOrganizationUsageOverview(this.env, input);
  }

  listRoutines(input: ListRoutinesInput) {
    return rpcListRoutines(this.env, input);
  }

  listRoutineTargetSpaces(input: ListRoutineTargetSpacesInput) {
    return rpcListRoutineTargetSpaces(this.env, input);
  }

  createRoutine(input: CreateRoutineInput) {
    return rpcCreateRoutine(this.env, input);
  }

  updateRoutine(input: UpdateRoutineInput) {
    return rpcUpdateRoutine(this.env, input);
  }

  pauseRoutine(input: PauseRoutineInput) {
    return rpcPauseRoutine(this.env, input);
  }

  resumeRoutine(input: ResumeRoutineInput) {
    return rpcResumeRoutine(this.env, input);
  }

  deleteRoutine(input: DeleteRoutineInput) {
    return rpcDeleteRoutine(this.env, input);
  }

  listRoutineRuns(input: ListRoutineRunsInput) {
    return rpcListRoutineRuns(this.env, input);
  }

  listCenterAgentTasks(
    input: ListCenterAgentTasksRpcInput
  ): Promise<ListCenterAgentTasksRpcResponse> {
    return rpcListCenterAgentTasks(this.env, input);
  }

  getCenterAgentTask(
    input: GetCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return rpcGetCenterAgentTask(this.env, input);
  }

  continueCenterAgentTask(
    input: ContinueCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return rpcContinueCenterAgentTask(this.env, input);
  }

  stopCenterAgentTask(
    input: StopCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return rpcStopCenterAgentTask(this.env, input);
  }

  retryCenterAgentTask(
    input: RetryCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return rpcRetryCenterAgentTask(this.env, input);
  }

  listInboxItems(
    input: ListInboxItemsRpcInput
  ): Promise<ListInboxItemsResponse> {
    return rpcListInboxItems(this.env, input);
  }

  dismissInboxItem(
    input: DismissInboxItemRpcInput
  ): Promise<DismissInboxItemResponse> {
    return rpcDismissInboxItem(this.env, input);
  }

  getInboxItem(input: GetInboxItemRpcInput): Promise<GetInboxItemResponse> {
    return rpcGetInboxItem(this.env, input);
  }

  getInboxSummary(
    input: GetInboxSummaryRpcInput
  ): Promise<InboxSummaryResponse> {
    return rpcGetInboxSummary(this.env, input);
  }

  getCenterAgentInboxSummary(
    input: GetCenterAgentInboxSummaryRpcInput
  ): Promise<CenterAgentInboxSummaryResponse> {
    return rpcGetCenterAgentInboxSummary(this.env, input);
  }

  getSpaceInboxSummary(
    input: GetSpaceInboxSummaryRpcInput
  ): Promise<SpaceInboxSummaryResponse> {
    return rpcGetSpaceInboxSummary(this.env, input);
  }

  markCenterAgentInboxReadThrough(
    input: MarkCenterAgentInboxReadThroughRpcInput
  ): Promise<MarkCenterAgentInboxReadThroughResponse> {
    return rpcMarkCenterAgentInboxReadThrough(this.env, input);
  }

  markSpaceInboxReadThrough(
    input: MarkSpaceInboxReadThroughRpcInput
  ): Promise<MarkSpaceInboxReadThroughResponse> {
    return rpcMarkSpaceInboxReadThrough(this.env, input);
  }

  markInboxItemRead(
    input: MarkInboxItemReadRpcInput
  ): Promise<MarkInboxItemReadResponse> {
    return rpcMarkInboxItemRead(this.env, input);
  }

  markAllInboxItemsRead(
    input: MarkAllInboxItemsReadRpcInput
  ): Promise<MarkAllInboxItemsReadResponse> {
    return rpcMarkAllInboxItemsRead(this.env, input);
  }

  getInboxNotificationPreferences(
    input: GetInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return rpcGetInboxNotificationPreferences(this.env, input);
  }

  updateInboxNotificationPreferences(
    input: UpdateInboxNotificationPreferencesRpcInput
  ): Promise<InboxNotificationPreferencesResponse> {
    return rpcUpdateInboxNotificationPreferences(this.env, input);
  }

  listOrganizationDocuments(
    input: ListOrganizationDocumentsRpcInput
  ): Promise<ListOrganizationDocumentsResponse> {
    return rpcListOrganizationDocuments(this.env, input);
  }

  centerAgentReadOrganizationSkills(
    input: CenterAgentReadOrganizationSkillsRpcInput
  ): Promise<CenterAgentReadOrganizationSkillsResponse> {
    return rpcCenterAgentReadOrganizationSkills(this.env, input);
  }

  centerAgentInstallOrganizationSkill(
    input: CenterAgentInstallOrganizationSkillRpcInput
  ): Promise<CenterAgentInstallOrganizationSkillResponse> {
    return rpcCenterAgentInstallOrganizationSkill(this.env, input);
  }

  listOrganizationSkills(
    input: ListOrganizationSkillsRpcInput
  ): Promise<ListOrganizationSkillsResponse> {
    return rpcListOrganizationSkills(this.env, input);
  }

  getOrganizationSkill(
    input: GetOrganizationSkillRpcInput
  ): Promise<GetOrganizationSkillResponse> {
    return rpcGetOrganizationSkill(this.env, input);
  }

  createOrganizationSkill(
    input: CreateOrganizationSkillRpcInput
  ): Promise<CreateOrganizationSkillResponse> {
    return rpcCreateOrganizationSkill(this.env, input);
  }

  importOrganizationSkillFromGitHub(
    input: ImportOrganizationSkillFromGitHubRpcInput
  ): Promise<ImportOrganizationSkillFromGitHubResponse> {
    return rpcImportOrganizationSkillFromGitHub(this.env, input);
  }

  previewOrganizationSkillFromGitHub(
    input: PreviewOrganizationSkillFromGitHubRpcInput
  ): Promise<PreviewOrganizationSkillFromGitHubResponse> {
    return rpcPreviewOrganizationSkillFromGitHub(this.env, input);
  }

  updateOrganizationSkill(
    input: UpdateOrganizationSkillRpcInput
  ): Promise<UpdateOrganizationSkillResponse> {
    return rpcUpdateOrganizationSkill(this.env, input);
  }

  setOrganizationSkillEnabled(
    input: SetOrganizationSkillEnabledRpcInput
  ): Promise<SetOrganizationSkillEnabledResponse> {
    return rpcSetOrganizationSkillEnabled(this.env, input);
  }

  setOrganizationSkillMaintainers(
    input: SetOrganizationSkillMaintainersRpcInput
  ): Promise<SetOrganizationSkillMaintainersResponse> {
    return rpcSetOrganizationSkillMaintainers(this.env, input);
  }

  deleteOrganizationSkill(
    input: DeleteOrganizationSkillRpcInput
  ): Promise<DeleteOrganizationSkillResponse> {
    return rpcDeleteOrganizationSkill(this.env, input);
  }

  readOrganizationSkillRuntimeSnapshot(
    input: ReadOrganizationSkillRuntimeSnapshotRpcInput
  ): Promise<OrganizationSkillRuntimeSnapshotResponse> {
    return rpcReadOrganizationSkillRuntimeSnapshot(this.env, input);
  }

  recordOrganizationSkillActivation(
    input: RecordOrganizationSkillActivationRpcInput
  ): Promise<RecordOrganizationSkillActivationResponse> {
    return rpcRecordOrganizationSkillActivation(this.env, input);
  }

  getOrganizationDocument(
    input: GetOrganizationDocumentRpcInput
  ): Promise<GetOrganizationDocumentResponse> {
    return rpcGetOrganizationDocument(this.env, input);
  }

  createOrganizationDocument(
    input: CreateOrganizationDocumentRpcInput
  ): Promise<CreateOrganizationDocumentResponse> {
    return rpcCreateOrganizationDocument(this.env, input);
  }

  updateOrganizationDocument(
    input: UpdateOrganizationDocumentRpcInput
  ): Promise<UpdateOrganizationDocumentResponse> {
    return rpcUpdateOrganizationDocument(this.env, input);
  }

  deleteOrganizationDocument(
    input: DeleteOrganizationDocumentRpcInput
  ): Promise<DeleteOrganizationDocumentResponse> {
    return rpcDeleteOrganizationDocument(this.env, input);
  }

  createOrganizationDocumentFolder(
    input: CreateOrganizationDocumentFolderRpcInput
  ): Promise<CreateOrganizationDocumentFolderResponse> {
    return rpcCreateOrganizationDocumentFolder(this.env, input);
  }

  updateOrganizationDocumentFolder(
    input: UpdateOrganizationDocumentFolderRpcInput
  ): Promise<UpdateOrganizationDocumentFolderResponse> {
    return rpcUpdateOrganizationDocumentFolder(this.env, input);
  }

  deleteOrganizationDocumentFolder(
    input: DeleteOrganizationDocumentFolderRpcInput
  ): Promise<DeleteOrganizationDocumentFolderResponse> {
    return rpcDeleteOrganizationDocumentFolder(this.env, input);
  }

  approveOrganizationDocumentDraft(
    input: ApproveOrganizationDocumentDraftRpcInput
  ): Promise<ApproveOrganizationDocumentDraftResponse> {
    return rpcApproveOrganizationDocumentDraft(this.env, input);
  }

  discardOrganizationDocumentDraft(
    input: DiscardOrganizationDocumentDraftRpcInput
  ): Promise<DiscardOrganizationDocumentDraftResponse> {
    return rpcDiscardOrganizationDocumentDraft(this.env, input);
  }

  async startCenterAgentMemberResearch(
    input: StartCenterAgentMemberResearchRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse> {
    const directMessage = await rpcOpenCenterAgentDirectMessageSpace(
      this.env,
      input
    );
    const response = await startCenterAgentMemberResearch(
      this.env,
      input,
      directMessage.spaceId
    );
    const db = localStateDb(this.env);
    if (db) {
      this.ctx.waitUntil(
        runCenterAgentMemberResearchTick({ db, env: this.env })
      );
    }
    return response;
  }

  getCenterAgentMemberResearchStatus(
    input: GetCenterAgentMemberResearchStatusRpcInput
  ): Promise<GetCenterAgentMemberResearchStatusResponse> {
    return getCenterAgentMemberResearchStatus(this.env, input);
  }

  ping() {
    return { ok: true, service: "openmeld-core" } as const;
  }

  getModelCatalog(): GetModelCatalogResponse {
    return readModelCatalog();
  }

  readChangelog(input: ReadChangelogInput): Promise<ChangelogQueryResponse> {
    return rpcReadChangelog(this.env, input);
  }

  inspectDbState(): DbFactSnapshot {
    return inspectCoreDbState(this.env);
  }

  inspectDispatchStorageReadiness(): Promise<DispatchStorageReadiness> {
    return inspectCoreDispatchStorageReadiness(this.env);
  }

  listSignals(input: ListSignalsInput): Promise<ListSignalsResult> {
    return withLegacySpaceAddressingRpcOutput(rpcListSignals(this.env, input));
  }

  async postSignal(input: PostSignalInput): Promise<SignalEnvelope> {
    const startedAt = Date.now();
    const requestId = input.context?.actorContext.requestId ?? null;
    const clientMessageId = input.meta?.clientMessageId ?? null;
    const activationTargetCount =
      input.messageEnvelope?.activationTargets.length ?? 0;
    const targetProfileId = input.messageEnvelope?.activationTargets[0] ?? null;

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
      const signal = await rpcPostSignal(this.env, input);
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
      return toLegacySpaceAddressingRpcOutput(signal);
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
  }

  postTransientSignal(input: PostTransientSignalInput): Promise<void> {
    return rpcPostTransientSignal(this.env, input);
  }

  getSpaceMembers(input: GetSpaceMembersInput): Promise<SpaceMembersSnapshot> {
    return rpcGetSpaceMembers(this.env, input);
  }

  getSpaceIdentityDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceIdentityDirectory> {
    return rpcGetSpaceIdentityDirectory(this.env, input);
  }

  getSpaceMemberDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceMemberDirectory> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceMemberDirectory(this.env, input)
    );
  }

  getSpaceViewerMembership(
    input: GetSpaceViewerMembershipInput
  ): Promise<SpaceViewerMembershipResponse> {
    return rpcGetSpaceViewerMembership(this.env, input);
  }

  recordSpaceAttachment(
    input: RecordSpaceAttachmentInput
  ): Promise<SpaceAttachmentDescriptor> {
    return rpcRecordSpaceAttachment(this.env, input);
  }

  deleteSpaceAttachmentRecord(
    input: DeleteSpaceAttachmentRecordInput
  ): Promise<DeleteSpaceAttachmentRecordResult> {
    return rpcDeleteSpaceAttachmentRecord(this.env, input);
  }

  resolveSpaceAttachmentForDownload(
    input: ResolveSpaceAttachmentForDownloadInput
  ): Promise<SpaceAttachmentDescriptor> {
    return rpcResolveSpaceAttachmentForDownload(this.env, input);
  }

  listSpaceFiles(input: ListSpaceFilesInput): Promise<ListSpaceFilesResponse> {
    return rpcListSpaceFiles(this.env, input);
  }

  getSpaceFile(input: GetSpaceFileInput): Promise<SpaceFileDescriptor> {
    return rpcGetSpaceFile(this.env, input);
  }

  listSpaceFileRevisions(
    input: GetSpaceFileInput
  ): Promise<ListSpaceFileRevisionsResponse> {
    return rpcListSpaceFileRevisions(this.env, input);
  }

  createSpaceFolder(
    input: CreateSpaceFolderInput
  ): Promise<CreateSpaceFolderResponse> {
    return rpcCreateSpaceFolder(this.env, input);
  }

  updateSpaceFileEntry(
    input: UpdateSpaceFileEntryInput
  ): Promise<UpdateSpaceFileEntryResponse> {
    return rpcUpdateSpaceFileEntry(this.env, input);
  }

  trashSpaceFileEntry(
    input: TrashSpaceFileEntryInput
  ): Promise<TrashSpaceFileEntryResponse> {
    return rpcTrashSpaceFileEntry(this.env, input);
  }

  restoreSpaceFileEntry(
    input: RestoreSpaceFileEntryInput
  ): Promise<RestoreSpaceFileEntryResponse> {
    return rpcRestoreSpaceFileEntry(this.env, input);
  }

  restoreSpaceFileRevision(
    input: RestoreSpaceFileRevisionInput
  ): Promise<SpaceFileDescriptor> {
    return rpcRestoreSpaceFileRevision(this.env, input);
  }

  prepareSpaceFileWrite(
    input: SpaceFileWriteInput
  ): Promise<PrepareSpaceFileWriteResponse> {
    return rpcPrepareSpaceFileWrite(this.env, input);
  }

  commitSpaceFileWrite(
    input: SpaceFileWriteInput
  ): Promise<SpaceFileDescriptor> {
    return rpcCommitSpaceFileWrite(this.env, input);
  }

  resolveSpaceFileContent(
    input: ResolveSpaceFileContentRpcInput
  ): Promise<ResolveSpaceFileContentResponse> {
    return rpcResolveSpaceFileContent(this.env, input);
  }

  readSpaceFileContent(
    input: ReadSpaceFileContentRpcInput
  ): Promise<ReadSpaceFileContentRpcResponse> {
    return rpcReadSpaceFileContent(this.env, input);
  }

  writeSpaceFileContent(
    input: WriteSpaceFileContentRpcInput
  ): Promise<SpaceFileDescriptor> {
    return rpcWriteSpaceFileContent(this.env, input);
  }

  stageSpaceComposerUpload(input: StageSpaceComposerUploadRpcInput) {
    return rpcStageSpaceComposerUpload(this.env, input);
  }

  publishSpaceComposerUpload(input: PublishSpaceComposerUploadRpcInput) {
    return rpcPublishSpaceComposerUpload(this.env, input);
  }

  discardSpaceComposerUpload(input: DiscardSpaceComposerUploadRpcInput) {
    return rpcDiscardSpaceComposerUpload(this.env, input);
  }

  listSpaceThreads(
    input: ListSpaceThreadsInput
  ): Promise<ListSpaceThreadsResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcListSpaceThreads(this.env, input)
    );
  }

  getSpaceThread(input: GetSpaceThreadInput): Promise<GetSpaceThreadResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceThread(this.env, input)
    );
  }

  listSpaceThreadEvents(
    input: ListSpaceThreadEventsInput
  ): Promise<ListSpaceThreadEventsResponse> {
    return rpcListSpaceThreadEvents(this.env, input);
  }

  listSpaceThreadSignals(
    input: ListSpaceThreadSignalsInput
  ): Promise<ListSpaceThreadSignalsResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcListSpaceThreadSignals(this.env, input)
    );
  }

  getSpaceDispatchTrace(
    input: GetSpaceDispatchTraceInput
  ): Promise<SpaceDispatchTraceResponse> {
    return rpcGetSpaceDispatchTrace(this.env, input);
  }

  inspectExecutionRecovery(
    input: InspectExecutionRecoveryInput
  ): Promise<InspectExecutionRecoveryResponse> {
    return rpcInspectExecutionRecovery(this.env, input);
  }

  executeExecutionRecovery(
    input: ExecuteExecutionRecoveryInput
  ): Promise<ExecuteExecutionRecoveryResponse> {
    return rpcExecuteExecutionRecovery(this.env, input);
  }

  getSpaceDispatchLookup(
    input: GetSpaceDispatchLookupInput
  ): Promise<GetSpaceDispatchLookupResponse> {
    return rpcGetSpaceDispatchLookup(this.env, input);
  }

  getActiveSpaceWakeProgress(
    input: GetActiveSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse> {
    return rpcGetActiveSpaceWakeProgress(this.env, input);
  }

  getSpaceWakeProgress(
    input: GetSpaceWakeProgressInput
  ): Promise<GetSpaceWakeProgressResponse> {
    return rpcGetSpaceWakeProgress(this.env, input);
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

  getSpaceMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse> {
    return rpcGetSpaceMessageDetails(this.env, input);
  }

  async createSpaceDiagnosticReport(
    input: CreateSpaceDiagnosticReportInput
  ): Promise<CreateSpaceDiagnosticReportResponse> {
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
        replySignalId: report.replyToSignalId ? report.reportedSignalId : null,
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
  }

  addSpaceMembers(
    input: AddSpaceMembersInput
  ): Promise<PostSpaceMembersResponse> {
    return rpcAddSpaceMembers(this.env, input);
  }

  removeSpaceMembers(
    input: RemoveSpaceMembersInput
  ): Promise<RemoveSpaceMembersResponse> {
    return rpcRemoveSpaceMembers(this.env, input);
  }

  leaveSpace(input: LeaveSpaceInput): Promise<LeaveSpaceResponse> {
    return rpcLeaveSpace(this.env, input);
  }

  getSpaceMeta(input: GetSpaceMetaInput): Promise<SpaceMeta> {
    return rpcGetSpaceMeta(this.env, input);
  }

  getSpaceContract(input: GetSpaceContractInput): Promise<SpaceContract> {
    return rpcGetSpaceContract(this.env, input);
  }

  getSpaceBoard(input: GetSpaceBoardInput): Promise<SpaceBoardResponse> {
    return rpcGetSpaceBoard(this.env, input);
  }

  getSpaceStatus(input: GetSpaceStatusInput): Promise<GetSpaceStatusResponse> {
    return rpcGetSpaceStatus(this.env, input);
  }

  getSpaceConversationState(
    input: GetSpaceConversationStateRpcInput
  ): Promise<GetSpaceConversationStateResponse> {
    return rpcGetSpaceConversationState(this.env, input);
  }

  getSpaceBootstrap(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceBootstrap(this.env, input)
    );
  }

  getSpaceBootstrapWithTiming(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapWithTiming> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceBootstrapWithTiming(this.env, input)
    );
  }

  getSpaceUpdates(
    input: GetSpaceUpdatesInput
  ): Promise<GetSpaceUpdatesResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceUpdates(this.env, input)
    );
  }

  getSpaceDispatchResult(
    input: GetSpaceDispatchResultInput
  ): Promise<DispatchResult> {
    return withLegacySpaceAddressingRpcOutput(
      rpcGetSpaceDispatchResult(this.env, input)
    );
  }

  deleteSpace(input: DeleteSpaceInput): Promise<DeleteSpaceResult> {
    return rpcDeleteSpace(this.env, input);
  }

  updateSpaceMeta(input: UpdateSpaceMetaInput): Promise<SpaceMeta> {
    return rpcUpdateSpaceMeta(this.env, input);
  }

  putSpaceContract(input: PutSpaceContractInput): Promise<SpaceContract> {
    return rpcPutSpaceContract(this.env, input);
  }

  patchSpaceContract(input: PatchSpaceContractInput): Promise<SpaceContract> {
    return rpcPatchSpaceContract(this.env, input);
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
    return rpcUpsertSpacePassword(this.env, input);
  }

  clearSpacePassword(
    input: ClearSpacePasswordInput
  ): Promise<SpacePasswordStateResult> {
    return rpcClearSpacePassword(this.env, input);
  }

  setSpaceAccessMode(
    input: SetSpaceAccessModeInput
  ): Promise<SpaceAccessModeStateResult> {
    return rpcSetSpaceAccessMode(this.env, input);
  }

  getCurrentDeviceTarget(
    input: GetCurrentDeviceTargetInput
  ): Promise<CurrentDeviceTargetResponse> {
    return rpcGetCurrentDeviceTarget(this.env, input);
  }

  forgetCurrentComputer(
    input: GetCurrentDeviceTargetInput
  ): Promise<ForgetCurrentComputerResponse> {
    return rpcForgetCurrentComputer(this.env, input);
  }

  forgetComputer(input: ForgetComputerInput): Promise<ForgetComputerResponse> {
    return rpcForgetComputer(this.env, input);
  }

  getPrepareReadiness(
    input: GetPrepareReadinessInput
  ): Promise<GetPrepareReadinessResponse> {
    return rpcGetPrepareReadiness(this.env, input);
  }

  createPrepareSession(
    input: CreatePrepareSessionInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return rpcCreatePrepareSession(this.env, input);
  }

  getPrepareSession(
    input: GetPrepareSessionInput
  ): Promise<PrepareSessionResponse> {
    return rpcGetPrepareSession(this.env, input);
  }

  mintPrepareSessionReconnectToken(
    input: MintPrepareSessionReconnectTokenInput
  ): Promise<PrepareSessionWithTokenResponse> {
    return rpcMintPrepareSessionReconnectToken(this.env, input);
  }

  resolvePrepareSessionToken(
    input: ResolvePrepareSessionTokenInput
  ): Promise<PrepareSessionResponse> {
    return rpcResolvePrepareSessionToken(this.env, input);
  }

  writePrepareAgentSelection(
    input: WritePrepareAgentSelectionInput
  ): Promise<PrepareSessionResponse> {
    return rpcWritePrepareAgentSelection(this.env, input);
  }

  writePrepareSetupBootstrap(
    input: WritePrepareSetupBootstrapInput
  ): Promise<PrepareSessionResponse> {
    return rpcWritePrepareSetupBootstrap(this.env, input);
  }

  writePrepareTerminalStep(
    input: WritePrepareTerminalStepInput
  ): Promise<PrepareSessionResponse> {
    return rpcWritePrepareTerminalStep(this.env, input);
  }

  getPrepareDiagnostic(
    input: GetPrepareSessionInput
  ): Promise<PrepareDiagnosticResponse> {
    return rpcGetPrepareDiagnostic(this.env, input);
  }
  getAgentProfilePrimaryBinding(
    input: GetAgentProfilePrimaryBindingInput
  ): Promise<GetAgentProfilePrimaryBindingResponse> {
    return rpcGetAgentProfilePrimaryBinding(this.env, input);
  }

  executeAgentProfileWorkRecovery(
    input: ExecuteAgentProfileWorkRecoveryInput
  ): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
    return rpcExecuteAgentProfileWorkRecovery(this.env, input);
  }

  getAgentProfileControllerChangeEligibility(
    input: GetAgentProfileControllerChangeEligibilityInput
  ): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
    return rpcGetAgentProfileControllerChangeEligibility(this.env, input);
  }

  getLocalRuntimeExpectedRoutes(
    input: GetLocalRuntimeExpectedRoutesInput
  ): Promise<GetLocalRuntimeExpectedRoutesResponse> {
    return rpcGetLocalRuntimeExpectedRoutes(this.env, input);
  }

  getAgentExecutionReadiness(
    input: GetAgentExecutionReadinessInput
  ): Promise<GetAgentExecutionReadinessResponse> {
    return rpcGetAgentExecutionReadiness(this.env, input);
  }

  getAgentExecutionReadinessBatch(
    input: GetAgentExecutionReadinessBatchInput
  ): Promise<GetAgentExecutionReadinessBatchResponse> {
    return rpcGetAgentExecutionReadinessBatch(this.env, input);
  }

  ensureAgentProfilePrimaryBinding(
    input: EnsureAgentProfilePrimaryBindingInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return rpcEnsureAgentProfilePrimaryBinding(this.env, input);
  }

  updateAgentProfilePrimaryBindingModelSelection(
    input: UpdateAgentProfilePrimaryBindingModelSelectionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return rpcUpdateAgentProfilePrimaryBindingModelSelection(this.env, input);
  }

  updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
      this.env,
      input
    );
  }

  updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
      this.env,
      input
    );
  }

  updateAgentProfilePrimaryBindingOpenCodePermission(
    input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(
      this.env,
      input
    );
  }

  disableAgentProfilePrimaryBinding(
    input: DisableAgentProfilePrimaryBindingInput
  ): Promise<DisableAgentProfilePrimaryBindingResponse> {
    return rpcDisableAgentProfilePrimaryBinding(this.env, input);
  }

  authorizeAgentProfileBindingForOrganization(
    input: AuthorizeAgentProfileBindingForOrganizationInput
  ): Promise<AuthorizeAgentProfileBindingForOrganizationResponse> {
    return rpcAuthorizeAgentProfileBindingForOrganization(this.env, input);
  }

  bulkAuthorizeAgentProfileBindingsForOrganization(
    input: BulkAuthorizeAgentProfileBindingsForOrganizationInput
  ): Promise<BulkAuthorizeAgentProfileBindingsForOrganizationResponse> {
    return rpcBulkAuthorizeAgentProfileBindingsForOrganization(this.env, input);
  }

  saveOrganizationWakeAccessChoice(
    input: SaveOrganizationWakeAccessChoiceInput
  ): Promise<SaveOrganizationWakeAccessChoiceResponse> {
    return rpcSaveOrganizationWakeAccessChoice(this.env, input);
  }

  listOrganizationBindingAuthorizations(
    input: ListOrganizationBindingAuthorizationsInput
  ): Promise<ListOrganizationBindingAuthorizationsResponse> {
    return rpcListOrganizationBindingAuthorizations(this.env, input);
  }

  listOrganizationBindingAuthorizationProfiles(
    input: ListOrganizationBindingAuthorizationProfilesInput
  ): Promise<ListOrganizationBindingAuthorizationProfilesResponse> {
    return rpcListOrganizationBindingAuthorizationProfiles(this.env, input);
  }

  listCurrentUserAgentProfileOrganizationWakeAccess(
    input: ListCurrentUserAgentProfileOrganizationWakeAccessInput
  ): Promise<ListCurrentUserAgentProfileOrganizationWakeAccessResponse> {
    return rpcListCurrentUserAgentProfileOrganizationWakeAccess(
      this.env,
      input
    );
  }

  revokeAgentProfileBindingForOrganization(
    input: RevokeAgentProfileBindingForOrganizationInput
  ): Promise<RevokeAgentProfileBindingForOrganizationResponse> {
    return rpcRevokeAgentProfileBindingForOrganization(this.env, input);
  }

  getOrganizationBindingAuthorizationPreference(
    input: GetOrganizationBindingAuthorizationPreferenceInput
  ): Promise<GetOrganizationBindingAuthorizationPreferenceResponse> {
    return rpcGetOrganizationBindingAuthorizationPreference(this.env, input);
  }

  getAgentProfileCreationDefaults(
    input: GetAgentProfileCreationDefaultsInput
  ): Promise<GetAgentProfileCreationDefaultsResponse> {
    return rpcGetAgentProfileCreationDefaults(this.env, input);
  }

  setAgentProfileCreationDefaults(
    input: SetAgentProfileCreationDefaultsInput
  ): Promise<SetAgentProfileCreationDefaultsResponse> {
    return rpcSetAgentProfileCreationDefaults(this.env, input);
  }

  setOrganizationBindingAuthorizationPreference(
    input: SetOrganizationBindingAuthorizationPreferenceInput
  ): Promise<SetOrganizationBindingAuthorizationPreferenceResponse> {
    return rpcSetOrganizationBindingAuthorizationPreference(this.env, input);
  }

  createAgentProfileCreationRequest(
    input: CreateAgentProfileCreationRequestRpcInput
  ): Promise<CreateAgentProfileCreationRequestResponse> {
    return rpcCreateAgentProfileCreationRequest(this.env, input);
  }

  listAgentProfileCreationRequests(
    input: ListAgentProfileCreationRequestsRpcInput
  ): Promise<ListAgentProfileCreationRequestsResponse> {
    return rpcListAgentProfileCreationRequests(this.env, input);
  }

  decideAgentProfileCreationRequest(
    input: DecideAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return rpcDecideAgentProfileCreationRequest(this.env, input);
  }

  cancelAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return rpcCancelAgentProfileCreationRequest(this.env, input);
  }

  retryAgentProfileCreationRequest(
    input: MutateAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return rpcRetryAgentProfileCreationRequest(this.env, input);
  }

  getAgentProfileCreationApprovalPreference(
    input: GetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
    return rpcGetAgentProfileCreationApprovalPreference(this.env, input);
  }

  setAgentProfileCreationApprovalPreference(
    input: SetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
    return rpcSetAgentProfileCreationApprovalPreference(this.env, input);
  }

  centerAgentCreateAgentProfileCreationRequest(
    input: CenterAgentCreateAgentProfileCreationRequestRpcInput
  ): Promise<CreateAgentProfileCreationRequestResponse> {
    return rpcCenterAgentCreateAgentProfileCreationRequest(this.env, input);
  }

  centerAgentListAgentProfileCreationRequests(
    input: CenterAgentListAgentProfileCreationRequestsRpcInput
  ): Promise<ListAgentProfileCreationRequestsResponse> {
    return rpcCenterAgentListAgentProfileCreationRequests(this.env, input);
  }

  centerAgentManageAgentProfileCreationRequest(
    input: CenterAgentManageAgentProfileCreationRequestRpcInput
  ): Promise<AgentProfileCreationRequestMutationResponse> {
    return rpcCenterAgentManageAgentProfileCreationRequest(this.env, input);
  }

  centerAgentGetAgentProfileCreationApprovalPreference(
    input: CenterAgentGetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
    return rpcCenterAgentGetAgentProfileCreationApprovalPreference(
      this.env,
      input
    );
  }

  centerAgentSetAgentProfileCreationApprovalPreference(
    input: CenterAgentSetAgentProfileCreationApprovalPreferenceRpcInput
  ): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
    return rpcCenterAgentSetAgentProfileCreationApprovalPreference(
      this.env,
      input
    );
  }

  getCurrentOrganizationDirectory(
    input: GetCurrentOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return rpcGetCurrentOrganizationDirectory(this.env, input);
  }

  recordCurrentOrganizationWebActivity(
    input: RecordCurrentOrganizationWebActivityInput
  ): Promise<OrganizationMemberWebActivityResponse> {
    return rpcRecordCurrentOrganizationWebActivity(this.env, input);
  }

  getCurrentOrganizationComputers(
    input: GetCurrentOrganizationComputersInput
  ): Promise<OrganizationComputersResponse> {
    return rpcGetCurrentOrganizationComputers(this.env, input);
  }

  getCurrentOrganizationMemberOpenMeldServiceStatuses(
    input: GetCurrentOrganizationMemberOpenMeldServiceStatusesInput
  ): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
    return rpcGetCurrentOrganizationMemberOpenMeldServiceStatuses(
      this.env,
      input
    );
  }

  getCurrentOrganizationSpaceDirectory(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return rpcGetCurrentOrganizationSpaceDirectory(this.env, input);
  }

  getCurrentOrganizationSpaceDirectoryWithMemberCounts(
    input: GetCurrentOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
    return rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts(
      this.env,
      input
    );
  }

  joinOrganizationPublicSpace(
    input: JoinOrganizationPublicSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return rpcJoinOrganizationPublicSpace(this.env, input);
  }

  addCenterAgentToSpace(
    input: AddCenterAgentToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return rpcAddCenterAgentToSpace(this.env, input);
  }

  addOrganizationDirectoryProfilesToSpace(
    input: AddOrganizationDirectoryProfilesToSpaceInput
  ): Promise<PostSpaceMembersResponse> {
    return rpcAddOrganizationDirectoryProfilesToSpace(this.env, input);
  }

  beginCurrentMemberConnectorAuthorization(
    input: BeginCurrentMemberConnectorAuthorizationInput
  ): Promise<ConnectorConnection> {
    return rpcBeginCurrentMemberConnectorAuthorization(this.env, input);
  }

  beginCurrentOrganizationSharedConnectorAuthorization(
    input: BeginCurrentOrganizationSharedConnectorAuthorizationInput
  ): Promise<ConnectorConnection> {
    return rpcBeginCurrentOrganizationSharedConnectorAuthorization(
      this.env,
      input
    );
  }

  beginCurrentOrganizationGitHubAppInstallation(
    input: BeginCurrentOrganizationGitHubAppInstallationInput
  ): Promise<GitHubAppInstallationStartResponse> {
    return rpcBeginCurrentOrganizationGitHubAppInstallation(this.env, input);
  }

  beginGitHubAppInstallationVerification(
    input: BeginGitHubAppInstallationVerificationInput
  ): Promise<GitHubAppInstallationVerificationResponse> {
    return rpcBeginGitHubAppInstallationVerification(this.env, input);
  }

  readPendingGitHubAppInstallation(
    input: ReadPendingGitHubAppInstallationInput
  ): Promise<PendingGitHubAppInstallation> {
    return rpcReadPendingGitHubAppInstallation(this.env, input);
  }

  completeGitHubAppInstallation(
    input: CompleteGitHubAppInstallationInput
  ): Promise<boolean> {
    return rpcCompleteGitHubAppInstallation(this.env, input);
  }

  listCurrentOrganizationConnectorConnections(
    input: ListCurrentOrganizationConnectorConnectionsInput
  ): Promise<ConnectorConnectionListResponse> {
    return rpcListCurrentOrganizationConnectorConnections(this.env, input);
  }

  listCurrentOrganizationConnectorAppRequests(
    input: ListCurrentOrganizationConnectorAppRequestsInput
  ): Promise<ConnectorAppRequestListResponse> {
    return rpcListCurrentOrganizationConnectorAppRequests(this.env, input);
  }

  createCurrentOrganizationConnectorAppRequest(
    input: CreateCurrentOrganizationConnectorAppRequestInput
  ): Promise<ConnectorAppRequestResponse> {
    return rpcCreateCurrentOrganizationConnectorAppRequest(this.env, input);
  }

  reconcileCurrentOrganizationConnectorConnections(
    input: ReconcileCurrentOrganizationConnectorConnectionsInput
  ): Promise<ConnectorConnectionListResponse> {
    return rpcReconcileCurrentOrganizationConnectorConnections(this.env, input);
  }

  authorizeConnectorDisconnect(
    input: AuthorizeConnectorDisconnectInput
  ): Promise<ConnectorConnection> {
    return rpcAuthorizeConnectorDisconnect(this.env, input);
  }

  completeConnectorDisconnect(
    input: CompleteConnectorDisconnectInput
  ): Promise<ConnectorConnection> {
    return rpcCompleteConnectorDisconnect(this.env, input);
  }

  centerAgentResolveConnectorConnection(
    input: CenterAgentResolveConnectorConnectionInput
  ): Promise<CenterAgentConnectorConnectionSelection> {
    return rpcCenterAgentResolveConnectorConnection(this.env, input);
  }

  getCenterAgentDesignation(
    input: GetCenterAgentDesignationInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return rpcGetCenterAgentDesignation(this.env, input);
  }

  getCenterAgentModel(
    input: GetCenterAgentModelInput
  ): Promise<CenterAgentModelConfigurationResponse> {
    return rpcGetCenterAgentModel(this.env, input);
  }

  updateCenterAgentModel(
    input: UpdateCenterAgentModelInput
  ): Promise<UpdateCenterAgentModelResponse> {
    return rpcUpdateCenterAgentModel(this.env, input);
  }

  listMessageChannelConnections(
    input: ListMessageChannelConnectionsInput
  ): Promise<MessageChannelConnectionListResponse> {
    return rpcListMessageChannelConnections(this.env, input);
  }

  requestMessageChannelSetup(
    input: RequestMessageChannelSetupInput
  ): Promise<MessageChannelSetupRequestResponse> {
    return rpcRequestMessageChannelSetup(this.env, input);
  }

  listActiveLarkPlatformRegistrations(
    input: ListActiveLarkPlatformRegistrationsInput
  ): Promise<LarkPlatformActiveRegistrationListResponse> {
    return rpcListActiveLarkPlatformRegistrations(this.env, input);
  }

  previewMessageChannelIdentityLink(
    input: PreviewMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkPreviewResponse> {
    return rpcPreviewMessageChannelIdentityLink(this.env, input);
  }

  consumeMessageChannelIdentityLink(
    input: ConsumeMessageChannelIdentityLinkInput
  ): Promise<MessageChannelIdentityLinkConsumeResponse> {
    return rpcConsumeMessageChannelIdentityLink(this.env, input);
  }

  beginLarkPlatformRegistration(
    input: BeginLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return rpcBeginLarkPlatformRegistration(this.env, input);
  }

  pollLarkPlatformRegistration(
    input: PollLarkPlatformRegistrationInput
  ): Promise<LarkPlatformRegistrationResponse> {
    return rpcPollLarkPlatformRegistration(this.env, input);
  }

  disconnectLarkPlatformRegistration(
    input: DisconnectLarkPlatformRegistrationInput
  ): Promise<MessageChannelConnectionListResponse> {
    return rpcDisconnectLarkPlatformRegistration(this.env, input);
  }

  disconnectMessageChannelIdentityLink(
    input: DisconnectMessageChannelIdentityLinkInput
  ): Promise<MessageChannelConnectionListResponse> {
    return rpcDisconnectMessageChannelIdentityLink(this.env, input);
  }

  getCenterAgentDirectMessageSpaceProjection(
    input: GetCenterAgentDirectMessageSpaceProjectionInput
  ): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
    return rpcGetCenterAgentDirectMessageSpaceProjection(this.env, input);
  }

  createCenterAgentContextManifest(
    input: CreateCenterAgentContextManifestInput
  ): Promise<CreateCenterAgentContextManifestResponse> {
    return rpcCreateCenterAgentContextManifest(this.env, input);
  }

  createCenterAgentContextLoadReceipt(
    input: CreateCenterAgentContextLoadReceiptInput
  ): Promise<CreateCenterAgentContextLoadReceiptResponse> {
    return rpcCreateCenterAgentContextLoadReceipt(this.env, input);
  }

  getCenterAgentOperatingState(
    input: GetCenterAgentOperatingStateInput
  ): Promise<GetCenterAgentOperatingStateResponse> {
    return rpcGetCenterAgentOperatingState(this.env, input);
  }

  designateCenterAgent(
    input: DesignateCenterAgentInput
  ): Promise<DesignateCenterAgentResponse> {
    return rpcDesignateCenterAgent(this.env, input);
  }

  updateCenterAgentProfile(
    input: UpdateCenterAgentProfileInput
  ): Promise<CenterAgentUpdateProfileResponse> {
    return rpcUpdateCenterAgentProfile(this.env, input);
  }

  updateCenterAgentOperatingState(
    input: UpdateCenterAgentOperatingStateInput
  ): Promise<UpdateCenterAgentOperatingStateResponse> {
    return rpcUpdateCenterAgentOperatingState(this.env, input);
  }

  connectCenterAgentSlackWorkspace(
    input: ConnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceConnectionResponse> {
    return rpcConnectCenterAgentSlackWorkspace(this.env, input);
  }

  createSlackOAuthState(
    input: CreateSlackOAuthStateInput
  ): Promise<SlackOAuthStateCreateResponse> {
    return rpcCreateSlackOAuthState(this.env, input);
  }

  consumeSlackOAuthState(
    input: ConsumeSlackOAuthStateInput
  ): Promise<SlackOAuthStateConsumeResponse> {
    return rpcConsumeSlackOAuthState(this.env, input);
  }

  installSlackWorkspaceFromOAuth(
    input: InstallSlackWorkspaceFromOAuthInput
  ): Promise<SlackOAuthInstallationResult> {
    return rpcInstallSlackWorkspaceFromOAuth(this.env, input);
  }

  issueSlackIdentityLinkFromOAuth(
    input: IssueSlackIdentityLinkFromOAuthInput
  ): Promise<SlackOAuthIdentityLinkResult> {
    return rpcIssueSlackIdentityLinkFromOAuth(this.env, input);
  }

  disconnectCenterAgentSlackWorkspace(
    input: DisconnectCenterAgentSlackWorkspaceInput
  ): Promise<CenterAgentSlackWorkspaceDisconnectResponse> {
    return rpcDisconnectCenterAgentSlackWorkspace(this.env, input);
  }

  previewSlackIdentityLink(
    input: PreviewSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkPreviewResponse> {
    return rpcPreviewSlackIdentityLink(this.env, input);
  }

  consumeSlackIdentityLink(
    input: ConsumeSlackIdentityLinkInput
  ): Promise<SlackIdentityLinkConsumeResponse> {
    return rpcConsumeSlackIdentityLink(this.env, input);
  }

  assertCurrentDesignatedCenterAgent(
    input: AssertCurrentDesignatedCenterAgentInput
  ): Promise<GetCenterAgentDesignationResponse> {
    return rpcAssertCurrentDesignatedCenterAgent(this.env, input);
  }

  recordCenterAgentAudit(
    input: RecordCenterAgentAuditInput
  ): Promise<CenterAgentAttribution> {
    return rpcRecordCenterAgentAudit(this.env, input);
  }

  listCenterAgentAuditJournal(
    input: ListCenterAgentAuditJournalInput
  ): Promise<ListCenterAgentAuditJournalResponse> {
    return rpcListCenterAgentAuditJournal(this.env, input);
  }

  readCenterAgentOrganizationMemoryPolicy(
    input: ReadCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return rpcReadCenterAgentOrganizationMemoryPolicy(this.env, input);
  }

  setCenterAgentOrganizationMemoryPolicy(
    input: SetCenterAgentOrganizationMemoryPolicyInput
  ): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
    return rpcSetCenterAgentOrganizationMemoryPolicy(this.env, input);
  }

  readOrganizationInformationProtectionPolicy(
    input: ReadOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return rpcReadOrganizationInformationProtectionPolicy(this.env, input);
  }

  setOrganizationInformationProtectionPolicy(
    input: SetOrganizationInformationProtectionPolicyInput
  ): Promise<OrganizationInformationProtectionPolicyResponse> {
    return rpcSetOrganizationInformationProtectionPolicy(this.env, input);
  }

  readCurrentOrganizationFeedbackReportingPolicy(
    input: ReadCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return rpcReadCurrentOrganizationFeedbackReportingPolicy(this.env, input);
  }

  setCurrentOrganizationFeedbackReportingPolicy(
    input: SetCurrentOrganizationFeedbackReportingPolicyInput
  ): Promise<FeedbackReportingPolicyResponse> {
    return rpcSetCurrentOrganizationFeedbackReportingPolicy(this.env, input);
  }

  wipeCurrentMemberCenterAgentMemory(
    input: WipeCurrentMemberCenterAgentMemoryInput
  ): Promise<CenterAgentWipeMemberMemoryResponse> {
    return rpcWipeCurrentMemberCenterAgentMemory(this.env, input);
  }

  centerAgentRememberForOrganization(
    input: CenterAgentRememberForOrganizationInput
  ): Promise<CenterAgentRememberForOrganizationResponse> {
    return rpcCenterAgentRememberForOrganization(this.env, input);
  }

  centerAgentRequestMemberAttention(
    input: CenterAgentRequestMemberAttentionRpcInput
  ): Promise<CenterAgentRequestMemberAttentionResponse> {
    return rpcCenterAgentRequestMemberAttention(this.env, input);
  }

  centerAgentListLocalAgentConnectionCandidates(
    input: CenterAgentListLocalAgentConnectionCandidatesInput
  ): Promise<CenterAgentListLocalAgentConnectionCandidatesResponse> {
    return rpcCenterAgentListLocalAgentConnectionCandidates(this.env, input);
  }

  centerAgentListAgentProfileCreationDefaults(
    input: CenterAgentListAgentProfileCreationDefaultsInput
  ): Promise<CenterAgentListAgentProfileCreationDefaultsResponse> {
    return rpcCenterAgentListAgentProfileCreationDefaults(this.env, input);
  }

  centerAgentListComputers(
    input: CenterAgentListComputersInput
  ): Promise<CenterAgentListComputersResponse> {
    return rpcCenterAgentListComputers(this.env, input);
  }

  centerAgentRequestOpenMeldToolsUpdate(
    input: CenterAgentRequestOpenMeldToolsUpdateInput
  ): Promise<CenterAgentRequestOpenMeldToolsUpdateResponse> {
    return rpcCenterAgentRequestOpenMeldToolsUpdate(this.env, input);
  }

  centerAgentSetOpenMeldToolsMaintenance(
    input: CenterAgentSetOpenMeldToolsMaintenanceInput
  ): Promise<CenterAgentSetOpenMeldToolsMaintenanceResponse> {
    return rpcCenterAgentSetOpenMeldToolsMaintenance(this.env, input);
  }

  centerAgentListLocalAgentInstallations(
    input: CenterAgentListLocalAgentInstallationsInput
  ): Promise<CenterAgentListLocalAgentInstallationsResponse> {
    return rpcCenterAgentListLocalAgentInstallations(this.env, input);
  }

  centerAgentSelectLocalAgentInstallation(
    input: CenterAgentSelectLocalAgentInstallationInput
  ): Promise<CenterAgentSelectLocalAgentInstallationResponse> {
    return rpcCenterAgentSelectLocalAgentInstallation(this.env, input);
  }

  centerAgentConnectAgentProfileToLocalAgent(
    input: CenterAgentConnectAgentProfileToLocalAgentInput
  ): Promise<CenterAgentConnectAgentProfileToLocalAgentResponse> {
    return rpcCenterAgentConnectAgentProfileToLocalAgent(this.env, input);
  }

  centerAgentUpdateAgentProfileRuntimeSettings(
    input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
  ): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
    return rpcCenterAgentUpdateAgentProfileRuntimeSettings(this.env, input);
  }

  centerAgentCheckAgentProfileReadiness(
    input: CenterAgentCheckAgentProfileReadinessInput
  ): Promise<CenterAgentCheckAgentProfileReadinessResponse> {
    return rpcCenterAgentCheckAgentProfileReadiness(this.env, input);
  }

  centerAgentCreateConfiguredAgentProfile(
    input: CenterAgentCreateConfiguredAgentProfileInput
  ): Promise<CenterAgentCreateConfiguredAgentProfileResponse> {
    return rpcCenterAgentCreateConfiguredAgentProfile(this.env, input);
  }

  completeRemoteAgentSubmission(
    input: RemoteAgentCoreCallbackEvent
  ): Promise<RemoteAgentCoreCallbackResponse> {
    const db = localStateDb(this.env);
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
    const db = localStateDb(this.env);
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
    });
  }

  submitRemoteAgentStreamDelta(
    input: RemoteAgentStreamDeltaCallbackBody
  ): Promise<RemoteAgentStreamDeltaCallbackResponse> {
    return submitRemoteAgentStreamDelta(this.env, input);
  }

  submitRemoteAgentStreamPart(
    input: RemoteAgentStreamPartCallbackBody
  ): Promise<RemoteAgentStreamDeltaCallbackResponse> {
    return submitRemoteAgentStreamPart(this.env, input);
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
    return processRemoteAgentSlackEvent(this.env, input);
  }

  submitFeedbackIssue(
    input: FeedbackIssueSubmitRpcRequest
  ): Promise<SubmitFeedbackIssueResponse> {
    return rpcSubmitFeedbackIssue(this.env, input);
  }

  listFeedbackIssuesForOrganization(
    input: ListFeedbackIssuesForOrganizationRequest
  ): Promise<ListFeedbackIssuesForOrganizationResponse> {
    return rpcListFeedbackIssuesForOrganization(this.env, input);
  }

  updateFeedbackIssueStatusForOrganization(
    input: UpdateFeedbackIssueStatusForOrganizationRequest
  ): Promise<FeedbackIssueRecord> {
    return rpcUpdateFeedbackIssueStatusForOrganization(this.env, input);
  }

  readFeedbackReportingPolicy(
    input: ReadFeedbackReportingPolicyRequest
  ): Promise<FeedbackReportingPolicyResponse> {
    return rpcReadFeedbackReportingPolicy(this.env, input);
  }

  centerAgentCreateSpace(
    input: CenterAgentCreateSpaceInput
  ): Promise<CenterAgentCreateSpaceResponse> {
    return rpcCenterAgentCreateSpace(this.env, input);
  }

  centerAgentCreateAgentProfile(
    input: CenterAgentCreateAgentProfileInput
  ): Promise<CenterAgentCreateAgentProfileResponse> {
    return rpcCenterAgentCreateAgentProfile(this.env, input);
  }

  centerAgentEnableAgentProfile(
    input: CenterAgentEnableAgentProfileInput
  ): Promise<CenterAgentEnableAgentProfileResponse> {
    return rpcCenterAgentEnableAgentProfile(this.env, input);
  }

  centerAgentAddAgentProfilesToSpace(
    input: CenterAgentAddAgentProfilesToSpaceInput
  ): Promise<CenterAgentAddAgentProfilesToSpaceResponse> {
    return rpcCenterAgentAddAgentProfilesToSpace(this.env, input);
  }

  centerAgentAddMembersToSpace(
    input: CenterAgentAddMembersToSpaceInput
  ): Promise<CenterAgentAddMembersToSpaceResponse> {
    return rpcCenterAgentAddMembersToSpace(this.env, input);
  }

  centerAgentRemoveAgentProfilesFromSpace(
    input: CenterAgentRemoveAgentProfilesFromSpaceInput
  ): Promise<CenterAgentRemoveAgentProfilesFromSpaceResponse> {
    return rpcCenterAgentRemoveAgentProfilesFromSpace(this.env, input);
  }

  centerAgentGetOrganizationDirectory(
    input: CenterAgentReadOrganizationDirectoryInput
  ): Promise<OrganizationDirectoryResponse> {
    return rpcCenterAgentGetOrganizationDirectory(this.env, input);
  }

  centerAgentReadMemberComputers(
    input: CenterAgentReadMemberComputersInput
  ): Promise<CenterAgentReadMemberComputersResponse> {
    return rpcCenterAgentReadMemberComputers(this.env, input);
  }

  centerAgentReadMemberOpenMeldServiceStatus(
    input: CenterAgentReadMemberOpenMeldServiceStatusInput
  ): Promise<CenterAgentReadMemberOpenMeldServiceStatusResponse> {
    return rpcCenterAgentReadMemberOpenMeldServiceStatus(this.env, input);
  }

  centerAgentReadSlackWorkspaceDirectory(
    input: CenterAgentReadSlackWorkspaceDirectoryInput
  ): Promise<CenterAgentReadSlackWorkspaceDirectoryResponse> {
    return rpcCenterAgentReadSlackWorkspaceDirectory(this.env, input);
  }

  centerAgentListSlackChannels(
    input: CenterAgentListSlackChannelsInput
  ): Promise<CenterAgentListSlackChannelsResponse> {
    return rpcCenterAgentListSlackChannels(this.env, input);
  }

  centerAgentReadSlackChannelMembers(
    input: CenterAgentReadSlackChannelMembersInput
  ): Promise<CenterAgentReadSlackChannelMembersResponse> {
    return rpcCenterAgentReadSlackChannelMembers(this.env, input);
  }

  centerAgentReadSlackChannelHistory(
    input: CenterAgentReadSlackChannelHistoryInput
  ): Promise<CenterAgentReadSlackChannelHistoryResponse> {
    return rpcCenterAgentReadSlackChannelHistory(this.env, input);
  }

  centerAgentReadSlackFile(
    input: CenterAgentReadSlackFileInput
  ): Promise<CenterAgentReadSlackFileResponse> {
    return rpcCenterAgentReadSlackFile(this.env, input);
  }

  centerAgentSearchSlackMessages(
    input: CenterAgentSearchSlackMessagesInput
  ): Promise<CenterAgentSearchSlackMessagesResponse> {
    return rpcCenterAgentSearchSlackMessages(this.env, input);
  }

  centerAgentGetOrganizationSpaceDirectory(
    input: CenterAgentReadOrganizationSpaceDirectoryInput
  ): Promise<OrganizationSpaceDirectoryResponse> {
    return rpcCenterAgentGetOrganizationSpaceDirectory(this.env, input);
  }

  centerAgentReadSpaceContext(
    input: CenterAgentReadSpaceContextInput
  ): Promise<CenterAgentReadSpaceContextResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcCenterAgentReadSpaceContext(this.env, input)
    );
  }

  centerAgentListSpaceFiles(
    input: CenterAgentListSpaceFilesRpcInput
  ): Promise<CenterAgentListSpaceFilesResponse> {
    return rpcCenterAgentListSpaceFiles(this.env, input);
  }

  centerAgentReadSpaceFile(
    input: CenterAgentReadSpaceFileRpcInput
  ): Promise<CenterAgentReadSpaceFileResponse> {
    return rpcCenterAgentReadSpaceFile(this.env, input);
  }

  centerAgentSaveSpaceFile(
    input: CenterAgentSaveSpaceFileRpcInput
  ): Promise<CenterAgentSaveSpaceFileResponse> {
    return rpcCenterAgentSaveSpaceFile(this.env, input);
  }

  centerAgentManageSpaceFiles(
    input: CenterAgentManageSpaceFilesRpcInput
  ): Promise<CenterAgentManageSpaceFilesResponse> {
    return rpcCenterAgentManageSpaceFiles(this.env, input);
  }

  centerAgentReadDispatchHistory(
    input: CenterAgentReadDispatchHistoryInput
  ): Promise<CenterAgentReadDispatchHistoryResponse> {
    return rpcCenterAgentReadDispatchHistory(this.env, input);
  }

  centerAgentPostSpaceMessage(
    input: CenterAgentPostSpaceMessageInput
  ): Promise<CenterAgentPostSpaceMessageResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcCenterAgentPostSpaceMessage(this.env, input)
    );
  }

  centerAgentReadSpaceAuthoringContract(
    input: CenterAgentReadSpaceAuthoringContractInput
  ): Promise<CenterAgentSpaceAuthoringContractResponse> {
    return rpcCenterAgentReadSpaceAuthoringContract(this.env, input);
  }

  centerAgentPostSlackChannelMessage(
    input: CenterAgentPostSlackChannelMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return rpcCenterAgentPostSlackChannelMessage(this.env, input);
  }

  centerAgentPostSlackFile(
    input: CenterAgentPostSlackFileInput
  ): Promise<CenterAgentPostSlackFileResponse> {
    return rpcCenterAgentPostSlackFile(this.env, input);
  }

  centerAgentPostSlackThreadMessage(
    input: CenterAgentPostSlackThreadMessageInput
  ): Promise<CenterAgentPostSlackChannelMessageResponse> {
    return rpcCenterAgentPostSlackThreadMessage(this.env, input);
  }

  centerAgentRecordConnectorActionAudit(
    input: CenterAgentRecordConnectorActionAuditInput
  ): Promise<CenterAgentRecordConnectorActionAuditResponse> {
    return rpcCenterAgentRecordConnectorActionAudit(this.env, input);
  }

  centerAgentReadConnectorActionOperation(
    input: CenterAgentReadConnectorActionOperationInput
  ): Promise<CenterAgentReadConnectorActionOperationResponse> {
    return rpcCenterAgentReadConnectorActionOperation(this.env, input);
  }

  centerAgentRecordConnectorActionOperation(
    input: CenterAgentRecordConnectorActionOperationInput
  ): Promise<CenterAgentRecordConnectorActionOperationResponse> {
    return rpcCenterAgentRecordConnectorActionOperation(this.env, input);
  }

  centerAgentWakeAgentProfilesInSpace(
    input: CenterAgentWakeAgentProfilesInSpaceInput
  ): Promise<CenterAgentWakeAgentProfilesInSpaceResponse> {
    return withLegacySpaceAddressingRpcOutput(
      rpcCenterAgentWakeAgentProfilesInSpace(this.env, input)
    );
  }

  centerAgentListAgentTasks(
    input: CenterAgentListAgentTasksInput
  ): Promise<CenterAgentListAgentTasksResponse> {
    return rpcCenterAgentListAgentTasks(this.env, input);
  }

  centerAgentWatchAgentTask(
    input: CenterAgentWatchAgentTaskInput
  ): Promise<CenterAgentWatchAgentTaskResponse> {
    return rpcCenterAgentWatchAgentTask(this.env, input);
  }

  centerAgentUpdateSpaceSettings(
    input: CenterAgentUpdateSpaceSettingsInput
  ): Promise<CenterAgentUpdateSpaceSettingsResponse> {
    return rpcCenterAgentUpdateSpaceSettings(this.env, input);
  }

  openCenterAgentDirectMessageSpace(
    input: OpenCenterAgentDirectMessageSpaceInput
  ): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
    return rpcOpenCenterAgentDirectMessageSpace(this.env, input);
  }

  openDirectMessageSpace(
    input: OpenDirectMessageSpaceInput
  ): Promise<OpenDirectMessageSpaceResponse> {
    return rpcOpenDirectMessageSpace(this.env, input);
  }

  convertDirectMessageToSpace(
    input: ConvertDirectMessageToSpaceInput
  ): Promise<ConvertDirectMessageToSpaceResponse> {
    return rpcConvertDirectMessageToSpace(this.env, input);
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
    return rpcSubmitRuntimeRegistration(this.env, input);
  }

  submitRuntimeAgentControllerReports(
    input: SubmitRuntimeAgentControllerReportsInput
  ): Promise<SubmitRuntimeAgentControllerReportsResponse> {
    return rpcSubmitRuntimeAgentControllerReports(this.env, input);
  }

  submitRuntimeProviderConversationProofs(
    input: SubmitRuntimeProviderConversationProofsInput
  ): Promise<SubmitRuntimeProviderConversationProofsResponse> {
    return rpcSubmitRuntimeProviderConversationProofs(this.env, input);
  }

  listLocalRuntimes(
    input: GetLocalRuntimesInput
  ): Promise<LocalRuntimesResponse> {
    return rpcListLocalRuntimes(this.env, input);
  }

  getCurrentLocalRuntimeReplyReadiness(
    input: GetCurrentLocalRuntimeReplyReadinessInput
  ): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
    return rpcGetCurrentLocalRuntimeReplyReadiness(this.env, input);
  }

  setCurrentLocalAgentEnabled(
    input: SetCurrentLocalAgentEnabledInput
  ): Promise<SetCurrentLocalAgentEnabledResponse> {
    return rpcSetCurrentLocalAgentEnabled(this.env, input);
  }

  getCurrentLocalAgentInstallations(
    input: GetCurrentLocalAgentInstallationsInput
  ): Promise<CurrentLocalAgentInstallationsResponse> {
    return rpcGetCurrentLocalAgentInstallations(this.env, input);
  }

  selectCurrentLocalAgentInstallation(
    input: SelectCurrentLocalAgentInstallationInput
  ): Promise<SelectCurrentLocalAgentInstallationResponse> {
    return rpcSelectCurrentLocalAgentInstallation(this.env, input);
  }

  requestCurrentOpenMeldToolsUpdate(
    input: RequestCurrentOpenMeldToolsUpdateInput
  ): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
    return rpcRequestCurrentOpenMeldToolsUpdate(this.env, input);
  }

  setCurrentOpenMeldToolsMaintenance(
    input: SetCurrentOpenMeldToolsMaintenanceInput
  ): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
    return rpcSetCurrentOpenMeldToolsMaintenance(this.env, input);
  }

  setCurrentAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput
  ): Promise<SetCurrentAgentProfileWorkspaceResponse> {
    return rpcSetCurrentAgentProfileWorkspace(this.env, input);
  }

  refreshCurrentLocalAgentCatalog(
    input: RefreshCurrentLocalAgentCatalogInput
  ): Promise<RefreshCurrentLocalAgentCatalogResponse> {
    return rpcRefreshCurrentLocalAgentCatalog(this.env, input);
  }

  setLocalRuntimeDisplayName(
    input: SetLocalRuntimeDisplayNameInput
  ): Promise<LocalRuntimesResponse> {
    return rpcSetLocalRuntimeDisplayName(this.env, input);
  }

  writeCurrentDeviceObservedMetadata(
    input: WriteCurrentDeviceObservedMetadataInput
  ): Promise<WriteCurrentDeviceObservedMetadataResponse> {
    return rpcWriteCurrentDeviceObservedMetadata(this.env, input);
  }

  enrollLocalRuntime(
    input: EnrollLocalRuntimeInput
  ): Promise<LocalRuntimeEnrollmentResponse> {
    return rpcEnrollLocalRuntime(this.env, input);
  }
}

// Gateway-specific RPC entrypoint. Kept as a dedicated subclass to preserve an
// extension point for future gateway-aware overrides.
export class GatewayRpcEntrypoint extends CoreRpcEntrypoint {
  handleSlackWelcomeInteraction(
    input: SlackWelcomeInteractionRpcInput
  ): Promise<SlackWelcomeInteractionRpcResponse> {
    return handleSlackWelcomeInteraction(this.env, input);
  }

  async runLocalRoutineSchedulerTick(): Promise<{
    ok: true;
    ranAtMs: number;
  }> {
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
  }

  createSpace(input?: CreateSpaceInput) {
    return super.createSpace(input);
  }

  getModelCatalog(): GetModelCatalogResponse {
    return super.getModelCatalog();
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

  createProject(input: CreateProjectInput) {
    return super.createProject(input);
  }

  updateProject(input: UpdateProjectInput) {
    return super.updateProject(input);
  }

  updateAgentProfileDefaultProject(
    input: UpdateAgentProfileDefaultProjectInput
  ) {
    return super.updateAgentProfileDefaultProject(input);
  }

  archiveProject(input: ArchiveProjectInput) {
    return super.archiveProject(input);
  }

  discoverProjects(input: DiscoverProjectsInput) {
    return super.discoverProjects(input);
  }

  readComputerFileAccessPolicy(input: ReadComputerFileAccessPolicyInput) {
    return super.readComputerFileAccessPolicy(input);
  }

  selectLocalFolders(input: SelectLocalFoldersInput) {
    return super.selectLocalFolders(input);
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

  listCenterAgentTasks(
    input: ListCenterAgentTasksRpcInput
  ): Promise<ListCenterAgentTasksRpcResponse> {
    return super.listCenterAgentTasks(input);
  }

  getCenterAgentTask(
    input: GetCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.getCenterAgentTask(input);
  }

  continueCenterAgentTask(
    input: ContinueCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.continueCenterAgentTask(input);
  }

  stopCenterAgentTask(
    input: StopCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.stopCenterAgentTask(input);
  }

  retryCenterAgentTask(
    input: RetryCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.retryCenterAgentTask(input);
  }

  listInboxItems(
    input: ListInboxItemsRpcInput
  ): Promise<ListInboxItemsResponse> {
    return super.listInboxItems(input);
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

  previewOrganizationSkillFromGitHub(
    input: PreviewOrganizationSkillFromGitHubRpcInput
  ): Promise<PreviewOrganizationSkillFromGitHubResponse> {
    return super.previewOrganizationSkillFromGitHub(input);
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

  listSignals(input: ListSignalsInput): Promise<ListSignalsResult> {
    return super.listSignals(input);
  }

  postSignal(input: PostSignalInput): Promise<SignalEnvelope> {
    return super.postSignal(input);
  }

  postTransientSignal(input: PostTransientSignalInput): Promise<void> {
    return super.postTransientSignal(input);
  }

  getSpaceMembers(input: GetSpaceMembersInput): Promise<SpaceMembersSnapshot> {
    return super.getSpaceMembers(input);
  }

  getSpaceIdentityDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceIdentityDirectory> {
    return super.getSpaceIdentityDirectory(input);
  }

  getSpaceMemberDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceMemberDirectory> {
    return super.getSpaceMemberDirectory(input);
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

  listSpaceFiles(input: ListSpaceFilesInput): Promise<ListSpaceFilesResponse> {
    return super.listSpaceFiles(input);
  }

  getSpaceFile(input: GetSpaceFileInput): Promise<SpaceFileDescriptor> {
    return super.getSpaceFile(input);
  }

  listSpaceFileRevisions(
    input: GetSpaceFileInput
  ): Promise<ListSpaceFileRevisionsResponse> {
    return super.listSpaceFileRevisions(input);
  }

  createSpaceFolder(
    input: CreateSpaceFolderInput
  ): Promise<CreateSpaceFolderResponse> {
    return super.createSpaceFolder(input);
  }

  updateSpaceFileEntry(
    input: UpdateSpaceFileEntryInput
  ): Promise<UpdateSpaceFileEntryResponse> {
    return super.updateSpaceFileEntry(input);
  }

  trashSpaceFileEntry(
    input: TrashSpaceFileEntryInput
  ): Promise<TrashSpaceFileEntryResponse> {
    return super.trashSpaceFileEntry(input);
  }

  restoreSpaceFileEntry(
    input: RestoreSpaceFileEntryInput
  ): Promise<RestoreSpaceFileEntryResponse> {
    return super.restoreSpaceFileEntry(input);
  }

  restoreSpaceFileRevision(
    input: RestoreSpaceFileRevisionInput
  ): Promise<SpaceFileDescriptor> {
    return super.restoreSpaceFileRevision(input);
  }

  prepareSpaceFileWrite(
    input: SpaceFileWriteInput
  ): Promise<PrepareSpaceFileWriteResponse> {
    return super.prepareSpaceFileWrite(input);
  }

  commitSpaceFileWrite(
    input: SpaceFileWriteInput
  ): Promise<SpaceFileDescriptor> {
    return super.commitSpaceFileWrite(input);
  }

  resolveSpaceFileContent(
    input: ResolveSpaceFileContentRpcInput
  ): Promise<ResolveSpaceFileContentResponse> {
    return super.resolveSpaceFileContent(input);
  }

  listSpaceThreads(
    input: ListSpaceThreadsInput
  ): Promise<ListSpaceThreadsResponse> {
    return super.listSpaceThreads(input);
  }

  getSpaceThread(input: GetSpaceThreadInput): Promise<GetSpaceThreadResponse> {
    return super.getSpaceThread(input);
  }

  listSpaceThreadEvents(
    input: ListSpaceThreadEventsInput
  ): Promise<ListSpaceThreadEventsResponse> {
    return super.listSpaceThreadEvents(input);
  }

  listSpaceThreadSignals(
    input: ListSpaceThreadSignalsInput
  ): Promise<ListSpaceThreadSignalsResponse> {
    return super.listSpaceThreadSignals(input);
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
    input: RespondToSpaceAgentInteractionInput
  ): Promise<RespondToSpaceAgentInteractionResponse> {
    return super.respondToSpaceAgentInteraction(input);
  }

  getSpaceWakeTraceWaterfall(
    input: GetSpaceWakeTraceWaterfallInput
  ): Promise<GetSpaceWakeTraceWaterfallResponse> {
    return super.getSpaceWakeTraceWaterfall(input);
  }

  getSpaceMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse> {
    return super.getSpaceMessageDetails(input);
  }

  createSpaceDiagnosticReport(
    input: CreateSpaceDiagnosticReportInput
  ): Promise<CreateSpaceDiagnosticReportResponse> {
    return super.createSpaceDiagnosticReport(input);
  }

  addSpaceMembers(
    input: AddSpaceMembersInput
  ): Promise<PostSpaceMembersResponse> {
    return super.addSpaceMembers(input);
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

  getSpaceContract(input: GetSpaceContractInput): Promise<SpaceContract> {
    return super.getSpaceContract(input);
  }

  getSpaceBoard(input: GetSpaceBoardInput): Promise<SpaceBoardResponse> {
    return super.getSpaceBoard(input);
  }

  getSpaceStatus(input: GetSpaceStatusInput): Promise<GetSpaceStatusResponse> {
    return super.getSpaceStatus(input);
  }

  getSpaceConversationState(
    input: GetSpaceConversationStateRpcInput
  ): Promise<GetSpaceConversationStateResponse> {
    return super.getSpaceConversationState(input);
  }

  getSpaceBootstrap(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapResponse> {
    return super.getSpaceBootstrap(input);
  }

  getSpaceBootstrapWithTiming(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapWithTiming> {
    return super.getSpaceBootstrapWithTiming(input);
  }

  inspectDispatchStorageReadiness(): Promise<DispatchStorageReadiness> {
    return super.inspectDispatchStorageReadiness();
  }

  getSpaceUpdates(
    input: GetSpaceUpdatesInput
  ): Promise<GetSpaceUpdatesResponse> {
    return super.getSpaceUpdates(input);
  }

  getSpaceDispatchResult(
    input: GetSpaceDispatchResultInput
  ): Promise<DispatchResult> {
    return super.getSpaceDispatchResult(input);
  }

  deleteSpace(input: DeleteSpaceInput): Promise<DeleteSpaceResult> {
    return super.deleteSpace(input);
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

  listLocalRuntimes(
    input: GetLocalRuntimesInput
  ): Promise<LocalRuntimesResponse> {
    return super.listLocalRuntimes(input);
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

  setCurrentAgentProfileWorkspace(
    input: SetCurrentAgentProfileWorkspaceInput
  ): Promise<SetCurrentAgentProfileWorkspaceResponse> {
    return super.setCurrentAgentProfileWorkspace(input);
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

  executeAgentProfileWorkRecovery(
    input: ExecuteAgentProfileWorkRecoveryInput
  ): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
    return super.executeAgentProfileWorkRecovery(input);
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
    input: EnsureAgentProfilePrimaryBindingInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return super.ensureAgentProfilePrimaryBinding(input);
  }

  updateAgentProfilePrimaryBindingModelSelection(
    input: UpdateAgentProfilePrimaryBindingModelSelectionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return super.updateAgentProfilePrimaryBindingModelSelection(input);
  }

  updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return super.updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
      input
    );
  }

  updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
    input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return super.updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
      input
    );
  }

  updateAgentProfilePrimaryBindingOpenCodePermission(
    input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
  ): Promise<EnsureAgentProfilePrimaryBindingResponse> {
    return super.updateAgentProfilePrimaryBindingOpenCodePermission(input);
  }

  disableAgentProfilePrimaryBinding(
    input: DisableAgentProfilePrimaryBindingInput
  ): Promise<DisableAgentProfilePrimaryBindingResponse> {
    return super.disableAgentProfilePrimaryBinding(input);
  }

  authorizeAgentProfileBindingForOrganization(
    input: AuthorizeAgentProfileBindingForOrganizationInput
  ): Promise<AuthorizeAgentProfileBindingForOrganizationResponse> {
    return super.authorizeAgentProfileBindingForOrganization(input);
  }

  bulkAuthorizeAgentProfileBindingsForOrganization(
    input: BulkAuthorizeAgentProfileBindingsForOrganizationInput
  ): Promise<BulkAuthorizeAgentProfileBindingsForOrganizationResponse> {
    return super.bulkAuthorizeAgentProfileBindingsForOrganization(input);
  }

  saveOrganizationWakeAccessChoice(
    input: SaveOrganizationWakeAccessChoiceInput
  ): Promise<SaveOrganizationWakeAccessChoiceResponse> {
    return super.saveOrganizationWakeAccessChoice(input);
  }

  listOrganizationBindingAuthorizations(
    input: ListOrganizationBindingAuthorizationsInput
  ): Promise<ListOrganizationBindingAuthorizationsResponse> {
    return super.listOrganizationBindingAuthorizations(input);
  }

  listOrganizationBindingAuthorizationProfiles(
    input: ListOrganizationBindingAuthorizationProfilesInput
  ): Promise<ListOrganizationBindingAuthorizationProfilesResponse> {
    return super.listOrganizationBindingAuthorizationProfiles(input);
  }

  listCurrentUserAgentProfileOrganizationWakeAccess(
    input: ListCurrentUserAgentProfileOrganizationWakeAccessInput
  ): Promise<ListCurrentUserAgentProfileOrganizationWakeAccessResponse> {
    return super.listCurrentUserAgentProfileOrganizationWakeAccess(input);
  }

  revokeAgentProfileBindingForOrganization(
    input: RevokeAgentProfileBindingForOrganizationInput
  ): Promise<RevokeAgentProfileBindingForOrganizationResponse> {
    return super.revokeAgentProfileBindingForOrganization(input);
  }

  getOrganizationBindingAuthorizationPreference(
    input: GetOrganizationBindingAuthorizationPreferenceInput
  ): Promise<GetOrganizationBindingAuthorizationPreferenceResponse> {
    return super.getOrganizationBindingAuthorizationPreference(input);
  }

  getAgentProfileCreationDefaults(
    input: GetAgentProfileCreationDefaultsInput
  ): Promise<GetAgentProfileCreationDefaultsResponse> {
    return super.getAgentProfileCreationDefaults(input);
  }

  setAgentProfileCreationDefaults(
    input: SetAgentProfileCreationDefaultsInput
  ): Promise<SetAgentProfileCreationDefaultsResponse> {
    return super.setAgentProfileCreationDefaults(input);
  }

  setOrganizationBindingAuthorizationPreference(
    input: SetOrganizationBindingAuthorizationPreferenceInput
  ): Promise<SetOrganizationBindingAuthorizationPreferenceResponse> {
    return super.setOrganizationBindingAuthorizationPreference(input);
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

  recordCurrentOrganizationWebActivity(
    input: RecordCurrentOrganizationWebActivityInput
  ): Promise<OrganizationMemberWebActivityResponse> {
    return super.recordCurrentOrganizationWebActivity(input);
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
  centerAgentInviteSlackTeammates(
    input: CenterAgentInviteSlackTeammatesRpcInput
  ): Promise<CenterAgentInviteSlackTeammatesRpcResponse> {
    return handleCenterAgentSlackTeammateInvitations(this.env, input);
  }

  listCenterAgentTasks(
    input: ListCenterAgentTasksRpcInput
  ): Promise<ListCenterAgentTasksRpcResponse> {
    return super.listCenterAgentTasks(input);
  }

  getCenterAgentTask(
    input: GetCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.getCenterAgentTask(input);
  }

  continueCenterAgentTask(
    input: ContinueCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.continueCenterAgentTask(input);
  }

  stopCenterAgentTask(
    input: StopCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.stopCenterAgentTask(input);
  }

  retryCenterAgentTask(
    input: RetryCenterAgentTaskRpcInput
  ): Promise<CenterAgentTaskDetailRpcResponse> {
    return super.retryCenterAgentTask(input);
  }

  centerAgentCreateTask(
    input: CenterAgentCreateTaskToolRpcInput
  ): Promise<CreateCenterAgentTaskResponse> {
    return rpcCenterAgentCreateTask(this.env, input);
  }

  centerAgentListTasks(
    input: CenterAgentListTasksToolRpcInput
  ): Promise<ListCenterAgentTasksResponse> {
    return rpcCenterAgentListTasksTool(this.env, input);
  }

  centerAgentGetTask(
    input: CenterAgentGetTaskToolRpcInput
  ): Promise<CenterAgentTaskDetail> {
    return rpcCenterAgentGetTaskTool(this.env, input);
  }

  centerAgentListOrganizationMembers(
    input: CenterAgentListOrganizationMembersToolRpcInput
  ): Promise<CenterAgentListOrganizationMembersResponse> {
    return rpcCenterAgentListOrganizationMembers(this.env, input);
  }

  centerAgentAuthorizeAnonymousMemberTool(
    input: CenterAgentAuthorizeAnonymousMemberToolRpcInput
  ): Promise<CenterAgentAuthorizeAnonymousMemberToolResponse> {
    return rpcCenterAgentAuthorizeAnonymousMemberTool(this.env, input);
  }

  centerAgentListProjects(
    input: CenterAgentListProjectsToolRpcInput
  ): Promise<CenterAgentListProjectsToolResponse> {
    return rpcCenterAgentListProjects(this.env, input);
  }

  centerAgentCreateProject(
    input: CenterAgentCreateProjectToolRpcInput
  ): Promise<CenterAgentCreateProjectToolResponse> {
    return rpcCenterAgentCreateProject(this.env, input);
  }

  centerAgentUpdateProject(
    input: CenterAgentUpdateProjectToolRpcInput
  ): Promise<CenterAgentUpdateProjectToolResponse> {
    return rpcCenterAgentUpdateProject(this.env, input);
  }

  centerAgentSetAgentProfileDefaultProject(
    input: CenterAgentSetAgentProfileDefaultProjectToolRpcInput
  ): Promise<CenterAgentSetAgentProfileDefaultProjectToolResponse> {
    return rpcCenterAgentSetAgentProfileDefaultProject(this.env, input);
  }

  centerAgentPrepareRemoveProject(
    input: CenterAgentPrepareRemoveProjectToolRpcInput
  ): Promise<CenterAgentPrepareRemoveProjectToolResponse> {
    return rpcCenterAgentPrepareRemoveProject(this.env, input);
  }

  centerAgentRemoveProject(
    input: CenterAgentRemoveProjectToolRpcInput
  ): Promise<CenterAgentRemoveProjectToolResponse> {
    return rpcCenterAgentRemoveProject(this.env, input);
  }

  centerAgentReadOrganizationDocuments(
    input: CenterAgentReadOrganizationDocumentsRpcInput
  ): Promise<CenterAgentReadOrganizationDocumentsResponse> {
    return rpcCenterAgentReadOrganizationDocuments(this.env, input);
  }

  centerAgentOrganizationDocumentsComputerSnapshot(
    input: CenterAgentOrganizationDocumentsComputerSnapshotRpcInput
  ): Promise<CenterAgentOrganizationDocumentsComputerSnapshotResponse> {
    return rpcCenterAgentOrganizationDocumentsComputerSnapshot(this.env, input);
  }

  centerAgentDraftOrganizationDocument(
    input: CenterAgentDraftOrganizationDocumentRpcInput
  ): Promise<CenterAgentDraftOrganizationDocumentResponse> {
    return rpcCenterAgentDraftOrganizationDocument(this.env, input);
  }

  async centerAgentStartSelfMemberResearch(
    input: CenterAgentStartSelfMemberResearchToolRpcInput
  ): Promise<StartCenterAgentMemberResearchResponse> {
    const response = await rpcCenterAgentStartSelfMemberResearch(
      this.env,
      input
    );
    const db = localStateDb(this.env);
    if (db) {
      this.ctx.waitUntil(
        runCenterAgentMemberResearchTick({ db, env: this.env })
      );
    }
    return response;
  }

  recordCenterAgentMemberResearchComputerFile(
    input: RecordCenterAgentMemberResearchComputerFileRpcInput
  ): Promise<RecordCenterAgentMemberResearchComputerFileResponse> {
    return rpcRecordCenterAgentMemberResearchComputerFile(this.env, input);
  }

  centerAgentManageOrganizationDocuments(
    input: CenterAgentManageOrganizationDocumentsRpcInput
  ): Promise<CenterAgentManageOrganizationDocumentsResponse> {
    return rpcCenterAgentManageOrganizationDocuments(this.env, input);
  }

  readOrganizationDocumentPromptContext(
    input: OrganizationDocumentPromptContextRpcInput
  ): Promise<OrganizationDocumentPromptContextResponse> {
    return rpcReadOrganizationDocumentPromptContext(this.env, input);
  }

  centerAgentCreateOrganizationInviteLink(
    input: CenterAgentCreateOrganizationInviteLinkToolRpcInput
  ): Promise<CenterAgentCreateOrganizationInviteLinkResponse> {
    return rpcCenterAgentCreateOrganizationInviteLink(this.env, input);
  }

  centerAgentGetOrganizationInviteLink(
    input: CenterAgentGetOrganizationInviteLinkToolRpcInput
  ): Promise<CenterAgentGetOrganizationInviteLinkResponse> {
    return rpcCenterAgentGetOrganizationInviteLink(this.env, input);
  }

  centerAgentReadAgentActivity(input: CenterAgentReadAgentActivityInput) {
    return rpcCenterAgentReadAgentActivity(this.env, input);
  }

  centerAgentListAgentActivitySessions(
    input: CenterAgentListAgentActivitySessionsInput
  ) {
    return rpcCenterAgentListAgentActivitySessions(this.env, input);
  }

  centerAgentReadChangelog(input: CenterAgentReadChangelogInput) {
    return rpcCenterAgentReadChangelog(this.env, input);
  }

  centerAgentReadTurnDiagnostics(
    input: CenterAgentReadTurnDiagnosticsInput
  ): Promise<CenterAgentReadTurnDiagnosticsResponse> {
    return rpcCenterAgentReadTurnDiagnostics(this.env, input);
  }

  centerAgentListOpportunities(input: CenterAgentListOpportunitiesInput) {
    return rpcCenterAgentListOpportunities(this.env, input);
  }

  centerAgentRecommendOpportunity(input: CenterAgentRecommendOpportunityInput) {
    return rpcCenterAgentRecommendOpportunity(this.env, input);
  }

  centerAgentRespondToOpportunity(input: CenterAgentRespondToOpportunityInput) {
    return rpcCenterAgentRespondToOpportunity(this.env, input);
  }

  centerAgentSetOrganizationWorkingLanguage(
    input: CenterAgentSetOrganizationWorkingLanguageToolRpcInput
  ): Promise<CenterAgentSetOrganizationWorkingLanguageToolResponse> {
    return rpcCenterAgentSetOrganizationWorkingLanguage(this.env, input);
  }

  centerAgentListRoutines(
    input: CenterAgentListRoutinesToolRpcInput
  ): Promise<ListCenterAgentRoutinesResponse> {
    return rpcCenterAgentListRoutines(this.env, input);
  }

  centerAgentCreateRoutine(
    input: CenterAgentCreateRoutineToolRpcInput
  ): Promise<CreateCenterAgentRoutineResponse> {
    return rpcCenterAgentCreateRoutine(this.env, input);
  }

  centerAgentUpdateRoutine(
    input: CenterAgentUpdateRoutineToolRpcInput
  ): Promise<UpdateCenterAgentRoutineResponse> {
    return rpcCenterAgentUpdateRoutine(this.env, input);
  }

  centerAgentDeleteRoutine(
    input: CenterAgentDeleteRoutineToolRpcInput
  ): Promise<DeleteCenterAgentRoutineResponse> {
    return rpcCenterAgentDeleteRoutine(this.env, input);
  }

  centerAgentPauseRoutine(
    input: CenterAgentPauseRoutineToolRpcInput
  ): Promise<PauseCenterAgentRoutineResponse> {
    return rpcCenterAgentPauseRoutine(this.env, input);
  }

  centerAgentResumeRoutine(
    input: CenterAgentResumeRoutineToolRpcInput
  ): Promise<ResumeCenterAgentRoutineResponse> {
    return rpcCenterAgentResumeRoutine(this.env, input);
  }
}

/**
 * Compatibility entrypoint for already-deployed Remote Agent bindings.
 * New bindings use CenterAgentRpcEntrypoint because this private surface now
 * carries multiple Center Agent product-tool families, not only Routines.
 */
export class CenterAgentRoutineRpcEntrypoint extends CenterAgentRpcEntrypoint {}

function toLegacySpaceAddressingRpcOutput<T>(value: T): T {
  return toLegacySpaceAddressingWireValue(value) as T;
}

async function withLegacySpaceAddressingRpcOutput<T>(
  value: Promise<T>
): Promise<T> {
  return toLegacySpaceAddressingRpcOutput(await value);
}

class CoreEntrypoint extends CenterAgentRpcEntrypoint {
  ping() {
    return super.ping();
  }

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    await handleCoreQueueBatch({
      batch,
      ctx: this.ctx,
      env: this.env,
    });
  }

  async scheduled(controller: ScheduledController): Promise<void> {
    await runCoreScheduledTasks({
      env: this.env,
      cron: controller.cron,
      nowMs: Date.now(),
    });
  }
}

export {
  app,
  PrepareSessionHub,
  RoutineRunWorkflow,
  RuntimeTransportHub,
  Space,
};
export default CoreEntrypoint;
