// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

export { readAccountOrganizationContext } from "./account-organization-context";
export { readAccountSession } from "./account-session";
export { createAccountSpaceIndexApi } from "./account-space-index/api";
export {
  buildAccountSpaceActiveWakeSummaryPath,
  buildAccountSpaceIndexPath,
  resolveAccountSpaceIndexGatewayHost,
} from "./account-space-index/routes";
export type {
  AccountSpaceIndexApi,
  CreateAccountSpaceIndexApi,
  ListAccountSpaceIndexInput,
} from "./account-space-index/types";
export { createAgentAccessApi } from "./agent-access/api";
export type {
  AgentAccessApi,
  CreateAgentAccessApi,
} from "./agent-access/types";
export { createAgentActivityApi } from "./agent-activity/api";
export {
  buildAgentActivitySessionsPath,
  buildAgentActivitySnapshotPath,
  buildAgentActivityStatsPath,
} from "./agent-activity/routes";
export type {
  AgentActivityApi,
  AgentActivityRequestInput,
  CreateAgentActivityApi,
  ReadAgentActivitySessionsInput,
  ReadAgentActivitySnapshotInput,
  ReadAgentActivityStatsInput,
} from "./agent-activity/types";
export { createAgentProfileBindingApi } from "./agent-profile-binding/api";
export { buildCurrentAgentProfileSessionRoute } from "./agent-profile-binding/routes";
export type {
  CreateAgentProfileBindingApi,
  DisableAgentProfilePrimaryBindingInput,
  EnsureAgentProfilePrimaryBindingInput,
  GetAgentExecutionReadinessBatchInput,
  GetAgentExecutionReadinessInput,
  GetAgentProfilePrimaryBindingInput,
  GetCurrentAgentProfileSessionInput,
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput,
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput,
  UpdateAgentProfilePrimaryBindingModelSelectionInput,
  UpdateAgentProfilePrimaryBindingOpenCodePermissionInput,
} from "./agent-profile-binding/types";
export { createAgentProfileExecutionModeApi } from "./agent-profile-execution-mode";
export { createAgentProfileWorkRecoveryApi } from "./agent-profile-work-recovery/api";
export { buildAgentProfileWorkRecoveryRoute } from "./agent-profile-work-recovery/routes";
export type {
  CreateAgentProfileWorkRecoveryApi,
  ExecuteAgentProfileWorkRecoveryInput,
} from "./agent-profile-work-recovery/types";
export { normalizeApiBaseUrl } from "./base-url";
export { createCenterAgentApi } from "./center-agent/api";
export {
  buildCenterAgentAuditJournalPath,
  buildCenterAgentDesignationPath,
  buildCenterAgentDirectMessageSpacePath,
  buildCenterAgentOperatingStatePath,
  buildCenterAgentProfilePath,
  buildCenterAgentSessionPath,
  buildCenterAgentSessionsPath,
} from "./center-agent/routes";
export type {
  CenterAgentApi,
  CenterAgentDesignateInput,
  CenterAgentRequestInput,
  CenterAgentUpdateOperatingStateInput,
  CenterAgentUpdateProfileInput,
  CreateCenterAgentApi,
  ListCenterAgentAuditJournalInput,
} from "./center-agent/types";
export { readCliRelease } from "./cli-release";
export type {
  OpenMeldApiClientConfig,
  OpenMeldApiClientFoundation,
  OpenMeldApiClientRequestOptions,
} from "./client";
export { createOpenMeldApiClient } from "./client";
export { createCloudComputerApi } from "./cloud-computer";
export { createComputerAuthorizationGrant } from "./computer-authorization";
export { createComputerFileAccessApi } from "./computer-file-access/api";
export {
  buildComputerFileAccessReadPath,
  buildComputerFileAccessUpdatePath,
} from "./computer-file-access/routes";
export type {
  ComputerFileAccessApi,
  ComputerFileAccessRequestInput,
  CreateComputerFileAccessApi,
  ReadComputerFileAccessPolicyInput,
  UpdateComputerFileAccessPolicyInput,
} from "./computer-file-access/types";
export { createComputerPowerApi } from "./computer-power";
export { createConfigApi, getModelCatalog } from "./config/api";
export { buildModelCatalogPath } from "./config/routes";
export type { ConfigApi, CreateConfigApi } from "./config/types";
export { createCurrentDeviceApi } from "./current-device/api";
export type {
  CreateCurrentDeviceApi,
  CurrentLocalRuntimeReplyReadinessResponse,
  EnrollLocalRuntimeInput,
  ForgetComputerInput,
  ForgetComputerResponse,
  ForgetCurrentComputerResponse,
  ListLocalRuntimesInput,
  LocalRuntimeEnrollmentResponse,
  LocalRuntimesResponse,
  SelectCurrentLocalAgentInstallationInput,
  SetLocalRuntimeDisplayNameInput,
  WriteCurrentDeviceObservedMetadataInput,
} from "./current-device/types";
export { createDirectMessageApi } from "./direct-message/api";
export {
  buildDirectMessageConversionPath,
  buildDirectMessageSessionPath,
  buildDirectMessageSessionsPath,
  buildDirectMessageSpacePath,
} from "./direct-message/routes";
export type {
  ConvertDirectMessageToSpaceInput,
  CreateDirectMessageApi,
  DeleteAgentDirectMessageSessionInput,
  DirectMessageApi,
  DirectMessageRequestInput,
  ListAgentDirectMessageSessionsInput,
  OpenDirectMessageSpaceInput,
  UpdateAgentDirectMessageSessionInput,
} from "./direct-message/types";
export type { StructuredApiClientFailure } from "./errors";
export {
  OpenMeldApiClientHttpError,
  OpenMeldApiClientInvalidResponseError,
  toStructuredApiClientFailure,
} from "./errors";
export { createFeedbackApi } from "./feedback/api";
export {
  buildCurrentOrganizationFeedbackReportingPolicyPath,
  buildFeedbackIssueSubmissionPath,
} from "./feedback/routes";
export type {
  CreateFeedbackApi,
  FeedbackApi,
  FeedbackRequestInput,
  SetCurrentOrganizationFeedbackReportingPolicyInput,
  SubmitFeedbackIssueInput,
} from "./feedback/types";
export type { FileRootLocation } from "./file-root/api";
export { createFileRootApi } from "./file-root/api";
export { createFirstWorkApi } from "./first-work";
export { createInboxApi } from "./inbox/api";
export { isInboxItemInOrganizationScope } from "./inbox/item-scope";
export {
  inboxMessageNotificationSpaceId,
  isInboxItemVisibleConversation,
  isInboxNotificationEligible,
} from "./inbox/notification-policy";
export {
  buildCenterAgentInboxReadThroughPath,
  buildCenterAgentInboxSummaryPath,
  buildInboxItemDismissPath,
  buildInboxItemPath,
  buildInboxItemReadPath,
  buildInboxMarkAllReadPath,
  buildInboxPath,
  buildInboxPreferencesPath,
  buildInboxSummaryPath,
  buildSpaceInboxReadThroughPath,
  buildSpaceInboxSummaryPath,
  buildSpaceInboxUnreadTargetsPath,
} from "./inbox/routes";
export type {
  CreateInboxApi,
  InboxApi,
  InboxRequestInput,
} from "./inbox/types";
export { createLocalFolderPickerApi } from "./local-folder-picker/api";
export { buildLocalFolderPickerPath } from "./local-folder-picker/routes";
export type {
  CreateLocalFolderPickerApi,
  LocalFolderPickerApi,
  LocalFolderPickerRequestInput,
  SelectLocalFoldersInput,
} from "./local-folder-picker/types";
export { createLocalProjectControlApi } from "./local-project-control/api";
export {
  buildLocalProjectControlPath,
  type LocalProjectControlRoute,
} from "./local-project-control/routes";
export type {
  ConnectLocalProjectCandidateInput,
  ConnectLocalProjectDeclaredPathInput,
  CreateLocalProjectControlApi,
  DiscoverLocalProjectsInput,
  LocalProjectControlApi,
  LocalProjectControlRequestInput,
  RemoveLocalProjectConnectionInput,
  RemoveMissingLocalProjectConnectionsInput,
  SetDefaultLocalProjectConnectionInput,
} from "./local-project-control/types";
export {
  createLocalRuntimeExpectedRoutesApi,
  type GetLocalRuntimeExpectedRoutesInput,
  type LocalRuntimeExpectedRoutesApi,
} from "./local-runtime/api";
export {
  createMemberAgentsApi,
  isMemberAgentsDisabledError,
} from "./member-agents/api";
export { buildMemberAgentsPath } from "./member-agents/routes";
export type {
  CreateMemberAgentsApi,
  MemberAgentsApi,
} from "./member-agents/types";
export { createOrganizationApi } from "./organization/api";
export {
  buildAgentProfileCreationApprovalPreferencePath,
  buildAgentProfileCreationDefaultsPath,
  buildAgentProfileCreationRequestCancelPath,
  buildAgentProfileCreationRequestDecisionPath,
  buildAgentProfileCreationRequestRetryPath,
  buildAgentProfileCreationRequestsPath,
  buildCurrentOrganizationCenterAgentMemoryWipeSelfPath,
  buildCurrentOrganizationComputersPath,
  buildCurrentOrganizationDirectoryPath,
  buildCurrentOrganizationInformationProtectionPath,
  buildCurrentOrganizationLogoPath,
  buildCurrentOrganizationMemberOpenMeldServiceStatusesPath,
  buildCurrentOrganizationMessageChannelPath,
  buildCurrentOrganizationMessageChannelRegistrationPath,
  buildCurrentOrganizationMessageChannelRegistrationPollPath,
  buildCurrentOrganizationMessageChannelRegistrationsPath,
  buildCurrentOrganizationMessageChannelSetupRequestsPath,
  buildCurrentOrganizationMessageChannelsPath,
  buildCurrentOrganizationSpacesPath,
  buildCurrentOrganizationSpacesWithMemberCountsPath,
} from "./organization/routes";
export type {
  AgentProfileCreationDefaultsRouteInput,
  AgentProfileCreationRequestRouteInput,
  BeginLarkPlatformRegistrationInput,
  CreateAgentProfileCreationRequestInput,
  CreateOrganizationApi,
  DecideAgentProfileCreationRequestInput,
  OrganizationApi,
  OrganizationRequestInput,
  OrganizationRouteInput,
  PollLarkPlatformRegistrationInput,
  RequestMessageChannelSetupInput,
  SetAgentProfileCreationApprovalPreferenceInput,
  SetAgentProfileCreationDefaultsInput,
  SetOrganizationInformationProtectionInput,
  UpdateCurrentOrganizationLogoInput,
} from "./organization/types";
export { createOrganizationDocumentsApi } from "./organization-documents/api";
export {
  buildCenterAgentMemberResearchPath,
  buildOrganizationDocumentApproveDraftPath,
  buildOrganizationDocumentDiscardDraftPath,
  buildOrganizationDocumentPath,
  buildOrganizationDocumentsPath,
} from "./organization-documents/routes";
export type {
  CreateOrganizationDocumentsApi,
  OrganizationDocumentRequestInput,
  OrganizationDocumentsApi,
} from "./organization-documents/types";
export { createOrganizationSkillsApi } from "./organization-skills/api";
export {
  buildOrganizationSkillCatalogPath,
  buildOrganizationSkillEnabledPath,
  buildOrganizationSkillFilesImportPath,
  buildOrganizationSkillFilesPreviewPath,
  buildOrganizationSkillGitHubImportPath,
  buildOrganizationSkillGitHubPreviewPath,
  buildOrganizationSkillMaintainersPath,
  buildOrganizationSkillPath,
  buildOrganizationSkillRepositoryPreviewPath,
  buildOrganizationSkillResourcePath,
  buildOrganizationSkillsPath,
} from "./organization-skills/routes";
export type {
  CreateOrganizationSkillsApi,
  OrganizationSkillRequestInput,
  OrganizationSkillsApi,
} from "./organization-skills/types";
export { createOrganizationUsageApi } from "./organization-usage/api";
export { buildOrganizationUsageOverviewPath } from "./organization-usage/routes";
export type {
  CreateOrganizationUsageApi,
  OrganizationUsageApi,
  OrganizationUsageRequestInput,
} from "./organization-usage/types";
export { createPermissionModeSuggestionsApi } from "./permission-mode-suggestions/api";
export { createPluginsApi } from "./plugins/api";
export { createPrepareReadinessApi } from "./prepare-readiness/api";
export type {
  CreatePrepareReadinessApi,
  GetPrepareReadinessInput,
} from "./prepare-readiness/types";
export { createProfileSpaceHistoryApi } from "./profile-space-history/api";
export {
  buildProfileSpaceHistoryListPath,
  buildProfileSpaceHistoryStatusPath,
  buildProfileSpaceHistoryUpsertPath,
  resolveProfileSpaceHistoryGatewayHost,
} from "./profile-space-history/routes";
export type {
  CreateProfileSpaceHistoryApi,
  ListProfileSpaceHistoryInput,
  ProfileSpaceHistoryApi,
  UpdateProfileSpaceHistoryStatusInput,
  UpsertProfileSpaceHistoryInput,
} from "./profile-space-history/types";
export { createProfilesApi } from "./profiles/api";
export { buildProfileRoute } from "./profiles/routes";
export type {
  CreateProfilesApi,
  GetAgentProfileFoldersInput,
  ManageAgentProfileFoldersInput,
  ProfilesApi,
  RenameProfileInput,
  UpdateAgentProfileDefaultProjectInput,
} from "./profiles/types";
export { createProjectsApi } from "./projects/api";
export {
  buildProjectCommonAgentsPath,
  buildProjectIssueRoutingPath,
  buildProjectPath,
  buildProjectRepositoriesPath,
  buildProjectsPath,
} from "./projects/routes";
export type {
  ArchiveProjectInput,
  CreateProjectInput,
  CreateProjectsApi,
  ListProjectsInput,
  ProjectRequestInput,
  ProjectsApi,
  ReadProjectCommonAgentsInput,
  ReadProjectIssueRoutingInput,
  ReadProjectRepositorySettingsInput,
  UpdateProjectCommonAgentsInput,
  UpdateProjectInput,
  UpdateProjectIssueRoutingInput,
  UpdateProjectRepositorySettingsInput,
} from "./projects/types";
export { publicSpaceUrls } from "./public-space-urls";
export { createReasoningStreamApi } from "./reasoning-stream";
export { createRoutinesApi } from "./routines/api";
export {
  buildRoutinePath,
  buildRoutinePausePath,
  buildRoutineResumePath,
  buildRoutineRunsPath,
  buildRoutinesPath,
  buildRoutineTargetSpacesPath,
} from "./routines/routes";
export type {
  CreateRoutineInput,
  CreateRoutinesApi,
  ListRoutineRunsInput,
  ListRoutinesInput,
  ListRoutineTargetSpacesInput,
  RoutineMutationInput,
  RoutineRequestInput,
  RoutinesApi,
  UpdateRoutineInput,
} from "./routines/types";
export { createRuntimeReportingApi } from "./runtime-reporting/api";
export type {
  CreateRuntimeReportingApi,
  SubmitAgentActivityEventsInput,
  SubmitAgentActivitySessionReconciliationInput,
  SubmitAgentControllerTaskLifecycleEventsInput,
  SubmitRuntimeAgentControllerReportsInput,
  SubmitRuntimeProviderConversationProofsInput,
  SubmitRuntimeRegistrationInput,
} from "./runtime-reporting/types";
export { createSensitiveOperationsApi } from "./sensitive-operations/api";
export type {
  CreateSensitiveOperationsApi,
  SensitiveOperationsApi,
} from "./sensitive-operations/types";
export { createServiceConnectionEvidenceApi } from "./service-connection-evidence/api";
export { createSessionHistoryApi } from "./session-history/api";
export type {
  AddSpaceMembersInput,
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceInput,
  RemoveSpaceMembersInput,
  ResolveSpaceEntryInput,
  SetSpaceAccessModeInput,
  SpaceApi,
  SpaceAttachmentUploadBytes,
  SpaceFileContent,
  SpaceFileContentBytes,
  SpaceSignalsReadQuery,
  UpdateSpaceMetaInput,
  UploadSpaceAttachmentInput,
} from "./space";
export {
  buildSpaceAttachmentDownloadPath,
  buildSpaceBootstrapReadPath,
  createSpaceApi,
  createSpaceFolder,
  downloadSpaceFileContent,
  getSpaceFile,
  listSpaceFileRevisions,
  listSpaceFiles,
  postSpaceWorkHandoff,
  setSpaceAccessMode,
  trashSpaceFileEntry,
  updateSpaceFileContent,
  updateSpaceFileEntry,
  updateSpaceMeta,
  uploadSpaceAttachment,
  uploadSpaceFile,
} from "./space";
export { readOrUpdateSpaceInputQueue } from "./space/input-queue";
export {
  readOrUpdateSpaceFilePins,
  readOrUpdateSpaceMessagePins,
} from "./space/message-pins";
export { buildSpaceFileContentPath } from "./space/routes";
export {
  createSpaceTask,
  getSpaceTask,
  listSpaceTasks,
  mutateSpaceTask,
} from "./space/tasks";
export { createSpacePreferencesApi } from "./space-preferences";
export type {
  OpenMeldApiClientStreamTransport,
  OpenMeldApiClientTransport,
} from "./transport";
export { createFetchTransport } from "./transport";
