// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

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
export { createAgentActivityApi } from "./agent-activity/api";
export {
  buildAgentActivitySnapshotPath,
  buildAgentActivityStatsPath,
} from "./agent-activity/routes";
export type {
  AgentActivityApi,
  AgentActivityRequestInput,
  CreateAgentActivityApi,
  ReadAgentActivitySnapshotInput,
  ReadAgentActivityStatsInput,
} from "./agent-activity/types";
export { createAgentProfileBindingApi } from "./agent-profile-binding/api";
export {
  buildAgentProfileBindingOrganizationAuthorizationsRoute,
  buildAgentProfilePrimaryBindingOrganizationAuthorizationRoute,
} from "./agent-profile-binding/routes";
export type {
  AuthorizeAgentProfileBindingForOrganizationInput,
  CreateAgentProfileBindingApi,
  DisableAgentProfilePrimaryBindingInput,
  EnsureAgentProfilePrimaryBindingInput,
  GetAgentExecutionReadinessBatchInput,
  GetAgentExecutionReadinessInput,
  GetAgentProfilePrimaryBindingInput,
  ListOrganizationBindingAuthorizationsInput,
  RevokeAgentProfileBindingForOrganizationInput,
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput,
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput,
  UpdateAgentProfilePrimaryBindingModelSelectionInput,
  UpdateAgentProfilePrimaryBindingOpenCodePermissionInput,
} from "./agent-profile-binding/types";
export { normalizeApiBaseUrl } from "./base-url";
export { createCenterAgentApi } from "./center-agent/api";
export {
  buildCenterAgentAuditJournalPath,
  buildCenterAgentDesignationPath,
  buildCenterAgentDirectMessageSpacePath,
  buildCenterAgentOperatingStatePath,
  buildCenterAgentProfilePath,
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
export { createCenterAgentTasksApi } from "./center-agent-tasks/api";
export {
  buildCenterAgentTaskMessagesPath,
  buildCenterAgentTaskPath,
  buildCenterAgentTaskRetryPath,
  buildCenterAgentTaskStopPath,
  buildCenterAgentTasksPath,
} from "./center-agent-tasks/routes";
export type {
  CenterAgentTaskRequestInput,
  CenterAgentTasksApi,
  ContinueCenterAgentTaskInput,
  CreateCenterAgentTasksApi,
  GetCenterAgentTaskInput,
  ListCenterAgentTasksInput,
  RetryCenterAgentTaskInput,
  StopCenterAgentTaskInput,
} from "./center-agent-tasks/types";
export type {
  OpenMeldApiClientConfig,
  OpenMeldApiClientFoundation,
  OpenMeldApiClientRequestOptions,
} from "./client";
export { createOpenMeldApiClient } from "./client";
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
  buildDirectMessageSpacePath,
} from "./direct-message/routes";
export type {
  ConvertDirectMessageToSpaceInput,
  CreateDirectMessageApi,
  DirectMessageApi,
  DirectMessageRequestInput,
  OpenDirectMessageSpaceInput,
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
export { createInboxApi } from "./inbox/api";
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
export { createOrganizationApi } from "./organization/api";
export {
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
  buildCurrentOrganizationMessageChannelsPath,
  buildCurrentOrganizationSpacesPath,
  buildCurrentOrganizationSpacesWithMemberCountsPath,
  buildOrganizationBindingAuthorizationPreferencePath,
  buildOrganizationBindingAuthorizationProfilesPath,
  buildOrganizationBindingAuthorizationsBulkPath,
  buildOrganizationWakeAccessChoicePath,
} from "./organization/routes";
export type {
  BeginLarkPlatformRegistrationInput,
  BulkAuthorizeAgentProfileBindingsForOrganizationInput,
  CreateOrganizationApi,
  OrganizationApi,
  OrganizationRequestInput,
  OrganizationRouteInput,
  PollLarkPlatformRegistrationInput,
  SaveOrganizationWakeAccessChoiceInput,
  SetOrganizationBindingAuthorizationPreferenceInput,
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
  buildOrganizationSkillEnabledPath,
  buildOrganizationSkillGitHubImportPath,
  buildOrganizationSkillGitHubPreviewPath,
  buildOrganizationSkillMaintainersPath,
  buildOrganizationSkillPath,
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
  ProfilesApi,
  RenameProfileInput,
  UpdateAgentProfileDefaultProjectInput,
} from "./profiles/types";
export { createProjectsApi } from "./projects/api";
export { buildProjectPath, buildProjectsPath } from "./projects/routes";
export type {
  ArchiveProjectInput,
  CreateProjectInput,
  CreateProjectsApi,
  ListProjectsInput,
  ProjectRequestInput,
  ProjectsApi,
  UpdateProjectInput,
} from "./projects/types";
export { publicSpaceUrls } from "./public-space-urls";
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
  SubmitAgentControllerTaskLifecycleEventsInput,
  SubmitRuntimeAgentControllerReportsInput,
  SubmitRuntimeProviderConversationProofsInput,
  SubmitRuntimeRegistrationInput,
} from "./runtime-reporting/types";
export type {
  AddSpaceMembersInput,
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceInput,
  RemoveSpaceMembersInput,
  SetSpaceAccessModeInput,
  SpaceApi,
  SpaceAttachmentUploadBytes,
  SpaceSignalsReadQuery,
  UpdateSpaceMetaInput,
  UploadSpaceAttachmentInput,
} from "./space";
export {
  buildSpaceAttachmentDownloadPath,
  buildSpaceBootstrapReadPath,
  createSpaceApi,
  setSpaceAccessMode,
  updateSpaceMeta,
  uploadSpaceAttachment,
} from "./space";
export type {
  OpenMeldApiClientStreamTransport,
  OpenMeldApiClientTransport,
} from "./transport";
export { createFetchTransport } from "./transport";
